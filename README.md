# Bink City (Friends Poker)

A hosted, mobile-friendly home-game poker app for 6–8 friends. Join a table by link, play in real time, keep lifetime stats. Runs entirely on the **Cloudflare Workers free plan**.

**Variants:** No-Limit Hold'em, Pot-Limit Omaha (4, 5 and 6 card), PLO Hi-Lo, Irish Hi-Lo, Donk'em and Pineapple (3 cards, discard one after the flop). The host can switch the variant and blinds between hands.

**Extras:** a per-player HUD (VPIP, PFR, 3-bet, AF, WTSD, W$SD for the session and lifetime), hand replays with street-by-street equities, and rabbit hunting.

## Stack

- Cloudflare Workers (TypeScript) serving a React + Vite + Tailwind v4 frontend as static assets
- Two SQLite-backed Durable Objects:
  - `TableDO` — one per table: authoritative game state, WebSocket fan-out (Hibernation API), turn timers via Alarms
  - `AccountsDO` — one global instance: users, sessions, tables registry, session results, leaderboard
- A pure TypeScript game engine (`src/engine`) with its own hand evaluator; no game logic touches Cloudflare APIs, so it is fully unit tested with Vitest

## Develop

```bash
npm install
npm run dev        # Vite build --watch + wrangler dev on http://127.0.0.1:8003
npm test           # engine unit tests (vitest)
npm run smoke      # end-to-end WebSocket smoke test against the dev server
npm run check      # type-check worker + client
```

Open <http://127.0.0.1:8003> in two browsers (or a private window) to play against yourself. `npm run dev:ui` starts a Vite HMR server on port 8013 that proxies `/api` and `/ws` to the Worker.

## Deploy

```bash
npx wrangler login
npm run deploy        # refuses while a game is in play on production
npm run deploy:wait   # waits (up to 2 h) for games to finish, then deploys
npm run deploy:force  # emergency fix: skips the check
```

**No deploys mid-game.** `scripts/deploy-guard.mjs` asks production's `/api/status` how many games are in play. A game counts as in play when a hand is live, or when a session is running or paused with someone connected and activity in the last 20 minutes. The GitHub deploy job runs the same guard with `--wait` for up to 5 hours. To push an urgent fix anyway, run the "CI & Deploy" workflow by hand with **force** ticked, or deploy locally with `npm run deploy:force`. A forced deploy is still safe for the game state: every action is saved before it is acknowledged, and clients reconnect on their own. The risk is a rules change landing between two streets of the same hand.

The first deploy creates the two Durable Object classes via the `v1` migration in `wrangler.jsonc` (`new_sqlite_classes`, as required on the free plan). State lives in Durable Object storage, so stats persist across redeploys.

## How it works

- **Auth** is username + 4–6 digit PIN. PINs are hashed with PBKDF2-SHA256 (100k iterations, per-user salt). Login issues a random 32-byte session token stored in SQLite and set as an `HttpOnly; SameSite=Lax` cookie for 30 days. Failed logins lock the username with exponential backoff after 5 attempts.
- **Privacy:** the server builds a separate view per socket. Hole cards are sent only to their owner until the hand is all-in or reaches showdown. The smoke test asserts this.
- **Timers:** every pending state (action, discard, run-out pause, next-hand delay) is a single Durable Object alarm. No `setTimeout`, so the object hibernates between actions. Client heartbeats use `setWebSocketAutoResponse`, which never wakes the object.
- **Persistence:** game state and table metadata are two JSON rows in a `kv` table, written once per action, plus a compact hand log and per-hand history for later replay.
- **Reconnect:** the client reconnects with exponential backoff and receives the full state on open. A dropped player is auto-folded by the timer and sits out from the next hand until they return.
- **Session end:** the host ends the session; each player's buy-in, cash-out, net, hands and biggest pot are written to `AccountsDO`, which powers the leaderboard and profile pages.

## House games and fun stuff

