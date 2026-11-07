# Friends Poker — agent notes

See the root `/Users/nishantroy/code/AGENTS.md` for shared conventions (ports, worktrees).

## Ports
- `8003` — `wrangler dev` (Worker + static assets). Start: `npm run dev`
- `8013` — Vite HMR dev server (`npm run dev:ui`), proxies `/api` and `/ws` to 8003

## Rules of the house
- `src/engine` must stay free of Cloudflare and DOM APIs. Every rules change needs a test in `test/`.
- Durable Objects are SQLite-backed (`new_sqlite_classes`). Never call `ws.accept()`; use `ctx.acceptWebSocket` and the hibernation handlers. Never `setTimeout` in a DO; schedule alarms via `TableDO.schedule()`.
- Hole cards are only ever placed in a view by `TableDO.viewFor()`. Keep it that way; `scripts/smoke.mjs` asserts privacy.
- Shared types live in `src/shared/protocol.ts`; the client never imports from `src/worker`.
- Path aliases (`@engine/*`, `@shared/*`) are declared in `tsconfig.base.json`, `vite.config.ts`, `vitest.config.ts` and `wrangler.jsonc` (`alias`). Add new engine modules to the wrangler alias list.

## Validation
- `npm run check` (types), `npm test` (engine), `npm run smoke` (needs `npm run dev` running).
