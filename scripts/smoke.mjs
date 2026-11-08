// End-to-end smoke test against a running `npm run dev` (http://127.0.0.1:8003).
// Signs up two users, creates a PLO table, plays an all-in hand over WebSockets,
// checks hole-card privacy, reconnect state, timers, session end and the leaderboard.
//   node scripts/smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://127.0.0.1:8003";
const WS = BASE.replace(/^http/, "ws");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok  ", msg); };

async function login(u, pin) {
  const post = (path) => fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, pin }) });
  let r = await post("/api/login");
  if (r.status === 401) r = await post("/api/signup");
  if (!r.ok) throw new Error(`auth failed ${r.status}`);
  return { cookie: r.headers.get("set-cookie").split(";")[0], user: (await r.json()).user };
}
function connect(who, code) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/ws/table/${code}`, { headers: { cookie: who.cookie } });
    const st = { ws, view: null, errors: [], log: [], ended: null };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "state") st.view = m.view;
      if (m.t === "error") st.errors.push(m);
      if (m.t === "log") st.log.push(...m.lines.map((l) => l.text));
      if (m.t === "ended") st.ended = m.results;
      if (m.t === "hands") st.handsList = m.hands;
      if (m.t === "hand") st.record = m.hand;
      if (m.t === "taunt") (st.taunts ??= []).push(m.taunt);
    };
    ws.onopen = () => res(st);
    ws.onerror = (e) => rej(e);
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
const suffix = Math.random().toString(36).slice(2, 6);
const a = await login(`smoke_a_${suffix}`, "1234");
const b = await login(`smoke_b_${suffix}`, "1234");

const bad = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: a.user.username, pin: "0000" }) });
assert(bad.status === 401, "wrong PIN is rejected");

const r = await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ name: "Smoke", config: { variant: "plo", smallBlind: 1, bigBlind: 2, startingStack: 200, actionTimerMs: 5000 } }) });
const { code } = await r.json();
assert(/^[A-Z0-9]{6}$/.test(code), `table created with code ${code}`);

const A = await connect(a, code), B = await connect(b, code);
send(A, { t: "sit", seat: 0, buyIn: 200 });
send(B, { t: "sit", seat: 3, buyIn: 200 });
await wait(300);
assert(A.view.seats[0]?.name === a.user.username && A.view.seats[3]?.name === b.user.username, "both players seated");
send(B, { t: "start" });
await wait(300);
assert(B.errors.some((e) => e.code === "not_host"), "non-host cannot start");
send(A, { t: "start" });
await wait(500);
assert(A.view.hand?.number === 1, "hand 1 started");
assert(A.view.seats[0].cards.every((c) => typeof c === "string") && A.view.seats[0].cards.length === 4, "I see my 4 PLO hole cards");
assert(A.view.seats[3].cards.every((c) => c === null), "opponent hole cards are hidden");
assert(B.view.seats[0].cards.every((c) => c === null), "my hole cards are hidden from the opponent");

// last action badge
{
  const h = A.view.hand; const c = h.actor === 0 ? A : B; const seat = h.actor;
  send(c, { t: "action", seq: h.actionSeq, action: { type: "call" } });
  await wait(300);
  assert(A.view.seats[seat].lastAction?.type === "call" && B.view.seats[seat].lastAction?.amount > 0, "a player's last action is shown to everyone");
}

// reconnect mid-hand
B.ws.close();
await wait(300);
assert(A.view.seats[3].disconnected === true, "opponent shows as disconnected after socket drop");
const B2 = await connect(b, code);
await wait(300);
assert(B2.view.hand?.number === 1 && B2.view.seats[3].cards.length === 4, "reconnect delivers full state incl. own cards");
assert(A.view.seats[3].disconnected === false, "reconnect clears the disconnected flag");

// play: actor shoves, other calls
for (let i = 0; i < 20 && A.view.hand && A.view.hand.phase !== "showdown"; i++) {
  const h = A.view.hand;
  const me = h.actor === 0 ? A : h.actor === 3 ? B2 : null;
  if (me && h.phase === "betting") send(me, { t: "action", seq: h.actionSeq, action: { type: me.view.me.limits.canRaise ? "allin" : "call" } });
  if (h.phase === "runChoice") for (const [c, seat] of [[A, 0], [B2, 3]]) if (h.runChoice.pending.includes(seat)) send(c, { t: "runs", runs: 1 });
  await wait(350);
}
await wait(3000); // run-out alarms
assert(A.view.hand.phase === "showdown" && A.view.hand.boards[0].length === 5, "all-in hand ran out to showdown via alarms");
assert(B2.view.seats[0].cards.every((c) => typeof c === "string"), "cards revealed at showdown");
const total = A.view.seats.filter(Boolean).reduce((s, x) => s + x.stack, 0);
assert(total === 400, "chips conserved (400)");

// timer: wait for next hand + auto action
await wait(7000);
if (A.view.hand?.number === 2) {
  await wait(6000);
  assert(A.log.some((l) => l.includes("timed out")), "action timer auto-acted");
} else {
  console.log("skip timer check (a player busted)");
}

// ---- replay, votes, rabbit hunt, HUD ----
const hud = A.view.hud;
assert(hud[a.user.username ? a.user.id : ""]?.hands >= 1 && hud[b.user.id]?.hands >= 1, "session HUD counters recorded for both players");
send(A, { t: "listHands" });
await wait(300);
const list = await new Promise((res) => { const i = setInterval(() => { if (A.handsList) { clearInterval(i); res(A.handsList); } }, 50); });
assert(list.length >= 1 && list[0].unlocked === false && list[0].votesNeeded === 2, "hand list shows locked hand needing 2 votes");
send(A, { t: "getHand", number: list[0].number });
await wait(300);
let rec = A.record;
assert(rec && rec.events.length > 5 && rec.players.length === 2, "hand record has full event history");
const bobInRec = rec.players.find((p) => p.playerId === b.user.id);
const aliceInRec = rec.players.find((p) => p.playerId === a.user.id);
assert(aliceInRec.hole.every((c) => typeof c === "string"), "record shows my own cards");
// the first hand went to showdown, so bob's cards were revealed anyway; the locked state is about non-revealed players
send(A, { t: "vote", number: list[0].number });
await wait(300);
assert(A.handsList.find((h) => h.number === list[0].number).votes === 1, "one vote registered");
send(B2, { t: "vote", number: list[0].number });
await wait(300);
assert(A.handsList.find((h) => h.number === list[0].number).unlocked === true, "majority vote unlocks the replay");
send(A, { t: "getHand", number: list[0].number });
await wait(300);
assert(A.record.unlocked && A.record.players.every((p) => p.hole.every((c) => typeof c === "string")), "unlocked record reveals all hole cards");
assert(Array.isArray(A.record.rabbit), "record carries rabbit cards");
if (A.view.hand?.phase === "showdown" && A.view.hand.boards[0].length < 5 && A.view.hand.rabbitAvailable) {
  send(A, { t: "rabbit" });
  await wait(300);
  assert(A.view.hand.rabbit && A.view.hand.rabbit[0].length === 5 - A.view.hand.boards[0].length, "rabbit hunt reveals the remaining board");
} else console.log("skip rabbit check (last hand reached the river)");
send(A, { t: "options", patch: { autoUnlockReplays: true } });
await wait(200);
assert(A.view.options.autoUnlockReplays === true, "host can change table options");

// ----- ghost player, Squid Game, taunts -----
assert(A.view.ghost && A.view.ghost.enabled === false, "ghost is off by default");
send(A, { t: "ghostVote", on: true });
await wait(200);
assert(A.view.ghost.vote && A.view.ghost.vote.votes === 1 && A.view.ghost.vote.needed === 2 && A.view.ghost.vote.voted === true, "one ghost vote registered (needs 2)");
send(B2, { t: "ghostVote", on: true });
await wait(200);
assert(A.view.ghost.enabled === true && A.view.ghost.vote === null, "majority vote summons the ghost");
send(A, { t: "config", patch: { boards: 2, squid: true } });
await wait(200);
assert(A.view.config.boards === 2 && A.view.config.squid === true || (A.view.hand && A.view.hand.phase !== "showdown"), "host set two boards with Squid Game");
// top both players back up so a hand can be dealt, then play one ghost + squid hand
send(A, { t: "rebuy", amount: 200 }); send(B2, { t: "rebuy", amount: 200 });
await wait(200);
if (A.view.rebuyRequests.length) for (const rq of A.view.rebuyRequests) send(A, { t: "approveRebuy", playerId: rq.playerId, approve: true });
await wait(200);
if (A.view.status !== "running") send(A, { t: A.view.status === "paused" ? "resume" : "start" });
await wait(200);
const tauntErrs = A.errors.length;
send(A, { t: "taunt", id: 3 });
await wait(200);
assert(A.errors.length === tauntErrs && B2.taunts && B2.taunts.length === 1 && B2.taunts[0].id === 3 && B2.taunts[0].userId === a.user.id, "taunt broadcast to the table");
send(A, { t: "taunt", id: 4 });
await wait(200);
assert(A.errors.at(-1)?.code === "taunt_cooldown", "taunt cooldown enforced");
// wait for the next hand to start with the ghost and two boards
let ghostHand = null;
for (let i = 0; i < 60 && !ghostHand; i++) {
  await wait(250);
  const h = A.view.hand;
  if (h && h.ghost && h.phase !== "showdown") ghostHand = h;
}
assert(ghostHand && ghostHand.boards.length === 2 && ghostHand.ghost.cards.length === 4 && ghostHand.ghost.cards.every((c) => c === null), `ghost dealt face-down into a two-board PLO hand (status ${A.view.status}, hand ${JSON.stringify(A.view.hand && { n: A.view.hand.number, phase: A.view.hand.phase, boards: A.view.hand.boards.length, ghost: !!A.view.hand.ghost })}, stacks ${A.view.seats.filter(Boolean).map((x) => x.stack)})`);
// play it out: shove/call until showdown
for (let i = 0; i < 20; i++) {
  const h = A.view.hand;
  if (!h || h.phase === "showdown") break;
  const me = h.actor === 0 ? A : h.actor === 3 ? B2 : null;
  if (me && h.phase === "betting" && me.view.me.limits) send(me, { t: "action", seq: h.actionSeq, action: { type: me.view.me.limits.canRaise ? "allin" : "call" } });
  await wait(350);
}
await wait(4500);
const gh = A.view.hand;
assert(gh && gh.phase === "showdown" && gh.boards.every((b) => b.length === 5), "two-board hand ran out to showdown");
assert(gh.eliminated === 0 || gh.eliminated === 1, "Squid Game eliminated one board");
assert(gh.ghost.cards.every((c) => typeof c === "string"), "ghost cards shown at showdown");
const chipsNow = A.view.seats.filter(Boolean).reduce((s, x) => s + x.stack, 0) + A.view.ghost.stack;
const chipsExpected = A.view.seats.filter(Boolean).reduce((s, x) => s + x.totalBuyIn, 0);
assert(chipsNow === chipsExpected, `chips conserved with ghost (${chipsNow})`);
assert(A.log.some((l) => l.includes("Board") && l.includes("eliminated")), "elimination logged");
send(A, { t: "config", patch: { boards: 1 } });

// ----- feature flags -----
const admin = await login("smoke_admin", "1234");
{
  const badClaim = await fetch(`${BASE}/api/admin/claim`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ token: "guess" }) });
  assert(badClaim.status === 403, "admin cannot be claimed with a wrong token");
  const claim = await fetch(`${BASE}/api/admin/claim`, { method: "POST", headers: { "content-type": "application/json", cookie: admin.cookie }, body: JSON.stringify({ token: "dev-only-bootstrap-token-0001" }) }); // ADMIN_BOOTSTRAP_TOKEN in .dev.vars
  assert(claim.ok, "admin granted by the private bootstrap token");
  const fresh = await login(`smoke_new_${suffix}`, "1234");
  const freshMe = await (await fetch(`${BASE}/api/me`, { headers: { cookie: fresh.cookie } })).json();
  assert(freshMe.isAdmin === false, "signing up never grants admin");
}
const setFlag = async (name, enabled) => {
  const r = await fetch(`${BASE}/api/admin/flags`, { method: "PUT", headers: { "content-type": "application/json", cookie: admin.cookie }, body: JSON.stringify({ name, enabled }) });
  if (!r.ok) throw new Error(`setFlag ${name} ${r.status}`);
  return (await r.json()).flags;
};
// a previous aborted run may have left flags off; start clean
for (const [name, on] of Object.entries((await (await fetch(`${BASE}/api/flags`)).json()).flags)) if (!on) await setFlag(name, true);
const meAdmin = await (await fetch(`${BASE}/api/me`, { headers: { cookie: admin.cookie } })).json();
assert(meAdmin.isAdmin === true && meAdmin.flags && meAdmin.flags.chat === true, "admin sees isAdmin and default flags");
const meA = await (await fetch(`${BASE}/api/me`, { headers: { cookie: a.cookie } })).json();
const notAdmin = await fetch(`${BASE}/api/admin/flags`, { method: "PUT", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ name: "chat", enabled: false }) });
assert(meA.isAdmin === true || notAdmin.status === 403, "non-admin cannot change flags");
try {
  const f1 = await setFlag("chat", false);
  assert(f1.chat === false, "admin turned chat off");
  await wait(150);
  assert(A.view.flags.chat === false, "flag pushed to the open table view");
  const chatErrs = A.errors.length;
  send(A, { t: "chat", text: "hello?" });
  await wait(150);
  assert(A.errors.length === chatErrs + 1 && A.errors.at(-1).code === "disabled", "chat rejected while flag is off");
  await setFlag("signup", false);
  const closed = await fetch(`${BASE}/api/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: `smoke_z_${suffix}`, pin: "1234" }) });
  assert(closed.status === 403, "signup blocked while flag is off");
  await setFlag("hud", false);
  await wait(150);
  assert(Object.keys(A.view.hud).length === 0, "HUD hidden from view while flag is off");
  const hudOff = await fetch(`${BASE}/api/hud?ids=${a.user.id}`, { headers: { cookie: a.cookie } });
  assert(hudOff.status === 403, "HUD API blocked while flag is off");
} finally {
  await setFlag("chat", true);
  await setFlag("signup", true);
  const restored = await setFlag("hud", true);
  assert(Object.values(restored).every((v) => v === true), "all flags restored");
}
await wait(150);
assert(A.view.flags.hud === true && Object.keys(A.view.hud).length > 0, "HUD back after flag restored");
const pub = await (await fetch(`${BASE}/api/flags`)).json();
assert(pub.flags && Object.keys(pub.flags).length >= 14, "public flags endpoint");

