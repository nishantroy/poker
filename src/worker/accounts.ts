import { DurableObject } from "cloudflare:workers";
import type { HudCounters, HudRow, LeaderboardRow, SessionResultRow, TableStatus, TableSummary, UserInfo, UserStats, Variant } from "@shared/protocol";
import { emptyHud } from "@engine/hud";
import { LIMITS } from "@shared/protocol";
import { type FlagName, type Flags, FLAG_NAMES, defaultFlags } from "@shared/flags";
import { type Env, SESSION_TTL_MS, hashPin, randomToken, timingSafeEqual } from "./env";
import { errFields, slog } from "./slog";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  table_code TEXT NOT NULL,
  table_name TEXT NOT NULL,
  buy_in INTEGER NOT NULL,
  cash_out INTEGER NOT NULL,
  net INTEGER NOT NULL,
  hands_played INTEGER NOT NULL,
  biggest_pot INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS results_user ON results(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS results_unique ON results(table_code, user_id);
CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tables (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host_id TEXT NOT NULL,
  host_name TEXT NOT NULL,
  variant TEXT NOT NULL,
  small_blind INTEGER NOT NULL,
  big_blind INTEGER NOT NULL,
  status TEXT NOT NULL,
  players INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hud (
  user_id TEXT PRIMARY KEY,
  hands INTEGER NOT NULL DEFAULT 0,
  vpip INTEGER NOT NULL DEFAULT 0,
  pfr INTEGER NOT NULL DEFAULT 0,
  three_bet INTEGER NOT NULL DEFAULT 0,
  agg_bets INTEGER NOT NULL DEFAULT 0,
  agg_calls INTEGER NOT NULL DEFAULT 0,
  saw_flop INTEGER NOT NULL DEFAULT 0,
  wtsd INTEGER NOT NULL DEFAULT 0,
  wsd INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS hud_applied (
  table_code TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS table_members (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (code, user_id)
);
CREATE TABLE IF NOT EXISTS flags (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL
);
`;

export class AuthError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export class AccountsDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(SCHEMA);
    });
  }

  // ---------- auth ----------

  async signup(username: string, pin: string): Promise<{ user: UserInfo; token: string }> {
    if (!LIMITS.usernameRe.test(username)) throw new AuthError(400, "bad_username", "Username: 2–20 letters, numbers or _");
    if (!LIMITS.pinRe.test(pin)) throw new AuthError(400, "bad_pin", "PIN must be 4–6 digits");
    const exists = this.sql.exec("SELECT id FROM users WHERE username = ?", username).toArray();
    if (exists.length) throw new AuthError(409, "taken", "That username is taken");
    const id = randomToken(8);
    const salt = randomToken(16);
    const hash = await hashPin(pin, salt);
    const now = Date.now();
    this.sql.exec("INSERT INTO users (id, username, pin_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)", id, username, hash, salt, now);
    const token = this.createSession(id);
    return { user: { id, username, createdAt: now }, token };
  }

  async login(username: string, pin: string): Promise<{ user: UserInfo; token: string }> {
    const now = Date.now();
    const key = username.toLowerCase();
    const att = this.sql.exec<{ failures: number; locked_until: number }>(
      "SELECT failures, locked_until FROM login_attempts WHERE username = ?", key,
    ).toArray()[0];
    if (att && att.locked_until > now) {
      const secs = Math.ceil((att.locked_until - now) / 1000);
      throw new AuthError(429, "locked", `Too many attempts. Try again in ${secs}s`);
    }
    const row = this.sql.exec<{ id: string; username: string; pin_hash: string; salt: string; created_at: number }>(
      "SELECT id, username, pin_hash, salt, created_at FROM users WHERE username = ?", username,
    ).toArray()[0];
    const ok = row ? timingSafeEqual(await hashPin(pin, row.salt), row.pin_hash) : false;
    if (!ok || !row) {
      const failures = (att?.failures ?? 0) + 1;
      // exponential lockout after 5 failures: 30s, 60s, 120s ... capped at 15 min
      const lockMs = failures >= 5 ? Math.min(15 * 60_000, 30_000 * 2 ** (failures - 5)) : 0;
      this.sql.exec(
        "INSERT INTO login_attempts (username, failures, locked_until) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until",
        key, failures, now + lockMs,
      );
      throw new AuthError(401, "bad_login", "Wrong username or PIN");
    }
    this.sql.exec("DELETE FROM login_attempts WHERE username = ?", key);
    const token = this.createSession(row.id);
    return { user: { id: row.id, username: row.username, createdAt: row.created_at }, token };
  }

  private createSession(userId: string): string {
    const token = randomToken(32);
    const now = Date.now();
    this.sql.exec("DELETE FROM sessions WHERE expires_at < ?", now);
    this.sql.exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, userId, now + SESSION_TTL_MS);
    return token;
  }

  async logout(token: string): Promise<void> {
    this.sql.exec("DELETE FROM sessions WHERE token = ?", token);
  }

  /** Session lookup plus everything the client needs to boot: admin status and feature flags. */
  async me(token: string | null): Promise<{ user: UserInfo | null; isAdmin: boolean; flags: Flags }> {
    const user = token ? await this.session(token) : null;
    return { user, isAdmin: user ? this.isAdmin(user) : false, flags: this.flags() };
  }

  // ---------- feature flags ----------

  /** Admins: usernames listed in ADMIN_USERS, plus the first account ever created. */
  isAdmin(user: UserInfo): boolean {
    const listed = (this.env.ADMIN_USERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (listed.includes(user.username.toLowerCase())) return true;
    const first = this.sql.exec<{ id: string }>("SELECT id FROM users ORDER BY created_at ASC, rowid ASC LIMIT 1").toArray()[0];
    return !!first && first.id === user.id;
  }

  flags(): Flags {
    const out = defaultFlags();
    for (const r of this.sql.exec<{ name: string; enabled: number }>("SELECT name, enabled FROM flags").toArray()) {
      if ((FLAG_NAMES as string[]).includes(r.name)) out[r.name as FlagName] = r.enabled === 1;
    }
    return out;
  }

  /** Feedback rate limit: at most 5 per user per hour. Records the attempt when allowed. */
  feedbackAllowed(userId: string): boolean {
    const since = Date.now() - 60 * 60 * 1000;
    const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND ts > ?", userId, since).toArray()[0]?.n ?? 0;
    if (n >= 5) return false;
    this.sql.exec("INSERT INTO feedback (user_id, ts) VALUES (?, ?)", userId, Date.now());
    this.sql.exec("DELETE FROM feedback WHERE ts < ?", Date.now() - 7 * 24 * 60 * 60 * 1000);
    return true;
  }

  /** Tables that may still be in play (not ended, touched in the last 3 days). */
  openTableCodes(limit = 50): string[] {
    return this.sql.exec<{ code: string }>(
      "SELECT code FROM tables WHERE status != 'ended' AND updated_at > ? ORDER BY updated_at DESC LIMIT ?", Date.now() - 3 * 24 * 60 * 60 * 1000, limit,
    ).toArray().map((r) => r.code);
  }

  /** Flip one flag and push the new set to every table that is still open. */
  async setFlag(name: FlagName, enabled: boolean, byUserId: string): Promise<Flags> {
    this.sql.exec(
      "INSERT INTO flags (name, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
      name, enabled ? 1 : 0, Date.now(), byUserId,
    );
    const flags = this.flags();
    const codes = this.sql.exec<{ code: string }>(
      "SELECT code FROM tables WHERE status != 'ended' AND updated_at > ? ORDER BY updated_at DESC LIMIT 50", Date.now() - 3 * 24 * 60 * 60 * 1000,
    ).toArray().map((r) => r.code);
    await Promise.all(codes.map(async (code) => {
      try {
        await this.env.TABLE.get(this.env.TABLE.idFromName(code)).setFlags(flags);
      } catch (e) {
        slog("error", "flags.pushFailed", { table: code, ...errFields(e) });
      }
    }));
    return flags;
  }

  async session(token: string): Promise<UserInfo | null> {
    const row = this.sql.exec<{ id: string; username: string; created_at: number; expires_at: number }>(
      "SELECT u.id, u.username, u.created_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
      token,
    ).toArray()[0];
    if (!row || row.expires_at < Date.now()) return null;
    return { id: row.id, username: row.username, createdAt: row.created_at };
  }

  // ---------- tables ----------

  async registerTable(t: { code: string; name: string; hostId: string; hostName: string; variant: Variant; smallBlind: number; bigBlind: number }): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO tables (code, name, host_id, host_name, variant, small_blind, big_blind, status, players, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', 0, ?, ?)",
      t.code, t.name, t.hostId, t.hostName, t.variant, t.smallBlind, t.bigBlind, now, now,
    );
    this.sql.exec("INSERT OR IGNORE INTO table_members (code, user_id) VALUES (?, ?)", t.code, t.hostId);
  }

  async updateTable(code: string, patch: { status?: TableStatus; players?: number; variant?: Variant; smallBlind?: number; bigBlind?: number; memberId?: string }): Promise<void> {
    const now = Date.now();
    if (patch.status !== undefined) this.sql.exec("UPDATE tables SET status = ?, updated_at = ? WHERE code = ?", patch.status, now, code);
    if (patch.players !== undefined) this.sql.exec("UPDATE tables SET players = ?, updated_at = ? WHERE code = ?", patch.players, now, code);
    if (patch.variant !== undefined) this.sql.exec("UPDATE tables SET variant = ?, updated_at = ? WHERE code = ?", patch.variant, now, code);
    if (patch.smallBlind !== undefined && patch.bigBlind !== undefined) {
      this.sql.exec("UPDATE tables SET small_blind = ?, big_blind = ?, updated_at = ? WHERE code = ?", patch.smallBlind, patch.bigBlind, now, code);
    }
    if (patch.memberId) this.sql.exec("INSERT OR IGNORE INTO table_members (code, user_id) VALUES (?, ?)", code, patch.memberId);
  }

  async myTables(userId: string): Promise<TableSummary[]> {
    const rows = this.sql.exec<{
      code: string; name: string; status: TableStatus; host_id: string; host_name: string; variant: Variant;
      small_blind: number; big_blind: number; players: number; created_at: number;
    }>(
      `SELECT t.* FROM tables t JOIN table_members m ON m.code = t.code
       WHERE m.user_id = ? AND t.status != 'ended' AND t.updated_at > ? ORDER BY t.updated_at DESC LIMIT 20`,
      userId, Date.now() - 3 * 24 * 60 * 60 * 1000,
    ).toArray();
    return rows.map((r) => ({
      code: r.code, name: r.name, status: r.status, hostId: r.host_id, hostName: r.host_name, variant: r.variant,
      smallBlind: r.small_blind, bigBlind: r.big_blind, players: r.players, createdAt: r.created_at,
    }));
  }

  // ---------- results ----------

  /** Add a session's HUD counters to lifetime totals. Idempotent per table. */
  async recordHud(tableCode: string, hud: Record<string, HudCounters>): Promise<void> {
    const done = this.sql.exec("SELECT 1 FROM hud_applied WHERE table_code = ?", tableCode).toArray().length > 0;
    if (done) return;
    this.sql.exec("INSERT INTO hud_applied (table_code) VALUES (?)", tableCode);
    for (const [userId, c] of Object.entries(hud)) {
      this.sql.exec(
        `INSERT INTO hud (user_id, hands, vpip, pfr, three_bet, agg_bets, agg_calls, saw_flop, wtsd, wsd, won)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET hands = hands + excluded.hands, vpip = vpip + excluded.vpip, pfr = pfr + excluded.pfr,
           three_bet = three_bet + excluded.three_bet, agg_bets = agg_bets + excluded.agg_bets, agg_calls = agg_calls + excluded.agg_calls,
           saw_flop = saw_flop + excluded.saw_flop, wtsd = wtsd + excluded.wtsd, wsd = wsd + excluded.wsd, won = won + excluded.won`,
        userId, c.hands, c.vpip, c.pfr, c.threeBet, c.aggBets, c.aggCalls, c.sawFlop, c.wtsd, c.wsd, c.won,
      );
    }
  }

  private hudRow(userId: string): HudCounters {
    const r = this.sql.exec<{ hands: number; vpip: number; pfr: number; three_bet: number; agg_bets: number; agg_calls: number; saw_flop: number; wtsd: number; wsd: number; won: number }>(
      "SELECT hands, vpip, pfr, three_bet, agg_bets, agg_calls, saw_flop, wtsd, wsd, won FROM hud WHERE user_id = ?", userId,
    ).toArray()[0];
    if (!r) return emptyHud();
    return { hands: r.hands, vpip: r.vpip, pfr: r.pfr, threeBet: r.three_bet, aggBets: r.agg_bets, aggCalls: r.agg_calls, sawFlop: r.saw_flop, wtsd: r.wtsd, wsd: r.wsd, won: r.won };
  }

  async hud(userIds: string[]): Promise<HudRow[]> {
    const out: HudRow[] = [];
    for (const id of userIds.slice(0, 16)) {
      const u = this.sql.exec<{ username: string }>("SELECT username FROM users WHERE id = ?", id).toArray()[0];
      if (!u) continue;
      out.push({ userId: id, username: u.username, counters: this.hudRow(id) });
    }
    return out;
  }

  async recordResults(tableCode: string, tableName: string, rows: SessionResultRow[], endedAt: number): Promise<void> {
    for (const r of rows) {
      this.sql.exec(
        `INSERT INTO results (user_id, table_code, table_name, buy_in, cash_out, net, hands_played, biggest_pot, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(table_code, user_id) DO UPDATE SET buy_in = excluded.buy_in, cash_out = excluded.cash_out, net = excluded.net,
           hands_played = excluded.hands_played, biggest_pot = excluded.biggest_pot, ended_at = excluded.ended_at`,
        r.userId, tableCode, tableName, r.buyIn, r.cashOut, r.net, r.handsPlayed, r.biggestPot, endedAt,
      );
    }
    this.sql.exec("UPDATE tables SET status = 'ended', updated_at = ? WHERE code = ?", endedAt, tableCode);
  }

  async leaderboard(): Promise<LeaderboardRow[]> {
    const rows = this.sql.exec<{ user_id: string; username: string; net: number; sessions: number; hands: number; biggest_pot: number; wins: number }>(
      `SELECT r.user_id, u.username, SUM(r.net) AS net, COUNT(*) AS sessions, SUM(r.hands_played) AS hands,
              MAX(r.biggest_pot) AS biggest_pot, SUM(CASE WHEN r.net > 0 THEN 1 ELSE 0 END) AS wins
       FROM results r JOIN users u ON u.id = r.user_id
       GROUP BY r.user_id ORDER BY net DESC LIMIT 100`,
    ).toArray();
    return rows.map((r) => ({ userId: r.user_id, username: r.username, net: r.net, sessions: r.sessions, hands: r.hands, biggestPot: r.biggest_pot, wins: r.wins }));
  }

  async stats(userId: string): Promise<UserStats | null> {
    const user = this.sql.exec<{ username: string }>("SELECT username FROM users WHERE id = ?", userId).toArray()[0];
    if (!user) return null;
    const agg = this.sql.exec<{ net: number | null; sessions: number; hands: number | null; biggest_pot: number | null; wins: number | null; best: number | null; worst: number | null }>(
      `SELECT SUM(net) AS net, COUNT(*) AS sessions, SUM(hands_played) AS hands, MAX(biggest_pot) AS biggest_pot,
              SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END) AS wins, MAX(net) AS best, MIN(net) AS worst
       FROM results WHERE user_id = ?`, userId,
    ).toArray()[0]!;
    const recent = this.sql.exec<{ table_code: string; table_name: string; net: number; buy_in: number; cash_out: number; hands_played: number; ended_at: number }>(
      "SELECT table_code, table_name, net, buy_in, cash_out, hands_played, ended_at FROM results WHERE user_id = ? ORDER BY ended_at DESC LIMIT 20", userId,
    ).toArray();
    return {
      userId, username: user.username, net: agg.net ?? 0, sessions: agg.sessions, hands: agg.hands ?? 0,
      biggestPot: agg.biggest_pot ?? 0, wins: agg.wins ?? 0, bestSession: agg.best ?? 0, worstSession: agg.worst ?? 0, hud: this.hudRow(userId),
      recent: recent.map((r) => ({ tableCode: r.table_code, tableName: r.table_name, net: r.net, buyIn: r.buy_in, cashOut: r.cash_out, hands: r.hands_played, endedAt: r.ended_at })),
    };
  }
}
