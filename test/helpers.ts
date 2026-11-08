import { createGame, seatPlayer, startHand, applyAction, type GameState, type TableConfig, type GameEvent, type Card, type Rng, type Variant } from "@engine/index";

export const baseConfig: TableConfig = {
  variant: "nlhe", smallBlind: 5, bigBlind: 10, ante: 0, startingStack: 1000, maxSeats: 8, actionTimerMs: 30000, boards: 1, squid: false, maxRuns: 1, dealersChoice: "off", straddle: true, shortDeck: false,
};

export function table(stacks: number[], cfg: Partial<TableConfig> = {}): GameState {
  let s = createGame({ ...baseConfig, ...cfg });
  stacks.forEach((st, i) => {
    s = seatPlayer(s, i, `p${i}`, `P${i}`, st);
  });
  return s;
}

/** rng that places the button at `button` for the first hand and leaves the deck unshuffled unless a deck is given. */
export function fixedRng(button: number): Rng {
  let first = true;
  return (n) => {
    if (first) { first = false; return button; }
    return n - 1; // Fisher-Yates with j = i leaves the array untouched
  };
}

/** Start a hand with a rigged deck: the cards listed are dealt in order (sb first), then board. */
export function startRigged(state: GameState, button: number, cards?: string): ReturnType<typeof startHand> {
  const res = startHand(state, fixedRng(button));
  if (cards) {
    const want = cards.split(/\s+/).filter(Boolean) as Card[];
    const deck = res.state.hand!.deck;
    // Rebuild: the engine pops from the end of the deck. We re-deal by resetting hole/board and the deck.
    const h = res.state.hand!;
    const fresh = [...deck, ...h.players.flatMap((p) => p.hole), ...(h.ghost?.hole ?? [])]; // all 52 again (hole cards taken back)
    const rest = fresh.filter((c) => !want.includes(c));
    h.deck = [...rest, ...want.slice().reverse()];
    const holeN = h.players[0]!.hole.length;
    for (const p of h.players) p.hole = [];
    // redeal in the same order as the engine: starting at sb, round robin, then the ghost
    const order: number[] = [];
    const idx = h.players.findIndex((p) => p.seat === h.smallBlindSeat);
    for (let i = 0; i < h.players.length; i++) order.push((idx + i) % h.players.length);
    for (let c = 0; c < holeN; c++) for (const i of order) h.players[i]!.hole.push(h.deck.pop()!);
    if (h.ghost) {
      h.ghost.hole = [];
      for (let c = 0; c < holeN; c++) h.ghost.hole.push(h.deck.pop()!);
    }
  }
  return res;
}

export function act(state: GameState, seat: number, type: Parameters<typeof applyAction>[2]["type"], amount?: number) {
  return applyAction(state, seat, { type, amount });
}

export function stacks(s: GameState): number[] {
  return s.seats.filter((x) => !!x).map((x) => x!.stack);
}

export function awards(events: GameEvent[]) {
  return events.filter((e) => e.type === "potAwarded").map((e) => (e.type === "potAwarded" ? [e.seat, e.amount] : null));
}

export const v = (x: Variant) => x;
