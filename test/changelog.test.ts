import { describe, expect, it } from "vitest";
import { CHANGELOG, unseenIds, visibleChangelog, type ChangelogEntry } from "@shared/changelog";
import { FLAG_DEFS, defaultFlags } from "@shared/flags";

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

describe("changelog entries", () => {
  it("have unique ids, real dates and something to say", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(new Set(CHANGELOG.map((e) => e.id)).size).toBe(CHANGELOG.length);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(day(e.date))).toBe(false);
      expect(e.title.trim().length).toBeGreaterThan(0);
      expect(e.items.length).toBeGreaterThan(0);
      const texts = e.items.map((i) => (typeof i === "string" ? i : i.text));
      for (const t of texts) expect(t.trim().length).toBeGreaterThan(0);
      expect(new Set(texts).size).toBe(texts.length); // the sheet uses the text as a key
      for (const i of e.items) if (typeof i !== "string" && i.flag) expect(i.flag in FLAG_DEFS).toBe(true);
    }
  });

  it("are listed newest first", () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(day(CHANGELOG[i - 1]!.date)).toBeGreaterThanOrEqual(day(CHANGELOG[i]!.date));
  });
});

const sample: ChangelogEntry[] = [
  { id: "c", date: "2026-03-03", title: "C", items: ["plain", { text: "about taunts", flag: "taunts" }] },
  { id: "b", date: "2026-02-02", title: "B", items: [{ text: "about the ghost", flag: "ghost" }] },
  { id: "a", date: "2026-01-01", title: "A", items: ["first"] },
];

describe("visibleChangelog", () => {
  it("shows everything with every flag on", () => {
    expect(visibleChangelog(defaultFlags(), sample).map((e) => e.items)).toEqual([["plain", "about taunts"], ["about the ghost"], ["first"]]);
  });

  it("drops lines about features that are off, and entries left empty", () => {
    const v = visibleChangelog({ ...defaultFlags(), taunts: false, ghost: false }, sample);
    expect(v.map((e) => e.id)).toEqual(["c", "a"]);
    expect(v[0]!.items).toEqual(["plain"]);
  });
});

describe("unseenIds", () => {
  it("is everything above the entry the player last saw", () => {
    expect([...unseenIds("a", undefined, sample)]).toEqual(["c", "b"]);
    expect([...unseenIds("b", undefined, sample)]).toEqual(["c"]);
    expect(unseenIds("c", undefined, sample).size).toBe(0);
  });

  it("counts only the newest entry for a browser with no memory, or one that remembers a dropped entry", () => {
    expect([...unseenIds(null, undefined, sample)]).toEqual(["c"]);
    expect([...unseenIds("gone", day("2026-01-01"), sample)]).toEqual(["c"]);
  });

  it("has nothing new for an account created after the newest entry shipped", () => {
    expect(unseenIds(null, day("2026-03-10"), sample).size).toBe(0);
    expect([...unseenIds(null, day("2026-03-03") + 3_600_000, sample)]).toEqual(["c"]); // joined that same day
    expect([...unseenIds("a", day("2026-03-10"), sample)]).toEqual(["c", "b"]); // a remembered entry wins over the account age
  });

  it("copes with an empty list", () => {
    expect(unseenIds(null, undefined, []).size).toBe(0);
  });
});
