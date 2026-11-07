# Friends Poker

A hosted, mobile-friendly home-game poker app for 6–8 friends. Join a table by link, play in real time, keep lifetime stats. Runs entirely on the **Cloudflare Workers free plan**.

**Variants:** No-Limit Hold'em, Pot-Limit Omaha (4, 5 and 6 card), Pineapple and Crazy Pineapple. The host can switch the variant and blinds between hands.

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

## Free-tier budget

Expected usage for one 8-player, 4-hour session (~250 hands, ~25 actions/hand):

| Resource | Free daily limit | One 4-hour game | Share |
| --- | ---: | ---: | ---: |
| Worker requests (assets + API) | 100,000 | ~2,000 | 2% |
| Durable Object requests (WS messages count 20:1, alarms 1:1) | 100,000 | ~2,500 | 2.5% |
| DO duration (hibernating between actions) | 13,000 GB-s | < 500 GB-s | < 4% |
| SQLite rows written | 100,000 | ~20,000 | 20% |
| SQLite rows read | 5,000,000 | ~30,000 | < 1% |

Row writes are the tightest budget: each action persists ~3 rows (state, meta, log line). Two simultaneous long sessions in one day still fit. If you host games most nights, consider batching log writes per street.

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
