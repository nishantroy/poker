import type { Variant } from "@engine/variants";

/** Plain-language rules for each game and house rule. Shown in the table's rules sheet, the create sheet and the dealer's choice picker. */
export interface GameGuide {
  /** One line for pickers. */
  tagline: string;
  /** How a hand works. */
  rules: string[];
  /** Things people coming from Hold'em get wrong. */
  watchOut: string[];
}

export const GAME_GUIDE: Record<Variant, GameGuide> = {
  nlhe: {
    tagline: "Two cards each. Bet any amount.",
    rules: [
      "Everyone gets 2 cards. Five shared cards come out: the flop (3), the turn (1) and the river (1).",
      "Your hand is the best 5 cards from your 2 plus the 5 on the board. You can use both, one or none of yours.",
      "No-limit: you can bet anything from the big blind up to your whole stack at any time.",
    ],
    watchOut: ["Kickers matter: with the same pair, the higher side card wins."],
  },
  plo: {
    tagline: "Four cards each. Use exactly two. Bets capped at the pot.",
    rules: [
      "Everyone gets 4 cards, then the same flop, turn and river as Hold'em.",
      "Your hand is exactly 2 of your cards plus exactly 3 from the board. Never more, never fewer.",
      "Pot-limit: the biggest raise is the size of the pot after you call.",
    ],
    watchOut: [
      "Four hearts in your hand plus one on the board is not a flush. You need 3 of the suit on the board.",
      "A board pair or four to a straight does not play for you on its own. Hands run big, so the nuts matter.",
    ],
  },
  plo5: {
    tagline: "Five cards each. Use exactly two. Pot-limit.",
    rules: [
      "Like Omaha, but everyone gets 5 cards.",
      "Your hand is still exactly 2 of yours plus exactly 3 from the board.",
      "Pot-limit betting.",
    ],
    watchOut: ["With more cards in play, straights and flushes are common. Second-best hands lose a lot."],
  },
  plo6: {
    tagline: "Six cards each. Use exactly two. Pot-limit.",
    rules: [
      "Like Omaha, but everyone gets 6 cards.",
      "Your hand is still exactly 2 of yours plus exactly 3 from the board.",
      "Pot-limit betting. Up to 7 players, since 8 would use up the deck.",
    ],
    watchOut: ["Expect someone to have the nuts. Top set is often behind on a wet board."],
  },
  pineapple: {
    tagline: "Three cards, throw one away before the flop.",
    rules: [
      "Everyone gets 3 cards and bets preflop.",
      "After preflop betting, each player discards one card. Then it plays exactly like Hold'em.",
      "No-limit betting. Use any of your 2 remaining cards with the board.",
    ],
    watchOut: ["Pick the two that work together. Suited and connected beats two random high cards."],
  },
  "crazy-pineapple": {
    tagline: "Three cards, throw one away after the flop.",
    rules: [
      "Everyone gets 3 cards and bets preflop and on the flop with all three.",
      "After flop betting, each player discards one card. Turn and river play like Hold'em.",
      "No-limit betting.",
    ],
    watchOut: ["You see the flop before you discard, so keep the two that hit it best."],
  },
};

export interface HouseRule {
  id: string;
  title: string;
  body: string[];
}

export const HOUSE_RULES: HouseRule[] = [
  {
    id: "runs",
    title: "Running it twice",
    body: [
      "When the betting is over and cards are still to come, everyone in the hand picks once, twice or three times.",
      "The lowest pick wins, so running it more than once needs everyone to agree. No pick in 12 seconds counts as once.",
      "Each run deals the rest of the board fresh and plays for an equal share of every pot.",
    ],
  },
  {
    id: "dealers",
    title: "Dealer's choice",
    body: [
      "The player about to get the button picks the game, either for that one hand or for a full orbit.",
      "An orbit lasts one hand per player at the table. Then the next dealer picks.",
      "No pick in 20 seconds keeps the current game.",
    ],
  },
  {
    id: "ghost",
    title: "Ghost player",
    body: [
      "Voted in by a majority. The ghost is dealt in every hand, never bets, and can only win at showdown.",
      "It only plays for the main pot. If everyone else folds to one player, the ghost loses.",
      "When it wins, its stack rides as dead money in the next main pot until someone beats it.",
      "If the session ends while the ghost holds chips, they are split equally between the players still seated.",
    ],
  },
  {
    id: "squid",
    title: "Multiple boards & Squid Game",
    body: [
      "With two or three boards, every pot is split equally between the boards.",
      "Squid Game: when the river comes, the board with the lowest river card is eliminated before river betting. Ties go to the turn, then the flop from last card to first.",
    ],
  },
  {
    id: "rabbit",
    title: "Rabbit hunting",
    body: ["After a hand ends early, anyone seated can reveal the cards that would have come. It is just for fun and changes nothing."],
  },
];
