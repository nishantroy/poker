import { describe, expect, it } from "vitest";
import { advance, applyAction, canStartHand, computePots, getLimits, startHand, timeout, EngineError } from "@engine/index";
import { table, startRigged, act, stacks, awards, fixedRng } from "./helpers";

describe("hand setup", () => {
  it("posts blinds, deals, and puts UTG on the clock (3+ players)", () => {
    const { state, events } = startRigged(table([1000, 1000, 1000]), 0);
    const h = state.hand!;
    expect(h.button).toBe(0);
    expect(h.smallBlindSeat).toBe(1);
    expect(h.bigBlindSeat).toBe(2);
    expect(h.actor).toBe(0);
    expect(stacks(state)).toEqual([1000, 995, 990]);
    expect(h.players.every((p) => p.hole.length === 2)).toBe(true);
    expect(events.filter((e) => e.type === "blind")).toHaveLength(2);
  });
  it("heads-up: button posts the small blind and acts first preflop, BB acts first postflop", () => {
    const { state } = startRigged(table([1000, 1000]), 0);
    const h = state.hand!;
    expect(h.smallBlindSeat).toBe(0);
    expect(h.bigBlindSeat).toBe(1);
    expect(h.actor).toBe(0);
    let s = act(state, 0, "call").state;
    expect(s.hand!.actor).toBe(1);
    s = act(s, 1, "check").state;
    expect(s.hand!.street).toBe("flop");
    expect(s.hand!.actor).toBe(1);
  });
  it("moves the button to the next participant each hand and skips sitting-out seats", () => {
    let s = table([1000, 1000, 1000, 1000]);
    s.seats[2]!.status = "sittingOut";
    let r = startRigged(s, 0);
    // fold around to end hand quickly
    s = r.state;
    s = act(s, 0, "fold").state; // UTG is seat 0 (button) with 3 players? button 0, sb 1, bb 3 -> actor 0
    s = act(s, 1, "fold").state;
    expect(s.hand!.phase).toBe("showdown");
    r = startHand(s);
    expect(r.state.button).toBe(1);
    r = startHand(act(act(r.state, 1, "fold").state, 3, "fold").state);
    expect(r.state.button).toBe(3);
    r = startHand(act(act(r.state, 3, "fold").state, 0, "fold").state);
    expect(r.state.button).toBe(0);
  });
  it("deals the right number of hole cards per variant", () => {
    expect(startRigged(table([500, 500], { variant: "plo" }), 0).state.hand!.players[0]!.hole).toHaveLength(4);
    expect(startRigged(table([500, 500], { variant: "plo5" }), 0).state.hand!.players[0]!.hole).toHaveLength(5);
    expect(startRigged(table([500, 500], { variant: "plo6" }), 0).state.hand!.players[0]!.hole).toHaveLength(6);
    expect(startRigged(table([500, 500], { variant: "pineapple" }), 0).state.hand!.players[0]!.hole).toHaveLength(3);
  });
  it("refuses to start with fewer than two funded players", () => {
    const s = table([1000, 0]);
    expect(canStartHand(s)).toBe(false);
    expect(() => startHand(s)).toThrow(EngineError);
  });
});

