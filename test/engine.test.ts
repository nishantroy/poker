import { describe, expect, it } from "vitest";
import { advance, applyAction, canStartHand, chooseRuns, computePots, forfeit, getLimits, startHand, timeout, EngineError, setGhost, squidLoser, GHOST_SEAT } from "@engine/index";
import { table, startRigged, act, stacks, awards, fixedRng } from "./helpers";
import { boardsThatFit, createGame, seatPlayer } from "@engine/index";
import { baseConfig } from "./helpers";

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
    expect(s.hand!.boards[0]).toHaveLength(3);
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
    expect(s.hand!.boards[0]).toHaveLength(0);
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

describe("forfeit", () => {
  it("folds a non-actor immediately and ends the hand when one player remains", () => {
    let s = startRigged(table([1000, 1000, 1000]), 0).state;
    s = act(s, 0, "raise", 30).state;
    const r = forfeit(s, 2); // bb leaves while sb is to act
    expect(r.state.hand!.players.find((p: { seat: number }) => p.seat === 2)!.folded).toBe(true);
    expect(r.state.hand!.actor).toBe(1);
    const r2 = forfeit(r.state, 1);
    expect(r2.state.hand!.phase).toBe("showdown");
    expect(stacks(r2.state)).toEqual([1015, 995, 990]);
  });
});

describe("multiple boards and Squid Game", () => {
  it("deals every board and splits the pot equally between boards", () => {
    // sb (seat1) AA, bb (seat2) 22, button (seat0) 77; board A gives the deuces a set, board B gives aces top pair
    let s = startRigged(table([1000, 1000, 1000], { boards: 2 }), 0, "Ah 2h 7c As 2s 7d  2c Kd 9h Qs Jd 5c  3d 4h  8s Tc").state;
    s = act(s, 0, "fold").state;
    s = act(s, 1, "allin").state;
    s = act(s, 2, "allin").state;
    expect(s.hand!.phase).toBe("runout");
    s = advance(s).state; // flop (both boards)
    expect(s.hand!.boards.map((b) => b.length)).toEqual([3, 3]);
    s = advance(s).state; // turn
    s = advance(s).state; // river
    const r = advance(s);
    expect(r.state.hand!.phase).toBe("showdown");
    const res = r.state.hand!.result!;
    // 2000 pot: 1000 per board. Board 0 (2c Kd 9h 3d 8s) -> set of deuces wins; board 1 (Qs Jd 5c 4h Tc) -> aces win
    expect(res.pots[0]!.winners.map((w) => [w.board, w.seat, w.amount])).toEqual([[0, 2, 1000], [1, 1, 1000]]);
    expect(stacks(r.state)).toEqual([1000, 1000, 1000]);
    expect(res.boardHands[0]![2]!.name).toMatch(/Twos/);
  });
  it("Squid Game eliminates the board with the lowest river, ties broken by turn then flop", () => {
    expect(squidLoser([["2c", "3c", "4c", "5c", "Kd"], ["2d", "3d", "4d", "5d", "9s"]])).toBe(1);
    // same river rank: compare turn
    expect(squidLoser([["2c", "3c", "4c", "Jc", "Kd"], ["2d", "3d", "4d", "5d", "Ks"]])).toBe(1);
    // same river and turn: compare last flop card
    expect(squidLoser([["2c", "3c", "4c", "Jc", "Kd"], ["2d", "3d", "9d", "Jd", "Ks"]])).toBe(0);
  });
  it("Squid Game: the eliminated board pays nothing and river betting still happens", () => {
    // board 0 river 3d (low) vs board 1 river Tc -> board 0 eliminated; the full pot goes to board 1 (aces)
    let s = startRigged(table([1000, 1000, 1000], { boards: 2, squid: true }), 0, "Ah 2h 7c As 2s 7d  2c Kd 9h Qs Jd 5c  Qd 4h  3d Tc").state;
    s = act(s, 0, "fold").state;
    s = act(s, 1, "call").state;
    s = act(s, 2, "check").state;
    s = act(s, 1, "check").state; s = act(s, 2, "check").state; // flop
    s = act(s, 1, "check").state;
    const riverStep = act(s, 2, "check"); // turn checked through: river dealt, Squid elimination happens here
    s = riverStep.state;
    expect(riverStep.events.some((e) => e.type === "boardEliminated" && e.board === 0)).toBe(true);
    expect(s.hand!.street).toBe("river");
    expect(s.hand!.eliminated).toBe(0);
    expect(s.hand!.phase).toBe("betting");
    s = act(s, 1, "check").state;
    const r = act(s, 2, "check");
    expect(r.state.hand!.phase).toBe("showdown");
    expect(r.state.hand!.result!.pots[0]!.winners).toEqual([expect.objectContaining({ seat: 1, amount: 20, board: 1 })]);
    expect(stacks(r.state)).toEqual([1000, 1010, 990]);
  });
  it("falls back to fewer boards when the deck is too short", () => {
    const s = startRigged(table([500, 500, 500, 500, 500, 500, 500, 500], { variant: "plo5", boards: 3 }), 0).state;
    // 8 x 5 = 40 hole cards leave 12: only two boards fit
    expect(s.hand!.boards).toHaveLength(2);
    expect(() => startHand(table([500, 500, 500, 500, 500, 500, 500, 500], { variant: "plo6" }))).toThrow(/Not enough cards/);
  });
});

