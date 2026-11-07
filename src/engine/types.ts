import type { Card } from "./cards";
import type { Variant } from "./variants";

export type SeatStatus = "active" | "sittingOut";

export interface Seat {
  seat: number;
  playerId: string;
  name: string;
  stack: number;
  status: SeatStatus;
  /** True while the socket is gone; the DO flips the seat to sittingOut at next hand start. */
  disconnected: boolean;
  totalBuyIn: number;
  /** Chips approved mid-hand, added at the next hand start. */
  pendingAdd: number;
  handsPlayed: number;
  biggestPot: number;
}

export interface TableConfig {
  variant: Variant;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  startingStack: number;
  maxSeats: number;
  actionTimerMs: number;
}

export type Street = "preflop" | "flop" | "turn" | "river";
export type Phase =
  | "betting" // waiting on `actor`
  | "discard" // waiting on everyone in `pendingDiscard`
  | "runout" // all-in: deal the next street after a short pause
  | "showdown" // hand over; results populated
  ;

export interface HandPlayer {
  seat: number;
  playerId: string;
  hole: Card[];
  discarded: Card[];
  folded: boolean;
  allIn: boolean;
  /** Chips committed on the current street. */
  streetBet: number;
  /** Chips committed in the whole hand. */
  totalBet: number;
  acted: boolean;
  /** False once a short all-in came in after this player acted on this street. */
  canRaise: boolean;
  /** Set at showdown for revealed hands. */
  revealed: boolean;
}

export interface Pot {
  amount: number;
  eligible: number[]; // seat numbers
}

export interface PotResult {
  amount: number;
  winners: { seat: number; amount: number; handName?: string; cards?: Card[] }[];
}

export interface HandResult {
  pots: PotResult[];
  /** Per seat: hand description when shown. */
  hands: Record<number, { name: string; score: number; cards: Card[] }>;
  /** Net chip change per seat for this hand. */
  net: Record<number, number>;
}

export interface Hand {
  number: number;
  variant: Variant;
  deck: Card[];
  board: Card[];
  players: HandPlayer[];
  button: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  street: Street;
  phase: Phase;
  actor: number | null;
  currentBet: number;
  minRaise: number;
  /** Seat of the last player to bet/raise on this street, null if none. */
  lastAggressor: number | null;
  pendingDiscard: number[];
  result: HandResult | null;
  /** Monotonic counter incremented per action; the DO uses it to validate timer alarms. */
  actionSeq: number;
}

export interface GameState {
  config: TableConfig;
  seats: (Seat | null)[];
  button: number;
  handCount: number;
  hand: Hand | null;
}

export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin" | "discard";

export interface Action {
  type: ActionType;
  /** For bet/raise: the total amount to make the street bet ("raise to"). For discard: card index. */
  amount?: number;
}

export type GameEvent =
  | { type: "handStarted"; handNumber: number; variant: Variant; button: number; players: number[] }
  | { type: "blind"; seat: number; kind: "sb" | "bb" | "ante"; amount: number }
  | { type: "action"; seat: number; action: ActionType; amount: number; allIn: boolean }
  | { type: "discarded"; seat: number }
  | { type: "street"; street: Street; board: Card[] }
  | { type: "showdown"; seat: number; cards: Card[]; handName: string }
  | { type: "potAwarded"; seat: number; amount: number; handName?: string; potIndex: number }
  | { type: "returned"; seat: number; amount: number }
  | { type: "handEnded"; handNumber: number }
  | { type: "timeout"; seat: number };

export interface ActionLimits {
  canCheck: boolean;
  callAmount: number; // chips the player must add to call (0 if check)
  canRaise: boolean;
  minRaiseTo: number; // total street bet after a minimum raise
  maxRaiseTo: number; // total street bet after maximum raise (stack-limited)
  potSize: number; // total chips in the middle incl. current street bets
}