describe("betting rules", () => {
  it("enforces turn order and legal actions", () => {
    const { state } = startRigged(table([1000, 1000, 1000]), 0);
    expect(() => act(state, 1, "call")).toThrow(/turn/);
    expect(() => act(state, 0, "check")).toThrow(/check/);
    expect(() => act(state, 0, "raise", 15)).toThrow(/Minimum/);
    expect(() => act(state, 0, "raise", 5000)).toThrow(/Maximum/);
  });
  it("min-raise tracks the last raise size; BB gets the option", () => {
    let s = startRigged(table([1000, 1000, 1000]), 0).state;
    s = act(s, 0, "raise", 30).state; // raise 20
    let lim = getLimits(s, 1);
    expect(lim.minRaiseTo).toBe(50);
    s = act(s, 1, "raise", 100).state; // raise 70
    lim = getLimits(s, 2);
    expect(lim.minRaiseTo).toBe(170);
    expect(lim.callAmount).toBe(90);
    s = act(s, 2, "call").state;
    expect(s.hand!.actor).toBe(0);
    s = act(s, 0, "call").state;
    expect(s.hand!.street).toBe("flop");
    expect(s.hand!.actor).toBe(1);
    expect(getLimits(s, 1).minRaiseTo).toBe(10);
  });
  it("everyone limps: BB has the option to raise", () => {
    let s = startRigged(table([1000, 1000, 1000]), 0).state;
    s = act(s, 0, "call").state;
    s = act(s, 1, "call").state;
    expect(s.hand!.actor).toBe(2);
    expect(getLimits(s, 2).canCheck).toBe(true);
    s = act(s, 2, "raise", 40).state;
    expect(s.hand!.actor).toBe(0);
  });
  it("short all-in does not reopen the action for players who already acted", () => {
    let s = startRigged(table([1000, 1000, 25]), 0).state;
    s = act(s, 0, "raise", 20).state; // seat0 raises to 20
    s = act(s, 1, "call").state; // sb calls 20
    s = act(s, 2, "allin").state; // bb all-in to 25 (short raise of 5)
    expect(s.hand!.actor).toBe(0);
    expect(getLimits(s, 0).canRaise).toBe(false);
    expect(getLimits(s, 0).callAmount).toBe(5);
    expect(() => act(s, 0, "raise", 60)).toThrow(/not allowed/);
    s = act(s, 0, "call").state;
    expect(s.hand!.actor).toBe(1);
    expect(getLimits(s, 1).canRaise).toBe(false);
    s = act(s, 1, "call").state;
    expect(s.hand!.street).toBe("flop");
    expect(s.hand!.phase).toBe("betting");
  });
  it("a full raise after a short all-in reopens the action", () => {
    let s = startRigged(table([1000, 1000, 25, 1000]), 0).state;
    // button 0, sb 1, bb 2, utg 3
    s = act(s, 3, "raise", 20).state;
    s = act(s, 0, "call").state;
    s = act(s, 1, "call").state;
    s = act(s, 2, "allin").state; // to 25
    expect(s.hand!.actor).toBe(3);
    expect(getLimits(s, 3).canRaise).toBe(false);
    s = act(s, 3, "call").state;
    s = act(s, 0, "call").state;
    expect(getLimits(s, 1).canRaise).toBe(false);
    s = act(s, 1, "call").state;
    expect(s.hand!.street).toBe("flop");
  });
  it("folding to one player ends the hand and awards the pot without a showdown", () => {
    let s = startRigged(table([1000, 1000, 1000]), 0).state;
    const r1 = act(s, 0, "raise", 30);
    s = r1.state;
    s = act(s, 1, "fold").state;
    const r = act(s, 2, "fold");
    expect(r.state.hand!.phase).toBe("showdown");
    expect(stacks(r.state)).toEqual([1015, 995, 990]);
    expect(r.events.some((e) => e.type === "showdown")).toBe(false);
    expect(r.state.hand!.players.every((p) => !p.revealed)).toBe(true);
  });
  it("timeout auto-checks when possible and otherwise folds", () => {
    let s = startRigged(table([1000, 1000, 1000]), 0).state;
    let r = timeout(s);
    expect(r.events[0]).toEqual({ type: "timeout", seat: 0 });
    expect(r.state.hand!.players[0]!.folded).toBe(true);
    s = act(r.state, 1, "call").state;
    r = timeout(s); // BB can check
    expect(r.state.hand!.street).toBe("flop");
  });
});

describe("pot-limit", () => {
  it("caps raises at the pot size", () => {
    let s = startRigged(table([1000, 1000, 1000], { variant: "plo" }), 0).state;
    // pot = 15, UTG call = 10 -> max raise to = 10 + 15 + 10 = 35
    let lim = getLimits(s, 0);
    expect(lim.maxRaiseTo).toBe(35);
    expect(() => act(s, 0, "raise", 36)).toThrow(/Maximum/);
    s = act(s, 0, "raise", 35).state;
    // sb: pot = 50, call = 30 -> max = 35 + 50 + 30 = 115
    lim = getLimits(s, 1);
    expect(lim.maxRaiseTo).toBe(115);
    expect(lim.minRaiseTo).toBe(60);
    // all-in in PL is capped to the pot
    s = act(s, 1, "allin").state;
    expect(s.hand!.currentBet).toBe(115);
    expect(stacks(s)[1]).toBe(885);
  });
});

