import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { UserStats } from "@shared/protocol";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Toggle } from "../components/Panels";
import { FLAG_DEFS, FLAG_NAMES, type FlagName } from "@shared/flags";
import { Link } from "../lib/router";
import { fmtNet, timeAgo } from "../lib/format";
import { hudStats } from "@engine/hud";

export function ProfilePage() {
  const { isAdmin } = useAuth();
  const [stats, setStats] = useState<UserStats | null | undefined>(undefined);
  useEffect(() => {
    api.myStats().then((r) => setStats(r.stats)).catch(() => setStats(null));
  }, []);

  return (
    <div className="min-h-full max-w-2xl mx-auto px-4" style={{ paddingTop: "calc(var(--sat) + 12px)", paddingBottom: "calc(var(--sab) + 40px)" }}>
      <header className="flex items-center gap-2 mb-6">
        <Link to="/" className="btn btn-ghost btn-sm -ml-2" aria-label="Back to lobby"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>{stats?.username ?? "Profile"}</h1>
      </header>
      {stats === undefined ? (
        <div className="skeleton h-40 rounded-2xl" />
      ) : !stats ? (
        <p className="text-muted">Could not load stats.</p>
      ) : (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8 anim-fade-up">
            <Stat label="Lifetime net" value={fmtNet(stats.net)} tone={stats.net > 0 ? "up" : stats.net < 0 ? "down" : undefined} big />
            <Stat label="Sessions" value={String(stats.sessions)} sub={`${stats.wins} winning`} />
            <Stat label="Hands" value={stats.hands.toLocaleString()} />
            <Stat label="Best session" value={fmtNet(stats.bestSession)} tone="up" />
            <Stat label="Worst session" value={fmtNet(stats.worstSession)} tone="down" />
            <Stat label="Biggest pot won" value={stats.biggestPot.toLocaleString()} />
          </section>
          <section className="mb-8">
            <h2 className="label">Lifetime HUD</h2>
            <HudGrid hud={stats.hud} />
          </section>
          {isAdmin && <FlagsPanel />}
          <section>
            <h2 className="label">Recent sessions</h2>
            {stats.recent.length === 0 ? (
              <p className="text-muted text-sm card-surface p-4">No finished sessions yet.</p>
            ) : (
              <ul className="card-surface divide-y divide-border">
                {stats.recent.map((r) => (
                  <li key={r.tableCode + r.endedAt} className="flex items-center gap-3 p-3.5">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{r.tableName}</p>
                      <p className="text-xs text-muted">{timeAgo(r.endedAt)} · {r.hands} hands · in {r.buyIn.toLocaleString()} / out {r.cashOut.toLocaleString()}</p>
                    </div>
                    <span className={`font-bold num ${r.net > 0 ? "text-green-bright" : r.net < 0 ? "text-[#ff8b8e]" : "text-muted"}`}>{fmtNet(r.net)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Admin-only kill switches. Changes reach every open table within a second. */
function FlagsPanel() {
  const { flags, setFlags } = useAuth();
  const [busy, setBusy] = useState<FlagName | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const flip = async (name: FlagName, enabled: boolean) => {
    setBusy(name);
    setErr(null);
    try {
      const r = await api.setFlag(name, enabled);
      setFlags(r.flags);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update that flag");
    } finally {
      setBusy(null);
    }
  };
  const off = FLAG_NAMES.filter((n) => !flags[n]).length;
  return (
    <section className="mb-8">
      <h2 className="label flex items-center gap-1.5"><ShieldCheck size={14} aria-hidden="true" /> Feature flags {off > 0 && <span className="pill pill-red normal-case tracking-normal">{off} off</span>}</h2>
      <p className="text-xs text-muted mb-2">Only admins see this. Switch a feature off if it misbehaves; every open table picks the change up immediately, no redeploy needed.</p>
      <div className={`space-y-2 ${busy ? "opacity-70 pointer-events-none" : ""}`}>
        {FLAG_NAMES.map((n) => (
          <Toggle key={n} label={FLAG_DEFS[n].label} hint={FLAG_DEFS[n].hint} checked={flags[n]} onChange={(v) => void flip(n, v)} />
        ))}
      </div>
      {err && <p className="text-sm text-[#ff8b8e] mt-2" role="alert">{err}</p>}
    </section>
  );
}

function Stat({ label, value, sub, tone, big }: { label: string; value: string; sub?: string; tone?: "up" | "down"; big?: boolean }) {
  const color = tone === "up" ? "text-green-bright" : tone === "down" ? "text-[#ff8b8e]" : "";
  return (
    <div className={`card-surface p-4 ${big ? "col-span-2 sm:col-span-1" : ""}`}>
      <p className="text-xs uppercase tracking-wider text-dim font-semibold">{label}</p>
      <p className={`font-extrabold num ${big ? "text-3xl" : "text-xl"} ${color}`} style={{ fontFamily: "var(--font-display)" }}>{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

function HudGrid({ hud }: { hud: UserStats["hud"] }) {
  const s = hudStats(hud);
  const f = (v: number | null, suf = "") => (v === null ? "–" : v === Infinity ? "∞" : `${v}${suf}`);
  const items: [string, string, string][] = [
    ["VPIP", f(s.vpip, "%"), "put money in preflop"],
    ["PFR", f(s.pfr, "%"), "raised preflop"],
    ["3-Bet", f(s.threeBet, "%"), "re-raised preflop"],
    ["AF", f(s.af), "postflop aggression"],
    ["WTSD", f(s.wtsd, "%"), "went to showdown"],
    ["W$SD", f(s.wsd, "%"), "won at showdown"],
  ];
  if (s.hands === 0) return <p className="text-muted text-sm card-surface p-4">HUD stats appear after your first finished session.</p>;
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(([k, v, hint]) => (
        <div key={k} className="card-surface p-3">
          <p className="text-[11px] uppercase tracking-wider text-dim font-semibold">{k}</p>
          <p className="text-xl font-extrabold num" style={{ fontFamily: "var(--font-display)" }}>{v}</p>
          <p className="text-[11px] text-muted leading-tight">{hint}</p>
        </div>
      ))}
      <p className="col-span-3 text-xs text-dim">Over {s.hands.toLocaleString()} hands.</p>
    </div>
  );
}
