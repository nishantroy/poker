import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Dices } from "lucide-react";
import { VARIANTS, VARIANT_IDS, type Variant } from "@engine/variants";
import { GAME_GUIDE, HOUSE_RULES } from "@shared/guide";
import type { Flags } from "@shared/flags";
import { Sheet } from "./ui";

/** Which house rules to explain, given the operator flags. */
function houseRulesFor(flags: Flags) {
  const on: Record<string, boolean> = { redRiver: flags.redRiver, shortDeck: flags.shortDeck, straddle: flags.straddle, runs: flags.runItTwice, dealers: flags.dealersChoice, ghost: flags.ghost, squid: flags.squid, rabbit: flags.rabbitHunt };
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

/**
 * Dealer's choice, non-blocking: a slim strip under the header while the current hand plays.
 * The next dealer taps it for a small dropdown of games; everyone else just sees who's picking (and the pick).
 * No pick keeps the current game.
 */
export function NextGameStrip({ chooserName, mine, options, current, picked, mode, onPick, onRules }: {
  chooserName: string; mine: boolean; options: Variant[]; current: Variant; picked: Variant | null; mode: "hand" | "orbit";
  onPick: (v: Variant) => void; onRules: (v: Variant) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const span = mode === "orbit" ? "next orbit" : "next hand";
  const next = picked ?? current;
  return (
    <div ref={ref} className="relative z-30 shrink-0 px-3 pb-1 flex justify-center">
      {mine ? (
        <button className={`next-game-strip ${picked ? "" : "next-game-strip-hot"}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox">
          <Dices size={14} aria-hidden="true" />
          <span>{picked ? <>You picked <b>{VARIANTS[picked].short}</b> for the {span}</> : <>Your pick for the {span}</>}</span>
          <ChevronDown size={14} aria-hidden="true" className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
      ) : (
        <p className="next-game-strip text-muted" aria-live="polite">
          <Dices size={14} aria-hidden="true" />
          <span>{picked ? <>{chooserName} picked <b className="text-text">{VARIANTS[picked].short}</b> for the {span}</> : <>{chooserName} picks the {span}</>}</span>
        </p>
      )}
      {mine && open && (
        <div className="next-game-pop anim-fade-up" role="listbox" aria-label="Pick the next game">
          <p className="text-[11px] text-dim px-2 pt-1 pb-1.5">Deals after this hand. No pick keeps {VARIANTS[current].short}.</p>
          {options.map((v) => (
            <div key={v} className="flex items-stretch gap-1">
              <button role="option" aria-selected={v === next} className={`flex-1 text-left px-2 py-1.5 rounded-lg hover:bg-white/5 ${v === next ? "bg-white/8" : ""}`} onClick={() => { onPick(v); setOpen(false); }}>
                <span className="font-bold text-sm">{VARIANTS[v].name}</span>
                {v === current && <span className="text-[10px] text-cyan ml-1.5">now</span>}
                {v === picked && <Check size={13} className="inline ml-1.5 text-green-bright" aria-label="your pick" />}
                <span className="block text-[11px] text-muted leading-snug">{GAME_GUIDE[v].tagline}</span>
              </button>
              <button className="px-2 text-[11px] text-dim hover:text-text" onClick={() => onRules(v)} aria-label={`Rules for ${VARIANTS[v].name}`}>Rules</button>
            </div>
          ))}
        </div>
      )}
    </div>
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