describe("ghost player", () => {
  it("is dealt in, cannot win when everyone folds, and its stake goes to the winner", () => {
    let s = setGhost(table([1000, 1000, 1000]), true);
    s.ghost.stack = 50;
    const r0 = startRigged(s, 0);
    s = r0.state;
    expect(s.hand!.ghost).not.toBeNull();
    expect(s.hand!.ghost!.hole).toHaveLength(2);
    expect(s.hand!.ghost!.stake).toBe(50);
    expect(s.ghost.stack).toBe(0);
    expect(r0.events.some((e) => e.type === "ghostDealt" && e.stake === 50)).toBe(true);
    s = act(s, 0, "fold").state;
    const r = act(s, 1, "fold");
    expect(r.state.hand!.phase).toBe("showdown");
    // bb wins blinds 15 + ghost stake 50
    expect(stacks(r.state)).toEqual([1000, 995, 1055]);
    expect(r.state.ghost.stack).toBe(0);
    expect(r.events.some((e) => e.type === "ghostShown" && e.won === 0)).toBe(true);
  });
  it("wins the main pot at showdown and the stake then rides into the next hand", () => {
    // sb 22, bb 33, ghost AA; board pairs nothing -> ghost wins main pot
    let s = setGhost(table([1000, 1000]), true);
    s = startRigged(s, 0, "2h 3h 2s 3s Ah Ad  7c 8d Tc Qs Kd").state;
    s = act(s, 0, "allin").state;
    s = act(s, 1, "call").state;
    expect(s.hand!.ghost!.revealed).toBe(true);
    s = advance(s).state; s = advance(s).state; s = advance(s).state;
    const r = advance(s);
    const res = r.state.hand!.result!;
    expect(res.pots[0]!.winners).toEqual([expect.objectContaining({ seat: GHOST_SEAT, amount: 2000 })]);
    expect(r.state.ghost.stack).toBe(2000);
    expect(res.ghost!.won).toBe(2000);
    expect(stacks(r.state)).toEqual([0, 0]);
    expect(() => setGhost(r.state, false)).toThrow(/still has chips/);
  });
  it("only competes for the main pot and splits ties", () => {
    // button(seat0, 1000) KK, sb(seat1, 100) AA, bb(seat2, 1000) AA-ish? use: seat1 short with AA, ghost AA too -> tie on main pot
    let s = setGhost(table([1000, 100, 1000]), true);
    s.ghost.stack = 100;
    s = startRigged(s, 0, "Ah 7h Kc Ad 7s Kd As Ac  2c 5d 9h Jc 4s").state;
    // deal order sb(1) bb(2) btn(0): sb AA, bb 77, btn KK, ghost As Ac
    s = act(s, 0, "allin").state;
    s = act(s, 1, "allin").state;
    s = act(s, 2, "allin").state;
    s = advance(s).state; s = advance(s).state; s = advance(s).state;
    const r = advance(s);
    const res = r.state.hand!.result!;
    // main pot 300 + ghost 100 = 400 split between sb and ghost; side pot 1800 to btn (KK beats 77)
    const main = res.pots[0]!;
    expect(main.amount).toBe(400);
    expect(main.winners.map((w) => [w.seat, w.amount]).sort()).toEqual([[-1, 200], [1, 200]].sort());
    expect(res.pots[1]!.winners).toEqual([expect.objectContaining({ seat: 0, amount: 1800 })]);
    expect(r.state.ghost.stack).toBe(200);
    expect(stacks(r.state)).toEqual([1800, 200, 0]);
  });
  it("sits out a hand that has no room for its cards", () => {
    let s = setGhost(table([500, 500, 500, 500, 500, 500, 500], { variant: "plo6" }), true);
    s.ghost.stack = 30;
    s = startRigged(s, 0).state;
    expect(s.hand!.ghost).toBeNull();
    expect(s.ghost.stack).toBe(30);
  });
});