send(A, { t: "end" });
for (let i = 0; i < 60 && !A.ended; i++) {
  // ending waits for a live hand: play it out
  const h = A.view.hand;
  if (h && h.phase === "betting" && h.actor !== null) { const c = h.actor === 0 ? A : B2; send(c, { t: "action", seq: h.actionSeq, action: { type: c.view.me.limits?.canCheck ? "check" : "call" } }); }
  if (h && h.phase === "runChoice") for (const [c, seat] of [[A, 0], [B2, 3]]) if (h.runChoice.pending.includes(seat)) send(c, { t: "runs", runs: 1 });
  if (h && h.phase === "discard") for (const [c, seat] of [[A, 0], [B2, 3]]) if (h.pendingDiscard.includes(seat)) send(c, { t: "action", seq: h.actionSeq, action: { type: "discard", amount: 0 } });
  await wait(400);
}
assert(Array.isArray(A.ended) && A.ended.length === 2, "session ended with results for both players");
assert(A.ended.reduce((x, r) => x + r.net, 0) === 0, `ghost session nets sum to zero (ghost chips are settled; nets ${A.ended.map((r) => r.net)})`);
const lb = await (await fetch(`${BASE}/api/leaderboard`, { headers: { cookie: a.cookie } })).json();
assert(lb.rows.some((x) => x.username === a.user.username), "leaderboard includes the player");
const stats = await (await fetch(`${BASE}/api/stats/me`, { headers: { cookie: a.cookie } })).json();
assert(stats.stats.sessions === 1, "profile stats recorded one session");
assert(stats.stats.hud.hands >= 1, "lifetime HUD updated at session end");
const hudApi = await (await fetch(`${BASE}/api/hud?ids=${a.user.id},${b.user.id}`, { headers: { cookie: a.cookie } })).json();
assert(hudApi.rows.length === 2, "HUD API returns both players");
assert(A.errors.every((e) => e.code === "disabled" || e.code === "taunt_cooldown") && B2.errors.length === 0, "no unexpected socket errors");

