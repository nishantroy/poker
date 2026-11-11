# Bink City — agent notes

See the root `/Users/nishantroy/code/AGENTS.md` for shared conventions (ports, worktrees).

## Ports
- `8003` — `wrangler dev` (Worker + static assets). Start: `npm run dev`
- `8013` — Vite HMR dev server (`npm run dev:ui`), proxies `/api` and `/ws` to 8003

## Rules of the house
- `src/engine` must stay free of Cloudflare and DOM APIs. Every rules change needs a test in `test/`.
- Durable Objects are SQLite-backed (`new_sqlite_classes`). Never call `ws.accept()`; use `ctx.acceptWebSocket` and the hibernation handlers. Never `setTimeout` in a DO; schedule alarms via `TableDO.schedule()`.
- Hole cards are only ever placed in a view by `TableDO.viewFor()`. Keep it that way; `scripts/smoke.mjs` asserts privacy.
- Shared types live in `src/shared/protocol.ts`; the client never imports from `src/worker`.
- New optional features get a flag in `src/shared/flags.ts` (default on), enforced server-side where the feature has a server half (`requireFlag` in `TableDO.handle`, `flags.*` checks in the Worker router) and hidden in the UI via `view.flags` (table) or `useAuth().flags` (elsewhere).
- Path aliases (`@engine/*`, `@shared/*`) are declared in `tsconfig.base.json`, `vite.config.ts`, `vitest.config.ts` and `wrangler.jsonc` (`alias`). Add new engine modules to the wrangler alias list.

## House games
- Ghost player, multi-board/Squid Game and bad beats live in the engine (`src/engine/engine.ts`: `startHand` options, `dealNextStreet`, `squidLoser`, `showdown`, `detectBadBeat`). The ghost is `GHOST_SEAT = -1` in results/events and never occupies a table seat. `hand.boards` is always an array; board 0 is the only board for normal games.
- Running it twice is engine-level: `offerRuns` opens the `runChoice` phase, `chooseRuns`/`timeout` resolve it, and several runs become several entries in `hand.boards` (so showdown's equal split per board pays each run). `hand.runs > 1` means the boards are runs, not a multi-board game: no Squid elimination.
- Dealer's choice is TableDO-only (`openGameChoice`/`finishGameChoice`, `chooseGame` message, `chooseGame` timer). The engine helps with `nextButtonSeat` and `StartOptions.firstButton`.
- Game and house-rule explanations live in `src/shared/guide.ts`; update them with any rules change.
- Tournaments are single-table sit-and-gos. The rules that are pure maths live in `src/engine/tournament.ts` (blind schedule `blindsAt`/`levelAt`, `prizeTable`, `bustPlaces`, `settle`); everything with state is TableDO-only (`meta.tourney`: level clock that counts playing time only, `away` players, finishing places; `startTourney`, `tourneyBeforeHand`, `tourneyAfterHand`, `tourneyResults`, the `tournament` host message, the `finish` timer). A tournament table never has antes, straddles, several runs, the ghost, rebuys, late seats or kicks after the start (`tourneyRules` and the guards in `handle`). Nobody leaves a running tournament with chips: stand/sit out/disconnect/timeout mark the player `away` (still dealt in, auto check/fold, blinds keep going in). Results and the leaderboard are in buy-in units, not chips; prizes must always add up to the pool.
- Taunts and ghost votes are TableDO-only (`taunt`, `ghostVote` messages). Everything new is flag-gated; see `src/shared/flags.ts`.

## Validation
- `npm run check` (types), `npm test` (engine), `npm run smoke` (needs `npm run dev` running).

## Deploying
- Use `npm run deploy`. It runs `scripts/deploy-guard.mjs` first and refuses while a game is in play on production (`/api/status`). Never use `deploy:force` or `wrangler deploy` directly unless the user explicitly asks for an emergency deploy.

## Debugging (logs)
- Workers Logs is on (`observability` in `wrangler.jsonc`). Every server log line is one JSON object from `slog()` in `src/worker/slog.ts`: `evt`, `level`, and for table events `table` (code), `hand`, `phase`, `status`.
- Live: `npx wrangler tail poker --format json` (filter with `--search <TABLECODE>`). History (about 3 days): Cloudflare dashboard → Workers & Pages → poker → Logs, filter e.g. `table = "ABC123"`.
- Events: `ws.connect`/`ws.close`, `msg.<type>` for every client message (actions include `seq`/`actionSeq`/`actor`), `msg.rejected` (EngineError code), `msg.crash`, `hand.start`/`hand.skip` (with `reason` and a seat snapshot)/`hand.end`, `seat.autoSitOut`, `timer.set`, `alarm`/`alarm.noop`/`alarm.crash`, `flags.apply`, `session.end`, `table.log` (mirrors the in-game log text), `auth.*`, `table.create`, `admin.flag`, `api.crash`, `client.error` (browser errors posted to `/api/client-log`).
- Snapshot of one table's server state (admin only, live hole cards and deck hidden): `GET /api/admin/tables/<CODE>/debug`. Returns meta, game state, pending alarm time, connected sockets and the last 150 in-game log lines. The admin can open it in a logged-in browser and paste the JSON.
- Never log PINs, session tokens or live hole cards.

## Integrity rules (cheating prevention)
- Treat every WebSocket message and HTTP body as hostile. Validate types (`Number.isInteger` for seats and counts) before any state change, and never mutate `meta` (ledger, votes, departed) before the last check that can throw.
- Nobody is ever folded once their chips are all in or the betting is over: kicks never fold, stands only fold a player during their own betting/discard round. Leaving mid-hand is deferred to showdown (`meta.leaving`), and ending a session mid-hand waits for showdown (`meta.endPending`).
- Cards leave the server only through `viewFor`, `recordView` and the admin `debugSnapshot`, and only when the table has seen them (revealed at showdown/all-in, shown by choice via `show`, or unlocked replays). The deck is never sent.
- `npm run smoke` includes the known attack sequences (repeated stand while folded, fractional seats, kick/end during a run-out). Session nets must always sum to zero; add an assertion for any new money path.
