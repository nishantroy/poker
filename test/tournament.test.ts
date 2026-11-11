import { describe, expect, it } from "vitest";
import { blindsAt, bustPlaces, levelAt, ordinal, payoutShares, prizeTable, settle, validateTournament, TOURNEY_LIMITS } from "@engine/index";

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("tournament blinds", () => {
  it("starts at the opening blinds and climbs 1, 1.5, 2, 3, 4, 6, 8, then times ten", () => {
    const bbs = Array.from({ length: 10 }, (_, l) => blindsAt(l, 10, 20).bb);
    expect(bbs).toEqual([20, 30, 40, 60, 80, 120, 160, 200, 300, 400]);
    expect(blindsAt(0, 10, 20)).toEqual({ sb: 10, bb: 20 });
    expect(blindsAt(7, 10, 20)).toEqual({ sb: 100, bb: 200 });
  });
  it("never goes down, keeps the small blind between 1 and the big blind, and stops at the last level", () => {
    let prev = 0;
    for (let l = 0; l <= TOURNEY_LIMITS.maxLevel + 5; l++) {
      const { sb, bb } = blindsAt(l, 1, 2);
      expect(bb).toBeGreaterThanOrEqual(prev);
      expect(sb).toBeGreaterThanOrEqual(1);
      expect(sb).toBeLessThanOrEqual(bb);
      prev = bb;
    }
    expect(blindsAt(TOURNEY_LIMITS.maxLevel + 5, 1, 2)).toEqual(blindsAt(TOURNEY_LIMITS.maxLevel, 1, 2));
    expect(blindsAt(-3, 5, 10)).toEqual({ sb: 5, bb: 10 });
  });
  it("turns played time into a level", () => {
    expect(levelAt(0, 60_000)).toBe(0);
    expect(levelAt(59_999, 60_000)).toBe(0);
    expect(levelAt(60_000, 60_000)).toBe(1);
    expect(levelAt(5 * 60_000 + 1, 60_000)).toBe(5);
    expect(levelAt(1e12, 60_000)).toBe(TOURNEY_LIMITS.maxLevel);
    expect(levelAt(-5, 60_000)).toBe(0);
    expect(levelAt(1000, 0)).toBe(0);
  });
});

