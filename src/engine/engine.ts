import { type Card, type Rng, cryptoRng, shuffledDeck } from "./cards";
import { describeHand, evaluateHand } from "./evaluate";
import type {
  Action, ActionLimits, GameEvent, GameState, Hand, HandPlayer, HandResult, Pot, Seat, Street, TableConfig,
} from "./types";
import { VARIANTS } from "./variants";

export class EngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EngineError";
  }
}

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river"];

// ---------- construction & seating ----------

export function createGame(config: TableConfig): GameState {
  return {
    config,
    seats: Array.from({ length: config.maxSeats }, () => null),
    button: -1,
    handCount: 0,
    hand: null,
  };
}

export function seatPlayer(state: GameState, seat: number, playerId: string, name: string, stack: number): GameState {
  const s = structuredClone(state);
  if (seat < 0 || seat >= s.seats.length) throw new EngineError("bad_seat", "No such seat");
  if (s.seats[seat]) throw new EngineError("seat_taken", "Seat is taken");
  if (s.seats.some((x) => x?.playerId === playerId)) throw new EngineError("already_seated", "Already seated");
  s.seats[seat] = {
    seat, playerId, name, stack, status: "active", disconnected: false,
    totalBuyIn: stack, pendingAdd: 0, handsPlayed: 0, biggestPot: 0,
  };
  return s;
}

export function removePlayer(state: GameState, seat: number): GameState {
  const s = structuredClone(state);
  const hp = s.hand?.players.find((p) => p.seat === seat);
  if (hp && s.hand && s.hand.phase !== "showdown") {
    throw new EngineError("in_hand", "Cannot remove a player mid-hand");
  }
  s.seats[seat] = null;
  return s;
}

/** Seats dealt into the next hand: active, connected, with chips. */
export function participants(state: GameState): Seat[] {
  return state.seats.filter((s): s is Seat => !!s && s.status === "active" && s.stack > 0);
}

export function canStartHand(state: GameState): boolean {
  return (!state.hand || state.hand.phase === "showdown") && participants(state).length >= 2;
}

export function isHandLive(state: GameState): boolean {
  return !!state.hand && state.hand.phase !== "showdown";
}

// ---------- helpers ----------

function hp(hand: Hand, seat: number): HandPlayer {
  const p = hand.players.find((x) => x.seat === seat);
  if (!p) throw new EngineError("not_in_hand", "Player is not in this hand");
  return p;
}

function nonFolded(hand: Hand): HandPlayer[] {
  return hand.players.filter((p) => !p.folded);
}
function canAct(p: HandPlayer): boolean {
  return !p.folded && !p.allIn;
}

/** Next hand player after `from` (seat order, wrapping) that matches pred. */
function nextPlayer(hand: Hand, from: number, pred: (p: HandPlayer) => boolean): HandPlayer | null {
  const n = hand.players.length;
  const idx = hand.players.findIndex((p) => p.seat === from);
  // if `from` isn't in the hand (e.g. button on an empty seat), start from the first seat after it
  let start = idx;
  if (idx < 0) {
    start = hand.players.findIndex((p) => p.seat > from);
    if (start < 0) start = 0;
    const p = hand.players[start]!;
    if (pred(p)) return p;
  }
  for (let k = 1; k <= n; k++) {
    const p = hand.players[(start + k) % n]!;
    if (pred(p)) return p;
  }
  return null;
}

function potTotal(hand: Hand): number {
  return hand.players.reduce((a, p) => a + p.totalBet, 0);
}

function commit(hand: Hand, p: HandPlayer, seatRef: Seat, amount: number, countsTowardBet = true): number {
  const amt = Math.min(amount, seatRef.stack);
  seatRef.stack -= amt;
  p.totalBet += amt;
  if (countsTowardBet) p.streetBet += amt;
  if (seatRef.stack === 0) p.allIn = true;
  return amt;
}

// ---------- hand start ----------

