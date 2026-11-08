import { AccountsDO, AuthError } from "./accounts";
import { TableDO } from "./table";
import { type AuthUser, type Env, SESSION_COOKIE, SESSION_TTL_MS, accounts, error, json, randomCode, readCookie } from "./env";
import { LIMITS, validateConfig } from "@shared/protocol";
import { type Flags, isFlagName } from "@shared/flags";
import { errFields, slog } from "./slog";

export { AccountsDO, TableDO };

function cookieHeader(req: Request, token: string | null): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  if (token === null) return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${secure}`;
}

interface Ctx {
  user: AuthUser | null;
  isAdmin: boolean;
  flags: Flags;
}

async function context(req: Request, env: Env): Promise<Ctx> {
  const token = readCookie(req, SESSION_COOKIE);
  const valid = token && /^[0-9a-f]{64}$/.test(token) ? token : null;
  const me = await accounts(env).me(valid);
  return { user: me.user ? { id: me.user.id, username: me.user.username } : null, isAdmin: me.isAdmin, flags: me.flags };
}

const disabled = () => error(403, "disabled", "This feature is switched off right now");

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = (await req.json()) as unknown;
    return typeof b === "object" && b ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const TABLE_CODE = /^[A-Z0-9]{4,8}$/;

async function handleApi(req: Request, env: Env, path: string): Promise<Response> {
  const method = req.method;
  const url = new URL(req.url);
  const acc = accounts(env);

  try {
    // ----- auth -----
    if (path === "/api/signup" && method === "POST") {
      if (!(await acc.flags()).signup) return error(403, "signups_closed", "Signups are closed right now");
      const b = await readBody(req);
      const { user, token } = await acc.signup(String(b.username ?? "").trim(), String(b.pin ?? ""));
      slog("info", "auth.signup", { user: user.username, userId: user.id });
      return json({ user }, { headers: { "set-cookie": cookieHeader(req, token) } });
    }
    if (path === "/api/login" && method === "POST") {
      const b = await readBody(req);
      const { user, token } = await acc.login(String(b.username ?? "").trim(), String(b.pin ?? "")).catch((e) => {
        slog("warn", "auth.loginFailed", { user: String(b.username ?? "").trim().slice(0, 24), code: (e as { code?: string })?.code });
        throw e;
      });
      slog("info", "auth.login", { user: user.username, userId: user.id });
      return json({ user }, { headers: { "set-cookie": cookieHeader(req, token) } });
    }
    if (path === "/api/logout" && method === "POST") {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) await acc.logout(token);
      return json({ ok: true }, { headers: { "set-cookie": cookieHeader(req, null) } });
    }
    if (path === "/api/me" && method === "GET") {
      const ctx = await context(req, env);
      return json({ user: ctx.user, isAdmin: ctx.isAdmin, flags: ctx.flags });
    }
    if (path === "/api/status" && method === "GET") {
      // Deploy guard: counts only (no table codes). A table is "in play" when a hand is live, or when the
      // session is running/paused with someone connected and activity in the last 20 minutes.
      const codes = await acc.openTableCodes();
      const now = Date.now();
      const rows = await Promise.all(codes.map(async (code) => {
        try { return await env.TABLE.get(env.TABLE.idFromName(code)).liveness(); } catch { return null; }
      }));
      let handsLive = 0, sessionsLive = 0;
      for (const r of rows) {
        if (!r) continue;
        if (r.handLive) handsLive++;
        if (r.handLive || ((r.status === "running" || r.status === "paused") && r.sockets > 0 && now - r.lastActivityAt < 20 * 60_000)) sessionsLive++;
      }
      return json({ ok: true, checkedAt: now, tables: codes.length, sessionsLive, handsLive }, { headers: { "cache-control": "no-store" } });
    }
    if (path === "/api/flags" && method === "GET") {
      return json({ flags: await acc.flags() });
    }

    if (path === "/api/client-log" && method === "POST") {
      const raw = await req.text();
      if (raw.length > 4000) return json({ ok: false });
      let b: Record<string, unknown> = {};
      try { b = JSON.parse(raw) as Record<string, unknown>; } catch { /* keep empty */ }
      const who = (await context(req, env)).user;
      const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
      slog("warn", "client.error", { user: who?.username ?? null, kind: str(b.kind, 40), message: str(b.message, 500), path: str(b.path, 100), src: str(b.src, 200), stack: str(b.stack, 1500), ua: str(b.ua, 200) });
      return json({ ok: true });
    }

    // everything below needs a user
    const ctx = await context(req, env);
    const user = ctx.user;
    if (!user) return error(401, "unauthorized", "Please log in");
    const flags = ctx.flags;

    if (path === "/api/admin/flags" && method === "PUT") {
      if (!ctx.isAdmin) return error(403, "not_admin", "Only an admin can change feature flags");
      const b = await readBody(req);
      if (!isFlagName(b.name) || typeof b.enabled !== "boolean") return error(400, "bad_flag", "Expected { name, enabled }");
      slog("info", "admin.flag", { user: user.username, flag: b.name, enabled: b.enabled });
      return json({ flags: await acc.setFlag(b.name, b.enabled, user.id) });
    }

    const debugMatch = path.match(/^\/api\/admin\/tables\/([A-Za-z0-9]+)\/debug$/);
    if (debugMatch && method === "GET") {
      if (!ctx.isAdmin) return error(403, "not_admin", "Only an admin can read table debug state");
      const code = debugMatch[1]!.toUpperCase();
      if (!TABLE_CODE.test(code)) return error(404, "not_found", "No such table");
      const snap = await env.TABLE.get(env.TABLE.idFromName(code)).debugSnapshot();
      if (!snap) return error(404, "not_found", "No such table");
      return json(snap);
    }

    if (path === "/api/feedback" && method === "POST") {
      if (!flags.feedback) return disabled();
      const b = await readBody(req);
      const kind = b.kind === "bug" ? "bug" : "idea";
      const title = String(b.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      const details = String(b.details ?? "").trim().slice(0, 4000);
      if (title.length < 3) return error(400, "bad_feedback", "Add a short title");
      const ctxInfo = (b.context && typeof b.context === "object" ? b.context : {}) as Record<string, unknown>;
      const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
      const body = [
        details || "_No details given._",
        "",
        "---",
        `Sent from ${"Bink City"} by **${user.username}** · ${kind === "bug" ? "bug report" : "idea"}`,
        `Page: \`${str(ctxInfo.page, 80)}\`${ctxInfo.variant ? ` · Game: ${str(ctxInfo.variant, 20)}` : ""}${ctxInfo.hand ? ` · Hand #${str(ctxInfo.hand, 8)}` : ""}`,
        `Device: ${str(ctxInfo.ua, 200)}`,
      ].join("\n");
      const repo = env.FEEDBACK_REPO || "nishantroy/poker";
      const labels = [kind === "bug" ? "bug" : "enhancement", "from-app"];
      const issueTitle = `${kind === "bug" ? "[Bug]" : "[Idea]"} ${title}`;
      if (!env.GITHUB_TOKEN) {
        const url = `https://github.com/${repo}/issues/new?${new URLSearchParams({ title: issueTitle, body, labels: labels.join(",") })}`;
        slog("info", "feedback.fallback", { user: user.username, kind });
        return json({ ok: true, filed: false, url });
      }
      if (!(await acc.feedbackAllowed(user.id))) return error(429, "too_many", "That's a lot of feedback. Try again in an hour.");
      const gh = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "bink-city-feedback", "x-github-api-version": "2022-11-28", "content-type": "application/json" },
        body: JSON.stringify({ title: issueTitle, body, labels }),
      });
      if (!gh.ok) {
        slog("error", "feedback.githubFailed", { user: user.username, status: gh.status, body: (await gh.text()).slice(0, 300) });
        return error(502, "github_failed", "Could not file that on GitHub right now. Try again later.");
      }
      const issue = (await gh.json()) as { html_url: string; number: number };
      slog("info", "feedback.filed", { user: user.username, kind, issue: issue.number });
      return json({ ok: true, filed: true, url: issue.html_url, number: issue.number });
    }

    if (path === "/api/tables" && method === "POST") {
      if (!flags.createTables) return disabled();
      const b = await readBody(req);
      const name = String(b.name ?? "").trim().slice(0, LIMITS.maxTableNameLen) || `${user.username}'s game`;
      const config = validateConfig(b.config);
      if (!flags.variants) config.variant = "nlhe";
      if (!flags.squid) { config.boards = 1; config.squid = false; }
      let code = randomCode();
      // extremely unlikely collision guard
      for (let i = 0; i < 3; i++) {
        const existing = await env.TABLE.get(env.TABLE.idFromName(code)).summary();
        if (!existing) break;
        code = randomCode();
      }
      const stub = env.TABLE.get(env.TABLE.idFromName(code));
      await stub.init({ code, name, hostId: user.id, hostName: user.username, config, flags });
      slog("info", "table.create", { table: code, user: user.username, config });
      await acc.registerTable({ code, name, hostId: user.id, hostName: user.username, variant: config.variant, smallBlind: config.smallBlind, bigBlind: config.bigBlind });
      return json({ code });
    }
    if (path === "/api/tables" && method === "GET") {
      return json({ tables: await acc.myTables(user.id) });
    }
    const tableMatch = path.match(/^\/api\/tables\/([A-Za-z0-9]+)$/);
    if (tableMatch && method === "GET") {
      const code = tableMatch[1]!.toUpperCase();
      if (!TABLE_CODE.test(code)) return error(404, "not_found", "No such table");
      const s = await env.TABLE.get(env.TABLE.idFromName(code)).summary();
      if (!s) return error(404, "not_found", "No such table");
      await acc.updateTable(code, { memberId: user.id });
      return json({ table: s });
    }
    if (path === "/api/leaderboard" && method === "GET") {
      if (!flags.leaderboard) return disabled();
      return json({ rows: await acc.leaderboard() });
    }
    if (path === "/api/hud" && method === "GET") {
      if (!flags.hud) return disabled();
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter((x) => /^[a-f0-9]{1,32}$/.test(x));
      return json({ rows: await acc.hud(ids) });
    }
    if (path === "/api/stats/me" && method === "GET") {
      return json({ stats: await acc.stats(user.id) });
    }
    const statsMatch = path.match(/^\/api\/stats\/([a-f0-9]+)$/);
    if (statsMatch && method === "GET") {
      return json({ stats: await acc.stats(statsMatch[1]!) });
    }
    return error(404, "not_found", "No such endpoint");
  } catch (e) {
    if (e instanceof AuthError || (e && typeof e === "object" && "status" in e && "code" in e)) {
      const ae = e as AuthError;
      return error(ae.status, ae.code, ae.message);
    }
    slog("error", "api.crash", { path: new URL(req.url).pathname, method: req.method, ...errFields(e) });
    return error(500, "internal", "Something went wrong");
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) return handleApi(req, env, path);

    const ws = path.match(/^\/ws\/table\/([A-Za-z0-9]+)$/);
    if (ws) {
      if (req.headers.get("upgrade") !== "websocket") return error(426, "upgrade", "WebSocket expected");
      const ctx = await context(req, env);
      const user = ctx.user;
      if (!user) return error(401, "unauthorized", "Please log in");
      const code = ws[1]!.toUpperCase();
      if (!TABLE_CODE.test(code)) return error(404, "not_found", "No such table");
      const stub = env.TABLE.get(env.TABLE.idFromName(code));
      const headers = new Headers(req.headers);
      headers.set("x-user-id", user.id);
      headers.set("x-user-name", user.username);
      headers.set("x-flags", JSON.stringify(ctx.flags));
      return stub.fetch(new Request(req.url, { headers, method: req.method }));
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
