import { type Card, type Rng, cryptoRng, freshDeck } from "./cards";
import { evaluateHand, evaluateOmahaLow } from "./evaluate";
import type { VariantSpec } from "./variants";

export interface EquityResult {
  /** Win+tie share per player, in percent, summing to ~100. */
  equity: number[];
  /** Outright win percent per player. */
  win: number[];
  /** Tie percent per player (any tie involving them). */
  tie: number[];
  /** Number of board run-outs evaluated. */
  trials: number;
  /** True when every possible run-out was enumerated. */
  exact: boolean;
}

function combos(arr: Card[], k: number, fn: (c: Card[]) => void) {
  const cur: Card[] = [];
  const rec = (start: number) => {
    if (cur.length === k) return fn(cur);
    for (let i = start; i <= arr.length - (k - cur.length); i++) {
      cur.push(arr[i]!);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
}

/**
 * Equity of each hand given a partial board. Known cards from folded players can be passed as `dead`
 * so they are not dealt again. Exact enumeration when the remaining run-outs are few; otherwise Monte Carlo.
 */
export function computeEquity(
  spec: Pick<VariantSpec, "holeRule"> & Partial<Pick<VariantSpec, "streetCards" | "superRiver">> & {
    hiLo?: boolean;
    shortDeck?: boolean;
    /** Red river: a red river card is followed by more cards until a black one. */
    redRiver?: boolean;
    /** Donk'em: whether the super river is already on `board`. */
    superDealt?: boolean;
  },
  holes: Card[][],
  board: Card[],
  dead: Card[] = [],
  opts: { maxExact?: number; samples?: number; rng?: Rng } = {},
): EquityResult {
  const n = holes.length;
  const known = new Set<Card>([...board, ...dead, ...holes.flat()]);
  const deck = freshDeck(!!spec.shortDeck && !spec.hiLo).filter((c) => !known.has(c));
  const rules = { shortDeck: !!spec.shortDeck && !spec.hiLo };
  const riverSize = (spec.streetCards ?? [3, 1, 1]).reduce((a, b) => a + b, 0);
  const sup = spec.superRiver ?? 0;
  // With red river, cards after the river are open-ended, so the board is completed by simulation;
  // once the river (and its red extension) is out, only the super river is left to come.
  const redPending = !!spec.redRiver && board.length < riverSize;
  const need = !spec.redRiver
    ? Math.max(0, riverSize + sup - board.length)
    : board.length >= riverSize ? (spec.superDealt ? 0 : sup) : -1;
  const win = new Array<number>(n).fill(0);
  const tie = new Array<number>(n).fill(0);
  const share = new Array<number>(n).fill(0);
  let trials = 0;

  const scoreRunout = (full: Card[]) => {
    let best = -1;
    const scores = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const s = evaluateHand(spec.holeRule, holes[i]!, full, rules).score;
      scores[i] = s;
      if (s > best) best = s;
    }
    const hiWinners: number[] = [];
    for (let i = 0; i < n; i++) if (scores[i] === best) hiWinners.push(i);
    // hi-lo: the pot splits between the best high and the best qualifying low
    let loWinners: number[] = [];
    if (spec.hiLo) {
      let bestLow = -1;
      const lows = holes.map((h) => evaluateOmahaLow(h, full, spec.holeRule)?.score ?? -1);
      for (const l of lows) if (l > bestLow) bestLow = l;
      if (bestLow >= 0) loWinners = lows.flatMap((l, i) => (l === bestLow ? [i] : []));
    }
    const got = new Array<number>(n).fill(0);
    const hiPart = loWinners.length ? 0.5 : 1;
    for (const i of hiWinners) got[i]! += hiPart / hiWinners.length;
    for (const i of loWinners) got[i]! += 0.5 / loWinners.length;
    for (let i = 0; i < n; i++) {
      if (got[i]! <= 0) continue;
      share[i]! += got[i]!;
      if (got[i]! >= 0.999) win[i]! += 1; // scooped
      else tie[i]! += 1;
    }
    trials++;
  };

  if (need === 0) {
    scoreRunout(board);
    return finish(true);
  }

  if (redPending) {
    const rng = opts.rng ?? cryptoRng;
    const samples = opts.samples ?? 3000;
    for (let s = 0; s < samples; s++) {
      const pool = [...deck];
      const draw = () => pool.splice(rng(pool.length), 1)[0]!;
      const full = [...board];
      while (full.length < riverSize && pool.length) full.push(draw());
      while (pool.length && (full[full.length - 1]![1] === "h" || full[full.length - 1]![1] === "d")) full.push(draw());
      if (!spec.superDealt) for (let k = 0; k < sup && pool.length; k++) full.push(draw());
      scoreRunout(full);
    }
    return finish(false);
  }

  // count possible run-outs
  let total = 1;
  for (let i = 0; i < need; i++) total = (total * (deck.length - i)) / (i + 1);
  const maxExact = opts.maxExact ?? 20_000;
  if (total <= maxExact) {
    combos(deck, need, (extra) => scoreRunout([...board, ...extra]));
    return finish(true);
  }

  const rng = opts.rng ?? cryptoRng;
  const samples = opts.samples ?? 3000;
  const pool = [...deck];
  for (let s = 0; s < samples; s++) {
    // partial Fisher–Yates: draw `need` cards
    for (let i = 0; i < need; i++) {
      const j = i + rng(pool.length - i);
      const t = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = t;
    }
    scoreRunout([...board, ...pool.slice(0, need)]);
  }
  return finish(false);

  function finish(exact: boolean): EquityResult {
    const pct = (x: number) => Math.round((x / trials) * 1000) / 10;
    return { equity: share.map(pct), win: win.map(pct), tie: tie.map(pct), trials, exact };
  }
}
