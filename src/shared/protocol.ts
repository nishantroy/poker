import type { Card } from "@engine/cards";
import type { Variant } from "@engine/variants";
import type { Action, ActionLimits, HandResult, Phase, Street, TableConfig } from "@engine/types";
import type { HandRecord, HudCounters } from "@engine/hud";

export type { Card, Variant, Action, ActionLimits, HandResult, Phase, Street, TableConfig, HandRecord, HudCounters };

/** Table-level options that the engine does not care about. */
export interface TableOptions {
  /** Anyone at the table may reveal the undealt board cards after an early finish. */
  rabbitHunt: boolean;
  /** Replays reveal every hole card without a vote. */
  autoUnlockReplays: boolean;
}

export const defaultOptions = (): TableOptions => ({ rabbitHunt: true, autoUnlockReplays: false });

export interface HandSummary {
  number: number;
  variant: Variant;
  pot: number;
  winners: string[];
  board: Card[];
  endedAt: number;
  /** Everyone's cards and equities may be shown. */
  unlocked: boolean;
  votes: number;
  votesNeeded: number;
  /** The viewer has already voted. */
  voted: boolean;
  /** The viewer was dealt into this hand (and so may vote). */
  eligible: boolean;
}

/** A hand record as seen by one viewer: hidden hole cards are null entries. */
export type HandRecordView = Omit<HandRecord, "players"> & {
  players: (Omit<HandRecord["players"][number], "hole" | "discarded"> & { hole: (Card | null)[]; discarded: (Card | null)[] })[];
  unlocked: boolean;
  votes: number;
  votesNeeded: number;
  voted: boolean;
  eligible: boolean;
};

export type TableStatus = "waiting" | "running" | "paused" | "ended";

export interface PublicSeat {
  seat: number;
  playerId: string;
  name: string;
  stack: number;
  status: "active" | "sittingOut";
  disconnected: boolean;
  isHost: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  streetBet: number;
  totalBet: number;
  /** null when not in the hand; hidden cards are null entries. */
  cards: (Card | null)[] | null;
  discarded: number;
  revealed: boolean;
  handName?: string;
  /** Cards that make the best hand at showdown. */
  bestCards?: Card[];
  pendingAdd: number;
  totalBuyIn: number;
}

export interface PublicPot {
  amount: number;
  eligible: number[];
}

export interface TimerInfo {
  kind: "action" | "discard" | "runout" | "nextHand";
  at: number; // epoch ms
  durationMs: number;
}

export interface PublicHand {
  number: number;
  variant: Variant;
  street: Street;
  phase: Phase;
  board: Card[];
  actor: number | null;
  currentBet: number;
  minRaise: number;
  pot: number;
  pots: PublicPot[];
  pendingDiscard: number[];
  result: HandResult | null;
  actionSeq: number;
  button: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  /** Undealt board cards revealed by a rabbit hunt (showdown only). */
  rabbit: Card[] | null;
  /** A rabbit hunt is possible for this hand (ended early, option on, not yet revealed). */
  rabbitAvailable: boolean;
}

export interface RebuyRequest {
  playerId: string;
  name: string;
  amount: number;
  seat: number;
}

export interface TableView {
  code: string;
  name: string;
  status: TableStatus;
  hostId: string;
  config: TableConfig;
  seats: (PublicSeat | null)[];
  button: number;
  handCount: number;
  hand: PublicHand | null;
  timer: TimerInfo | null;
  rebuyRequests: RebuyRequest[];
  options: TableOptions;
  /** Session HUD counters per userId (everyone currently seated, plus departed players). */
  hud: Record<string, HudCounters>;
  me: {
    userId: string;
    seat: number | null;
    limits: ActionLimits | null;
    isHost: boolean;
  };
  serverTime: number;
}

export interface ChatMessage {
  id: number;
  userId: string;
  name: string;
  text: string;
  ts: number;
}

export interface LogLine {
  id: number;
  ts: number;
  handNumber: number;
  text: string;
  kind: "action" | "street" | "result" | "system";
}

