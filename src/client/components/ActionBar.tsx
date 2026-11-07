import { useEffect, useMemo, useState } from "react";
import type { Action, ActionLimits, TableView } from "@shared/protocol";
import { VARIANTS } from "@engine/variants";
import { fmtChips } from "../lib/format";

export function ActionBar({ view, onAction }: { view: TableView; onAction: (a: Action) => void }) {
  const limits = view.me.limits!;
  const hand = view.hand!;
  const me = view.seats[view.me.seat!]!;
  const spec = VARIANTS[hand.variant];
  const [raising, setRaising] = useState(false);
  const [amount, setAmount] = useState(limits.minRaiseTo);
  const seqKey = hand.actionSeq;

  useEffect(() => {
    setRaising(false);
    setAmount(limits.minRaiseTo);
  }, [seqKey, limits.minRaiseTo]);

  const maxBy = me.stack + me.streetBet;
  const canRaise = limits.canRaise && limits.maxRaiseTo > hand.currentBet;
  const allInIsRaise = maxBy > hand.currentBet && (spec.limit === "no-limit" || maxBy <= limits.maxRaiseTo);

  const presets = useMemo(() => {
    const pot = limits.potSize;
    const call = limits.callAmount;
    // "raise to" amounts for a fraction of the pot after calling
    const potRaise = (f: number) => Math.round(hand.currentBet + (pot + call) * f);
    const items: { label: string; value: number }[] = [
      { label: "Min", value: limits.minRaiseTo },
      { label: "½ Pot", value: potRaise(0.5) },
      { label: "¾ Pot", value: potRaise(0.75) },
      { label: "Pot", value: potRaise(1) },
    ];
    if (spec.limit === "no-limit") items.push({ label: "All-in", value: maxBy });
    const seen = new Set<number>();
    return items
      .map((p) => ({ ...p, value: Math.min(limits.maxRaiseTo, Math.max(limits.minRaiseTo, p.value)) }))
      .filter((p) => (seen.has(p.value) ? false : (seen.add(p.value), true)));
  }, [limits, hand.currentBet, spec.limit, maxBy]);

  const clamp = (v: number) => Math.min(limits.maxRaiseTo, Math.max(limits.minRaiseTo, Math.round(v)));
  const raiseWord = hand.currentBet === 0 ? "Bet" : "Raise";
  const isAllIn = amount >= maxBy;
  const fill = limits.maxRaiseTo > limits.minRaiseTo ? ((amount - limits.minRaiseTo) / (limits.maxRaiseTo - limits.minRaiseTo)) * 100 : 100;

  return (
    <div>
      {raising && (
        <div className="absolute left-0 right-0 bottom-full mb-2 card-surface p-3 anim-fade-up space-y-2 shadow-pop z-10">
          <div className="flex gap-1.5 overflow-x-auto scroll-thin" role="group" aria-label="Quick raise sizes">
            {presets.map((p) => (
              <button key={p.label} className="chip-toggle whitespace-nowrap flex-1 px-2" aria-pressed={amount === p.value} onClick={() => setAmount(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <input type="range" className="range flex-1" min={limits.minRaiseTo} max={limits.maxRaiseTo} step={1} value={amount}
              style={{ ["--fill" as string]: `${fill}%` }} aria-label={`${raiseWord} amount`}
              onChange={(e) => setAmount(Number(e.target.value))} />
            <input className="input w-24 text-right font-bold num" type="number" inputMode="numeric" min={limits.minRaiseTo} max={limits.maxRaiseTo} value={amount}
              onChange={(e) => setAmount(Number(e.target.value))} onBlur={() => setAmount(clamp(amount))} aria-label={`${raiseWord} to amount`} />
          </div>
          <button className="btn btn-green w-full text-base" onClick={() => onAction(isAllIn && spec.limit === "no-limit" ? { type: "allin" } : { type: hand.currentBet === 0 ? "bet" : "raise", amount: clamp(amount) })}>
            {isAllIn ? "All-in" : `${raiseWord} to`} <span className="num">{fmtChips(clamp(amount))}</span>
          </button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button className="btn btn-danger text-base" onClick={() => onAction({ type: "fold" })}>Fold</button>
        {limits.canCheck ? (
          <button className="btn text-base" onClick={() => onAction({ type: "check" })}>Check</button>
        ) : (
          <button className="btn text-base flex-col gap-0 leading-tight" onClick={() => onAction({ type: "call" })}>
            <span>{limits.callAmount >= me.stack ? "Call all-in" : "Call"}</span>
            <span className="text-sm text-gold-bright num">{fmtChips(limits.callAmount)}</span>
          </button>
        )}
        {canRaise ? (
          <button className={`btn text-base ${raising ? "btn-ghost border-border-strong" : "btn-primary"}`} onClick={() => setRaising((r) => !r)} aria-expanded={raising}>
            {raising ? "Cancel" : raiseWord}
          </button>
        ) : allInIsRaise ? (
          <button className="btn btn-primary text-base" onClick={() => onAction({ type: "allin" })}>All-in</button>
        ) : (
          <button className="btn" disabled>—</button>
        )}
      </div>
    </div>
  );
}

export function DiscardBar({ selected, count, onDiscard }: { selected: number | null; count: number; onDiscard: () => void }) {
  return (
    <div className="card-surface p-3 flex items-center gap-3 anim-fade-up">
      <p className="flex-1 text-sm">
        <span className="font-bold">Discard one card.</span> <span className="text-muted">Tap a card, then confirm. {count > 1 ? `${count} players` : "1 player"} still to discard.</span>
      </p>
      <button className="btn btn-primary" disabled={selected === null} onClick={onDiscard}>Discard</button>
    </div>
  );
}
