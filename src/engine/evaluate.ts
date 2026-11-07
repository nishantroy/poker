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

function pack(category: number, ranks: number[]): number {
  // category in top bits, then up to 5 ranks × 4 bits.
  let s = category;
  for (let i = 0; i < 5; i++) s = s * 16 + (ranks[i] ?? 0);
  return s;
}

/** Evaluate exactly 5 cards. */
export function evaluate5(cards: Card[]): HandRank {
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
    else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5; // wheel
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
  return { score: pack(category, ranks), category, ranks, cards: [...cards] };
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
export function evaluateAny(cards: Card[]): HandRank {
  if (cards.length < 5) throw new Error("need at least 5 cards");
  let best: HandRank | null = null;
  for (const combo of combinations(cards, 5)) {
    const r = evaluate5(combo);
    if (!best || r.score > best.score) best = r;
  }
  return best!;
}

/** Omaha rule: exactly 2 hole cards + exactly 3 board cards. */
export function evaluateOmaha(hole: Card[], board: Card[]): HandRank {
  if (board.length < 3) throw new Error("need at least 3 board cards");
  let best: HandRank | null = null;
  const holeCombos = combinations(hole, 2);
  const boardCombos = combinations(board, 3);
  for (const h of holeCombos) {
    for (const b of boardCombos) {
      const r = evaluate5([...h, ...b]);
      if (!best || r.score > best.score) best = r;
    }
  }
  return best!;
}

export function evaluateHand(rule: "any" | "exactly2", hole: Card[], board: Card[]): HandRank {
  return rule === "exactly2" ? evaluateOmaha(hole, board) : evaluateAny([...hole, ...board]);
}