export function startHand(state: GameState, rng: Rng = cryptoRng): StepResult {
  const s = structuredClone(state);
  if (s.hand && s.hand.phase !== "showdown") throw new EngineError("hand_live", "A hand is in progress");
  // apply pending chip adds
  for (const seat of s.seats) {
    if (seat && seat.pendingAdd > 0) {
      seat.stack += seat.pendingAdd;
      seat.totalBuyIn += seat.pendingAdd;
      seat.pendingAdd = 0;
    }
  }
  const parts = participants(s);
  if (parts.length < 2) throw new EngineError("not_enough_players", "Need at least 2 players with chips");
  const spec = VARIANTS[s.config.variant];
  const events: GameEvent[] = [];

  // move button
  const partSeats = parts.map((p) => p.seat);
  if (s.button < 0 || s.handCount === 0) {
    s.button = partSeats[rng(partSeats.length)]!;
  } else {
    const next = partSeats.find((x) => x > s.button) ?? partSeats[0]!;
    s.button = next;
  }
  s.handCount += 1;

  const deck = shuffledDeck(rng);
  const players: HandPlayer[] = parts.map((seat) => ({
    seat: seat.seat, playerId: seat.playerId, hole: [], discarded: [], folded: false, allIn: false,
    streetBet: 0, totalBet: 0, acted: false, canRaise: true, revealed: false,
  }));
  const hand: Hand = {
    number: s.handCount, variant: s.config.variant, deck, board: [], players, button: s.button,
    smallBlindSeat: -1, bigBlindSeat: -1, street: "preflop", phase: "betting", actor: null,
    currentBet: 0, minRaise: s.config.bigBlind, lastAggressor: null, pendingDiscard: [], result: null, actionSeq: 0,
  };
  s.hand = hand;

  const headsUp = players.length === 2;
  const sb = headsUp ? hp(hand, s.button) : nextPlayer(hand, s.button, () => true)!;
  const bb = nextPlayer(hand, sb.seat, () => true)!;
  hand.smallBlindSeat = sb.seat;
  hand.bigBlindSeat = bb.seat;
  events.push({ type: "handStarted", handNumber: hand.number, variant: hand.variant, button: s.button, players: partSeats });

  // antes
  if (s.config.ante > 0) {
    for (const p of players) {
      const seatRef = s.seats[p.seat]!;
      const amt = commit(hand, p, seatRef, s.config.ante, false);
      events.push({ type: "blind", seat: p.seat, kind: "ante", amount: amt });
    }
  }
  // blinds
  {
    const amt = commit(hand, sb, s.seats[sb.seat]!, s.config.smallBlind);
    events.push({ type: "blind", seat: sb.seat, kind: "sb", amount: amt });
  }
  {
    const amt = commit(hand, bb, s.seats[bb.seat]!, s.config.bigBlind);
    events.push({ type: "blind", seat: bb.seat, kind: "bb", amount: amt });
  }
  hand.currentBet = s.config.bigBlind;
  hand.minRaise = s.config.bigBlind;

  // deal
  for (let c = 0; c < spec.holeCards; c++) {
    let p: HandPlayer = sb;
    for (let i = 0; i < players.length; i++) {
      p.hole.push(hand.deck.pop()!);
      p = nextPlayer(hand, p.seat, () => true)!;
    }
  }
  for (const seat of parts) seat.handsPlayed += 1;

  // first to act: left of BB
  const first = nextPlayer(hand, bb.seat, canAct);
  if (!first || players.filter(canAct).length < 2 && roundSettled(hand)) {
    // everyone (or all but one) is all-in from the blinds
    hand.actor = null;
    enterRunoutOrShowdown(s, hand, events);
  } else {
    hand.actor = first.seat;
  }
  return { state: s, events };
}

// ---------- limits ----------

