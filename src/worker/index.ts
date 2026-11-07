import { AccountsDO, AuthError } from "./accounts";
import { TableDO } from "./table";
import { type AuthUser, type Env, SESSION_COOKIE, SESSION_TTL_MS, accounts, error, json, randomCode, readCookie } from "./env";
import { LIMITS, validateConfig } from "@shared/protocol";

export { AccountsDO, TableDO };

function cookieHeader(req: Request, token: string | null): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  if (token === null) return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${secure}`;
}

async function currentUser(req: Request, env: Env): Promise<AuthUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const u = await accounts(env).session(token);
  return u ? { id: u.id, username: u.username } : null;
}

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
  const acc = accounts(env);

  try {
    // ----- auth -----
    if (path === "/api/signup" && method === "POST") {
      const b = await readBody(req);
      const { user, token } = await acc.signup(String(b.username ?? "").trim(), String(b.pin ?? ""));
      return json({ user }, { headers: { "set-cookie": cookieHeader(req, token) } });
    }
    if (path === "/api/login" && method === "POST") {
      const b = await readBody(req);
      const { user, token } = await acc.login(String(b.username ?? "").trim(), String(b.pin ?? ""));
      return json({ user }, { headers: { "set-cookie": cookieHeader(req, token) } });
    }
    if (path === "/api/logout" && method === "POST") {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) await acc.logout(token);
      return json({ ok: true }, { headers: { "set-cookie": cookieHeader(req, null) } });
    }
    if (path === "/api/me" && method === "GET") {
      const user = await currentUser(req, env);
      return json({ user });
    }

    // everything below needs a user
    const user = await currentUser(req, env);
    if (!user) return error(401, "unauthorized", "Please log in");

    if (path === "/api/tables" && method === "POST") {
      const b = await readBody(req);
      const name = String(b.name ?? "").trim().slice(0, LIMITS.maxTableNameLen) || `${user.username}'s game`;
      const config = validateConfig(b.config);
      let code = randomCode();
      // extremely unlikely collision guard
      for (let i = 0; i < 3; i++) {
        const existing = await env.TABLE.get(env.TABLE.idFromName(code)).summary();
        if (!existing) break;
        code = randomCode();
      }
      const stub = env.TABLE.get(env.TABLE.idFromName(code));
      await stub.init({ code, name, hostId: user.id, hostName: user.username, config });
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
      return json({ rows: await acc.leaderboard() });
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
    console.error("api error", e);
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
      const user = await currentUser(req, env);
      if (!user) return error(401, "unauthorized", "Please log in");
      const code = ws[1]!.toUpperCase();
      if (!TABLE_CODE.test(code)) return error(404, "not_found", "No such table");
      const stub = env.TABLE.get(env.TABLE.idFromName(code));
      const headers = new Headers(req.headers);
      headers.set("x-user-id", user.id);
      headers.set("x-user-name", user.username);
      return stub.fetch(new Request(req.url, { headers, method: req.method }));
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
