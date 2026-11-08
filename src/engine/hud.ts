import type { Card } from "./cards";
import type { GameEvent, HandResult, Street } from "./types";
import type { Variant } from "./variants";

/** Per-player counters that a HUD is computed from. All are counts, so they can be summed across hands/sessions. */
export interface HudCounters {
  hands: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  /** postflop bets + raises */
  aggBets: number;
  /** postflop calls */
  aggCalls: number;
  sawFlop: number;
  wtsd: number;
  wsd: number;
  won: number;
}

export const emptyHud = (): HudCounters => ({ hands: 0, vpip: 0, pfr: 0, threeBet: 0, aggBets: 0, aggCalls: 0, sawFlop: 0, wtsd: 0, wsd: 0, won: 0 });

export function addHud(a: HudCounters, b: HudCounters): HudCounters {
  const out = emptyHud();
  for (const k of Object.keys(out) as (keyof HudCounters)[]) out[k] = a[k] + b[k];
  return out;
}

export interface HandRecordPlayer {
  seat: number;
  playerId: string;
  name: string;
  /** Final hole cards (after any discard). */
  hole: Card[];
  discarded: Card[];
  startStack: number;
  /** Cards were shown at the table (showdown or all-in run-out). */
  revealed: boolean;
  folded: boolean;
}

/** Everything needed to replay a hand. Hole cards are redacted per viewer by the server. */
export interface HandRecord {
  number: number;
  variant: Variant;
  button: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  blinds: { sb: number; bb: number; ante: number };
  players: HandRecordPlayer[];
  boards: Card[][];
  /** Squid Game: index of the eliminated board. */
  eliminated: number | null;
  /** Short deck (36 cards) was in force. Missing on records saved before it existed. */
  shortDeck?: boolean;
  /** Red river was in force. */
  redRiver?: boolean;
  /** Per board: cards that would have followed had the hand gone to the river. */
  rabbit: Card[][];
  /** The ghost player's hand, when one was dealt in. */
  ghost: { hole: Card[]; discarded: Card[]; stake: number; won: number } | null;
  events: GameEvent[];
  result: HandResult | null;
  startedAt: number;
  endedAt: number;
}

/** Derive HUD counters for every player in a finished hand. */
export function hudFromHand(rec: HandRecord): Record<number, HudCounters> {
  const out: Record<number, HudCounters> = {};
  for (const p of rec.players) {
    out[p.seat] = emptyHud();
    out[p.seat]!.hands = 1;
  }
  let street: Street = "preflop";
  let preflopRaises = 0;
  const folded = new Set<number>();
  const vpipDone = new Set<number>();
  const pfrDone = new Set<number>();
  const threeBetDone = new Set<number>();
  for (const e of rec.events) {
    if (e.type === "street") {
      street = e.street;
      if (street === "flop") for (const p of rec.players) if (!folded.has(p.seat)) out[p.seat]!.sawFlop = 1;
      continue;
    }
    if (e.type !== "action") continue;
    const h = out[e.seat];
    if (!h) continue;
    if (e.action === "fold") folded.add(e.seat);
    if (street === "preflop") {
      if ((e.action === "call" && e.amount > 0) || e.action === "bet" || e.action === "raise") {
        if (!vpipDone.has(e.seat)) { vpipDone.add(e.seat); h.vpip = 1; }
      }
      if (e.action === "raise" || e.action === "bet") {
        if (!pfrDone.has(e.seat)) { pfrDone.add(e.seat); h.pfr = 1; }
        if (preflopRaises >= 1 && !threeBetDone.has(e.seat)) { threeBetDone.add(e.seat); h.threeBet = 1; }
        preflopRaises++;
      }
    } else {
      if (e.action === "bet" || e.action === "raise") h.aggBets++;
      else if (e.action === "call" && e.amount > 0) h.aggCalls++;
    }
  }
  if (rec.result) {
    const atShowdown = Object.keys(rec.result.hands).map(Number);
    for (const seat of atShowdown) if (out[seat]) out[seat]!.wtsd = 1;
    for (const pot of rec.result.pots) {
      for (const w of pot.winners) {
        const h = out[w.seat];
        if (!h) continue;
        h.won = 1;
        if (atShowdown.includes(w.seat)) h.wsd = 1;
      }
    }
  }
  return out;
}

export interface HudStats {
  hands: number;
  vpip: number | null; // percent
  pfr: number | null;
  threeBet: number | null;
  af: number | null; // aggression factor
  wtsd: number | null; // % of flops seen
  wsd: number | null; // % of showdowns won
  won: number | null; // % hands won
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

export function hudStats(c: HudCounters): HudStats {
  return {
    hands: c.hands,
    vpip: pct(c.vpip, c.hands),
    pfr: pct(c.pfr, c.hands),
    threeBet: pct(c.threeBet, c.hands),
    af: c.aggCalls > 0 ? Math.round((c.aggBets / c.aggCalls) * 10) / 10 : c.aggBets > 0 ? Infinity : null,
    wtsd: pct(c.wtsd, c.sawFlop),
    wsd: pct(c.wsd, c.wtsd),
    won: pct(c.won, c.hands),
  };
}