export function getLimits(state: GameState, seat: number): ActionLimits {
  const hand = state.hand;
  if (!hand || hand.phase !== "betting") throw new EngineError("no_betting", "No betting round in progress");
  const p = hp(hand, seat);
  const seatRef = state.seats[seat]!;
  const spec = VARIANTS[hand.variant];
  const pot = potTotal(hand);
  const callAmount = Math.min(hand.currentBet - p.streetBet, seatRef.stack);
  const canCheck = hand.currentBet === p.streetBet;
  const maxByStack = p.streetBet + seatRef.stack;
  let maxRaiseTo = maxByStack;
  if (spec.limit === "pot-limit") {
    const fullCall = hand.currentBet - p.streetBet;
    maxRaiseTo = Math.min(maxByStack, hand.currentBet + pot + fullCall);
  }
  const minRaiseTo = Math.min(hand.currentBet + hand.minRaise, maxByStack);
  const canRaise = p.canRaise && maxByStack > hand.currentBet && (minRaiseTo <= maxRaiseTo);
  return { canCheck, callAmount, canRaise, minRaiseTo, maxRaiseTo, potSize: pot };
}

// ---------- actions ----------

export function applyAction(state: GameState, seat: number, action: Action): StepResult {
  const s = structuredClone(state);
  const hand = s.hand;
  if (!hand || hand.phase === "showdown") throw new EngineError("no_hand", "No hand in progress");
  const events: GameEvent[] = [];

  if (action.type === "discard") {
    if (hand.phase !== "discard") throw new EngineError("not_discard", "Not a discard phase");
    if (!hand.pendingDiscard.includes(seat)) throw new EngineError("not_pending", "Nothing to discard");
    const p = hp(hand, seat);
    const idx = action.amount ?? -1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= p.hole.length) throw new EngineError("bad_card", "Bad card index");
    doDiscard(hand, p, idx);
    events.push({ type: "discarded", seat });
    hand.actionSeq += 1;
    if (hand.pendingDiscard.length === 0) afterDiscard(s, hand, events);
    return { state: s, events };
  }

  if (hand.phase !== "betting") throw new EngineError("not_betting", "Not a betting round");
  if (hand.actor !== seat) throw new EngineError("not_your_turn", "Not your turn");
  const p = hp(hand, seat);
  const seatRef = s.seats[seat]!;
  const limits = getLimits(s, seat);

  switch (action.type) {
    case "fold": {
      p.folded = true;
      events.push({ type: "action", seat, action: "fold", amount: 0, allIn: false });
      break;
    }
    case "check": {
      if (!limits.canCheck) throw new EngineError("cannot_check", "Cannot check facing a bet");
      events.push({ type: "action", seat, action: "check", amount: 0, allIn: false });
      break;
    }
    case "call": {
      if (limits.canCheck) {
        events.push({ type: "action", seat, action: "check", amount: 0, allIn: false });
        break;
      }
      const amt = commit(hand, p, seatRef, limits.callAmount);
      events.push({ type: "action", seat, action: "call", amount: amt, allIn: p.allIn });
      break;
    }
    case "bet":
    case "raise":
    case "allin": {
      let raiseTo: number;
      if (action.type === "allin") {
        raiseTo = Math.min(p.streetBet + seatRef.stack, limits.maxRaiseTo);
        if (raiseTo <= hand.currentBet || !limits.canRaise) {
          // all-in for less than (or equal to) a call
          const amt = commit(hand, p, seatRef, limits.canRaise ? seatRef.stack : limits.callAmount);
          events.push({ type: "action", seat, action: amt === 0 ? "check" : "call", amount: amt, allIn: p.allIn });
          break;
        }
      } else {
        raiseTo = Math.floor(action.amount ?? 0);
      }
      if (!Number.isFinite(raiseTo) || raiseTo <= hand.currentBet) throw new EngineError("bad_amount", "Raise must exceed the current bet");
      if (!limits.canRaise) throw new EngineError("cannot_raise", "Raising is not allowed right now");
      const isAllIn = raiseTo === p.streetBet + seatRef.stack;
      if (raiseTo > limits.maxRaiseTo) throw new EngineError("too_much", `Maximum is ${limits.maxRaiseTo}`);
      if (raiseTo < limits.minRaiseTo && !isAllIn) throw new EngineError("too_small", `Minimum is ${limits.minRaiseTo}`);
      const raiseSize = raiseTo - hand.currentBet;
      const fullRaise = raiseSize >= hand.minRaise;
      commit(hand, p, seatRef, raiseTo - p.streetBet);
      for (const o of hand.players) {
        if (o === p) continue;
        if (fullRaise) o.canRaise = true;
        else if (o.acted) o.canRaise = false;
        o.acted = false;
      }
      if (fullRaise) hand.minRaise = raiseSize;
      const kind = hand.currentBet === 0 ? "bet" : "raise";
      hand.currentBet = raiseTo;
      hand.lastAggressor = seat;
      events.push({ type: "action", seat, action: kind, amount: raiseTo, allIn: p.allIn });
      break;
    }
    default:
      throw new EngineError("bad_action", "Unknown action");
  }
  p.acted = true;
  hand.actionSeq += 1;
  progress(s, hand, events);
  return { state: s, events };
}