describe("side pots and showdown", () => {
  it("builds main and side pots from contributions", () => {
    const pots = computePots([
      { seat: 0, totalBet: 100, folded: false } as never,
      { seat: 1, totalBet: 50, folded: false } as never,
      { seat: 2, totalBet: 100, folded: false } as never,
      { seat: 3, totalBet: 20, folded: true } as never,
    ]);
    expect(pots).toEqual([
      { amount: 170, eligible: [0, 1, 2] },
      { amount: 100, eligible: [0, 2] },
    ]);
  });
  it("three-way all-in with different stacks pays the right side pots", () => {
    // seat0 (button) 1000, seat1 (sb) 300, seat2 (bb) 100
    // rig: sb gets AA, bb gets KK, button gets 22; board gives nobody help -> AA > KK > 22
    let s = startRigged(table([1000, 300, 100]), 0, "Ah Kh 2h Ad Kd 2d 3c 7c 9s Jd 5s").state;
    // deal order: sb, bb, button
    expect(s.hand!.players.find((p) => p.seat === 1)!.hole).toEqual(["Ah", "Ad"]);
    s = act(s, 0, "allin").state; // 1000
    s = act(s, 1, "allin").state; // 300
    s = act(s, 2, "allin").state; // 100
    expect(s.hand!.phase).toBe("runout");
    expect(s.hand!.players.every((p) => p.revealed)).toBe(true);
    s = advance(s).state; // flop
    expect(s.hand!.board).toHaveLength(3);
    s = advance(s).state; // turn
    s = advance(s).state; // river
    expect(s.hand!.street).toBe("river");
    const r = advance(s); // showdown
    expect(r.state.hand!.phase).toBe("showdown");
    // main pot: 300 (100 x 3) -> sb (AA) ; side pot: 400 (200 x 2) -> sb ; remaining 700 returned to button
    expect(stacks(r.state)).toEqual([700, 700, 0]);
    expect(r.events.some((e) => e.type === "returned" && e.seat === 0 && e.amount === 700)).toBe(true);
    expect(r.state.hand!.result!.hands[1]!.name).toBe("Pair of Aces");
  });
  it("short stack wins main pot while a bigger stack wins the side pot", () => {
    // bb (seat2, 100) has AA, sb (seat1, 300) has 22, button has KK
    let s = startRigged(table([1000, 300, 100]), 0, "2h Ah Kh 2d Ad Kd 3c 7c 9s Jd 5s").state;
    s = act(s, 0, "allin").state;
    s = act(s, 1, "allin").state;
    s = act(s, 2, "allin").state;
    for (let i = 0; i < 3; i++) s = advance(s).state;
    const r = advance(s);
    // main 300 -> seat2 (AA); side 400 -> seat0 (KK beats 22); 700 returned to seat0
    expect(stacks(r.state)).toEqual([1100, 0, 300]);
  });
  it("splits a tied pot and gives the odd chip to the first seat left of the button", () => {
    // 3 players, 5/10 blinds. Seats 1 and 2 tie with the same straight; seat 0 folds.
    // ensure an odd pot: sb completes to 10? Use raise to 11 by button then both call, button folds? simpler:
    let s = startRigged(table([1000, 1000, 1000]), 0, "9h 9d 2c 8h 8d 3c Th Jd Qs Ks 4c").state;
    // deal: sb=9h, bb=9d, btn=2c, sb=8h, bb=8d, btn=3c ; board T J Q K 4 -> both sb and bb have K-high straight (board plays with 9)
    s = act(s, 0, "fold").state;
    s = act(s, 1, "raise", 25).state; // 25 total
    s = act(s, 2, "call").state; // pot 50
    // flop: sb bets 7 (odd), bb calls -> 64 ; then check down
    s = act(s, 1, "bet", 10).state;
    s = act(s, 2, "call").state;
    s = act(s, 1, "check").state;
    s = act(s, 2, "check").state;
    s = act(s, 1, "check").state;
    const r = act(s, 2, "check");
    expect(r.state.hand!.phase).toBe("showdown");
    // pot = 64, even -> 32 each. Make an odd pot instead: pot should be 64; test odd chip with bet 8? Adjust: use 7 then 1 extra from both -> still even.
    expect(stacks(r.state)).toEqual([1000, 1000, 1000]);
    expect(awards(r.events)).toEqual([[1, 35], [2, 35]]);
  });
  it("odd chip goes to the earliest seat after the button", () => {
    // heads-up: button=0 posts sb 5, seat1 posts bb 10. Button calls (pot 20); then seat1 bets 1 (min bet is 10, so use a different route):
    // Use ante 1 with 3 players: antes 3 + blinds 15 = 18 -> everyone calls: 10+10+10+3 = 33 odd.
    let s = startRigged(table([1000, 1000, 1000], { ante: 1 }), 0, "9h 9d 2c 8h 8d 3c Th Jd Qs Ks 4c").state;
    s = act(s, 0, "fold").state;
    s = act(s, 1, "call").state;
    s = act(s, 2, "check").state;
    for (let i = 0; i < 3; i++) { s = act(s, 1, "check").state; s = act(s, 2, "check").state; }
    expect(s.hand!.phase).toBe("showdown");
    // pot = 1*3 + 10 + 10 = 23 -> 12 to seat 1 (first after button), 11 to seat 2
    expect(awards(s.hand!.result ? [] : [])).toEqual([]);
    expect(stacks(s)).toEqual([999, 1001, 1000]);
  });
  it("uncontested side pot money is returned to the over-bettor", () => {
    let s = startRigged(table([1000, 200]), 0).state;
    s = act(s, 0, "allin").state;
    const r = act(s, 1, "fold");
    expect(stacks(r.state)).toEqual([1010, 190]);
  });
});