// ----- auto-deal survives a player dropping between hands -----
{
  const r2 = await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ name: "Smoke auto", config: { variant: "nlhe", smallBlind: 1, bigBlind: 2, startingStack: 200, actionTimerMs: 5000 } }) });
  const code2 = (await r2.json()).code;
  const C = await connect(a, code2); let D = await connect(b, code2);
  send(C, { t: "sit", seat: 0, buyIn: 200 }); send(D, { t: "sit", seat: 1, buyIn: 200 });
  await wait(300); send(C, { t: "start" }); await wait(500);
  assert(C.view.hand?.number === 1, "auto-deal table: hand 1 started");
  const h = C.view.hand; const actor = h.actor === 0 ? C : D;
  send(actor, { t: "action", seq: h.actionSeq, action: { type: "fold" } });
  await wait(200);
  D.ws.close();
  await wait(5000);
  assert(C.view.status === "running", "table stays running when a player drops between hands");
  assert(C.view.hand?.number === 1 && C.view.seats[1].status === "sittingOut", "dropped player is sat out and no hand is dealt short-handed");
  D = await connect(b, code2);
  for (let i = 0; i < 16 && C.view.hand?.number !== 2; i++) await wait(500);
  assert(C.view.hand?.number === 2, "next hand deals itself when the player returns, no Start needed");
  assert(C.errors.length === 0 && D.errors.length === 0, "auto-deal section had no socket errors");
  C.ws.close(); D.ws.close();
}