/** Called when the action timer expires: auto-check/fold the actor, or auto-discard. */
export function timeout(state: GameState): StepResult {
  const hand = state.hand;
  if (!hand) throw new EngineError("no_hand", "No hand in progress");
  if (hand.phase === "betting" && hand.actor !== null) {
    const seat = hand.actor;
    const limits = getLimits(state, seat);
    const res = applyAction(state, seat, { type: limits.canCheck ? "check" : "fold" });
    res.events.unshift({ type: "timeout", seat });
    return res;
  }
  if (hand.phase === "discard") {
    const s = structuredClone(state);
    const h = s.hand!;
    const events: GameEvent[] = [];
    for (const seat of [...h.pendingDiscard]) {
      const p = hp(h, seat);
      events.push({ type: "timeout", seat });
      doDiscard(h, p, p.hole.length - 1);
      events.push({ type: "discarded", seat });
    }
    h.actionSeq += 1;
    afterDiscard(s, h, events);
    return { state: s, events };
  }
  throw new EngineError("no_timer", "Nothing to time out");
}

/** Called by the host runtime after a pause while in the `runout` phase: deals the next street. */
export function advance(state: GameState): StepResult {
  const s = structuredClone(state);
  const hand = s.hand;
  if (!hand || hand.phase !== "runout") throw new EngineError("not_runout", "Not running out the board");
  const events: GameEvent[] = [];
  hand.actionSeq += 1;
  if (hand.street === "river") {
    showdown(s, hand, events);
    return { state: s, events };
  }
  dealNextStreet(s, hand, events);
  const spec = VARIANTS[hand.variant];
  if (spec.discardAfter === hand.street && needsDiscard(hand)) {
    enterDiscard(hand);
  }
  return { state: s, events };
}

/** A player leaves (or is kicked) mid-hand: fold them immediately, whether or not it is their turn. */
export function forfeit(state: GameState, seat: number): StepResult {
  const s = structuredClone(state);
  const hand = s.hand;
  const events: GameEvent[] = [];
  if (!hand || hand.phase === "showdown") return { state: s, events };
  const p = hand.players.find((x) => x.seat === seat);
  if (!p || p.folded) return { state: s, events };
  if (hand.phase === "betting" && hand.actor === seat) {
    return applyAction(state, seat, { type: "fold" });
  }
  p.folded = true;
  p.acted = true;
  events.push({ type: "action", seat, action: "fold", amount: 0, allIn: false });
  hand.actionSeq += 1;
  hand.pendingDiscard = hand.pendingDiscard.filter((x) => x !== seat);
  if (nonFolded(hand).length === 1) {
    hand.actor = null;
    showdown(s, hand, events);
  } else if (hand.phase === "discard" && hand.pendingDiscard.length === 0) {
    afterDiscard(s, hand, events);
  } else if (hand.phase === "betting" && roundSettled(hand)) {
    hand.actor = null;
    endOfStreet(s, hand, events);
  } else if (hand.phase === "runout" && hand.street === "river") {
    showdown(s, hand, events);
  }
  return { state: s, events };
}

