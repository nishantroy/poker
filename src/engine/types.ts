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
  /** Number of boards dealt (1–3). More than one splits every pot equally between boards. */
  boards: number;
  /** Squid Game: with several boards, the board with the lowest river card is eliminated before river betting. */
  squid: boolean;
  /** Most times an all-in board may be run (1 = never more than once). Players pick up to this; the lowest pick wins. */
  maxRuns: number;
  /** Dealer's choice: the player about to get the button picks the game, every hand or for one orbit. */
  dealersChoice: DealersChoice;
  /** Allow the under-the-gun player to straddle (a voluntary third blind of 2× the big blind) with 3+ players. */
  straddle: boolean;
  /** Short deck: 2s through 5s removed (36 cards); flush beats full house, trips beat a straight, A-6-7-8-9 is a straight. Not used for hi-lo games. */
  shortDeck: boolean;
}

export type DealersChoice = "off" | "hand" | "orbit";

/** Seat number used for the ghost in results and events. The ghost never occupies a table seat. */
export const GHOST_SEAT = -1;

export interface GhostState {
  /** Dealt into every hand from the next one. */
  enabled: boolean;
  /** Chips the ghost has won; they ride as dead money in the next hand's main pot. */
  stack: number;
}

export interface HandGhost {
  hole: Card[];
  discarded: Card[];
  /** Dead money this hand (the ghost's stack at the deal). */
  stake: number;
  revealed: boolean;
}

export type Street = "preflop" | "flop" | "turn" | "river";
export type Phase =
  | "betting" // waiting on `actor`
  | "discard" // waiting on everyone in `pendingDiscard`
  | "runChoice" // all-in with cards to come: players in the hand pick how many times to run it
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

export interface BoardHand {
  name: string;
  score: number;
  cards: Card[];
  /** Hi-lo games: the player's qualifying eight-or-better low on this board, if any. */
  low?: { name: string; score: number; cards: Card[] } | null;
}

export interface PotResult {
  amount: number;
  /** `seat` may be GHOST_SEAT. `board` is set when several boards split the pot. */
  winners: { seat: number; amount: number; handName?: string; cards?: Card[]; board?: number; half?: "high" | "low" }[];
}

export interface BadBeat {
  victim: number;
  winner: number;
  /** Victim's equity (percent) with one card to come. */
  equity: number;
  victimHand: string;
  winnerHand: string;
}

export interface HandResult {
  pots: PotResult[];
  /** Per seat: headline hand (best across surviving boards) when shown at showdown. */
  hands: Record<number, BoardHand>;
  /** Per board index: hand per seat. Empty object for an eliminated board. */
  boardHands: Record<number, BoardHand>[];
  /** Net chip change per seat for this hand. */
  net: Record<number, number>;
  ghost: { won: number; hands: Record<number, BoardHand> } | null;
  badBeat: BadBeat | null;
}

export interface Hand {
  number: number;
  variant: Variant;
  deck: Card[];
  boards: Card[][];
  /** Index of the board knocked out by Squid Game, once the river is dealt. */
  eliminated: number | null;
  ghost: HandGhost | null;
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
  /** Short deck in force for this hand (fixed at the deal). */
  shortDeck: boolean;
  /** Most runs allowed this hand (from config and the runtime flag, fixed at the deal). */
  runsAllowed: number;
  /** How many times the board is being run. When > 1, `boards` holds one board per run. */
  runs: number;
  /** Open "run it twice" vote: choices are private until everyone has picked. */
  runChoice: RunChoice | null;
}

export interface RunChoice {
  max: number;
  /** Seats still to pick. */
  pending: number[];
  /** Seat → runs picked. */
  choices: Record<number, number>;
}

export interface GameState {
  config: TableConfig;
  seats: (Seat | null)[];
  button: number;
  handCount: number;
  hand: Hand | null;
  ghost: GhostState;
}

export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin" | "discard";

export interface Action {
  type: ActionType;
  /** For bet/raise: the total amount to make the street bet ("raise to"). For discard: card index. */
  amount?: number;
}

export type GameEvent =
  | { type: "handStarted"; handNumber: number; variant: Variant; button: number; players: number[] }
  | { type: "blind"; seat: number; kind: "sb" | "bb" | "ante" | "straddle"; amount: number }
  | { type: "action"; seat: number; action: ActionType; amount: number; allIn: boolean }
  | { type: "discarded"; seat: number }
  | { type: "street"; street: Street; boards: Card[][] }
  | { type: "boardEliminated"; board: number; river: Card }
  | { type: "ghostDealt"; stake: number }
  | { type: "ghostShown"; cards: Card[]; handName: string | null; won: number }
  | { type: "showdown"; seat: number; cards: Card[]; handName: string }
  | { type: "potAwarded"; seat: number; amount: number; handName?: string; potIndex: number; board?: number }
  | { type: "badBeat"; victim: number; winner: number; equity: number }
  | { type: "returned"; seat: number; amount: number }
  | { type: "runChoiceOpened"; max: number }
  | { type: "runsChosen"; runs: number }
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