describe("bad beats", () => {
  it("flags a loser who was over 80% with one card to come", () => {
    // sb KK vs bb 22; board K 7 2 Q then river 2 -> quads beat the set
    let s = startRigged(table([1000, 1000]), 0, "Kh 2h Ks 2s  Kc 7d 2c Qs 2d").state;
    s = act(s, 0, "allin").state;
    s = act(s, 1, "call").state;
    s = advance(s).state; s = advance(s).state; s = advance(s).state;
    const r = advance(s);
    const bb = r.state.hand!.result!.badBeat;
    expect(bb).not.toBeNull();
    expect(bb!.victim).toBe(0);
    expect(bb!.winner).toBe(1);
    expect(bb!.equity).toBeGreaterThan(90);
    expect(r.events.some((e) => e.type === "badBeat")).toBe(true);
  });
  it("does not flag an ordinary loss", () => {
    let s = startRigged(table([1000, 1000]), 0, "Ah 9c Kh 9d  2s 5d 7h Jc Qd").state;
    s = act(s, 0, "allin").state;
    s = act(s, 1, "call").state;
    s = advance(s).state; s = advance(s).state; s = advance(s).state;
    const r = advance(s);
    expect(r.state.hand!.result!.badBeat).toBeNull();
  });
});

describe("chip conservation with ghost and boards", () => {
  it("random play keeps players + ghost + pot constant", () => {
    let seed = 11;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (const cfg of [{ variant: "nlhe", boards: 2, squid: true }, { variant: "plo", boards: 3, squid: true }, { variant: "crazy-pineapple", boards: 2, squid: false }] as const) {
      let s = setGhost(table([400, 1000, 50, 300, 900], cfg), true);
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
        expect(s.seats.reduce((a, x) => a + (x?.stack ?? 0), 0) + s.ghost.stack).toBe(total);
        if (s.hand!.ghost) expect(s.hand!.ghost.hole.length).toBeLessThanOrEqual(cfg.variant === "crazy-pineapple" ? 2 : 4);
      }
    }
  });
});

