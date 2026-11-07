import { describe, expect, it } from "vitest";
import { hudFromHand, hudStats, addHud, type HandRecord } from "@engine/hud";
import type { GameEvent } from "@engine/types";

const rec = (events: GameEvent[], result: HandRecord["result"] = null): HandRecord => ({
  number: 1, variant: "nlhe", button: 0, smallBlindSeat: 1, bigBlindSeat: 2, blinds: { sb: 1, bb: 2, ante: 0 },
  players: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, name: `P${seat}`, hole: [], discarded: [], startStack: 200, revealed: false, folded: false })),
  board: [], rabbit: [], events, result, startedAt: 0, endedAt: 0,
});

describe("hudFromHand", () => {
  it("counts VPIP, PFR, 3-bet, flop seen and postflop aggression", () => {
    const h = hudFromHand(rec([
      { type: "blind", seat: 1, kind: "sb", amount: 1 },
      { type: "blind", seat: 2, kind: "bb", amount: 2 },
      { type: "action", seat: 0, action: "raise", amount: 6, allIn: false },
      { type: "action", seat: 1, action: "raise", amount: 20, allIn: false }, // 3-bet
      { type: "action", seat: 2, action: "fold", amount: 0, allIn: false },
      { type: "action", seat: 0, action: "call", amount: 14, allIn: false },
      { type: "street", street: "flop", board: ["2c", "7d", "9h"] },
      { type: "action", seat: 1, action: "bet", amount: 20, allIn: false },
      { type: "action", seat: 0, action: "call", amount: 20, allIn: false },
      { type: "street", street: "turn", board: ["2c", "7d", "9h", "Js"] },
      { type: "action", seat: 1, action: "check", amount: 0, allIn: false },
      { type: "action", seat: 0, action: "bet", amount: 30, allIn: false },
      { type: "action", seat: 1, action: "fold", amount: 0, allIn: false },
      { type: "potAwarded", seat: 0, amount: 110, potIndex: 0 },
      { type: "handEnded", handNumber: 1 },
    ], { pots: [{ amount: 110, winners: [{ seat: 0, amount: 110 }] }], hands: {}, net: {} }));
    expect(h[0]).toMatchObject({ hands: 1, vpip: 1, pfr: 1, threeBet: 0, sawFlop: 1, aggBets: 1, aggCalls: 1, won: 1, wtsd: 0 });
    expect(h[1]).toMatchObject({ vpip: 1, pfr: 1, threeBet: 1, sawFlop: 1, aggBets: 1, aggCalls: 0, won: 0 });
    expect(h[2]).toMatchObject({ vpip: 0, pfr: 0, sawFlop: 0 });
  });
  it("BB checking is not VPIP; showdown stats come from the result", () => {
    const h = hudFromHand(rec([
      { type: "action", seat: 0, action: "call", amount: 2, allIn: false },
      { type: "action", seat: 1, action: "call", amount: 1, allIn: false },
      { type: "action", seat: 2, action: "check", amount: 0, allIn: false },
      { type: "street", street: "flop", board: ["2c", "7d", "9h"] },
    ], { pots: [{ amount: 6, winners: [{ seat: 2, amount: 6, handName: "Pair" }] }], hands: { 0: { name: "x", score: 1, cards: [] }, 2: { name: "y", score: 2, cards: [] } }, net: {} }));
    expect(h[2]!.vpip).toBe(0);
    expect(h[0]).toMatchObject({ vpip: 1, wtsd: 1, wsd: 0 });
    expect(h[2]).toMatchObject({ wtsd: 1, wsd: 1, won: 1 });
    const s = hudStats(addHud(h[0]!, h[0]!));
    expect(s.vpip).toBe(100);
    expect(s.hands).toBe(2);
  });
});
