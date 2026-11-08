// Refuses to deploy while a game is being played on production, so a new build never lands mid-session.
//   node scripts/deploy-guard.mjs              exit 1 if a game is in play
//   node scripts/deploy-guard.mjs --wait       poll every minute until it's clear (default up to 120 min)
//   node scripts/deploy-guard.mjs --wait --max-wait 30
//   DEPLOY_FORCE=1 or --force                  skip the check (an emergency fix)
// Production URL: DEPLOY_URL, default https://poker.eightdudes.workers.dev
const args = process.argv.slice(2);
const URL_BASE = process.env.DEPLOY_URL ?? "https://poker.eightdudes.workers.dev";
const force = args.includes("--force") || process.env.DEPLOY_FORCE === "1";
const wait = args.includes("--wait");
const mi = args.indexOf("--max-wait");
const maxWaitMin = mi >= 0 ? Number(args[mi + 1]) : 120;

if (force) {
  console.log("deploy-guard: forced, skipping the live-game check.");
  process.exit(0);
}

async function check() {
  const r = await fetch(`${URL_BASE}/api/status`, { headers: { "cache-control": "no-cache" } });
  if (r.status === 404) return { unknown: true };
  if (!r.ok) throw new Error(`status endpoint returned ${r.status}`);
  return r.json();
}

const started = Date.now();
for (;;) {
  let s;
  try {
    s = await check();
  } catch (e) {
    console.error(`deploy-guard: could not reach ${URL_BASE} (${e.message}). Refusing to deploy blind. Use --force to override.`);
    process.exit(1);
  }
  if (s.unknown) {
    console.error("deploy-guard: production has no status endpoint (older build), so it can't tell whether a game is in play. Not deploying. Check by hand, then use --force.");
    process.exit(1);
  }
  if (s.sessionsLive === 0) {
    console.log(`deploy-guard: no games in play (${s.tables} open tables checked). Clear to deploy.`);
    process.exit(0);
  }
  const msg = `${s.sessionsLive} game${s.sessionsLive === 1 ? "" : "s"} in play, ${s.handsLive} hand${s.handsLive === 1 ? "" : "s"} live right now.`;
  if (!wait) {
    console.error(`deploy-guard: ${msg} Not deploying. Re-run with --wait to deploy when they finish, or --force for an emergency fix.`);
    process.exit(1);
  }
  const waited = (Date.now() - started) / 60_000;
  if (waited >= maxWaitMin) {
    console.error(`deploy-guard: ${msg} Still busy after ${maxWaitMin} min. Giving up.`);
    process.exit(1);
  }
  console.log(`deploy-guard: ${msg} Checking again in 60s (waited ${waited.toFixed(0)} of ${maxWaitMin} min).`);
  await new Promise((r) => setTimeout(r, 60_000));
}
