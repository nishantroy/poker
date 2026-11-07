export type Variant = "nlhe" | "plo" | "plo5" | "plo6" | "pineapple" | "crazy-pineapple";

export type BettingLimit = "no-limit" | "pot-limit";

export interface VariantSpec {
  id: Variant;
  name: string;
  short: string;
  holeCards: number;
  limit: BettingLimit;
  /** "any": use any combination of hole + board (hold'em). "exactly2": Omaha rule. */
  holeRule: "any" | "exactly2";
  /** Street after which each player must discard down to `discardTo` cards. */
  discardAfter?: "preflop" | "flop";
  discardTo?: number;
}

export const VARIANTS: Record<Variant, VariantSpec> = {
  nlhe: { id: "nlhe", name: "No-Limit Hold'em", short: "NLHE", holeCards: 2, limit: "no-limit", holeRule: "any" },
  plo: { id: "plo", name: "Pot-Limit Omaha", short: "PLO", holeCards: 4, limit: "pot-limit", holeRule: "exactly2" },
  plo5: { id: "plo5", name: "5-Card Pot-Limit Omaha", short: "PLO5", holeCards: 5, limit: "pot-limit", holeRule: "exactly2" },
  plo6: { id: "plo6", name: "6-Card Pot-Limit Omaha", short: "PLO6", holeCards: 6, limit: "pot-limit", holeRule: "exactly2" },
  pineapple: {
    id: "pineapple",
    name: "Pineapple",
    short: "PINE",
    holeCards: 3,
    limit: "no-limit",
    holeRule: "any",
    discardAfter: "preflop",
    discardTo: 2,
  },
  "crazy-pineapple": {
    id: "crazy-pineapple",
    name: "Crazy Pineapple",
    short: "CRAZY",
    holeCards: 3,
    limit: "no-limit",
    holeRule: "any",
    discardAfter: "flop",
    discardTo: 2,
  },
};

export const VARIANT_IDS = Object.keys(VARIANTS) as Variant[];

export function isVariant(v: unknown): v is Variant {
  return typeof v === "string" && v in VARIANTS;
}
