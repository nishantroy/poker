# Friends Poker

A hosted, mobile-friendly home-game poker app for 6–8 friends. Join a table by link, play in real time, keep lifetime stats. Runs entirely on the **Cloudflare Workers free plan**.

**Variants:** No-Limit Hold'em, Pot-Limit Omaha (4, 5 and 6 card), Pineapple and Crazy Pineapple. The host can switch the variant and blinds between hands.

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
npm run deploy     # = npm run build && wrangler deploy
```

The first deploy creates the two Durable Object classes via the `v1` migration in `wrangler.jsonc` (`new_sqlite_classes`, as required on the free plan). State lives in Durable Object storage, so stats persist across redeploys.

## How it works

- **Auth** is username + 4–6 digit PIN. PINs are hashed with PBKDF2-SHA256 (100k iterations, per-user salt). Login issues a random 32-byte session token stored in SQLite and set as an `HttpOnly; SameSite=Lax` cookie for 30 days. Failed logins lock the username with exponential backoff after 5 attempts.
- **Privacy:** the server builds a separate view per socket. Hole cards are sent only to their owner until the hand is all-in or reaches showdown. The smoke test asserts this.
- **Timers:** every pending state (action, discard, run-out pause, next-hand delay) is a single Durable Object alarm. No `setTimeout`, so the object hibernates between actions. Client heartbeats use `setWebSocketAutoResponse`, which never wakes the object.
- **Persistence:** game state and table metadata are two JSON rows in a `kv` table, written once per action, plus a compact hand log and per-hand history for later replay.
- **Reconnect:** the client reconnects with exponential backoff and receives the full state on open. A dropped player is auto-folded by the timer and sits out from the next hand until they return.
- **Session end:** the host ends the session; each player's buy-in, cash-out, net, hands and biggest pot are written to `AccountsDO`, which powers the leaderboard and profile pages.

## House games and fun stuff

- **Ghost player** (vote-in, majority of seated players): a ghost is dealt into every hand but never bets. It always sees showdown and can only win there, and only the main pot. When it wins, its whole stack rides into the next hand's main pot as dead money (shown as a separate 👻 pot; it never changes pot-limit bet sizing). When a player beats it, its stack resets to 0 and that player takes the dead money too. The ghost can only be voted off while its stack is 0. The ghost shows its cards at the end of every hand.
- **Multiple boards / Squid Game 🦑** (host setting, 1–3 boards): every pot is split equally between boards. With Squid Game on, when the river is dealt the board with the lowest river card is eliminated before river betting (ties: turn, then flop cards last to first, then river suit). Works with every variant as long as the deck has enough cards; the engine deals fewer boards (or refuses to start) when it does not.
- **Bad beat splash 💔**: at showdown the engine enumerates the river for every loser. A loser who was at least 80% to win with one card to come gets a full-screen "You got rivered" moment for everyone (the ghost can be the victim too) and the next hand waits a little longer.
- **Taunts**: a smiley button sends one of 12 canned taunts as a speech bubble over your seat for a few seconds (one every 6 seconds).
- **Sounds**: synthesised chips, cards, all-in, win, Squid elimination, ghost entrance and bad-beat womp via WebAudio; mute per device with the bell.

## Feature flags (kill switches)

Every optional feature has an operator flag in `src/shared/flags.ts` (HUD, replays, replay equities, rabbit hunting, chat, Omaha/Pineapple variants, leaderboard, signups, creating tables, sounds, ghost player, multi-board/Squid Game, bad beat splash, taunts). All default to on. Admins see a **Feature flags** section on their profile page; flipping one is stored in `AccountsDO` and pushed to every open table at once, so a misbehaving feature can be switched off mid-session without a redeploy. Server-enforced flags also reject the underlying messages/API calls, not just hide the UI.

Admins are the usernames in the `ADMIN_USERS` var in `wrangler.jsonc` (comma-separated) plus the first account ever created. `.dev.vars` sets `ADMIN_USERS=smoke_admin` for local dev so the smoke test can exercise the admin API.

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
