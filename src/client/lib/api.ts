import type { LeaderboardRow, TableConfig, TableSummary, UserInfo, UserStats } from "@shared/protocol";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } } & T;
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? "error", body.error?.message ?? res.statusText);
  return body as T;
}

export const api = {
  me: () => call<{ user: UserInfo | null }>("/api/me"),
  login: (username: string, pin: string) => call<{ user: UserInfo }>("/api/login", { method: "POST", body: JSON.stringify({ username, pin }) }),
  signup: (username: string, pin: string) => call<{ user: UserInfo }>("/api/signup", { method: "POST", body: JSON.stringify({ username, pin }) }),
  logout: () => call<{ ok: true }>("/api/logout", { method: "POST" }),
  createTable: (name: string, config: Partial<TableConfig>) => call<{ code: string }>("/api/tables", { method: "POST", body: JSON.stringify({ name, config }) }),
  myTables: () => call<{ tables: TableSummary[] }>("/api/tables"),
  table: (code: string) => call<{ table: { code: string; name: string; status: string; hostName: string; config: TableConfig; players: number } }>(`/api/tables/${encodeURIComponent(code)}`),
  leaderboard: () => call<{ rows: LeaderboardRow[] }>("/api/leaderboard"),
  myStats: () => call<{ stats: UserStats | null }>("/api/stats/me"),
};
