import { useEffect, useState } from "react";
import { VARIANTS, type Variant } from "@engine/variants";
import { GAME_GUIDE, HOUSE_RULES } from "@shared/guide";
import type { Flags } from "@shared/flags";
import { Sheet } from "./ui";

const VARIANT_IDS = Object.keys(VARIANTS) as Variant[];

/** Which house rules to explain, given the operator flags. */
function houseRulesFor(flags: Flags) {
  const on: Record<string, boolean> = { straddle: flags.straddle, runs: flags.runItTwice, dealers: flags.dealersChoice, ghost: flags.ghost, squid: flags.squid, rabbit: flags.rabbitHunt };
  return HOUSE_RULES.filter((r) => on[r.id] !== false);
}

export function GameRules({ variant }: { variant: Variant }) {
  const spec = VARIANTS[variant];
  const g = GAME_GUIDE[variant];
  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-extrabold text-lg" style={{ fontFamily: "var(--font-display)" }}>{spec.name}</h3>
        <p className="text-sm text-cyan-bright">{g.tagline}</p>
      </div>
      <ul className="space-y-2 text-sm list-disc pl-5 marker:text-dim">
        {g.rules.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <div className="card-surface p-3">
        <p className="label mb-1">Watch out</p>
        <ul className="space-y-1.5 text-sm text-muted">{g.watchOut.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>
    </div>
  );
}

/** Rules sheet: every game the table can play, plus the house rules that are switched on. */
export function RulesSheet({ open, onClose, current, flags }: { open: boolean; onClose: () => void; current: Variant; flags: Flags }) {
  const [tab, setTab] = useState<Variant | "house">(current);
  useEffect(() => { if (open) setTab(current); }, [open, current]);
  const ids = flags.variants ? VARIANT_IDS : (["nlhe"] as Variant[]);
  const house = houseRulesFor(flags);
  return (
    <Sheet open={open} onClose={onClose} title="How to play">
      <div className="flex flex-wrap gap-1.5 mb-4" role="tablist" aria-label="Game">
        {ids.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className="chip-toggle" aria-pressed={tab === id} onClick={() => setTab(id)}>{VARIANTS[id].short}</button>
        ))}
        {house.length > 0 && <button role="tab" aria-selected={tab === "house"} className="chip-toggle" aria-pressed={tab === "house"} onClick={() => setTab("house")}>House rules</button>}
      </div>
      {tab === "house" ? (
        <div className="space-y-4">
          {house.map((r) => (
            <section key={r.id}>
              <h3 className="font-bold mb-1">{r.title}</h3>
              <ul className="space-y-1.5 text-sm text-muted">{r.body.map((b) => <li key={b}>{b}</li>)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <GameRules variant={tab} />
      )}
    </Sheet>
  );
}

/** Dealer's choice picker: every game that fits, with a one-line explanation and full rules on tap. */
export function GameChoiceSheet({ open, onClose, options, current, mode, onPick, secondsLeft }: {
  open: boolean; onClose: () => void; options: Variant[]; current: Variant; mode: "hand" | "orbit"; onPick: (v: Variant) => void; secondsLeft: number | null;
}) {
  const [info, setInfo] = useState<Variant | null>(null);
  useEffect(() => { if (!open) setInfo(null); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Dealer's choice">
      {info ? (
        <div className="space-y-4">
          <GameRules variant={info} />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn" onClick={() => setInfo(null)}>Back</button>
            <button className="btn btn-primary" onClick={() => onPick(info)}>Deal {VARIANTS[info].short}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            You're the dealer. Pick the game {mode === "orbit" ? "for the next orbit" : "for this hand"}.
            {secondsLeft !== null && <> No pick in {secondsLeft}s keeps {VARIANTS[current].short}.</>}
          </p>
          <ul className="space-y-2">
            {options.map((v) => (
              <li key={v} className="flex items-stretch gap-2">
                <button className={`flex-1 text-left card-surface px-3 py-2.5 rounded-xl border ${v === current ? "border-cyan/50" : "border-transparent"} hover:border-white/20`} onClick={() => onPick(v)}>
                  <span className="font-bold">{VARIANTS[v].name}</span>
                  {v === current && <span className="pill-cyan pill ml-2 text-[10px]">current</span>}
                  <span className="block text-xs text-muted mt-0.5">{GAME_GUIDE[v].tagline}</span>
                </button>
                <button className="btn btn-ghost px-3" onClick={() => setInfo(v)} aria-label={`Rules for ${VARIANTS[v].name}`}>Rules</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

export function DealersChoicePicker({ value, onChange }: { value: "off" | "hand" | "orbit"; onChange: (v: "off" | "hand" | "orbit") => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label mb-0">Dealer's choice</span>
        <div className="flex gap-1.5" role="group" aria-label="Dealer's choice">
          {([["off", "Off"], ["hand", "Each hand"], ["orbit", "Each orbit"]] as const).map(([v, l]) => (
            <button type="button" key={v} className="chip-toggle" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>
          ))}
        </div>
      </div>
      {value !== "off" && <p className="text-xs text-dim">The player about to get the button picks the game {value === "orbit" ? "for one full orbit" : "every hand"}. Blinds and other settings stay the same.</p>}
    </div>
  );
}
