import { type Card, type Rng, cryptoRng, freshDeck } from "./cards";
import { evaluateHand } from "./evaluate";
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
  spec: Pick<VariantSpec, "holeRule">,
  holes: Card[][],
  board: Card[],
  dead: Card[] = [],
  opts: { maxExact?: number; samples?: number; rng?: Rng } = {},
): EquityResult {
  const n = holes.length;
  const known = new Set<Card>([...board, ...dead, ...holes.flat()]);
  const deck = freshDeck().filter((c) => !known.has(c));
  const need = 5 - board.length;
  const win = new Array<number>(n).fill(0);
  const tie = new Array<number>(n).fill(0);
  const share = new Array<number>(n).fill(0);
  let trials = 0;

  const scoreRunout = (full: Card[]) => {
    let best = -1;
    const scores = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const s = evaluateHand(spec.holeRule, holes[i]!, full).score;
      scores[i] = s;
      if (s > best) best = s;
    }
    let winners = 0;
    for (let i = 0; i < n; i++) if (scores[i] === best) winners++;
    for (let i = 0; i < n; i++) {
      if (scores[i] === best) {
        share[i]! += 1 / winners;
        if (winners === 1) win[i]! += 1;
        else tie[i]! += 1;
      }
    }
    trials++;
  };

  if (need === 0) {
    scoreRunout(board);
    return finish(true);
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
