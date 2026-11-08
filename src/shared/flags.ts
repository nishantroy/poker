/**
 * Feature flags: operator-level kill switches. Every feature defaults to ON; an admin turns one off
 * from the profile page when something misbehaves, without a redeploy. Flags live in AccountsDO and
 * are pushed to every active table, so a change takes effect within a second everywhere.
 *
 * `server: true` flags are enforced by the Worker / Durable Objects as well as hidden in the UI.
 * The rest are client-only behaviour.
 */
export const FLAG_DEFS = {
  hud: { label: "HUD", hint: "Per-player stat strip and the stats sheet on avatar tap.", server: true },
  replays: { label: "Hand replays", hint: "The Hands tab, hand records and reveal votes.", server: true },
  equity: { label: "Replay equities", hint: "Equity bars inside unlocked replays (computed on the player's device).", server: false },
  rabbitHunt: { label: "Rabbit hunting", hint: "Revealing the undealt board after an early finish.", server: true },
  chat: { label: "Table chat", hint: "The Chat tab at every table.", server: true },
  variants: { label: "Omaha & Pineapple", hint: "Off: new tables are Hold'em only and running tables switch to Hold'em from the next hand.", server: true },
  leaderboard: { label: "Leaderboard", hint: "The lobby leaderboard and lifetime results API.", server: true },
  signup: { label: "New signups", hint: "Off: only existing accounts can log in.", server: true },
  createTables: { label: "Creating tables", hint: "Off: nobody can open a new table. Running tables are unaffected.", server: true },
  sounds: { label: "Sounds", hint: "Turn chime, chips, cards, wins and vibration on phones.", server: false },
  ghost: { label: "Ghost player", hint: "The vote-in ghost seat. Off: no ghost is dealt (its chips stay safe until it is back on).", server: true },
  squid: { label: "Multi-board & Squid Game", hint: "Two or three boards per hand with Squid elimination. Off: tables go back to one board from the next hand.", server: true },
  badBeat: { label: "Bad beat splash", hint: "Full-screen moment when a big favourite gets rivered.", server: true },
  taunts: { label: "Taunts", hint: "Quick canned taunts shown as speech bubbles at the table.", server: true },
  runItTwice: { label: "Run it twice", hint: "All-in players can agree to run the rest of the board two or three times. Off: always once.", server: true },
  shortDeck: { label: "Short deck", hint: "Host toggle that removes the 2s through 5s (36 cards) for any game except PLO Hi-Lo. Off: full deck from the next hand.", server: true },
  redRiver: { label: "Red river", hint: "Host toggle: a red river is followed by more cards until a black one. Off: normal rivers from the next hand.", server: true },
  straddle: { label: "Straddle", hint: "Under the gun can post a voluntary third blind of 2x the big blind. Off: no straddles.", server: true },
  showCards: { label: "Show cards", hint: "After a hand ends, players can choose to show their hole cards to the table.", server: true },
  feedback: { label: "Feedback button", hint: "Players can send bug reports and ideas, filed as GitHub issues.", server: true },
  dealersChoice: { label: "Dealer's choice", hint: "The dealer picks the game each hand or each orbit. Off: those tables keep their current game.", server: true },
} as const;

export type FlagName = keyof typeof FLAG_DEFS;
export type Flags = Record<FlagName, boolean>;

export const FLAG_NAMES = Object.keys(FLAG_DEFS) as FlagName[];

export function defaultFlags(): Flags {
  return Object.fromEntries(FLAG_NAMES.map((n) => [n, true])) as Flags;
}

/** Fill in defaults for anything missing or malformed (old records, partial payloads). */
export function normalizeFlags(input: unknown): Flags {
  const out = defaultFlags();
  if (typeof input === "object" && input) {
    const o = input as Record<string, unknown>;
    for (const n of FLAG_NAMES) if (typeof o[n] === "boolean") out[n] = o[n] as boolean;
  }
  return out;
}

export function isFlagName(x: unknown): x is FlagName {
  return typeof x === "string" && x in FLAG_DEFS;
}
