import type { FlagName, Flags } from "./flags";

/**
 * What's new, for players. Newest entry first. Shown in the app's "What's new" sheet (lobby and the table's You menu).
 *
 * Only what changes how the game is played: new games and game modes, rule changes, and significant changes to the
 * table or lobby UI. Small fixes, polish and anything a player would not go looking for stay out; git has those.
 * Write for someone at the table, not for a developer: what they can now do and where to find it.
 * Never change the `id` of an entry that has shipped: browsers remember the last id they have seen.
 */
export interface ChangeItem {
  text: string;
  /** Hide this line while the feature it talks about is switched off. */
  flag?: FlagName;
}

export interface ChangelogEntry {
  /** Stable and unique. */
  id: string;
  /** YYYY-MM-DD, the day it shipped. */
  date: string;
  title: string;
  items: (string | ChangeItem)[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-11-10-tournaments",
    date: "2026-11-10",
    title: "Tournaments",
    items: [
      { flag: "tournaments", text: "Sit-and-go tournaments: everyone pays one buy-in and starts with the same stack, the blinds rise on a clock, and the last player with chips wins. Pick Tournament when you create a table." },
      { flag: "tournaments", text: "Nobody leaves a running tournament with chips. If you sit out or drop off you are still dealt in: your hands are checked or folded and your blinds keep going in." },
    ],
  },
  {
    id: "2026-11-08-table",
    date: "2026-11-08",
    title: "A faster table",
    items: [
      { flag: "dealersChoice", text: "Dealer's choice no longer pauses the game. The next dealer picks from a strip under the header while the current hand plays; no pick keeps the current game." },
      "The hand log and chat sit beside the table on a computer and drop down under the header on a phone, so they never cover the table.",
      { flag: "ghost", text: "The ghost can't be sent away while it still has chips. Voted off during a hand, it plays that hand out and anything it wins goes into the next pot." },
      { flag: "variants", text: "There is one Pineapple now: the one where you discard after the flop." },
    ],
  },
  {
    id: "2026-11-08-games",
    date: "2026-11-08",
    title: "New games and house rules",
    items: [
      { flag: "variants", text: "Three new games: PLO Hi-Lo (8 or better), Irish Hi-Lo and Donk'em. Tap the game badge at the table for the rules." },
      { flag: "shortDeck", text: "Short deck (6+): the host can take the 2s through 5s out of any game except the hi-lo ones." },
      { flag: "redRiver", text: "Red river: when the river is red, the dealer keeps dealing until a black card lands." },
      { flag: "straddle", text: "Straddles: under the gun can post 2× the big blind and act last before the flop." },
    ],
  },
  {
    id: "2026-11-07-run-it-twice",
    date: "2026-11-07",
    title: "Run it twice, dealer's choice and showing cards",
    items: [
      { flag: "runItTwice", text: "Run it twice: all in with cards to come, the players in the hand can run the rest of the board up to three times. The pot is split between the runs." },
      { flag: "dealersChoice", text: "Dealer's choice: the player about to get the button picks the game, each hand or each orbit." },
      { flag: "showCards", text: "Show your cards to the table once a hand is over." },
    ],
  },
];

export interface VisibleEntry {
  id: string;
  date: string;
  title: string;
  items: string[];
}

/** The entries to show, without the lines about features that are switched off (and without entries left empty). */
export function visibleChangelog(flags: Flags, entries: ChangelogEntry[] = CHANGELOG): VisibleEntry[] {
  return entries
    .map((e) => ({
      id: e.id,
      date: e.date,
      title: e.title,
      items: e.items.filter((i) => typeof i === "string" || !i.flag || flags[i.flag]).map((i) => (typeof i === "string" ? i : i.text)),
    }))
    .filter((e) => e.items.length > 0);
}

const DAY_MS = 86_400_000;

/**
 * Ids of the entries this browser has not seen. `seenId` is the newest entry at the time the player last looked.
 * A browser with no usable memory (first visit, or an id that is no longer listed) only counts the newest entry,
 * and not even that for an account created after it shipped: a new player has no "before" to compare with.
 */
export function unseenIds(seenId: string | null, accountCreatedAt?: number, entries: ChangelogEntry[] = CHANGELOG): Set<string> {
  const at = seenId === null ? -1 : entries.findIndex((e) => e.id === seenId);
  if (at >= 0) return new Set(entries.slice(0, at).map((e) => e.id));
  const newest = entries[0];
  if (!newest) return new Set();
  const shipped = Date.parse(`${newest.date}T00:00:00Z`) + DAY_MS; // end of that day, give or take a time zone
  if (accountCreatedAt !== undefined && accountCreatedAt > shipped) return new Set();
  return new Set([newest.id]);
}
