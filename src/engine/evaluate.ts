import { type Card, rankValue, suitOf } from "./cards";

export const CATEGORY_NAMES = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
] as const;

export interface HandRank {
  /** Higher is better. Comparable across any two hands. */
  score: number;
  category: number; // 0..8 index into CATEGORY_NAMES
  /** Tiebreak ranks, most significant first (e.g. [14, 13] for Aces-full-of-Kings). */
  ranks: number[];
  /** The 5 cards that make the hand. */
  cards: Card[];
}

const RANK_NAMES: Record<number, string> = {
  2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine",
  10: "Ten", 11: "Jack", 12: "Queen", 13: "King", 14: "Ace",
};
const plural = (r: number) => (r === 6 ? "Sixes" : RANK_NAMES[r] + "s");

export function describeHand(h: HandRank): string {
  const r = h.ranks;
  switch (h.category) {
    case 8: return r[0] === 14 ? "Royal Flush" : `Straight Flush, ${RANK_NAMES[r[0]!]} high`;
    case 7: return `Four of a Kind, ${plural(r[0]!)}`;
    case 6: return `Full House, ${plural(r[0]!)} full of ${plural(r[1]!)}`;
    case 5: return `Flush, ${RANK_NAMES[r[0]!]} high`;
    case 4: return `Straight, ${RANK_NAMES[r[0]!]} high`;
    case 3: return `Three of a Kind, ${plural(r[0]!)}`;
    case 2: return `Two Pair, ${plural(r[0]!)} and ${plural(r[1]!)}`;
    case 1: return `Pair of ${plural(r[0]!)}`;
    default: return `${RANK_NAMES[r[0]!]} high`;
  }
}

/**
 * Short deck (Triton rules): a flush beats a full house and three of a kind beats a straight.
 * Category numbers keep their names; only their strength order changes.
 */
const SHORT_DECK_STRENGTH = [0, 1, 2, 4, 3, 6, 5, 7, 8];

/** Rules that change how hands are ranked. */
export interface RankRules {
  shortDeck?: boolean;
}

function pack(category: number, ranks: number[]): number {
  // category in top bits, then up to 5 ranks × 4 bits.
  let s = category;
  for (let i = 0; i < 5; i++) s = s * 16 + (ranks[i] ?? 0);
  return s;
}

/** Evaluate exactly 5 cards. */
export function evaluate5(cards: Card[], rules: RankRules = {}): HandRank {
  if (cards.length !== 5) throw new Error("evaluate5 needs 5 cards");
  const vals = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  // counts
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  // group ranks by count desc then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const distinct = groups.length;

  let straightHigh = 0;
  if (distinct === 5) {
    if (vals[0]! - vals[4]! === 4) straightHigh = vals[0]!;
    else if (!rules.shortDeck && vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5; // wheel
    else if (rules.shortDeck && vals[0] === 14 && vals[1] === 9 && vals[4] === 6) straightHigh = 9; // A-6-7-8-9: the ace plays low
  }

  let category: number;
  let ranks: number[];
  if (straightHigh && flush) { category = 8; ranks = [straightHigh]; }
  else if (groups[0]![1] === 4) { category = 7; ranks = [groups[0]![0], groups[1]![0]]; }
  else if (groups[0]![1] === 3 && groups[1]![1] === 2) { category = 6; ranks = [groups[0]![0], groups[1]![0]]; }
  else if (flush) { category = 5; ranks = vals; }
  else if (straightHigh) { category = 4; ranks = [straightHigh]; }
  else if (groups[0]![1] === 3) { category = 3; ranks = [groups[0]![0], groups[1]![0], groups[2]![0]]; }
  else if (groups[0]![1] === 2 && groups[1]![1] === 2) { category = 2; ranks = [groups[0]![0], groups[1]![0], groups[2]![0]]; }
  else if (groups[0]![1] === 2) { category = 1; ranks = [groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]]; }
  else { category = 0; ranks = vals; }
  const strength = rules.shortDeck ? SHORT_DECK_STRENGTH[category]! : category;
  return { score: pack(strength, ranks), category, ranks, cards: [...cards] };
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const cur: T[] = [];
  const rec = (start: number) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i <= arr.length - (k - cur.length); i++) {
      cur.push(arr[i]!);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

/** Best 5-card hand from any 5..7+ cards (hold'em rule: use any). */
export function evaluateAny(cards: Card[], rules: RankRules = {}): HandRank {
  if (cards.length < 5) throw new Error("need at least 5 cards");
  let best: HandRank | null = null;
  for (const combo of combinations(cards, 5)) {
    const r = evaluate5(combo, rules);
    if (!best || r.score > best.score) best = r;
  }
  return best!;
}

/** Omaha rule: exactly 2 hole cards + exactly 3 board cards. */
export function evaluateOmaha(hole: Card[], board: Card[], rules: RankRules = {}): HandRank {
  if (board.length < 3) throw new Error("need at least 3 board cards");
  let best: HandRank | null = null;
  const holeCombos = combinations(hole, 2);
  const boardCombos = combinations(board, 3);
  for (const h of holeCombos) {
    for (const b of boardCombos) {
      const r = evaluate5([...h, ...b], rules);
      if (!best || r.score > best.score) best = r;
    }
  }
  return best!;
}

export function evaluateHand(rule: "any" | "exactly2", hole: Card[], board: Card[], rules: RankRules = {}): HandRank {
  return rule === "exactly2" ? evaluateOmaha(hole, board, rules) : evaluateAny([...hole, ...board], rules);
}

// ---------- eight-or-better low (Omaha Hi-Lo) ----------

export interface LowRank {
  /** Higher is better (a lower low). Only comparable with other lows. */
  score: number;
  /** Low ranks, highest first, ace = 1 (e.g. [8, 6, 4, 3, 1]). */
  ranks: number[];
  cards: Card[];
}

const lowValue = (c: Card) => (rankValue(c) === 14 ? 1 : rankValue(c));

/** 5 cards qualify for low when they are 5 different ranks, all 8 or lower (ace low). Straights and flushes don't count against a low. */
export function evaluateLow5(cards: Card[]): LowRank | null {
  const vals = cards.map(lowValue);
  if (vals.some((v) => v > 8) || new Set(vals).size !== 5) return null;
  const ranks = [...vals].sort((a, b) => b - a);
  let packed = 0;
  for (const r of ranks) packed = packed * 16 + r;
  return { score: 0xfffff - packed, ranks, cards: [...cards] };
}

/** Best Omaha low: exactly 2 hole cards + exactly 3 board cards, or null when no low qualifies. */
export function evaluateOmahaLow(hole: Card[], board: Card[]): LowRank | null {
  if (board.length < 3) return null;
  let best: LowRank | null = null;
  for (const h of combinations(hole, 2)) {
    for (const b of combinations(board, 3)) {
      const r = evaluateLow5([...h, ...b]);
      if (r && (!best || r.score > best.score)) best = r;
    }
  }
  return best;
}

export function describeLow(l: LowRank): string {
  const face = (r: number) => (r === 1 ? "A" : String(r));
  if (l.ranks.join() === "5,4,3,2,1") return "Wheel (5-4-3-2-A) low";
  return `${l.ranks.map(face).join("-")} low`;
}