export interface SessionResultRow {
  userId: string;
  name: string;
  buyIn: number;
  cashOut: number;
  net: number;
  handsPlayed: number;
  biggestPot: number;
}

// ----- client -> server -----
export type ClientMessage =
  | { t: "sit"; seat: number; buyIn: number }
  | { t: "stand" }
  | { t: "action"; action: Action; seq: number }
  | { t: "sitOut" }
  | { t: "sitIn" }
  | { t: "rebuy"; amount: number }
  | { t: "chat"; text: string }
  | { t: "start" }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "kick"; playerId: string }
  | { t: "approveRebuy"; playerId: string; approve: boolean }
  | { t: "config"; patch: Partial<TableConfig> }
  | { t: "end" }
  | { t: "options"; patch: Partial<TableOptions> }
  | { t: "rabbit" }
  | { t: "listHands" }
  | { t: "getHand"; number: number }
  | { t: "vote"; number: number }
  | { t: "ping" };

// ----- server -> client -----
export type ServerMessage =
  | { t: "state"; view: TableView }
  | { t: "log"; lines: LogLine[] }
  | { t: "chat"; messages: ChatMessage[] }
  | { t: "error"; code: string; message: string }
  | { t: "ended"; results: SessionResultRow[] }
  | { t: "hands"; hands: HandSummary[] }
  | { t: "hand"; hand: HandRecordView }
  | { t: "pong"; serverTime: number };

// ----- REST -----
export interface UserInfo {
  id: string;
  username: string;
  createdAt: number;
}

export interface LeaderboardRow {
  userId: string;
  username: string;
  net: number;
  sessions: number;
  hands: number;
  biggestPot: number;
  wins: number;
}

export interface HudRow {
  userId: string;
  username: string;
  counters: HudCounters;
}

export interface UserStats extends LeaderboardRow {
  hud: HudCounters;
  bestSession: number;
  worstSession: number;
  recent: { tableCode: string; tableName: string; net: number; buyIn: number; cashOut: number; hands: number; endedAt: number }[];
}

export interface TableSummary {
  code: string;
  name: string;
  status: TableStatus;
  hostId: string;
  hostName: string;
  variant: Variant;
  smallBlind: number;
  bigBlind: number;
  players: number;
  createdAt: number;
}

export const LIMITS = {
  maxSeats: 8,
  minSeats: 2,
  maxChatLen: 300,
  maxNameLen: 24,
  maxTableNameLen: 40,
  usernameRe: /^[a-zA-Z0-9_]{2,20}$/,
  pinRe: /^\d{4,6}$/,
} as const;

export function defaultConfig(): TableConfig {
  return { variant: "nlhe", smallBlind: 1, bigBlind: 2, ante: 0, startingStack: 200, maxSeats: 8, actionTimerMs: 30_000 };
}

export function validateConfig(input: unknown): TableConfig {
  const d = defaultConfig();
  const o = (typeof input === "object" && input) ? (input as Record<string, unknown>) : {};
  const int = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = typeof v === "number" ? Math.floor(v) : typeof v === "string" ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const cfg: TableConfig = {
    variant: typeof o.variant === "string" && ["nlhe", "plo", "plo5", "plo6", "pineapple", "crazy-pineapple"].includes(o.variant) ? (o.variant as Variant) : d.variant,
    smallBlind: int(o.smallBlind, 1, 1_000_000, d.smallBlind),
    bigBlind: int(o.bigBlind, 1, 2_000_000, d.bigBlind),
    ante: int(o.ante, 0, 1_000_000, d.ante),
    startingStack: int(o.startingStack, 1, 100_000_000, d.startingStack),
    maxSeats: int(o.maxSeats, 2, 8, d.maxSeats),
    actionTimerMs: int(o.actionTimerMs, 5_000, 300_000, d.actionTimerMs),
  };
  if (cfg.bigBlind < cfg.smallBlind) cfg.bigBlind = cfg.smallBlind;
  if (cfg.startingStack < cfg.bigBlind) cfg.startingStack = cfg.bigBlind;
  return cfg;
}
