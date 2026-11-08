/**
 * Structured logs for Cloudflare Workers Logs (dashboard: Workers & Pages → poker → Logs,
 * or live: `npx wrangler tail poker --format json`). Every line is one JSON object with
 * `evt` (dotted event name) plus context, so the dashboard can filter on any field:
 * e.g. `table = "ABC123"`, `evt = "hand.skip"`, `level = "error"`.
 * Never log PINs, session tokens or live hole cards.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export function slog(level: LogLevel, evt: string, fields: LogFields = {}): void {
  const line = { evt, level, ...fields };
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Error objects don't serialise to JSON; flatten them. */
export function errFields(e: unknown): LogFields {
  if (e instanceof Error) return { err: e.message, errName: e.name, stack: e.stack?.split("\n").slice(0, 6).join("\n") };
  return { err: String(e) };
}
