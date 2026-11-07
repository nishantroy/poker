import { ArrowRight, Crown, LogOut, Plus, Trophy, User, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { LeaderboardRow, TableConfig, TableSummary, Variant } from "@shared/protocol";
import { defaultConfig } from "@shared/protocol";
import { VARIANTS, VARIANT_IDS } from "@engine/variants";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Link, navigate } from "../lib/router";
import { fmtNet, timeAgo } from "../lib/format";
import { Field, Sheet, Toast } from "../components/ui";
import { Logo } from "./Login";

export function LobbyPage() {
  const { user, logout } = useAuth();
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [board, setBoard] = useState<LeaderboardRow[] | null>(null);
  const [create, setCreate] = useState(false);
  const [code, setCode] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.myTables().then((r) => setTables(r.tables)).catch(() => setTables([]));
    api.leaderboard().then((r) => setBoard(r.rows)).catch(() => setBoard([]));
  }, []);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    try {
      await api.table(c);
      navigate(`/t/${c}`);
    } catch (err) {
      setToast(err instanceof ApiError && err.status === 404 ? "No table with that code" : "Could not look up that table");
      setTimeout(() => setToast(null), 2500);
    }
  };

  return (
    <div className="min-h-full max-w-2xl mx-auto px-4 pb-10" style={{ paddingTop: "calc(var(--sat) + 16px)", paddingBottom: "calc(var(--sab) + 40px)" }}>
      <Toast message={toast} />
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <h1 className="text-xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>Friends Poker</h1>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/profile" className="btn btn-ghost btn-sm">
            <User size={18} aria-hidden="true" /> <span className="max-w-[9ch] truncate">{user?.username}</span>
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={logout} aria-label="Log out"><LogOut size={18} /></button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 mb-8 anim-fade-up">
        <button className="btn btn-primary min-h-[64px] text-base" onClick={() => setCreate(true)}>
          <Plus size={20} aria-hidden="true" /> Create a table
        </button>
        <form onSubmit={join} className="flex gap-2">
          <input className="input uppercase tracking-[0.2em] font-bold" placeholder="CODE" value={code} aria-label="Table code"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          <button className="btn btn-green px-5" disabled={code.length < 4} aria-label="Join table"><ArrowRight size={20} /></button>
        </form>
      </section>

      <section className="mb-8">
        <h2 className="label">Your tables</h2>
        {tables === null ? (
          <div className="skeleton h-16 rounded-2xl" />
        ) : tables.length === 0 ? (
          <p className="text-muted text-sm card-surface p-4">No open tables. Create one and share the link.</p>
        ) : (
          <ul className="space-y-2">
            {tables.map((t) => (
              <li key={t.code}>
                <Link to={`/t/${t.code}`} className="card-surface flex items-center gap-3 p-3.5 hover:bg-surface-2 transition-colors">
                  <span className="pill pill-gold">{VARIANTS[t.variant].short}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold truncate">{t.name}</p>
                    <p className="text-xs text-muted">{t.smallBlind}/{t.bigBlind} · {t.hostName} · {timeAgo(t.createdAt)}</p>
                  </div>
                  <span className={`pill ${t.status === "running" ? "pill-green" : t.status === "paused" ? "pill-red" : ""}`}>{t.status}</span>
                  <span className="text-muted text-sm inline-flex items-center gap-1"><Users size={14} aria-hidden="true" />{t.players}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="label flex items-center gap-1.5"><Trophy size={14} aria-hidden="true" /> Leaderboard</h2>
        {board === null ? (
          <div className="skeleton h-32 rounded-2xl" />
        ) : board.length === 0 ? (
          <p className="text-muted text-sm card-surface p-4">No finished sessions yet. End a session as host to record results.</p>
        ) : (
          <div className="card-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-dim">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2.5 font-semibold">#</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Player</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Net</th>
                  <th className="text-right px-3 py-2.5 font-semibold hidden sm:table-cell">Sessions</th>
                  <th className="text-right px-3 py-2.5 font-semibold hidden sm:table-cell">Hands</th>
                </tr>
              </thead>
              <tbody>
                {board.map((r, i) => (
                  <tr key={r.userId} className={`border-b border-border last:border-0 ${r.userId === user?.id ? "bg-gold/10" : ""}`}>
                    <td className="px-3 py-2.5 text-muted">{i === 0 ? <Crown size={16} className="text-gold" aria-label="First place" /> : i + 1}</td>
                    <td className="px-3 py-2.5 font-semibold">{r.username}</td>
                    <td className={`px-3 py-2.5 text-right font-bold num ${r.net > 0 ? "text-green-bright" : r.net < 0 ? "text-[#ff8b8e]" : "text-muted"}`}>{fmtNet(r.net)}</td>
                    <td className="px-3 py-2.5 text-right text-muted hidden sm:table-cell">{r.sessions}</td>
                    <td className="px-3 py-2.5 text-right text-muted hidden sm:table-cell">{r.hands}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CreateSheet open={create} onClose={() => setCreate(false)} />
    </div>
  );
}

export function VariantPicker({ value, onChange }: { value: Variant; onChange: (v: Variant) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Game variant">
      {VARIANT_IDS.map((id) => (
        <button type="button" key={id} className="chip-toggle" aria-pressed={value === id} onClick={() => onChange(id)} title={VARIANTS[id].name}>
          {VARIANTS[id].short}
        </button>
      ))}
    </div>
  );
}

function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState<TableConfig>(defaultConfig());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof TableConfig>(k: K, v: TableConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const num = (k: keyof TableConfig) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createTable(name.trim() || `${user?.username}'s game`, cfg);
      navigate(`/t/${r.code}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create the table");
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New table">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Table name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${user?.username}'s game`} maxLength={40} />
        </Field>
        <div>
          <span className="label">Game</span>
          <VariantPicker value={cfg.variant} onChange={(v) => set("variant", v)} />
          <p className="text-xs text-dim mt-1.5">{VARIANTS[cfg.variant].name} · {VARIANTS[cfg.variant].holeCards} hole cards · {VARIANTS[cfg.variant].limit}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Small blind"><input className="input" type="number" inputMode="numeric" min={1} value={cfg.smallBlind} onChange={num("smallBlind")} /></Field>
          <Field label="Big blind"><input className="input" type="number" inputMode="numeric" min={1} value={cfg.bigBlind} onChange={num("bigBlind")} /></Field>
          <Field label="Ante"><input className="input" type="number" inputMode="numeric" min={0} value={cfg.ante} onChange={num("ante")} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Buy-in (max)"><input className="input" type="number" inputMode="numeric" min={1} value={cfg.startingStack} onChange={num("startingStack")} /></Field>
          <Field label="Seats"><input className="input" type="number" inputMode="numeric" min={2} max={8} value={cfg.maxSeats} onChange={num("maxSeats")} /></Field>
          <Field label="Timer (s)"><input className="input" type="number" inputMode="numeric" min={5} max={300} value={Math.round(cfg.actionTimerMs / 1000)} onChange={(e) => set("actionTimerMs", Number(e.target.value) * 1000)} /></Field>
        </div>
        {err && <p className="text-sm text-[#ff8b8e]" role="alert">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create & open table"}</button>
      </form>
    </Sheet>
  );
}
