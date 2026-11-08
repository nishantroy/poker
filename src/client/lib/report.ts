/** Sends uncaught browser errors to the Worker so they show up in Cloudflare Workers Logs (evt = "client.error"). */
let sent = 0;
const seen = new Set<string>();

export function reportError(kind: string, message: string, extra: Record<string, unknown> = {}) {
  const key = `${kind}:${message}`;
  if (sent >= 20 || seen.has(key)) return; // cap per page load, skip repeats
  seen.add(key);
  sent++;
  const body = JSON.stringify({ kind, message: message.slice(0, 500), path: location.pathname, ua: navigator.userAgent.slice(0, 200), ...extra });
  try {
    if (!navigator.sendBeacon?.("/api/client-log", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/client-log", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* never throw from the reporter */ }
}

export function installErrorReporting() {
  window.addEventListener("error", (e) => {
    reportError("error", e.message || String(e.error), { stack: String((e.error as Error | undefined)?.stack ?? "").slice(0, 1500), src: `${e.filename}:${e.lineno}:${e.colno}` });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as Error | undefined;
    reportError("unhandledrejection", r?.message ?? String(r), { stack: String(r?.stack ?? "").slice(0, 1500) });
  });
}