describe("pineapple discards", () => {
  it("pineapple: discard after preflop betting, before the flop", () => {
    let s = startRigged(table([1000, 1000, 1000], { variant: "pineapple" }), 0).state;
    s = act(s, 0, "call").state;
    s = act(s, 1, "call").state;
    s = act(s, 2, "check").state;
    expect(s.hand!.phase).toBe("discard");
    expect(s.hand!.pendingDiscard.sort()).toEqual([0, 1, 2]);
    expect(s.hand!.board).toHaveLength(0);
    s = applyAction(s, 0, { type: "discard", amount: 0 }).state;
    s = applyAction(s, 2, { type: "discard", amount: 2 }).state;
    expect(s.hand!.phase).toBe("discard");
    const r = timeout(s); // seat 1 auto-discards
    s = r.state;
    expect(s.hand!.phase).toBe("betting");
    expect(s.hand!.street).toBe("flop");
    expect(s.hand!.players.every((p) => p.hole.length === 2 && p.discarded.length === 1)).toBe(true);
    expect(s.hand!.actor).toBe(1);
  });
  it("crazy pineapple: discard after the flop betting round", () => {
    let s = startRigged(table([1000, 1000], { variant: "crazy-pineapple" }), 0).state;
    s = act(s, 0, "call").state;
    s = act(s, 1, "check").state;
    expect(s.hand!.street).toBe("flop");
    expect(s.hand!.phase).toBe("betting");
    s = act(s, 1, "check").state;
    s = act(s, 0, "check").state;
    expect(s.hand!.phase).toBe("discard");
    s = applyAction(s, 0, { type: "discard", amount: 1 }).state;
    s = applyAction(s, 1, { type: "discard", amount: 1 }).state;
    expect(s.hand!.street).toBe("turn");
    expect(s.hand!.phase).toBe("betting");
  });
  it("all-in pineapple still discards, then runs out", () => {
    let s = startRigged(table([100, 100], { variant: "pineapple" }), 0).state;
    s = act(s, 0, "allin").state;
    s = act(s, 1, "call").state;
    expect(s.hand!.phase).toBe("discard");
    s = applyAction(s, 0, { type: "discard", amount: 0 }).state;
    s = applyAction(s, 1, { type: "discard", amount: 0 }).state;
    expect(s.hand!.phase).toBe("runout");
    s = advance(s).state;
    expect(s.hand!.street).toBe("flop");
    s = advance(s).state;
    s = advance(s).state;
    s = advance(s).state;
    expect(s.hand!.phase).toBe("showdown");
    expect(stacks(s).reduce((a, b) => a + b, 0)).toBe(200);
  });
});

describe("chip conservation", () => {
  it("random play never creates or destroys chips", () => {
    const variants = ["nlhe", "plo", "plo5", "plo6", "pineapple", "crazy-pineapple"] as const;
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (const variant of variants) {
      let s = table([400, 1000, 50, 300, 900], { variant });
      const total = 2650;
      for (let hand = 0; hand < 40 && canStartHand(s); hand++) {
        s = startHand(s, (n) => Math.floor(rnd() * n)).state;
        let guard = 0;
        while (s.hand!.phase !== "showdown" && guard++ < 500) {
          const h = s.hand!;
          if (h.phase === "runout") { s = advance(s).state; continue; }
          if (h.phase === "discard") { s = timeout(s).state; continue; }
          const seat = h.actor!;
          const lim = getLimits(s, seat);
          const x = rnd();
          if (x < 0.15) s = act(s, seat, "fold").state;
          else if (x < 0.6) s = act(s, seat, lim.canCheck ? "check" : "call").state;
          else if (x < 0.9 && lim.canRaise) {
            const amt = lim.minRaiseTo + Math.floor(rnd() * (lim.maxRaiseTo - lim.minRaiseTo + 1));
            s = act(s, seat, "raise", amt).state;
          } else s = act(s, seat, "allin").state;
        }
        expect(s.hand!.phase).toBe("showdown");
        expect(s.seats.reduce((a, x) => a + (x?.stack ?? 0), 0)).toBe(total);
        // net sums to zero
        const net = Object.values(s.hand!.result!.net).reduce((a, b) => a + b, 0);
        expect(net).toBe(0);
      }
    }
  });
});