// ----- feedback -----
{
  const fb = await fetch(`${BASE}/api/feedback`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ kind: "bug", title: "Smoke test report", details: "ignore", context: { page: "/smoke" } }) });
  const fj = await fb.json();
  assert(fb.ok && (fj.filed || /github\.com\/.+\/issues\/new\?/.test(fj.url)), "feedback returns a filed issue or a prefilled GitHub link");
  const bad = await fetch(`${BASE}/api/feedback`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ kind: "idea", title: "x" }) });
  assert(bad.status === 400, "feedback needs a title");
}

// ----- leaving mid-hand cannot inflate the ledger -----
{
  const c = await login(`smoke_c_${suffix}`, "1234");
  const r4 = await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ name: "Smoke ledger", config: { variant: "nlhe", smallBlind: 1, bigBlind: 2, startingStack: 200, actionTimerMs: 8000, maxRuns: 1 } }) });
  const code4 = (await r4.json()).code;
  const P = [await connect(a, code4), await connect(b, code4), await connect(c, code4)];
  const seatsOf = [0, 2, 4];
  P.forEach((p, i) => send(p, { t: "sit", seat: seatsOf[i], buyIn: 200 }));
  await wait(300); send(P[0], { t: "start" }); await wait(500);
  const h = P[0].view.hand;
  const folder = seatsOf.indexOf(h.actor);
  send(P[folder], { t: "action", seq: h.actionSeq, action: { type: "fold" } });
  await wait(300);
  for (let i = 0; i < 3; i++) { send(P[folder], { t: "stand" }); await wait(150); }
  assert(P[0].view.hand.phase !== "showdown" && P[0].view.seats[seatsOf[folder]] !== null, "folded player who stands stays seated until the hand ends");
  for (let i = 0; i < 30 && P[0].view.hand.phase !== "showdown"; i++) {
    const hh = P[0].view.hand;
    if (hh.phase === "betting") { const k = seatsOf.indexOf(hh.actor); send(P[k], { t: "action", seq: hh.actionSeq, action: { type: P[k].view.me.limits.canCheck ? "check" : "call" } }); }
    await wait(300);
  }
  assert(P[0].view.seats[seatsOf[folder]] === null, "the player leaves once the hand is over");
  // someone else takes the empty seat while the finished hand is still on the table
  const d = await login(`smoke_d_${suffix}`, "1234");
  const Q = await connect(d, code4);
  send(Q, { t: "sit", seat: seatsOf[folder], buyIn: 200 }); await wait(250);
  const mySeatView = Q.view.seats[seatsOf[folder]];
  assert(Q.view.hand?.phase === "showdown" && mySeatView && mySeatView.playerId === d.user.id && !mySeatView.inHand && !(mySeatView.cards ?? []).some(Boolean), "a new player in a reused seat does not get the previous player's cards");
  send(Q, { t: "show" }); await wait(200);
  assert(Q.errors.some((e) => e.code === "cannot_show"), "a new player in a reused seat cannot show the previous player's cards");
  P.push(Q);
  send(P[0], { t: "end" });
  for (let i = 0; i < 40 && !P[0].ended; i++) {
    const hh = P[0].view.hand; // play out any hand that started meanwhile
    if (hh && hh.phase === "betting") { const k = [...seatsOf].indexOf(hh.actor); const who = k >= 0 && k !== folder ? P[k] : Q; send(who, { t: "action", seq: hh.actionSeq, action: { type: who.view.me.limits?.canCheck ? "check" : "call" } }); }
    await wait(400);
  }
  const res = P[0].ended;
  const sum = res.reduce((x, r) => x + r.net, 0);
  const leaver = res.find((r) => r.userId === [a, b, c][folder].user.id);
  assert(res.length === 4 && sum === 0, `session nets sum to zero after repeated stand requests (sum ${sum})`);
  assert(leaver && leaver.buyIn === 200 && leaver.net === leaver.cashOut - 200 && leaver.cashOut <= 200, "the leaver is counted once with their real cash-out");
  P.forEach((p) => p.ws.close());
}