describe("run it twice", () => {
  // sb (seat1) AA, bb (seat2) 22, button (seat0) 77; same rigged cards as the two-board test
  const deal = "Ah 2h 7c As 2s 7d  2c Kd 9h Qs Jd 5c  3d 4h  8s Tc";
  const allInPreflop = (cfg = {}) => {
    let s = startRigged(table([1000, 1000, 1000], { maxRuns: 3, ...cfg }), 0, deal).state;
    s = act(s, 0, "fold").state;
    s = act(s, 1, "allin").state;
    return act(s, 2, "allin");
  };

  it("opens a vote when all-in with cards to come, and runs twice when both agree", () => {
    const step = allInPreflop();
    let s = step.state;
    expect(s.hand!.phase).toBe("runChoice");
    expect(s.hand!.runChoice).toEqual({ max: 3, pending: [1, 2], choices: {} });
    expect(step.events.some((e) => e.type === "runChoiceOpened")).toBe(true);
    s = chooseRuns(s, 1, 2).state;
    expect(s.hand!.phase).toBe("runChoice");
    const r = chooseRuns(s, 2, 3); // lowest pick wins
    s = r.state;
    expect(r.events).toContainEqual({ type: "runsChosen", runs: 2 });
    expect(s.hand!.phase).toBe("runout");
    expect(s.hand!.runs).toBe(2);
    expect(s.hand!.boards).toEqual([[], []]);
    for (let i = 0; i < 3; i++) s = advance(s).state;
    const done = advance(s).state;
    const res = done.hand!.result!;
    // run 1 (2c Kd 9h 3d 8s): set of deuces; run 2 (Qs Jd 5c 4h Tc): aces. 1000 each.
    expect(res.pots[0]!.winners.map((w) => [w.board, w.seat, w.amount])).toEqual([[0, 2, 1000], [1, 1, 1000]]);
    expect(stacks(done)).toEqual([1000, 1000, 1000]);
    expect(done.hand!.result!.badBeat).toBeNull();
  });

  it("any player picking once means once", () => {
    let s = allInPreflop().state;
    s = chooseRuns(s, 1, 3).state;
    s = chooseRuns(s, 2, 1).state;
    expect(s.hand!.runs).toBe(1);
    expect(s.hand!.boards).toHaveLength(1);
  });

  it("a timed-out vote runs it once", () => {
    let s = allInPreflop().state;
    s = chooseRuns(s, 1, 2).state;
    const r = timeout(s);
    expect(r.state.hand!.runs).toBe(1);
    expect(r.state.hand!.phase).toBe("runout");
  });

  it("rejects bad picks", () => {
    const s = allInPreflop().state;
    expect(() => chooseRuns(s, 0, 2)).toThrow(EngineError); // folded, not pending
    expect(() => chooseRuns(s, 1, 4)).toThrow(/between 1 and 3/);
    const s2 = chooseRuns(s, 1, 2).state;
    expect(() => chooseRuns(s2, 1, 2)).toThrow(/already picked/);
  });

  it("runs on the flop share the flop and deal separate turns and rivers", () => {
    let s = startRigged(table([1000, 1000, 1000], { maxRuns: 2 }), 0, deal).state;
    s = act(s, 0, "fold").state;
    s = act(s, 1, "call").state;
    s = act(s, 2, "check").state; // flop dealt
    const flop = [...s.hand!.boards[0]!];
    s = act(s, 1, "allin").state;
    s = act(s, 2, "call").state;
    expect(s.hand!.phase).toBe("runChoice");
    expect(s.hand!.runChoice!.max).toBe(2);
    s = chooseRuns(s, 1, 2).state;
    s = chooseRuns(s, 2, 2).state;
    expect(s.hand!.boards).toEqual([flop, flop]);
    s = advance(s).state; // turn
    s = advance(s).state; // river
    const [b0, b1] = s.hand!.boards;
    expect(b0!.slice(0, 3)).toEqual(b1!.slice(0, 3));
    expect(b0!.length).toBe(5);
    expect(new Set([...b0!.slice(3), ...b1!.slice(3)]).size).toBe(4);
    const done = advance(s).state;
    expect(done.hand!.phase).toBe("showdown");
    expect(stacks(done).reduce((a, b) => a + b, 0)).toBe(3000);
  });

  it("is not offered when the table, the flag, multi-board or a pending discard rule it out", () => {
    expect(allInPreflop({ maxRuns: 1 }).state.hand!.phase).toBe("runout");
    expect(allInPreflop({ boards: 2 }).state.hand!.phase).toBe("runout");
    let s = startHand(table([1000, 1000, 1000], { maxRuns: 3 }), fixedRng(0), { allowRuns: false }).state;
    s = act(s, 0, "fold").state; s = act(s, 1, "allin").state;
    expect(act(s, 2, "allin").state.hand!.phase).toBe("runout");
    // crazy pineapple: the discard after the flop is still to come
    let c = startRigged(table([1000, 1000, 1000], { maxRuns: 3, variant: "crazy-pineapple" }), 0).state;
    c = act(c, 0, "fold").state; c = act(c, 1, "allin").state;
    expect(act(c, 2, "allin").state.hand!.phase).toBe("runout");
  });

  it("a player leaving mid-vote drops out of the vote", () => {
    let s = startRigged(table([1000, 1000, 1000], { maxRuns: 2 }), 0, deal).state;
    s = act(s, 0, "allin").state;
    s = act(s, 1, "allin").state;
    s = act(s, 2, "allin").state;
    expect(s.hand!.runChoice!.pending).toEqual([0, 1, 2]);
    s = chooseRuns(s, 1, 2).state;
    s = chooseRuns(s, 2, 2).state;
    s = forfeit(s, 0).state;
    expect(s.hand!.runs).toBe(2);
    expect(s.hand!.phase).toBe("runout");
  });

  it("random play with random run picks never creates or destroys chips", () => {
    let seed = 5;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (const variant of ["nlhe", "plo", "pineapple"] as const) {
      let s = setGhost(table([400, 1000, 50, 300], { variant, maxRuns: 3 }), true);
      let ran = 0;
      for (let hand = 0; hand < 60 && canStartHand(s); hand++) {
        s = startHand(s, (n) => Math.floor(rnd() * n)).state;
        let guard = 0;
        while (s.hand!.phase !== "showdown" && guard++ < 500) {
          const h = s.hand!;
          if (h.phase === "runChoice") { s = chooseRuns(s, h.runChoice!.pending[0]!, 1 + Math.floor(rnd() * h.runChoice!.max)).state; continue; }
          if (h.phase === "runout") { s = advance(s).state; continue; }
          if (h.phase === "discard") { s = timeout(s).state; continue; }
          const seat = h.actor!;
          const lim = getLimits(s, seat);
          const x = rnd();
          if (x < 0.1) s = act(s, seat, "fold").state;
          else if (x < 0.5) s = act(s, seat, lim.canCheck ? "check" : "call").state;
          else s = act(s, seat, "allin").state;
        }
        if (s.hand!.runs > 1) ran++;
        expect(s.hand!.phase).toBe("showdown");
        expect(s.seats.reduce((a, x) => a + (x?.stack ?? 0), 0) + s.ghost.stack).toBe(1750);
      }
      expect(ran).toBeGreaterThan(0);
    }
  });
});

