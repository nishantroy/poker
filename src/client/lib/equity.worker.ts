/// <reference lib="webworker" />
import { computeEquity } from "@engine/equity";
import { VARIANTS } from "@engine/variants";
import type { Card } from "@engine/cards";
import type { Variant } from "@engine/variants";

export interface EquityRequest {
  id: number;
  variant: Variant;
  stages: { key: string; board: Card[]; seats: number[]; holes: Card[][]; dead: Card[] }[];
}
export interface EquityResponse {
  id: number;
  stages: { key: string; seats: number[]; equity: number[]; exact: boolean }[];
}

self.onmessage = (ev: MessageEvent<EquityRequest>) => {
  const req = ev.data;
  const spec = VARIANTS[req.variant];
  const out: EquityResponse = { id: req.id, stages: [] };
  for (const st of req.stages) {
    if (st.holes.length < 2) {
      out.stages.push({ key: st.key, seats: st.seats, equity: st.seats.map(() => 100), exact: true });
      continue;
    }
    const samples = spec.holeCards >= 5 ? 1200 : spec.holeCards === 4 ? 1800 : 3000;
    const r = computeEquity(spec, st.holes, st.board, st.dead, { samples, maxExact: spec.holeCards >= 4 ? 4000 : 20_000 });
    out.stages.push({ key: st.key, seats: st.seats, equity: r.equity, exact: r.exact });
    // stream partial results so the UI fills in street by street
    self.postMessage({ ...out, stages: [...out.stages] });
  }
  self.postMessage(out);
};
