/**
 * Sit-and-go tournament rules: the blind schedule, the payout table and how the prize pool is settled.
 * Pure functions only; the level clock, seats and eliminations are driven by the table (TableDO).
 */

export type PayoutMode = "auto" | "winner";

export interface TournamentSetup {
  /** What each entrant pays into the prize pool. Results and the leaderboard are kept in this unit, not in chips. 0 plays for nothing. */
  buyIn: number;
  /** Length of one blind level. */
  levelMs: number;
  /** "auto" pays more places as the field grows; "winner" is winner-takes-all. */
  payouts: PayoutMode;
}

export const TOURNEY_LIMITS = {
  minLevelMs: 60_000,
  maxLevelMs: 60 * 60_000,
  maxBuyIn: 1_000_000,
  /** Last blind level (0-based); the blinds stop rising here. */
  maxLevel: 34,
} as const;

export function defaultTournament(): TournamentSetup {
  return { buyIn: 20, levelMs: 5 * 60_000, payouts: "auto" };
}

/**
 * Clean up an untrusted tournament setup. Returns null when the input is not a tournament at all.
 * Fields that are missing or make no sense fall back to `base` (the defaults, or the setup being changed).
 */
export function validateTournament(input: unknown, base: TournamentSetup = defaultTournament()): TournamentSetup | null {
  if (typeof input !== "object" || !input) return null;
  const o = input as Record<string, unknown>;
  const d = base;
  const int = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = typeof v === "number" ? Math.floor(v) : typeof v === "string" ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  return {
    buyIn: int(o.buyIn, 0, TOURNEY_LIMITS.maxBuyIn, d.buyIn),
    levelMs: int(o.levelMs, TOURNEY_LIMITS.minLevelMs, TOURNEY_LIMITS.maxLevelMs, d.levelMs),
    payouts: o.payouts === "winner" || o.payouts === "auto" ? o.payouts : d.payouts,
  };
}

/** Blinds as a multiple of the opening blinds: 1, 1.5, 2, 3, 4, 6, 8, then the same steps times ten, and so on. */
const STEPS = [1, 1.5, 2, 3, 4, 6, 8];

/** Blinds for a level (0 = the opening blinds). */
export function blindsAt(level: number, startSb: number, startBb: number): { sb: number; bb: number } {
  const l = Math.max(0, Math.min(TOURNEY_LIMITS.maxLevel, Math.floor(level)));
  const m = STEPS[l % STEPS.length]! * 10 ** Math.floor(l / STEPS.length);
  const bb = Math.max(1, Math.round(startBb * m));
  const sb = Math.max(1, Math.min(bb, Math.round(startSb * m)));
  return { sb, bb };
}

/** Level the clock has reached after `elapsedMs` of play. */
export function levelAt(elapsedMs: number, levelMs: number): number {
  if (!(levelMs > 0) || !(elapsedMs > 0)) return 0;
  return Math.min(TOURNEY_LIMITS.maxLevel, Math.floor(elapsedMs / levelMs));
}

/** Percent of the prize pool per paid place. */
export function payoutShares(entrants: number, mode: PayoutMode): number[] {
  if (mode === "winner" || entrants <= 3) return [100];
  if (entrants <= 6) return [65, 35];
  return [50, 30, 20];
}

/** Prize per paid place (index 0 = first). Whole numbers; rounding leftovers go to first place, so the prizes always add up to the pool. */
export function prizeTable(entrants: number, buyIn: number, mode: PayoutMode): number[] {
  const pool = Math.max(0, entrants) * Math.max(0, buyIn);
  const prizes = payoutShares(entrants, mode).map((s) => Math.floor((pool * s) / 100));
  prizes[0] = (prizes[0] ?? 0) + pool - prizes.reduce((a, b) => a + b, 0);
  return prizes;
}

/**
 * Finishing places for players knocked out in the same hand. Whoever started the hand with more chips finishes
 * higher; equal stacks tie for the better place. `remainingBefore` counts everyone still in when the hand began.
 */
export function bustPlaces(remainingBefore: number, busts: { id: string; startStack: number }[]): { id: string; place: number }[] {
  const sorted = [...busts].sort((a, b) => b.startStack - a.startStack);
  const top = remainingBefore - sorted.length + 1;
  const out: { id: string; place: number }[] = [];
  sorted.forEach((b, i) => {
    const prev = i > 0 ? sorted[i - 1]! : null;
    out.push({ id: b.id, place: prev && prev.startStack === b.startStack ? out[i - 1]!.place : top + i });
  });
  return out;
}

/**
 * Who gets what from the prize pool.
 * - Finished players take the prize for their place; players tied for a place share the prizes for the places they cover.
 * - One player left: they take everything that remains (first place).
 * - Several left (the host ended it early): what remains is split by chip count, odd chips to the biggest stack.
 * The amounts always add up to the pool.
 */
export function settle(prizes: number[], finished: { id: string; place: number }[], remaining: { id: string; chips: number }[]): Record<string, number> {
  const pool = prizes.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  let awarded = 0;
  const byPlace = new Map<number, string[]>();
  for (const f of finished) byPlace.set(f.place, [...(byPlace.get(f.place) ?? []), f.id]);
  for (const [place, ids] of byPlace) {
    let total = 0;
    for (let p = place; p < place + ids.length; p++) total += prizes[p - 1] ?? 0;
    const each = Math.floor(total / ids.length);
    let odd = total - each * ids.length;
    for (const id of ids) {
      out[id] = each + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
    }
    awarded += total;
  }
  const left = pool - awarded;
  if (remaining.length === 0) return out;
  const chips = remaining.reduce((a, r) => a + Math.max(0, r.chips), 0);
  let given = 0;
  for (const r of remaining) {
    out[r.id] = chips > 0 ? Math.floor((left * Math.max(0, r.chips)) / chips) : Math.floor(left / remaining.length);
    given += out[r.id]!;
  }
  const biggest = [...remaining].sort((a, b) => b.chips - a.chips)[0]!;
  out[biggest.id] = out[biggest.id]! + left - given;
  return out;
}

export function ordinal(n: number): string {
  const v = n % 100;
  const s = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}
