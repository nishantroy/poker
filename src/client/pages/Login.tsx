import { AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react";
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
      setErr(e instanceof ApiError ? e.message : "Can't reach the table. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === "signup" && flags.signup;
  return (
    <div className="login-bg min-h-full flex flex-col items-center px-5" style={{ paddingTop: "calc(var(--sat) + 24px)", paddingBottom: "calc(var(--sab) + 24px)" }}>
      <main className="relative flex-1 flex flex-col justify-center w-full max-w-sm mx-auto py-6">
        <div className="flex flex-col items-center text-center mb-8 anim-fade-up">
          <div className="logo-glow mb-5"><Logo size={112} /></div>
          <h1 className="text-[40px] leading-none font-extrabold uppercase tracking-[0.08em] text-gradient-gold" style={{ fontFamily: "var(--font-display)" }}>{APP_NAME}</h1>
          <p className="text-muted mt-3 text-[15px]">{signup ? "Pick a name and a PIN to grab a seat." : TAGLINE}</p>
        </div>

        <form onSubmit={submit} className="space-y-4 anim-fade-up">
          <Field label="Username">
            <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} autoFocus
              onChange={(e) => setUsername(e.target.value)} required minLength={2} maxLength={20} />
          </Field>
          <Field label="PIN" hint={signup ? "4 to 6 digits." : undefined}>
            <div className="relative">
              <input className="input pr-12 tracking-[0.35em]" type={showPin ? "text" : "password"} inputMode="numeric" pattern="[0-9]*" autoComplete={signup ? "new-password" : "current-password"}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••" required minLength={4} maxLength={6} />
              <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm px-2" onClick={() => setShowPin((v) => !v)} aria-label={showPin ? "Hide PIN" : "Show PIN"} aria-pressed={showPin}>
                {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          {err && <p className="text-sm text-[#ff8b8e] font-medium flex items-center gap-1.5" role="alert"><AlertCircle size={16} aria-hidden="true" />{err}</p>}
          <button className="btn btn-primary w-full min-h-[52px] text-base" disabled={busy || pin.length < 4 || username.trim().length < 2}>
            {busy ? <span className="inline-block w-4 h-4 rounded-full border-2 border-black/30 border-t-black animate-spin" aria-label="Working" /> : signup ? "Create account" : "Log in"}
            {!busy && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form>

        {flags.signup ? (
          <p className="text-sm text-muted mt-6 text-center anim-fade-up">
            {signup ? "Been here before? " : "New in town? "}
            <button type="button" className="text-cyan-bright font-medium underline underline-offset-4 decoration-cyan/40 hover:decoration-cyan" onClick={() => { setMode(signup ? "login" : "signup"); setErr(null); }}>
              {signup ? "Log in" : "Make an account"}
            </button>
          </p>
        ) : (
          <p className="text-sm text-dim mt-6 text-center">New signups are closed for now.</p>
        )}
      </main>
    </div>
  );
}

export function Logo({ size = 44 }: { size?: number }) {
  // Bink City mark: a cyan chip ring around a striped sunset sun.
  const r = 20;
  const circ = 2 * Math.PI * r;
  const uid = "bc";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb14d" />
          <stop offset="0.5" stopColor="#ff6b4a" />
          <stop offset="1" stopColor="#ff3fa4" />
        </linearGradient>
        <linearGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7df3f9" />
          <stop offset="1" stopColor="#22e3ee" />
        </linearGradient>
        <clipPath id={`${uid}-clip`}><circle cx="32" cy="32" r="12.5" /></clipPath>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0a0d24" stroke="rgba(255,255,255,0.12)" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={`url(#${uid}-ring)`} strokeWidth="5" strokeDasharray={`${circ / 4 - 9} 9`} strokeDashoffset={circ / 8 - 4.5} />
      <g clipPath={`url(#${uid}-clip)`}>
        <circle cx="32" cy="32" r="12.5" fill={`url(#${uid}-sun)`} />
        <rect x="16" y="34" width="32" height="1.8" fill="#0a0d24" />
        <rect x="16" y="38.2" width="32" height="2.4" fill="#0a0d24" />
        <rect x="16" y="43" width="32" height="3" fill="#0a0d24" />
      </g>
    </svg>
  );
}
