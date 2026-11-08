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
- Taunts and ghost votes are TableDO-only (`taunt`, `ghostVote` messages). Everything new is flag-gated; see `src/shared/flags.ts`.

## Validation
- `npm run check` (types), `npm test` (engine), `npm run smoke` (needs `npm run dev` running).

## Debugging (logs)
- Workers Logs is on (`observability` in `wrangler.jsonc`). Every server log line is one JSON object from `slog()` in `src/worker/slog.ts`: `evt`, `level`, and for table events `table` (code), `hand`, `phase`, `status`.
- Live: `npx wrangler tail poker --format json` (filter with `--search <TABLECODE>`). History (about 3 days): Cloudflare dashboard → Workers & Pages → poker → Logs, filter e.g. `table = "ABC123"`.
- Events: `ws.connect`/`ws.close`, `msg.<type>` for every client message (actions include `seq`/`actionSeq`/`actor`), `msg.rejected` (EngineError code), `msg.crash`, `hand.start`/`hand.skip` (with `reason` and a seat snapshot)/`hand.end`, `seat.autoSitOut`, `timer.set`, `alarm`/`alarm.noop`/`alarm.crash`, `flags.apply`, `session.end`, `table.log` (mirrors the in-game log text), `auth.*`, `table.create`, `admin.flag`, `api.crash`, `client.error` (browser errors posted to `/api/client-log`).
- Snapshot of one table's server state (admin only, live hole cards and deck hidden): `GET /api/admin/tables/<CODE>/debug`. Returns meta, game state, pending alarm time, connected sockets and the last 150 in-game log lines. The admin can open it in a logged-in browser and paste the JSON.
- Never log PINs, session tokens or live hole cards.