// ----- cheating attempts from the review, and showing cards -----
{
  const r5 = await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ name: "Smoke cheat", config: { variant: "nlhe", smallBlind: 1, bigBlind: 2, startingStack: 200, actionTimerMs: 8000, maxRuns: 1 } }) });
  const code5 = (await r5.json()).code;
  const H = await connect(a, code5), V = await connect(b, code5);
  // fractional seat numbers are rejected
  send(V, { t: "sit", seat: 0.5, buyIn: 200 }); await wait(250);
  assert(V.errors.some((e) => e.code === "bad_seat") && V.view.seats.every((s) => !s), "fractional seat number is rejected");
  send(H, { t: "sit", seat: 0, buyIn: 200 }); send(V, { t: "sit", seat: 1, buyIn: 200 });
  await wait(300); send(H, { t: "start" }); await wait(500);
  // hand 1: everyone folds to one player, who then shows
  {
    const h = H.view.hand; const actor = h.actor === 0 ? H : V; const other = actor === H ? V : H; const otherSeat = actor === H ? 1 : 0;
    send(other, { t: "show" }); await wait(200);
    assert(other.errors.some((e) => e.code === "cannot_show"), "cannot show cards while the hand is live");
    send(actor, { t: "action", seq: h.actionSeq, action: { type: "fold" } }); await wait(300);
    assert(actor.view.seats[otherSeat].cards.every((c) => c === null), "uncontested winner's cards stay hidden by default");
    send(other, { t: "show" }); await wait(300);
    assert(actor.view.seats[otherSeat].cards.every((c) => typeof c === "string"), "a player can show their cards after everyone folds");
  }
  // hand 2: both all-in, host tries to kick the opponent and end the session during the run-out
  for (let i = 0; i < 20 && !(H.view.hand?.number === 2); i++) await wait(500);
  for (let i = 0; i < 6 && H.view.hand.phase === "betting"; i++) {
    const h = H.view.hand; const c = h.actor === 0 ? H : V;
    send(c, { t: "action", seq: h.actionSeq, action: { type: c.view.me.limits.canRaise ? "allin" : "call" } });
    await wait(300);
  }
  assert(H.view.hand.phase === "runout", "both players all-in");
  send(H, { t: "kick", playerId: b.user.id }); await wait(200);
  send(H, { t: "end" }); await wait(200);
  assert(!H.view.seats[1].folded && H.view.hand.phase !== "showdown", "host cannot fold out an all-in player by kicking during the run-out");
  assert(H.view.endPending && H.view.status !== "ended", "ending mid-hand waits for the hand to finish");
  for (let i = 0; i < 20 && !H.ended; i++) await wait(500);
  const res = H.ended;
  assert(res && res.reduce((x, r) => x + r.net, 0) === 0 && H.view.hand.result.hands[1] && H.view.hand.result.hands[0], "the all-in pot is played out to showdown and the session ends with nets summing to zero");
  H.ws.close(); V.ws.close();
}

