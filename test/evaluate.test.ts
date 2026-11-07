import { describe, expect, it } from "vitest";
import { evaluate5, evaluateAny, evaluateOmaha, describeHand, CATEGORY_NAMES } from "@engine/evaluate";
import type { Card } from "@engine/cards";

const c = (s: string) => s.split(" ") as Card[];

describe("evaluate5", () => {
  it("ranks categories in order", () => {
    const hands = [
      c("2s 5d 7h 9c Kd"), // high card
      c("2s 2d 7h 9c Kd"), // pair
      c("2s 2d 7h 7c Kd"), // two pair
      c("2s 2d 2h 9c Kd"), // trips
      c("3s 4d 5h 6c 7d"), // straight
      c("2s 5s 7s 9s Ks"), // flush
      c("2s 2d 2h 9c 9d"), // full house
      c("2s 2d 2h 2c Kd"), // quads
      c("3s 4s 5s 6s 7s"), // straight flush
    ];
    const scores = hands.map((h) => evaluate5(h));
    for (let i = 0; i < scores.length; i++) expect(scores[i]!.category).toBe(i);
    for (let i = 1; i < scores.length; i++) expect(scores[i]!.score).toBeGreaterThan(scores[i - 1]!.score);
  });
  it("detects the wheel and ranks it below a six-high straight", () => {
    const wheel = evaluate5(c("As 2d 3h 4c 5d"));
    const six = evaluate5(c("2s 3d 4h 5c 6d"));
    expect(wheel.category).toBe(4);
    expect(wheel.ranks[0]).toBe(5);
    expect(six.score).toBeGreaterThan(wheel.score);
    expect(describeHand(wheel)).toBe("Straight, Five high");
  });
  it("uses kickers", () => {
    const a = evaluate5(c("As Ad 7h 9c Kd"));
    const b = evaluate5(c("Ah Ac 7d 9s Qd"));
    expect(a.score).toBeGreaterThan(b.score);
    expect(describeHand(a)).toBe("Pair of Aces");
  });
  it("compares two pair by top pair, then second, then kicker", () => {
    expect(evaluate5(c("Ks Kd 3h 3c 2d")).score).toBeGreaterThan(evaluate5(c("Qs Qd Jh Jc Ad")).score);
    expect(evaluate5(c("Ks Kd 3h 3c Ad")).score).toBeGreaterThan(evaluate5(c("Ks Kd 3h 3c 2d")).score);
  });
  it("names hands", () => {
    expect(describeHand(evaluate5(c("Ts Js Qs Ks As")))).toBe("Royal Flush");
    expect(describeHand(evaluate5(c("6s 6d 6h 9c 9d")))).toBe("Full House, Sixes full of Nines");
    expect(describeHand(evaluate5(c("2s 5s 7s 9s Ks")))).toBe("Flush, King high");
    expect(CATEGORY_NAMES[7]).toBe("Four of a Kind");
  });
});

describe("evaluateAny (7 cards)", () => {
  it("finds the best 5 of 7", () => {
    const r = evaluateAny(c("As Ks Qs Js 9d Ts 2c"));
    expect(describeHand(r)).toBe("Royal Flush");
  });
  it("finds a straight hidden across hole and board", () => {
    const r = evaluateAny(c("9h 8h 7c 6d 5s Ks Kd"));
    expect(r.category).toBe(4);
    expect(r.ranks[0]).toBe(9);
  });
});

describe("evaluateOmaha", () => {
  it("must use exactly two hole cards (no board-only flush)", () => {
    // board is a flush, hole has one spade only -> not a flush
    const board = c("2s 5s 9s Ks 7d");
    const hole = c("As 3h 4c 8d");
    const r = evaluateOmaha(hole, board);
    expect(r.category).not.toBe(5);
  });
  it("makes a flush with two suited hole cards", () => {
    const board = c("2s 5s 9s Kd 7d");
    const hole = c("As 3s 4c 8d");
    const r = evaluateOmaha(hole, board);
    expect(r.category).toBe(5);
  });
  it("cannot play four of a kind on the board with only one hole card", () => {
    // Board has trips; a player with a pair in hand makes a full house, one card makes quads? No: must use 2.
    const board = c("9s 9d 9h 2c 3c");
    const hole = c("9c Ac Kd Qd"); // 9c + another hole card + 3 board: quads 9s9d9h9c + kicker -> allowed (2 hole: 9c, Ac)
    const r = evaluateOmaha(hole, board);
    expect(r.category).toBe(7);
  });
  it("works with 5 and 6 hole cards", () => {
    const board = c("Th Jh Qh 2c 3c");
    const r5 = evaluateOmaha(c("Ah Kh 2d 2s 5c"), board);
    expect(describeHand(r5)).toBe("Royal Flush");
    const r6 = evaluateOmaha(c("4d 5d 6d 7d 8s 9s"), board);
    expect(r6.category).toBe(4); // 8 9 T J Q straight using 8s 9s
  });
});
