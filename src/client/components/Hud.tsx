import { useEffect, useState } from "react";
import type { HudCounters, PublicSeat } from "@shared/protocol";
import { hudStats, emptyHud } from "@engine/hud";
import { api } from "../lib/api";
import { Sheet } from "./ui";

const fmt = (v: number | null, suffix = "") => (v === null ? "–" : v === Infinity ? "∞" : `${v}${suffix}`);

export function HudStrip({ counters }: { counters: HudCounters | undefined }) {
  const s = hudStats(counters ?? emptyHud());
  if (s.hands === 0) return null;
  return (
    <div className="mt-0.5 rounded-md bg-black/55 border border-border px-1.5 py-0.5 text-[10px] font-bold num tracking-tight text-muted anim-fade-up" title="VPIP / PFR · AF · hands" aria-label={`VPIP ${fmt(s.vpip)} percent, PFR ${fmt(s.pfr)} percent, aggression ${fmt(s.af)}, ${s.hands} hands`}>
      <span className="text-text">{fmt(s.vpip)}</span>/<span className="text-text">{fmt(s.pfr)}</span> · {fmt(s.af)} · <span className="text-dim">{s.hands}h</span>
    </div>
  );
}

const ROWS: { key: keyof ReturnType<typeof hudStats>; label: string; hint: string; suffix?: string }[] = [
  { key: "hands", label: "Hands", hint: "Hands dealt" },
  { key: "vpip", label: "VPIP", hint: "Voluntarily put money in preflop", suffix: "%" },
  { key: "pfr", label: "PFR", hint: "Raised preflop", suffix: "%" },
  { key: "threeBet", label: "3-Bet", hint: "Re-raised preflop", suffix: "%" },
  { key: "af", label: "AF", hint: "Postflop bets+raises ÷ calls" },
  { key: "wtsd", label: "WTSD", hint: "Went to showdown after seeing the flop", suffix: "%" },
  { key: "wsd", label: "W$SD", hint: "Won money at showdown", suffix: "%" },
  { key: "won", label: "Won", hint: "Hands won", suffix: "%" },
];

export function HudTable({ session, lifetime }: { session: HudCounters; lifetime: HudCounters | null }) {
  const s = hudStats(session);
  const l = lifetime ? hudStats(lifetime) : null;
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] uppercase tracking-wider text-dim">
        <tr><th className="text-left font-semibold py-1">Stat</th><th className="text-right font-semibold py-1">Session</th><th className="text-right font-semibold py-1">Lifetime</th></tr>
      </thead>
      <tbody>
        {ROWS.map((r) => (
          <tr key={r.key} className="border-t border-border">
            <td className="py-1.5"><span className="font-semibold">{r.label}</span> <span className="text-dim text-xs hidden sm:inline">· {r.hint}</span></td>
            <td className="py-1.5 text-right num font-bold">{fmt(s[r.key] as number | null, r.suffix)}</td>
            <td className="py-1.5 text-right num text-muted">{l ? fmt(l[r.key] as number | null, r.suffix) : <span className="skeleton inline-block w-8 h-3 rounded" />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PlayerSheet({ seat, session, onClose }: { seat: PublicSeat | null; session: HudCounters | undefined; onClose: () => void }) {
  const [lifetime, setLifetime] = useState<HudCounters | null>(null);
  useEffect(() => {
    setLifetime(null);
    if (!seat) return;
    let alive = true;
    api.hud([seat.playerId]).then((r) => { if (alive) setLifetime(r.rows[0]?.counters ?? emptyHud()); }).catch(() => { if (alive) setLifetime(emptyHud()); });
    return () => { alive = false; };
  }, [seat?.playerId]);
  return (
    <Sheet open={!!seat} onClose={onClose} title={seat?.name ?? ""}>
      {seat && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Stack <span className="num font-bold text-gold-bright">{seat.stack.toLocaleString()}</span> · bought in {seat.totalBuyIn.toLocaleString()} · net <span className={`num font-bold ${seat.stack - seat.totalBuyIn >= 0 ? "text-green-bright" : "text-[#ff8b8e]"}`}>{seat.stack - seat.totalBuyIn >= 0 ? "+" : ""}{(seat.stack - seat.totalBuyIn).toLocaleString()}</span></p>
          <HudTable session={session ?? emptyHud()} lifetime={lifetime} />
          <p className="text-xs text-dim">Session stats are from this table. Lifetime totals update when a session ends.</p>
        </div>
      )}
    </Sheet>
  );
}
