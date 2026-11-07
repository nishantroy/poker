import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import type { UserStats } from "@shared/protocol";
import { api } from "../lib/api";
import { Link } from "../lib/router";
import { fmtNet, timeAgo } from "../lib/format";

export function ProfilePage() {
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