- **Ghost player** (vote-in, majority of seated players): a ghost is dealt into every hand but never bets. It always sees showdown and can only win there, and only the main pot. When it wins, its whole stack rides into the next hand's main pot as dead money (shown as a separate 👻 pot; it never changes pot-limit bet sizing). When a player beats it, its stack resets to 0 and that player takes the dead money too. The ghost can only be voted off while its stack is 0. The ghost shows its cards at the end of every hand. If the session ends while the ghost holds chips, they are split equally between the players still seated (odd chips to the lowest seats), so the session's nets always sum to zero.
- **Multiple boards / Squid Game 🦑** (host setting, 1–3 boards): every pot is split equally between boards. With Squid Game on, when the river is dealt the board with the lowest river card is eliminated before river betting (ties: turn, then flop cards last to first, then river suit). Works with every variant as long as the deck has enough cards; the engine deals fewer boards (or refuses to start) when it does not.
- **Bad beat splash 💔**: at showdown the engine enumerates the river for every loser. A loser who was at least 80% to win with one card to come gets a full-screen "You got rivered" moment for everyone (the ghost can be the victim too) and the next hand waits a little longer.
- **Running it twice** (host setting "Run it up to", default 3): when the betting is over with cards to come, everyone still in the hand picks once, twice or three times within 12 seconds. The lowest pick wins and a missing pick counts as once. Each run becomes its own board that shares the cards already dealt, and every pot splits equally between runs (odd chips to the first run). Not offered on multi-board hands or while a Pineapple discard is still to come.
- **PLO Hi-Lo (PLO8)**: Omaha with an eight-or-better low. High and low are each made with exactly 2 hole cards and 3 board cards; half of every pot (per board or run) goes to the best high and half to the best qualifying low, the odd chip to the high, and the high scoops when no low qualifies. Equity in replays counts the split. Bad-beat detection is skipped for hi-lo.
- **Irish Hi-Lo**: 5 hole cards, pot-limit, eight-or-better split like PLO8, but each half uses either 2 hole + 3 board or 3 hole + 2 board (whichever is best, chosen separately for high and low). A-2-3 in hand makes a low with only two low cards on the board.
- **Donk'em**: 3 hole cards, exactly 2 used (Omaha-style 2 + 3), pot-limit. The board comes 2 (flop), 2 (turn), 1 (river) with betting after each, then a sixth "super river" card is dealt with no betting before a contested showdown.
- **Red river** (host toggle, any single-board game): when the river is red, cards keep coming until a black one lands; one betting round after. Red-river hands are never run twice and multi-board tables can't use it. The table badge shows a red dot.
- **Short deck** (host toggle "Short deck (6+)", every game except PLO8): 2s through 5s removed (36 cards). Triton rules: a flush beats a full house, three of a kind beats a straight, and A-6-7-8-9 is a straight. Fewer seats and boards fit; the table badge shows "6+".
- **Straddle** (host setting "Allow straddles", on by default; player toggle "Straddle under the gun" in the You menu): with 3+ players, the player left of the big blind posts 2× the big blind before the deal when opted in and their stack covers it. Preflop action starts to their left, they act last with the option, and the minimum raise is to double the straddle.
- **Dealer's choice** (host setting: off, each hand, each orbit): before the deal, the player about to get the button picks the game from those that fit the table. An orbit lasts one hand per player at the table. No pick in 20 seconds keeps the current game.
- **Last action badges**: each player's most recent action this street (Check, Call 20, Raise 60, All-in) sits on top of their avatar until the next street.
- **Feedback button** (lobby header and the table's "You" menu): bug reports and ideas become GitHub issues on `FEEDBACK_REPO`, labelled `bug` or `enhancement` plus `from-app`. Filing needs a fine-grained GitHub token with Issues read/write on that repo, stored with `npx wrangler secret put GITHUB_TOKEN`. Without the token the button opens a prefilled GitHub "new issue" page instead. Limited to 5 per player per hour.
- **How to play**: tap the game badge at the top of the table for rules of every game plus the house rules in force. The rules text lives in `src/shared/guide.ts`.
- **Taunts**: a smiley button sends one of 12 canned taunts as a speech bubble over your seat for a few seconds (one every 6 seconds).
- **Sounds**: synthesised chips, cards, all-in, win, Squid elimination, ghost entrance and bad-beat womp via WebAudio; mute per device with the bell.

## Design

Miami Vice: deep navy night base, hot pink (`--color-brand`) and cyan (`--color-cyan`) neon, sunset orange on primary actions, teal felt. Sunset gold (`--color-gold`) is reserved for chips, stacks and pots. Display face is Outfit (uppercase, tracked wordmark), body is Inter, both from Google Fonts with `display=swap`. The mark is a cyan four-notch chip ring around a striped sunset sun (`Logo` in `src/client/pages/Login.tsx`, favicon inline in `index.html`), centered and large on the login and lobby. App name and tagline live in `src/shared/brand.ts`.

## Feature flags (kill switches)

Every optional feature has an operator flag in `src/shared/flags.ts` (HUD, replays, replay equities, rabbit hunting, chat, Omaha/Pineapple variants, leaderboard, signups, creating tables, sounds, ghost player, multi-board/Squid Game, bad beat splash, taunts). All default to on. Admins see a **Feature flags** section on their profile page; flipping one is stored in `AccountsDO` and pushed to every open table at once, so a misbehaving feature can be switched off mid-session without a redeploy. Server-enforced flags also reject the underlying messages/API calls, not just hide the UI.

Admins are bound to account ids, never usernames, and signing up never grants admin. They come from the `admins` table in `AccountsDO` or the `ADMIN_USER_IDS` var in `wrangler.jsonc`. The account that was admin under the old "first account" rule was carried over once. To bootstrap an admin on a fresh deployment, set a long random `ADMIN_BOOTSTRAP_TOKEN` secret, sign in, `POST /api/admin/claim {"token": ...}`, then delete the secret. `.dev.vars` sets a dev-only token so the smoke test can do the same.

## HUD, replays, equity and rabbit hunting

- **HUD:** tap the bar-chart icon at the table to show a mini strip under each player (VPIP/PFR · AF · hands). Tap any avatar for the full session + lifetime table. Session counters are computed in `TableDO` from each finished hand (`src/engine/hud.ts`) and added to lifetime totals in `AccountsDO` when the host ends the session.
- **Replays:** the Log/Chat panel has a Hands tab listing every finished hand. A replay shows each street's board, the players still in, their actions, and the result. Nothing is revealed while a hand is live.
- **Equities and hidden cards are locked** until a majority of the players dealt into that hand vote to reveal (or the host turns on "Auto-reveal replays"). Your own cards and anything shown at the table are always visible. Equities are computed in a Web Worker on the client (`src/engine/equity.ts`): exact enumeration on the flop/turn/river, Monte Carlo preflop.
- **Rabbit hunting:** when a hand ends before the river, anyone seated can tap "Rabbit hunt" to show the cards that would have come (the deck is fixed at the deal). The host can turn this off.

## Free-tier budget

Expected usage for one 8-player, 4-hour session (~250 hands, ~25 actions/hand):

| Resource | Free daily limit | One 4-hour game | Share |
| --- | ---: | ---: | ---: |
| Worker requests (assets + API) | 100,000 | ~2,000 | 2% |
| Durable Object requests (WS messages count 20:1, alarms 1:1) | 100,000 | ~2,500 | 2.5% |
| DO duration (hibernating between actions) | 13,000 GB-s | < 500 GB-s | < 4% |
| SQLite rows written | 100,000 | ~20,000 | 20% |
| SQLite rows read | 5,000,000 | ~30,000 | < 1% |

Row writes are the tightest budget: each action persists ~3 rows (state, meta, log line) and each finished hand adds one replay record. Two simultaneous long sessions in one day still fit. If you host games most nights, consider batching log writes per street.

## Project layout

```
src/engine/    pure game engine: cards, evaluator, variants, betting/pots/showdown
src/shared/    protocol types shared by worker and client
src/worker/    Worker entry, AccountsDO, TableDO
src/client/    React app (pages: Login, Lobby, Table, Profile)
test/          vitest engine tests
scripts/       smoke.mjs end-to-end check
public/        built client (generated, git-ignored)
```

## Out of scope (for now)

Real money, tournaments, OAuth, spectator chat for non-players, hand replay UI (hand history is already stored per table).

## Debugging

Server logs are structured JSON in Cloudflare Workers Logs (dashboard: Workers & Pages → poker → Logs, or `npx wrangler tail poker --format json`). Filter by `table = "<CODE>"` to follow one game. Admins can open `/api/admin/tables/<CODE>/debug` for a snapshot of a table's server state. See `AGENTS.md` for the event list.