describe("tournament payouts", () => {
  it("pays one place up to 3 players, two up to 6, three beyond", () => {
    expect(payoutShares(2, "auto")).toEqual([100]);
    expect(payoutShares(3, "auto")).toEqual([100]);
    expect(payoutShares(4, "auto")).toEqual([65, 35]);
    expect(payoutShares(6, "auto")).toEqual([65, 35]);
    expect(payoutShares(7, "auto")).toEqual([50, 30, 20]);
    expect(payoutShares(8, "winner")).toEqual([100]);
  });
  it("prizes are whole numbers that add up to the pool", () => {
    for (let n = 2; n <= 8; n++) {
      for (const buyIn of [0, 1, 7, 20, 33, 999]) {
        for (const mode of ["auto", "winner"] as const) {
          const prizes = prizeTable(n, buyIn, mode);
          expect(prizes.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
          expect(prizes.reduce((a, b) => a + b, 0)).toBe(n * buyIn);
        }
      }
    }
    expect(prizeTable(8, 20, "auto")).toEqual([80, 48, 32]);
    expect(prizeTable(5, 7, "auto")).toEqual([23, 12]);
  });
});

describe("tournament places", () => {
  it("a single bust takes the last place still open", () => {
    expect(bustPlaces(5, [{ id: "a", startStack: 300 }])).toEqual([{ id: "a", place: 5 }]);
  });
  it("two busts in one hand: the bigger starting stack finishes higher", () => {
    expect(bustPlaces(5, [{ id: "a", startStack: 300 }, { id: "b", startStack: 900 }])).toEqual([
      { id: "b", place: 4 },
      { id: "a", place: 5 },
    ]);
  });
  it("equal starting stacks tie for the better place", () => {
    expect(bustPlaces(4, [{ id: "a", startStack: 500 }, { id: "b", startStack: 500 }, { id: "c", startStack: 100 }])).toEqual([
      { id: "a", place: 2 },
      { id: "b", place: 2 },
      { id: "c", place: 4 },
    ]);
  });
});

describe("tournament settlement", () => {
  it("played to the end: the last player takes first, the rest get their place's prize", () => {
    const prizes = prizeTable(8, 20, "auto"); // 80, 48, 32
    const finished = [8, 7, 6, 5, 4, 3, 2].map((place) => ({ id: `p${place}`, place }));
    const out = settle(prizes, finished, [{ id: "p1", chips: 12000 }]);
    expect(out.p1).toBe(80);
    expect(out.p2).toBe(48);
    expect(out.p3).toBe(32);
    expect(out.p4).toBe(0);
    expect(sum(out)).toBe(160);
  });
  it("players tied for a place share the prizes for the places they cover", () => {
    const prizes = [80, 48, 32];
    // Two players knocked out together with equal stacks while three were left: both are 2nd, sharing 2nd + 3rd.
    const out = settle(prizes, [{ id: "a", place: 2 }, { id: "b", place: 2 }], [{ id: "w", chips: 100 }]);
    expect(out).toEqual({ a: 40, b: 40, w: 80 });
    // An odd unit goes to one of them rather than vanishing.
    const odd = settle([81, 48, 33], [{ id: "a", place: 2 }, { id: "b", place: 2 }], [{ id: "w", chips: 100 }]);
    expect(odd.a! + odd.b!).toBe(81);
    expect(sum(odd)).toBe(162);
  });
  it("ended early: what is left is split by chips, and nothing is lost to rounding", () => {
    const prizes = prizeTable(4, 25, "auto"); // 65, 35
    const out = settle(prizes, [{ id: "d", place: 4 }], [
      { id: "a", chips: 3000 },
      { id: "b", chips: 2000 },
      { id: "c", chips: 1000 },
    ]);
    expect(out.d).toBe(0);
    expect(out.a).toBe(51); // 50 by chips plus the odd unit, as the biggest stack
    expect(out.b).toBe(33);
    expect(out.c).toBe(16);
    expect(out.a! + out.b! + out.c!).toBe(100);
    expect(sum(out)).toBe(100);
  });
  it("ended early with a paid place already decided keeps that prize out of the chop", () => {
    const out = settle([50, 30, 20], [{ id: "x", place: 3 }], [
      { id: "a", chips: 1 },
      { id: "b", chips: 1 },
    ]);
    expect(out.x).toBe(20);
    expect(out.a! + out.b!).toBe(80);
  });
  it("always adds up to the pool, whatever the shape", () => {
    for (let n = 2; n <= 8; n++) {
      for (const buyIn of [0, 3, 20, 101]) {
        const prizes = prizeTable(n, buyIn, "auto");
        for (let left = 1; left <= n; left++) {
          const finished = Array.from({ length: n - left }, (_, i) => ({ id: `f${i}`, place: n - i }));
          const remaining = Array.from({ length: left }, (_, i) => ({ id: `r${i}`, chips: 100 + i * 37 }));
          const out = settle(prizes, finished, remaining);
          expect(sum(out)).toBe(n * buyIn);
          expect(Object.values(out).every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
        }
      }
    }
  });
  it("no chips anywhere (should not happen) still splits evenly", () => {
    const out = settle([100], [], [{ id: "a", chips: 0 }, { id: "b", chips: 0 }]);
    expect(sum(out)).toBe(100);
  });
});

describe("tournament setup", () => {
  it("rejects non-objects and clamps everything else", () => {
    expect(validateTournament(null)).toBeNull();
    expect(validateTournament("yes")).toBeNull();
    expect(validateTournament({})).toEqual({ buyIn: 20, levelMs: 300_000, payouts: "auto" });
    expect(validateTournament({ buyIn: -5, levelMs: 1, payouts: "winner" })).toEqual({ buyIn: 0, levelMs: TOURNEY_LIMITS.minLevelMs, payouts: "winner" });
    expect(validateTournament({ buyIn: 1e12, levelMs: 1e12, payouts: "nope" })).toEqual({ buyIn: TOURNEY_LIMITS.maxBuyIn, levelMs: TOURNEY_LIMITS.maxLevelMs, payouts: "auto" });
    expect(validateTournament({ buyIn: 12.9, levelMs: "120000" })).toEqual({ buyIn: 12, levelMs: 120_000, payouts: "auto" });
  });
  it("names places", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});