// ---------- internals ----------

function doDiscard(hand: Hand, p: HandPlayer, idx: number) {
  const [card] = p.hole.splice(idx, 1);
  p.discarded.push(card!);
  hand.pendingDiscard = hand.pendingDiscard.filter((x) => x !== p.seat);
}

function needsDiscard(hand: Hand): boolean {
  const spec = VARIANTS[hand.variant];
  if (spec.discardTo === undefined) return false;
  return nonFolded(hand).some((p) => p.hole.length > spec.discardTo!);
}

function enterDiscard(hand: Hand) {
  const spec = VARIANTS[hand.variant];
  hand.phase = "discard";
  hand.actor = null;
  hand.pendingDiscard = nonFolded(hand).filter((p) => p.hole.length > spec.discardTo!).map((p) => p.seat);
}

function afterDiscard(s: GameState, hand: Hand, events: GameEvent[]) {
  // Discard phase finished: continue to the next street (betting or runout).
  const actors = nonFolded(hand).filter(canAct);
  if (actors.length < 2) {
    hand.phase = "runout";
    for (const p of nonFolded(hand)) p.revealed = true;
    return;
  }
  hand.phase = "betting";
  dealNextStreet(s, hand, events);
  hand.actor = nextPlayer(hand, hand.button, canAct)!.seat;
}

function roundSettled(hand: Hand): boolean {
  return nonFolded(hand).every((p) => p.allIn || (p.acted && p.streetBet === hand.currentBet));
}

function progress(s: GameState, hand: Hand, events: GameEvent[]) {
  const live = nonFolded(hand);
  if (live.length === 1) {
    hand.actor = null;
    showdown(s, hand, events);
    return;
  }
  if (!roundSettled(hand)) {
    const cur = hand.actor!;
    const next = nextPlayer(hand, cur, (p) => canAct(p) && (!p.acted || p.streetBet < hand.currentBet));
    if (next) {
      hand.actor = next.seat;
      return;
    }
  }
  // round complete
  hand.actor = null;
  endOfStreet(s, hand, events);
}

function resetStreet(hand: Hand, bigBlind: number) {
  for (const p of hand.players) {
    p.streetBet = 0;
    p.acted = false;
    p.canRaise = true;
  }
  hand.currentBet = 0;
  hand.minRaise = bigBlind;
  hand.lastAggressor = null;
}

function endOfStreet(s: GameState, hand: Hand, events: GameEvent[]) {
  resetStreet(hand, s.config.bigBlind);
  const spec = VARIANTS[hand.variant];
  if (spec.discardAfter === hand.street && needsDiscard(hand)) {
    enterDiscard(hand);
    return;
  }
  if (hand.street === "river") {
    showdown(s, hand, events);
    return;
  }
  enterRunoutOrShowdown(s, hand, events);
}

/** After a settled round: either deal the next street for live betting, or hand over to the timed run-out. */
function enterRunoutOrShowdown(s: GameState, hand: Hand, events: GameEvent[]) {
  const actors = nonFolded(hand).filter(canAct);
  if (actors.length < 2) {
    hand.phase = "runout";
    hand.actor = null;
    for (const p of nonFolded(hand)) p.revealed = true;
    if (hand.street === "river") showdown(s, hand, events);
    return;
  }
  hand.phase = "betting";
  dealNextStreet(s, hand, events);
  hand.actor = nextPlayer(hand, hand.button, canAct)!.seat;
}

function dealNextStreet(s: GameState, hand: Hand, events: GameEvent[]) {
  const i = STREET_ORDER.indexOf(hand.street);
  const next = STREET_ORDER[i + 1];
  if (!next) throw new EngineError("no_street", "No more streets");
  hand.street = next;
  const n = next === "flop" ? 3 : 1;
  for (let k = 0; k < n; k++) hand.board.push(hand.deck.pop()!);
  resetStreet(hand, s.config.bigBlind);
  events.push({ type: "street", street: next, board: [...hand.board] });
}

