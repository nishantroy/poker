import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Field } from "../components/ui";

export function LoginPage() {
  const { setUser, flags } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = mode === "login" || !flags.signup ? await api.login(username.trim(), pin) : await api.signup(username.trim(), pin);
      setUser(r.user);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-4" style={{ paddingTop: "var(--sat)", paddingBottom: "var(--sab)" }}>
      <div className="w-full max-w-sm anim-fade-up">
        <div className="flex items-center gap-3 mb-8">
          <Logo />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>Friends Poker</h1>
            <p className="text-muted text-sm">Home game, any device.</p>
          </div>
        </div>

        <div className="card-surface p-5">
          {flags.signup ? (
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-2 mb-5" role="tablist">
            {(["login", "signup"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null); }}
                className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${mode === m ? "bg-surface-3 text-text" : "text-muted"}`}>
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>
          ) : (
            <p className="text-xs text-dim mb-4">Signups are closed right now. Log in with an existing account.</p>
          )}
          <form onSubmit={submit} className="space-y-4">
            <Field label="Username">
              <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username}
                onChange={(e) => setUsername(e.target.value)} placeholder="e.g. nish" required minLength={2} maxLength={20} />
            </Field>
            <Field label="PIN" hint={mode === "signup" ? "4–6 digits. This is a casual login, not bank security." : undefined}>
              <input className="input tracking-[0.3em]" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••" required minLength={4} maxLength={6} />
            </Field>
            {err && <p className="text-sm text-[#ff8b8e] font-medium" role="alert">{err}</p>}
            <button className="btn btn-primary w-full" disabled={busy || pin.length < 4 || username.trim().length < 2}>
              {busy ? "…" : mode === "login" || !flags.signup ? "Log in" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#131b2e" stroke="rgba(255,255,255,0.1)" />
      <circle cx="32" cy="32" r="19" fill="#e8b033" />
      <circle cx="32" cy="32" r="19" fill="none" stroke="#0b1120" strokeWidth="3" strokeDasharray="7 6.9" />
      <circle cx="32" cy="32" r="11" fill="#0b1120" />
      <path d="M32 24.5c-2.4-3.4-7.5-1-6 3 1.1 2.8 4.4 4.4 6 7 1.6-2.6 4.9-4.2 6-7 1.5-4-3.6-6.4-6-3z" fill="#e8b033" />
    </svg>
  );
}
