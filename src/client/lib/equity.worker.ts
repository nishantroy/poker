/// <reference lib="webworker" />
import { computeEquity } from "@engine/equity";
import { VARIANTS } from "@engine/variants";
import type { Card } from "@engine/cards";
import type { Variant } from "@engine/variants";

export interface EquityRequest {
  id: number;
  variant: Variant;
  shortDeck?: boolean;
  /** `boards`: every board still in play at this stage; equities are averaged across them (pots split per board). */
  stages: { key: string; boards: Card[][]; seats: number[]; holes: Card[][]; dead: Card[] }[];
}
export interface EquityResponse {
  id: number;
  stages: { key: string; seats: number[]; equity: number[]; exact: boolean }[];
}

self.onmessage = (ev: MessageEvent<EquityRequest>) => {
  const req = ev.data;
  const spec = { ...VARIANTS[req.variant], shortDeck: !!req.shortDeck };
  const out: EquityResponse = { id: req.id, stages: [] };
  for (const st of req.stages) {
    if (st.holes.length < 2) {
      out.stages.push({ key: st.key, seats: st.seats, equity: st.seats.map(() => 100), exact: true });
      continue;
    }
    const samples = Math.round((spec.holeCards >= 5 ? 1200 : spec.holeCards === 4 ? 1800 : 3000) / st.boards.length);
    const sum = st.seats.map(() => 0);
    let exact = true;
    for (const board of st.boards) {
      // the other boards' cards are dead for this one
      const others = st.boards.filter((b) => b !== board).flat();
      const r = computeEquity(spec, st.holes, board, [...st.dead, ...others], { samples, maxExact: spec.holeCards >= 4 ? 4000 : 20_000 });
      r.equity.forEach((e, i) => { sum[i]! += e; });
      exact &&= r.exact;
    }
    const n = Math.max(1, st.boards.length);
    out.stages.push({ key: st.key, seats: st.seats, equity: sum.map((x) => Math.round((x / n) * 10) / 10), exact });
    // stream partial results so the UI fills in street by street
    self.postMessage({ ...out, stages: [...out.stages] });
  }
  self.postMessage(out);
};