// ----- straddle -----
{
  const r6 = await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ name: "Smoke straddle", config: { variant: "nlhe", smallBlind: 1, bigBlind: 2, startingStack: 200, actionTimerMs: 8000, maxRuns: 1, straddle: true } }) });
  const code6 = (await r6.json()).code;
  const c6 = await login(`smoke_c_${suffix}`, "1234");
  const S = [await connect(a, code6), await connect(b, code6), await connect(c6, code6)];
  send(S[2], { t: "straddle", on: true }); await wait(200);
  assert(S[2].errors.some((e) => e.code === "not_seated"), "only seated players can opt in to straddle");
  S.forEach((p, i) => send(p, { t: "sit", seat: i * 2, buyIn: 200 }));
  await wait(300);
  S.forEach((p) => send(p, { t: "straddle", on: true }));
  await wait(300);
  assert(S.every((p) => p.view.me.straddle === true), "players opted in to straddle");
  send(S[0], { t: "start" }); await wait(600);
  const h = S[0].view.hand;
  const straddler = S[0].view.seats.find((x) => x && x.lastAction?.type === "straddle");
  assert(h.currentBet === 4 && straddler && straddler.lastAction.amount === 4 && straddler.streetBet === 4, "under the gun straddles 2x the big blind");
  assert(h.actor !== straddler.seat && h.actor !== h.bigBlindSeat, "action starts to the left of the straddle");
  send(S[0], { t: "end" });
  for (let i = 0; i < 40 && !S[0].ended; i++) {
    const hh = S[0].view.hand;
    if (hh && hh.phase === "betting" && hh.actor !== null) { const who = S[hh.actor / 2]; send(who, { t: "action", seq: hh.actionSeq, action: { type: "fold" } }); }
    await wait(300);
  }
  assert(S[0].ended && S[0].ended.reduce((x, r) => x + r.net, 0) === 0, "straddle session nets sum to zero");
  S.forEach((p) => p.ws.close());
}

