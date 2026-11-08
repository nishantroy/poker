import { describe, expect, it } from "vitest";
import { computeEquity } from "@engine/equity";
import { seededRng } from "@engine/cards";
import type { Card } from "@engine/cards";

const c = (s: string) => s.split(" ") as Card[];
const holdem = { holeRule: "any" as const };
const omaha = { holeRule: "exactly2" as const };

describe("computeEquity", () => {
  it("is exact and decisive on the river", () => {
    const r = computeEquity(holdem, [c("As Ad"), c("Ks Kd")], c("2c 7d 9h Jc 3s"));
    expect(r.exact).toBe(true);
    expect(r.equity).toEqual([100, 0]);
  });
  it("enumerates the turn exactly (44 run-outs)", () => {
    const r = computeEquity(holdem, [c("As Ad"), c("Ks Kd")], c("2c 7d 9h Jc"));
    expect(r.exact).toBe(true);
    expect(r.trials).toBe(44);
    // KK needs one of 2 kings: 2/44
    expect(r.equity[1]).toBeCloseTo(4.5, 0);
  });
  it("splits a chopped board", () => {
    const r = computeEquity(holdem, [c("2s 3d"), c("4h 5c")], c("Ts Js Qs Ks As"));
    expect(r.equity).toEqual([50, 50]);
    expect(r.tie).toEqual([100, 100]);
  });
  it("AA vs KK preflop is about 80/20 (Monte Carlo)", () => {
    const r = computeEquity(holdem, [c("As Ad"), c("Ks Kd")], [], [], { samples: 4000, rng: seededRng(1) });
    expect(r.exact).toBe(false);
    expect(r.equity[0]).toBeGreaterThan(77);
    expect(r.equity[0]).toBeLessThan(86);
    expect(r.equity[0]! + r.equity[1]!).toBeCloseTo(100, 0);
  });
  it("respects dead cards", () => {
    // Hero needs a heart; all remaining hearts are dead -> no flush possible.
    const board = c("2h 7h 9c Jd");
    const hero = c("Ah Kh");
    const vill = c("Js Jc");
    const deadHearts = c("3h 4h 5h 6h 8h Th Qh");
    const r = computeEquity(holdem, [hero, vill], board, deadHearts);
    expect(r.exact).toBe(true);
    expect(r.equity[0]).toBe(0);
  });
  it("handles Omaha hands", () => {
    const r = computeEquity(omaha, [c("As Ad Ks Kd"), c("7c 8c 9d Td")], c("6s 7d 8h Qc"));
    expect(r.exact).toBe(true);
    expect(r.equity[0]! + r.equity[1]!).toBeCloseTo(100, 0);
    expect(r.equity[1]).toBeGreaterThan(r.equity[0]!);
  });
});

describe("hi-lo equity", () => {
  const plo8 = { holeRule: "exactly2" as const, hiLo: true };
  it("splits the pot between the high and the low on a finished board", () => {
    const r = computeEquity(plo8, [c("Kh Kd Qs Js"), c("Ac 2c 9s 9d")], c("Ks 3d 4h 7c Th"));
    expect(r.equity).toEqual([50, 50]);
    expect(r.win).toEqual([0, 0]);
  });
  it("the high scoops when no low is possible", () => {
    const r = computeEquity(plo8, [c("Kh Kd Qs Js"), c("Ac 2c 9s 9d")], c("Ks 9h Th Jc Qd"));
    expect(r.equity).toEqual([100, 0]); // Qs Js make a K-high straight; no low possible
  });
  it("short deck deals from 36 cards", () => {
    const r = computeEquity({ holeRule: "any" as const, shortDeck: true }, [c("As Ad"), c("Ks Kd")], c("6c 7d 9h Jc"));
    expect(r.trials).toBe(36 - 8);
  });
});

describe("board shapes in equity", () => {
  it("Donk'em counts the super river still to come", () => {
    const donk = { holeRule: "exactly2" as const, streetCards: [2, 2, 1] as [number, number, number], superRiver: 1 };
    const r = computeEquity(donk, [c("As Ad Kc"), c("Ks Kd 2c")], c("7h 8h 9c Tc 2s"));
    expect(r.exact).toBe(true);
    expect(r.trials).toBe(52 - 6 - 5);
  });
  it("red river simulates the extra cards", () => {
    const r = computeEquity({ holeRule: "any" as const, redRiver: true }, [c("As Ad"), c("Ks Kd")], c("2c 7d 9h Jc"), [], { samples: 500, rng: seededRng(3) });
    expect(r.exact).toBe(false);
    expect(r.trials).toBe(500);
    expect(r.equity[0]!).toBeGreaterThan(80);
  });
});
