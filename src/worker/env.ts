import type { AccountsDO } from "./accounts";
import type { TableDO } from "./table";

export interface Env {
  TABLE: DurableObjectNamespace<TableDO>;
  ACCOUNTS: DurableObjectNamespace<AccountsDO>;
  ASSETS: Fetcher;
  /** Comma-separated usernames allowed to change feature flags (see src/shared/flags.ts). */
  ADMIN_USERS?: string;
}

export function accounts(env: Env) {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName("global"));
}

export interface AuthUser {
  id: string;
  username: string;
}

export const SESSION_COOKIE = "fp_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers ?? {}) },
  });
}

export function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomCode(len = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => alphabet[b % alphabet.length]).join("");
}

const PBKDF2_ITER = 100_000;

export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITER },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
