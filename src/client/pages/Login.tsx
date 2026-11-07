import { AlertCircle, ArrowRight, Eye, EyeOff, Ghost, Spade, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { APP_NAME, TAGLINE } from "@shared/brand";
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
  const [showPin, setShowPin] = useState(false);

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
    <div className="login-bg min-h-full flex flex-col items-center justify-center px-4" style={{ paddingTop: "calc(var(--sat) + 24px)", paddingBottom: "calc(var(--sab) + 24px)" }}>
      <div className="w-full max-w-sm anim-fade-up">
        <div className="flex flex-col items-center text-center mb-7">
          <div className="logo-glow mb-4"><Logo size={72} /></div>
          <h1 className="text-[34px] leading-none font-black tracking-tight text-gradient-gold" style={{ fontFamily: "var(--font-display)" }}>{APP_NAME}</h1>
          <p className="text-muted mt-2">{TAGLINE}</p>
        </div>

        <div className="card-surface p-5 shadow-pop">
          {flags.signup ? (
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-2 mb-5" role="tablist">
            {(["login", "signup"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null); }}
                className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${mode === m ? "bg-surface-3 text-text shadow-sm" : "text-muted hover:text-text"}`}>
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>
          ) : (
            <p className="text-xs text-dim mb-4">Signups are closed right now. Log in with an existing account.</p>
          )}
          <form onSubmit={submit} className="space-y-4">
            <Field label="Username">
              <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} autoFocus
                onChange={(e) => setUsername(e.target.value)} placeholder="e.g. nish" required minLength={2} maxLength={20} />
            </Field>
            <Field label="PIN" hint={mode === "signup" && flags.signup ? "4–6 digits. Casual login, not bank security." : undefined}>
              <div className="relative">
                <input className="input pr-12 tracking-[0.35em] text-lg" type={showPin ? "text" : "password"} inputMode="numeric" pattern="[0-9]*" autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••" required minLength={4} maxLength={6} />
                <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm px-2" onClick={() => setShowPin((v) => !v)} aria-label={showPin ? "Hide PIN" : "Show PIN"} aria-pressed={showPin}>
                  {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            {err && <p className="text-sm text-[#ff8b8e] font-medium flex items-center gap-1.5" role="alert"><AlertCircle size={16} aria-hidden="true" />{err}</p>}
            <button className="btn btn-primary w-full min-h-[52px] text-base" disabled={busy || pin.length < 4 || username.trim().length < 2}>
              {busy ? <span className="inline-block w-5 h-5 rounded-full border-2 border-on-gold/40 border-t-on-gold animate-spin" aria-label="Working" /> : mode === "login" || !flags.signup ? <>Log in <ArrowRight size={18} aria-hidden="true" /></> : <>Create account <ArrowRight size={18} aria-hidden="true" /></>}
            </button>
          </form>
        </div>

        <ul className="mt-6 grid grid-cols-3 gap-2 text-center" aria-label="What you get">
          {[
            { icon: <Spade size={18} aria-hidden="true" />, text: "Hold'em, Omaha, Pineapple" },
            { icon: <Users size={18} aria-hidden="true" />, text: "Up to 8 friends, any phone" },
            { icon: <Ghost size={18} aria-hidden="true" />, text: "Ghost seats & Squid boards" },
          ].map((f, i) => (
            <li key={i} className="rounded-xl border border-border bg-surface/60 px-2 py-3 text-[11px] leading-snug text-muted flex flex-col items-center gap-1.5">
              <span className="text-brand">{f.icon}</span>{f.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Logo({ size = 44 }: { size?: number }) {
  // Bink City mark: a neon chip ring around a three-tower skyline.
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="bc-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff6aa0" />
          <stop offset="0.55" stopColor="#ff3d81" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="bc-tower" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#151226" stroke="rgba(255,255,255,0.1)" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="url(#bc-ring)" strokeWidth="5.5" strokeDasharray="9 5.3" strokeDashoffset="2" />
      <circle cx="32" cy="32" r="17" fill="#0c0a16" />
      <rect x="20" y="31" width="7" height="13" rx="1" fill="url(#bc-tower)" />
      <rect x="29" y="23" width="7" height="21" rx="1" fill="#ff3d81" />
      <rect x="38" y="35" width="7" height="9" rx="1" fill="url(#bc-tower)" />
      <rect x="31.5" y="19" width="2" height="4" fill="#ff6aa0" />
      <circle cx="40.5" cy="24.5" r="1.6" fill="#ffe08a" />
    </svg>
  );
}
