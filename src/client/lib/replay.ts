import type { Card, HandRecordView, Street } from "@shared/protocol";
import { GHOST_SEAT, type GameEvent } from "@engine/types";
import type { EquityRequest } from "./equity.worker";

export interface StageAction {
  seat: number;
  text: string;
  kind: "blind" | "fold" | "check" | "call" | "bet" | "raise" | "discard" | "timeout";
  allIn?: boolean;
}

export interface Stage {
  key: string;
  street: Street;
  boards: Card[][];
  /** Squid Game: board eliminated at this point (river stage only). */
  eliminated: number | null;
  /** players still in the hand when this street was dealt (GHOST_SEAT for the ghost) */
  seats: number[];
  actions: StageAction[];
  /** seats that folded during this street */
  foldedHere: number[];
}

const STREET_LABEL: Record<Street, string> = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" };
export const streetLabel = (s: Street) => STREET_LABEL[s];

/** Split a hand's events into streets with the players alive at each. */
export function buildStages(rec: HandRecordView): Stage[] {
  const alive = new Set(rec.players.map((p) => p.seat));
  if (rec.ghost) alive.add(GHOST_SEAT);
  const nb = rec.boards.length || 1;
  const stages: Stage[] = [{ key: "preflop", street: "preflop", boards: Array.from({ length: nb }, () => []), eliminated: null, seats: [...alive], actions: [], foldedHere: [] }];
  let cur = stages[0]!;
  const describe = (e: GameEvent): StageAction | null => {
    switch (e.type) {
      case "blind": return { seat: e.seat, text: e.kind === "ante" ? `ante ${e.amount}` : `${e.kind.toUpperCase()} ${e.amount}`, kind: "blind" };
      case "action": {
        const t = e.action === "fold" ? "fold" : e.action === "check" ? "check" : e.action === "call" ? `call ${e.amount}` : e.action === "bet" ? `bet ${e.amount}` : `raise to ${e.amount}`;
        return { seat: e.seat, text: t + (e.allIn ? " (all-in)" : ""), kind: e.action === "allin" ? "raise" : e.action, allIn: e.allIn };
      }
      case "discarded": return { seat: e.seat, text: "discard", kind: "discard" };
      case "timeout": return { seat: e.seat, text: "timed out", kind: "timeout" };
      default: return null;
    }
  };
  for (const e of rec.events) {
    if (e.type === "street") {
      cur = { key: e.street, street: e.street, boards: e.boards.map((b) => [...b]), eliminated: null, seats: [...alive], actions: [], foldedHere: [] };
      stages.push(cur);
      continue;
    }
    if (e.type === "boardEliminated") {
      cur.eliminated = e.board;
      continue;
    }
    if (e.type === "action" && e.action === "fold") {
      alive.delete(e.seat);
      cur.foldedHere.push(e.seat);
    }
    const a = describe(e);
    if (a) cur.actions.push(a);
  }
  return stages;
}

/** Build the worker request for stages where every alive player's cards are known. Returns null if locked. */
export function equityRequest(rec: HandRecordView, stages: Stage[], id: number): EquityRequest | null {
  const cardsOf = new Map<number, Card[] | null>();
  for (const p of rec.players) cardsOf.set(p.seat, p.hole.every((c): c is Card => c !== null) ? (p.hole as Card[]) : null);
  if (rec.ghost) cardsOf.set(GHOST_SEAT, rec.ghost.hole);
  const allKnown = [...cardsOf.values()].flatMap((c) => c ?? []).concat(rec.ghost?.discarded ?? []);
  const req: EquityRequest = { id, variant: rec.variant, stages: [] };
  for (const st of stages) {
    const holes: Card[][] = [];
    for (const seat of st.seats) {
      const c = cardsOf.get(seat);
      if (!c) return null;
      holes.push(c);
    }
    const inHand = new Set(holes.flat());
    const onBoards = new Set(st.boards.flat());
    const dead = [...new Set([...allKnown, ...rec.players.flatMap((p) => p.discarded.filter((c): c is Card => c !== null))])].filter((c) => !inHand.has(c) && !onBoards.has(c));
    const boards = st.boards.filter((_, i) => i !== st.eliminated);
    req.stages.push({ key: st.key, boards, seats: st.seats, holes, dead });
  }
  return req;
}