/** Build main/side pots from total contributions. Folded players contribute but aren't eligible. */
export function computePots(players: HandPlayer[]): Pot[] {
  const levels = [...new Set(players.filter((p) => p.totalBet > 0).map((p) => p.totalBet))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.totalBet, level) - prev);
    const eligible = players.filter((p) => !p.folded && p.totalBet >= level).map((p) => p.seat);
    prev = level;
    if (amount === 0) continue;
    const last = pots[pots.length - 1];
    if (eligible.length === 0 && last) {
      last.amount += amount; // over-contribution by a folded player: goes to the pot below
    } else if (last && sameSet(last.eligible, eligible)) {
      last.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
  }
  return pots;
}

function sameSet(a: number[], b: number[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function showdown(s: GameState, hand: Hand, events: GameEvent[]) {
  hand.phase = "showdown";
  hand.actor = null;
  const spec = VARIANTS[hand.variant];
  const live = nonFolded(hand);
  const pots = computePots(hand.players);
  const result: HandResult = { pots: [], hands: {}, net: {} };
  const contested = live.length > 1;

  if (contested) {
    for (const p of live) {
      const r = evaluateHand(spec.holeRule, p.hole, hand.board);
      result.hands[p.seat] = { name: describeHand(r), score: r.score, cards: r.cards };
      p.revealed = true;
      events.push({ type: "showdown", seat: p.seat, cards: [...p.hole], handName: result.hands[p.seat]!.name });
    }
  }

  // order seats clockwise from the button for odd-chip distribution
  const order = hand.players.map((p) => p.seat);
  const bi = order.indexOf(hand.button);
  const clockwise = [...order.slice(bi + 1), ...order.slice(0, bi + 1)];

  pots.forEach((pot, potIndex) => {
    const elig = pot.eligible.filter((seat) => live.some((p) => p.seat === seat));
    const pr = { amount: pot.amount, winners: [] as HandResult["pots"][number]["winners"] };
    if (elig.length === 1 || !contested) {
      const seat = elig[0] ?? live[0]!.seat;
      const own = hand.players.find((p) => p.seat === seat)!;
      // An uncontested pot that only this player funded is a returned bet, not a win.
      const returned = pot.eligible.length === 1 && hand.players.every((p) => p === own || p.totalBet < own.totalBet);
      pr.winners.push({ seat, amount: pot.amount, handName: result.hands[seat]?.name });
      if (returned && contested) events.push({ type: "returned", seat, amount: pot.amount });
      else events.push({ type: "potAwarded", seat, amount: pot.amount, potIndex, handName: result.hands[seat]?.name });
    } else {
      let best = -1;
      for (const seat of elig) best = Math.max(best, result.hands[seat]!.score);
      const winners = clockwise.filter((seat) => elig.includes(seat) && result.hands[seat]!.score === best);
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const seat of winners) {
        const amt = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd -= 1;
        pr.winners.push({ seat, amount: amt, handName: result.hands[seat]!.name, cards: result.hands[seat]!.cards });
        events.push({ type: "potAwarded", seat, amount: amt, potIndex, handName: result.hands[seat]!.name });
      }
    }
    result.pots.push(pr);
  });

  // pay out
  const total = potTotal(hand);
  for (const p of hand.players) result.net[p.seat] = -p.totalBet;
  for (const pr of result.pots) {
    for (const w of pr.winners) {
      s.seats[w.seat]!.stack += w.amount;
      result.net[w.seat] = (result.net[w.seat] ?? 0) + w.amount;
      const seatRef = s.seats[w.seat]!;
      if (total > seatRef.biggestPot) seatRef.biggestPot = total;
    }
  }
  hand.result = result;
  events.push({ type: "handEnded", handNumber: hand.number });
}