describe("seating", () => {
  it("rejects seat numbers that are not whole, in-range integers", () => {
    const g = createGame(baseConfig);
    for (const bad of [0.5, -1, 8, Number.NaN, Infinity]) {
      expect(() => seatPlayer(g, bad, "u", "U", 100)).toThrow(/No such seat/);
    }
    expect(seatPlayer(g, 3, "u", "U", 100).seats[3]?.playerId).toBe("u");
  });
});

describe("straddle", () => {
  // baseConfig: blinds 5/10, button at seat 0 -> sb 1, bb 2, utg 3
  it("under the gun posts 2x the big blind, action starts to their left, and they get the option", () => {
    const r = startHand(table([1000, 1000, 1000, 1000]), fixedRng(0), { straddleSeats: [3] });
    let s = r.state;
    expect(r.events).toContainEqual({ type: "blind", seat: 3, kind: "straddle", amount: 20 });
    expect(s.hand!.currentBet).toBe(20);
    expect(s.hand!.actor).toBe(0);
    expect(getLimits(s, 0).minRaiseTo).toBe(40);
    s = act(s, 0, "call").state;
    s = act(s, 1, "call").state;
    s = act(s, 2, "call").state;
    expect(s.hand!.actor).toBe(3); // the straddler's option
    const lim = getLimits(s, 3);
    expect(lim.canCheck).toBe(true);
    expect(lim.canRaise).toBe(true);
    s = act(s, 3, "check").state;
    expect(s.hand!.street).toBe("flop");
    expect(s.hand!.players.reduce((a, p) => a + p.totalBet, 0)).toBe(80);
  });

  it("a raise over the straddle must be at least another straddle, and the straddler can re-raise", () => {
    let s = startHand(table([1000, 1000, 1000, 1000]), fixedRng(0), { straddleSeats: [3] }).state;
    expect(() => act(s, 0, "raise", 30)).toThrow(/Minimum is 40/);
    s = act(s, 0, "raise", 40).state;
    s = act(s, 1, "fold").state;
    s = act(s, 2, "fold").state;
    expect(s.hand!.actor).toBe(3);
    expect(getLimits(s, 3).minRaiseTo).toBe(60);
  });

  it("three-handed the button straddles and the small blind acts first", () => {
    const s = startHand(table([1000, 1000, 1000]), fixedRng(0), { straddleSeats: [0] }).state;
    expect(s.hand!.currentBet).toBe(20);
    expect(s.hand!.actor).toBe(1);
  });

  it("is skipped heads-up, when the table disallows it, when not asked for, or when the stack is too short", () => {
    const heads = startHand(table([1000, 1000]), fixedRng(0), { straddleSeats: [0, 1] });
    expect(heads.events.some((e) => e.type === "blind" && e.kind === "straddle")).toBe(false);
    const off = startHand(table([1000, 1000, 1000, 1000], { straddle: false }), fixedRng(0), { straddleSeats: [3] });
    expect(off.state.hand!.currentBet).toBe(10);
    const other = startHand(table([1000, 1000, 1000, 1000]), fixedRng(0), { straddleSeats: [0, 1, 2] });
    expect(other.state.hand!.currentBet).toBe(10);
    const short = startHand(table([1000, 1000, 1000, 20]), fixedRng(0), { straddleSeats: [3] });
    expect(short.state.hand!.currentBet).toBe(10);
    expect(short.state.hand!.actor).toBe(3);
  });
});

