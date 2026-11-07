// Card primitives. A card is a two-char string: rank + suit, e.g. "As", "Td".
export const RANKS = "23456789TJQKA" as const;
export const SUITS = "shdc" as const;
export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type Card = `${Rank}${Suit}`;

export function rankValue(card: Card): number {
  // 2 -> 2 ... A -> 14
  return RANKS.indexOf(card[0] as Rank) + 2;
}
export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}` as Card);
  return deck;
}

/** Random source returning an integer in [0, n). */
export type Rng = (n: number) => number;

/** Unbiased integer in [0, n) using crypto.getRandomValues (rejection sampling). */
export const cryptoRng: Rng = (n) => {
  if (n <= 0) throw new Error("rng bound must be positive");
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < limit) return v % n;
  }
};

/** Fisher–Yates shuffle (in place) and return the array. */
export function shuffle<T>(arr: T[], rng: Rng = cryptoRng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}

export function shuffledDeck(rng: Rng = cryptoRng): Card[] {
  return shuffle(freshDeck(), rng);
}

/** Deterministic RNG for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const f = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(f * n);
  };
}
