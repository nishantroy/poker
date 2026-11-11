import { ChevronRight, Trophy, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { TableView, TournamentInfo, TournamentSetup } from "@shared/protocol";
import { TOURNEY_LIMITS, blindsAt, ordinal, payoutShares } from "@engine/tournament";
import { fmtChips } from "../lib/format";
import { Field, Sheet } from "./ui";

/** Playing time left in the blind level, ticking once a second while the clock runs. */
export function useLevelLeft(t: TournamentInfo | null, serverTime: number, offset: number): number {
  const [, tick] = useState(0);
  const running = !!t && t.clockRunning;
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [running]);
  if (!t) return 0;
  return Math.max(0, t.levelLeftMs - (running ? Math.max(0, Date.now() + offset - serverTime) : 0));
}

export function fmtClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const mins = (ms: number) => Math.round(ms / 60_000);

/** When the next level starts, in words. */
function nextUp(t: TournamentInfo, left: number): string {
  if (!t.clockRunning) return "clock stopped";
  return left <= 0 ? "next hand" : `in ${fmtClock(left)}`;
}

/** Slim strip under the header: level, blinds, the next rise and who is left. Tap for standings, payouts and the schedule. */
export function TourneyStrip({ view, offset, onOpen }: { view: TableView; offset: number; onOpen: () => void }) {
  const t = view.tournament!;
  const left = useLevelLeft(t, view.serverTime, offset);
  let body: ReactNode;
  if (!t.started) {
    body = <span>Tournament · {t.entrants} in{t.pool > 0 ? ` · prize pool ${fmtChips(t.pool)}` : ""} · blinds up every {mins(t.levelMs)} min</span>;
  } else if (t.over) {
    const w = t.standings.find((s) => s.place === 1);
    body = <span><b>{w ? (w.userId === view.me.userId ? "You win" : `${w.name} wins`) : "Tournament over"}</b>{w && w.prize > 0 ? ` · ${fmtChips(w.prize)}` : ""}</span>;
  } else {
    const soon = t.clockRunning && left < 30_000;
    body = (
      <span className="inline-flex items-center gap-x-1.5 flex-wrap justify-center">
        <span>Level {t.level + 1}</span>
        <b key={t.level} className="num text-gold-bright anim-pop">{fmtChips(t.blinds.sb)}/{fmtChips(t.blinds.bb)}</b>
        {t.nextBlinds && (
          <span className={soon ? "text-[#ff9a9d]" : "text-muted"}>
            <span aria-hidden="true">→</span> <span className="num">{fmtChips(t.nextBlinds.sb)}/{fmtChips(t.nextBlinds.bb)}</span> <span className="num">{nextUp(t, left)}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-muted"><Users size={12} aria-hidden="true" /><span className="num">{t.left}/{t.entrants}</span></span>
      </span>
    );
  }
  return (
    <div className="relative z-30 shrink-0 px-3 pb-1 flex justify-center">
      <button className={`next-game-strip ${t.over ? "next-game-strip-hot" : ""}`} onClick={onOpen} aria-label="Tournament standings, payouts and blind schedule">
        <Trophy size={14} className="text-gold shrink-0" aria-hidden="true" />
        {body}
        <ChevronRight size={14} className="text-dim shrink-0" aria-hidden="true" />
      </button>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="card-surface px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-dim font-semibold">{label}</p>
      <p className="font-extrabold num leading-tight">{children}</p>
    </div>
  );
}

/** Standings, payouts and the blind schedule. */
export function TourneySheet({ open, onClose, view, offset }: { open: boolean; onClose: () => void; view: TableView; offset: number }) {
  const t = view.tournament;
  const left = useLevelLeft(open ? t : null, view.serverTime, offset);
  if (!t) return null;
  const shares = payoutShares(t.entrants, t.payouts);
  const lastLevel = Math.min(TOURNEY_LIMITS.maxLevel, Math.max(t.level + 6, 9));
  const levels = Array.from({ length: lastLevel + 1 }, (_, l) => ({ l, ...blindsAt(l, t.startBlinds.sb, t.startBlinds.bb) }));
  return (
    <Sheet open={open} onClose={onClose} title="Tournament">
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Buy-in">{t.buyIn > 0 ? fmtChips(t.buyIn) : "Free"}</Stat>
          <Stat label="Prize pool">{fmtChips(t.pool)}</Stat>
          <Stat label={t.started ? "Players left" : "Players in"}>{t.started ? `${t.left} of ${t.entrants}` : t.entrants}</Stat>
          <Stat label={t.started ? `Level ${t.level + 1}` : "Starting blinds"}>{fmtChips(t.blinds.sb)}/{fmtChips(t.blinds.bb)}</Stat>
        </div>
        {!t.started && <p className="text-sm text-muted">Everyone starts with <span className="num font-bold text-text">{t.startingStack.toLocaleString()}</span> chips. One entry, no rebuys: seats close when the host starts, and the last player with chips wins.</p>}

        <section>
          <h3 className="label">Payouts {t.payouts === "winner" && <span className="normal-case font-normal text-dim">(winner takes all)</span>}</h3>
          {t.pool > 0 ? (
            <ul className="card-surface divide-y divide-border">
              {t.prizes.map((p, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-bold w-10">{ordinal(i + 1)}</span>
                  <span className="text-muted flex-1">{shares[i]}%</span>
                  <span className="num font-extrabold text-gold-bright">{fmtChips(p)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t.buyIn > 0 ? "The prize pool grows as players take a seat." : "No buy-in: this one is for bragging rights."}</p>
          )}
          {!t.started && t.payouts === "auto" && <p className="text-xs text-dim mt-1.5">Paid places follow the field: 1 place up to 3 players, 2 places up to 6, 3 places from 7.</p>}
        </section>

        <section>
          <h3 className="label">{t.started ? "Standings" : "Players"}</h3>
          {t.standings.length === 0 ? (
            <p className="text-sm text-muted">Nobody has taken a seat yet.</p>
          ) : (
            <table className="w-full text-sm card-surface overflow-hidden">
              <tbody>
                {t.standings.map((s, i) => {
                  const out = s.place !== null && s.place !== 1;
                  return (
                    <tr key={s.userId} className={`border-b border-border last:border-0 ${s.userId === view.me.userId ? "bg-brand/10" : ""}`}>
                      <td className="px-3 py-2 text-muted w-12">{s.place !== null ? ordinal(s.place) : t.started ? i + 1 : ""}</td>
                      <td className={`px-3 py-2 font-semibold ${out ? "text-muted" : ""}`}>{s.name}</td>
                      <td className="px-3 py-2 text-right num">
                        {out ? <span className="text-dim">out</span> : <><span className="font-bold text-gold-bright">{fmtChips(s.chips)}</span>{t.started && t.blinds.bb > 0 && <span className="text-dim text-xs"> · {Math.round(s.chips / t.blinds.bb)} BB</span>}</>}
                      </td>
                      {t.pool > 0 && t.started && <td className="px-3 py-2 text-right num font-bold text-green-bright w-16">{s.prize > 0 ? `+${fmtChips(s.prize)}` : ""}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h3 className="label">Blinds <span className="normal-case font-normal text-dim">(up every {mins(t.levelMs)} min of play, from the next deal)</span></h3>
          <ul className="card-surface divide-y divide-border text-sm">
            {levels.map(({ l, sb, bb }) => {
              const now = t.started && l === t.level;
              const next = t.started && !t.over && l === t.level + 1;
              return (
                <li key={l} className={`flex items-center gap-2 px-3 py-1.5 ${now ? "bg-brand/10" : t.started && l < t.level ? "text-dim" : ""}`}>
                  <span className="w-16 text-muted">Level {l + 1}</span>
                  <span className={`num flex-1 ${now ? "font-extrabold text-gold-bright" : "font-semibold"}`}>{fmtChips(sb)}/{fmtChips(bb)}</span>
                  <span className="text-xs text-muted num">{now ? "now" : next ? nextUp(t, left) : ""}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </Sheet>
  );
}

const LEVEL_MINUTES = [3, 5, 10, 15, 20];

/** Buy-in, level length and payouts: used when creating a tournament and by the host before it starts. */
export function TournamentFields({ value, onChange }: { value: TournamentSetup; onChange: (v: TournamentSetup) => void }) {
  const m = mins(value.levelMs);
  const options = LEVEL_MINUTES.includes(m) ? LEVEL_MINUTES : [...LEVEL_MINUTES, m].sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      <Field label="Buy-in" hint="What each player puts into the prize pool. Results and the leaderboard count this, not chips. 0 plays for nothing.">
        <input className="input" type="number" inputMode="numeric" min={0} max={TOURNEY_LIMITS.maxBuyIn} value={value.buyIn} onChange={(e) => onChange({ ...value, buyIn: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
      </Field>
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label mb-0">Blinds go up every</span>
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Minutes per blind level">
            {options.map((n) => (
              <button type="button" key={n} className="chip-toggle min-w-[44px]" aria-pressed={m === n} onClick={() => onChange({ ...value, levelMs: n * 60_000 })}>{n}m</button>
            ))}
          </div>
        </div>
        <p className="text-xs text-dim">The clock only counts playing time; it stops while the game is paused.</p>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label mb-0">Payouts</span>
          <div className="flex gap-1.5" role="group" aria-label="Payouts">
            {([["auto", "Top places"], ["winner", "Winner takes all"]] as const).map(([v, l]) => (
              <button type="button" key={v} className="chip-toggle" aria-pressed={value.payouts === v} onClick={() => onChange({ ...value, payouts: v })}>{l}</button>
            ))}
          </div>
        </div>
        <p className="text-xs text-dim">{value.payouts === "winner" ? "First place takes the whole prize pool." : "Up to 3 players: winner takes all. 4 to 6: 65% / 35%. 7 or more: 50% / 30% / 20%."}</p>
      </div>
    </div>
  );
}

/** The first few blind levels, for the create form. */
export function blindPreview(sb: number, bb: number, count = 5): string {
  return Array.from({ length: count }, (_, l) => blindsAt(l, sb, bb)).map((b) => `${fmtChips(b.sb)}/${fmtChips(b.bb)}`).join(" → ") + " …";
}