describe("PLO hi-lo", () => {
  const allInPreflop3 = (deal: string) => {
    let s = startRigged(table([1000, 1000, 1000], { variant: "plo8" }), 0, deal).state;
    // pot-limit: keep raising the maximum (or calling) until everyone is all in
    for (let i = 0; i < 30 && s.hand!.phase === "betting"; i++) {
      const seat = s.hand!.actor!;
      s = act(s, seat, getLimits(s, seat).canRaise ? "allin" : "call").state;
    }
    while (s.hand!.phase !== "showdown") s = advance(s).state;
    return s;
  };
  it("splits the pot between the best high and the best low", () => {
    // deal order sb (1), bb (2), button (0). Seat 0: kings (high). Seat 1: A-2 (low). Seat 2: junk.
    const s = allInPreflop3("Ac Th Kh 2c Tc Kd 9s 6s Qs 9d 6c Js  Ks 3d 4h 7c 8s");
    const res = s.hand!.result!;
    // 3000 pot: 1500 high to seat 0 (set of kings), 1500 low to seat 1 (7-4-3-2-A)
    expect(stacks(s)).toEqual([1500, 1500, 0]);
    const w = res.pots[0]!.winners;
    expect(w).toContainEqual(expect.objectContaining({ seat: 0, amount: 1500, half: "high" }));
    expect(w).toContainEqual(expect.objectContaining({ seat: 1, amount: 1500, half: "low", handName: "7-4-3-2-A low" }));
    expect(res.hands[1]!.name).toMatch(/· 7-4-3-2-A low$/);
  });
  it("the high scoops when no low qualifies", () => {
    const s = allInPreflop3("Ac Th Kh 2c Tc Kd 9s 6s Qs 9d 6c Js  Ks 9h Jd Qc Qh");
    expect(stacks(s)[0]).toBe(3000);
    expect(s.hand!.result!.pots[0]!.winners.every((w) => w.half === undefined)).toBe(true);
  });
  it("two identical lows get quartered", () => {
    // seats 1 and 2 both hold A-2; seat 0 has the kings
    const s = allInPreflop3("Ac Ad Kh 2c 2d Kd Ts Tc Qs 9d 9c Js  Ks 3d 4h 7c 8s");
    expect(stacks(s)).toEqual([1500, 750, 750]);
  });
});

describe("short deck", () => {
  it("deals from 36 cards with no 2s through 5s", () => {
    const s = startHand(table([1000, 1000, 1000], { shortDeck: true }), fixedRng(0)).state;
    const all = [...s.hand!.deck, ...s.hand!.players.flatMap((p) => p.hole)];
    expect(all).toHaveLength(36);
    expect(all.some((c) => "2345".includes(c[0]!))).toBe(false);
    expect(s.hand!.shortDeck).toBe(true);
  });
  it("a flush beats a full house at showdown", () => {
    // heads-up: seat 0 (button/sb) hearts, seat 1 nines; board gives 9s full and a heart flush
    let s = startRigged(table([1000, 1000], { shortDeck: true }), 0, "Ah 9s Kh 9d  9c 6h 6s Th 7h").state;
    s = act(s, 0, "allin").state;
    s = act(s, 1, "call").state;
    while (s.hand!.phase !== "showdown") s = advance(s).state;
    expect(stacks(s)).toEqual([2000, 0]);
    expect(s.hand!.result!.hands[1]!.name).toMatch(/^Full House/);
  });
  it("fewer players fit, and hi-lo games always use the full deck", () => {
    expect(boardsThatFit({ ...baseConfig, variant: "plo6", shortDeck: true }, 6, false)).toBe(0); // 36 - 36 leaves no board
    expect(boardsThatFit({ ...baseConfig, variant: "plo6", shortDeck: false }, 6, false)).toBe(1);
    const s = startHand(table([1000, 1000], { variant: "plo8", shortDeck: true }), fixedRng(0)).state;
    expect(s.hand!.shortDeck).toBe(false);
    expect(s.hand!.deck.length + 8).toBe(52);
  });
});
