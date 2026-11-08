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
  plo8: {
    tagline: "Omaha where the best high and the best low split the pot.",
    rules: [
      "Everyone gets 4 cards. Like Omaha, every hand uses exactly 2 of your cards and exactly 3 from the board, separately for high and for low.",
      "Half the pot goes to the best normal (high) hand and half to the best low.",
      "A low is 5 different ranks, all 8 or lower, with the ace counting low. Straights and flushes don't spoil a low, so A-2-3-4-5 (the wheel) is the best low and can win the high too.",
      "If nobody has a low, the best high takes the whole pot. Lows are compared from the top card down: 7-5-4-3-2 beats 8-4-3-2-A.",
    ],
    watchOut: [
      "You can win both halves (scoop) with different pairs of your cards.",
      "If the board has fewer than 3 different cards 8 or lower, no low is possible.",
      "Getting quartered (splitting the low with someone else) can lose you money even when you win.",
    ],
  },
  irish: {
    tagline: "Five cards, hi-lo split. Use 2 or 3 of yours for each half.",
    rules: [
      "Everyone gets 5 cards. Pot-limit betting, with a flop, turn and river like Omaha.",
      "Each hand is 5 cards: either 2 of yours with 3 from the board, or 3 of yours with 2 from the board. High and low pick whichever works best, separately.",
      "Half the pot goes to the best high and half to the best low. A low is 5 different ranks, all 8 or lower, with the ace counting low. No low means the high takes it all.",
      "Because you can use 3 of your own cards, a hand like A-2-3 needs only two low cards on the board to make a low.",
    ],
    watchOut: [
      "Holding A-2-3 (or A-2-4) is the dream start: it makes lows on boards where Omaha players can't.",
      "You can scoop by winning high with one set of cards and low with another.",
      "Lows get quartered often, since plenty of players hold an ace and a deuce.",
    ],
  },
  donkem: {
    tagline: "Three cards, use exactly two. A 2-2-1 board plus a free super river.",
    rules: [
      "Everyone gets 3 cards. Your hand is exactly 2 of yours plus exactly 3 from the board, like Omaha.",
      "The board comes 2 cards (flop), then 2 more (turn), then 1 (river), with a betting round after each. Pot-limit.",
      "After the river betting, a sixth card, the super river, is dealt with no betting before the showdown.",
    ],
    watchOut: [
      "The super river can change everything after the betting is done, so a made hand on the river isn't safe.",
      "With 3 hole cards and exactly 2 to use, you'll often have a choice of which pair of cards plays.",
    ],
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
    id: "straddle",
    title: "Straddle",
    body: [
      "With 3 or more players, the player to the left of the big blind can post a straddle of 2× the big blind before the cards are dealt.",
      "Preflop action then starts to the straddler's left, and the straddler acts last with the option to raise. The smallest raise is to double the straddle.",
      "Turn it on in your menu (\"Straddle under the gun\"). It applies every time you're in that seat until you turn it off.",
    ],
  },
  {
    id: "shortDeck",
    title: "Short deck",
    body: [
      "A host setting that works with every game except PLO Hi-Lo: the 2s through 5s are removed, leaving 36 cards.",
      "A flush beats a full house, three of a kind beats a straight, and A-6-7-8-9 counts as a straight (the ace plays low).",
      "Fewer cards also means fewer players and boards fit, so 5- and 6-card Omaha seat fewer people.",
    ],
  },
  {
    id: "redRiver",
    title: "Red river",
    body: [
      "A host setting for any single-board game. When the river card is red (hearts or diamonds), another card is dealt, and this repeats until a black card lands.",
      "All of those cards are part of the board. There is one betting round once the black card is out.",
      "Hands are made the usual way for the game, from the bigger board. Red-river hands are always run once.",
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