// ----- dealer's choice and running it twice -----
{
  const r3 = await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ name: "Smoke DC", config: { variant: "nlhe", smallBlind: 1, bigBlind: 2, startingStack: 200, actionTimerMs: 8000, maxRuns: 3, dealersChoice: "hand" } }) });
  const code3 = (await r3.json()).code;
  const E = await connect(a, code3), F = await connect(b, code3);
  send(E, { t: "sit", seat: 0, buyIn: 200 }); send(F, { t: "sit", seat: 1, buyIn: 200 });
  await wait(300); send(E, { t: "start" }); await wait(500);
  const pick = E.view.dealerChoice?.picking;
  assert(pick && E.view.hand === null && pick.options.includes("plo"), "dealer's choice: the first dealer is asked to pick before the deal");
  const dealer = pick.chooser === 0 ? E : F, other = dealer === E ? F : E;
  send(other, { t: "chooseGame", variant: "plo" });
  await wait(300);
  assert(other.errors.some((e) => e.code === "not_dealer"), "only the dealer can pick the game");
  send(dealer, { t: "chooseGame", variant: "plo" });
  await wait(500);
  assert(E.view.hand?.number === 1 && E.view.hand.variant === "plo" && E.view.hand.button === pick.chooser, "picked game is dealt and the picker has the button");
  // both all-in preflop, then agree to run it twice
  for (let i = 0; i < 6 && E.view.hand.phase === "betting"; i++) {
    const h = E.view.hand; const c = h.actor === 0 ? E : F;
    send(c, { t: "action", seq: h.actionSeq, action: { type: c.view.me.limits.canRaise ? "allin" : "call" } });
    await wait(300);
  }
  assert(E.view.hand.phase === "runChoice" && E.view.hand.runChoice.max === 3, "all-in opens the run-it-twice vote");
  send(E, { t: "runs", runs: 2 }); await wait(200);
  assert(F.view.hand.runChoice.decided.includes(0) && F.view.hand.runChoice.mine === null, "votes stay private until everyone picks");
  send(F, { t: "runs", runs: 3 }); await wait(300);
  assert(E.view.hand.runs === 2 && E.view.hand.boards.length === 2, "lowest pick wins: running it twice on two boards");
  for (let i = 0; i < 20 && E.view.hand.phase !== "showdown"; i++) await wait(500);
  assert(E.view.hand.phase === "showdown" && E.view.hand.boards.every((b) => b.length === 5), "both runs dealt to the river");
  assert(E.view.seats.filter(Boolean).reduce((x, s) => x + s.stack, 0) === 400, "chips conserved after running it twice");
  if (E.view.seats.every((s) => !s || s.stack > 0)) {
    for (let i = 0; i < 20 && !E.view.dealerChoice?.picking; i++) await wait(500);
    const p2 = E.view.dealerChoice?.picking;
    assert(p2 && p2.chooser !== pick.chooser, "next hand: the new dealer picks");
    send(p2.chooser === 0 ? E : F, { t: "chooseGame", variant: "nlhe" });
    await wait(500);
    assert(E.view.hand?.number === 2 && E.view.hand.variant === "nlhe", "second pick switches the game back");
  } else console.log("skip second pick (a player busted)");
  assert(E.errors.filter((e) => e.code !== "not_dealer").length === 0 && F.errors.filter((e) => e.code !== "not_dealer").length === 0, "dealer's choice section had no unexpected socket errors");
  E.ws.close(); F.ws.close();
}
A.ws.close(); B2.ws.close();
console.log("\nSMOKE PASSED");
process.exit(0);
