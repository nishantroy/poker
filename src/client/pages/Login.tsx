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
      setErr(e instanceof ApiError ? e.message : "Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === "signup" && flags.signup;
  return (
    <div className="login-bg min-h-full flex flex-col px-5" style={{ paddingTop: "calc(var(--sat) + 20px)", paddingBottom: "calc(var(--sab) + 20px)" }}>
      <header className="flex items-center gap-2.5 anim-fade-up">
        <Logo size={28} />
        <span className="font-semibold tracking-tight">{APP_NAME}</span>
      </header>

      <main className="flex-1 flex flex-col justify-center w-full max-w-sm mx-auto py-10 anim-fade-up">
        <h1 className="text-[32px] leading-[1.05] font-semibold tracking-tight">{signup ? "Create your seat." : "Welcome back."}</h1>
        <p className="text-muted mt-2 mb-8">{signup ? "A username and a short PIN is all it takes." : TAGLINE}</p>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} autoFocus
              onChange={(e) => setUsername(e.target.value)} placeholder="nish" required minLength={2} maxLength={20} />
          </Field>
          <Field label="PIN" hint={signup ? "4 to 6 digits. Casual login, not bank security." : undefined}>
            <div className="relative">
              <input className="input pr-12 tracking-[0.35em]" type={showPin ? "text" : "password"} inputMode="numeric" pattern="[0-9]*" autoComplete={signup ? "new-password" : "current-password"}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••" required minLength={4} maxLength={6} />
              <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm px-2" onClick={() => setShowPin((v) => !v)} aria-label={showPin ? "Hide PIN" : "Show PIN"} aria-pressed={showPin}>
                {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          {err && <p className="text-sm text-[#ff8b8e] font-medium flex items-center gap-1.5" role="alert"><AlertCircle size={16} aria-hidden="true" />{err}</p>}
          <button className="btn btn-primary w-full min-h-[50px]" disabled={busy || pin.length < 4 || username.trim().length < 2}>
            {busy ? <span className="inline-block w-4 h-4 rounded-full border-2 border-black/30 border-t-black animate-spin" aria-label="Working" /> : signup ? "Create account" : "Log in"}
            {!busy && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form>

        {flags.signup ? (
          <p className="text-sm text-muted mt-6">
            {signup ? "Already have a seat? " : "New here? "}
            <button type="button" className="text-text font-medium underline underline-offset-4 decoration-border-strong hover:decoration-text" onClick={() => { setMode(signup ? "login" : "signup"); setErr(null); }}>
              {signup ? "Log in" : "Create an account"}
            </button>
          </p>
        ) : (
          <p className="text-sm text-dim mt-6">Signups are closed right now.</p>
        )}
      </main>

      <footer className="text-xs text-dim flex items-center gap-3 anim-fade-up">
        <span>Hold'em · Omaha · Pineapple</span><span aria-hidden="true">·</span><span>Up to 8 players</span>
      </footer>
    </div>
  );
}

export function Logo({ size = 44 }: { size?: number }) {
  // Monochrome chip: four clean notches, one amber centre.
  const r = 19;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#121214" stroke="rgba(255,255,255,0.1)" />
      <circle cx="32" cy="32" r={r} fill="none" stroke="#fafafa" strokeWidth="6" strokeDasharray={`${circ / 4 - 10} 10`} strokeDashoffset={circ / 8 - 5} />
      <circle cx="32" cy="32" r="5" fill="#f0b43c" />
    </svg>
  );
}
