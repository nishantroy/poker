export type Variant = "nlhe" | "plo" | "plo5" | "plo6" | "plo8" | "irish" | "donkem" | "pineapple" | "crazy-pineapple";

export type BettingLimit = "no-limit" | "pot-limit";

export interface VariantSpec {
  id: Variant;
  name: string;
  short: string;
  holeCards: number;
  limit: BettingLimit;
  /** "any": use any combination of hole + board (hold'em). "exactly2": Omaha rule. "twoOrThree": 2 hole + 3 board or 3 hole + 2 board (Irish). */
  holeRule: "any" | "exactly2" | "twoOrThree";
  /** Street after which each player must discard down to `discardTo` cards. */
  discardAfter?: "preflop" | "flop";
  discardTo?: number;
  /** Split pot: half to the best high, half to the best eight-or-better low (when one qualifies). */
  hiLo?: boolean;
  /** Board cards dealt on the flop, turn and river. Default [3, 1, 1]. */
  streetCards?: [number, number, number];
  /** Extra board cards dealt after the river betting, with no betting, before showdown (Donk'em's "super river"). */
  superRiver?: number;
  /** No longer offered for new games; kept so old hands and replays still play back. */
  retired?: boolean;
}

/** Cards dealt on a street (preflop deals none). */
export function streetCardCount(spec: VariantSpec, street: "flop" | "turn" | "river"): number {
  const c = spec.streetCards ?? [3, 1, 1];
  return street === "flop" ? c[0] : street === "turn" ? c[1] : c[2];
}

/** Board cards up to and including the river. */
export function riverBoardSize(spec: VariantSpec): number {
  const c = spec.streetCards ?? [3, 1, 1];
  return c[0] + c[1] + c[2];
}

/** Full board length at showdown (before any red-river extension). */
export function fullBoardSize(spec: VariantSpec): number {
  return riverBoardSize(spec) + (spec.superRiver ?? 0);
}

export const VARIANTS: Record<Variant, VariantSpec> = {
  nlhe: { id: "nlhe", name: "No-Limit Hold'em", short: "NLHE", holeCards: 2, limit: "no-limit", holeRule: "any" },
  plo: { id: "plo", name: "Pot-Limit Omaha", short: "PLO", holeCards: 4, limit: "pot-limit", holeRule: "exactly2" },
  plo5: { id: "plo5", name: "5-Card Pot-Limit Omaha", short: "PLO5", holeCards: 5, limit: "pot-limit", holeRule: "exactly2" },
  plo6: { id: "plo6", name: "6-Card Pot-Limit Omaha", short: "PLO6", holeCards: 6, limit: "pot-limit", holeRule: "exactly2" },
  plo8: { id: "plo8", name: "PLO Hi-Lo (8 or better)", short: "PLO8", holeCards: 4, limit: "pot-limit", holeRule: "exactly2", hiLo: true },
  donkem: { id: "donkem", name: "Donk'em", short: "DONK", holeCards: 3, limit: "pot-limit", holeRule: "exactly2", streetCards: [2, 2, 1], superRiver: 1 },
  irish: { id: "irish", name: "Irish Hi-Lo", short: "IRISH", holeCards: 5, limit: "pot-limit", holeRule: "twoOrThree", hiLo: true },
  pineapple: {
    id: "pineapple",
    name: "Pineapple (preflop discard)",
    short: "PINE-P",
    holeCards: 3,
    limit: "no-limit",
    holeRule: "any",
    discardAfter: "preflop",
    discardTo: 2,
    retired: true,
  },
  "crazy-pineapple": {
    id: "crazy-pineapple",
    name: "Pineapple",
    short: "PINE",
    holeCards: 3,
    limit: "no-limit",
    holeRule: "any",
    discardAfter: "flop",
    discardTo: 2,
  },
};

/** Games that can be picked for a table (retired ones excluded). */
export const VARIANT_IDS = (Object.keys(VARIANTS) as Variant[]).filter((v) => !VARIANTS[v].retired);

/** Any known variant, including retired ones (old hand records). */
export function isVariant(v: unknown): v is Variant {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(VARIANTS, v);
}

/** A variant a table can be set to. Retired ids map to their replacement. */
export function playableVariant(v: unknown): Variant | null {
  if (v === "pineapple") return "crazy-pineapple";
  return isVariant(v) && !VARIANTS[v].retired ? v : null;
}
