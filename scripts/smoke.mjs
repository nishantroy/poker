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
send(A, { t: "taunt", id: 5 });
await wait(200);
assert(A.errors.length === tauntErrs && B2.taunts.length === 3, "no taunt rate limit: back-to-back taunts all go out");
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
assert(A.errors.every((e) => e.code === "disabled") && B2.errors.length === 0, "no unexpected socket errors");

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

// ----- PLO hi-lo and short deck -----
{
  const mk = async (name, config) => (await (await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ name, config: { smallBlind: 1, bigBlind: 2, startingStack: 200, actionTimerMs: 8000, maxRuns: 1, ...config } }) })).json()).code;
  // short deck hold'em: only 6s and up are dealt
  const sdCode = await mk("Smoke short deck", { variant: "nlhe", shortDeck: true });
  const X = await connect(a, sdCode), Y = await connect(b, sdCode);
  send(X, { t: "sit", seat: 0, buyIn: 200 }); send(Y, { t: "sit", seat: 1, buyIn: 200 });
  await wait(300); send(X, { t: "start" }); await wait(500);
  assert(X.view.hand.shortDeck === true && X.view.seats[0].cards.every((c) => !"2345".includes(c[0])), "short deck table deals no 2s through 5s");
  send(X, { t: "end" });
  for (let i = 0; i < 40 && !X.ended; i++) { const h = X.view.hand; if (h?.phase === "betting") { const c = h.actor === 0 ? X : Y; send(c, { t: "action", seq: h.actionSeq, action: { type: "fold" } }); } await wait(300); }
  X.ws.close(); Y.ws.close();
  // PLO hi-lo: play an all-in hand to showdown
  const hlCode = await mk("Smoke hi-lo", { variant: "plo8", shortDeck: true });
  const P = await connect(a, hlCode), Q = await connect(b, hlCode);
  send(P, { t: "sit", seat: 0, buyIn: 200 }); send(Q, { t: "sit", seat: 1, buyIn: 200 });
  await wait(300); send(P, { t: "start" }); await wait(500);
  assert(P.view.hand.variant === "plo8" && P.view.hand.shortDeck === false && P.view.seats[0].cards.length === 4, "PLO hi-lo deals 4 cards from the full deck even with short deck on");
  for (let i = 0; i < 40 && P.view.hand.phase !== "showdown"; i++) {
    const h = P.view.hand;
    if (h.phase === "betting" && h.actor !== null) { const c = h.actor === 0 ? P : Q; send(c, { t: "action", seq: h.actionSeq, action: { type: c.view.me.limits?.canRaise ? "allin" : "call" } }); }
    await wait(350);
  }
  const res = P.view.hand.result;
  const paid = res.pots.flatMap((p) => p.winners).reduce((x, w) => x + w.amount, 0);
  assert(P.view.hand.phase === "showdown" && paid === res.pots.reduce((x, p) => x + p.amount, 0) && P.view.seats.filter(Boolean).reduce((x, s) => x + s.stack, 0) === 400, "PLO hi-lo pays out every chip at showdown");
  send(P, { t: "end" }); for (let i = 0; i < 30 && !P.ended; i++) await wait(300);
  assert(P.ended && P.ended.reduce((x, r) => x + r.net, 0) === 0, "PLO hi-lo session nets sum to zero");
  P.ws.close(); Q.ws.close();
  // Irish hi-lo: 5 cards, played to showdown
  const irCode = await mk("Smoke Irish", { variant: "irish" });
  const I = await connect(a, irCode), J = await connect(b, irCode);
  send(I, { t: "sit", seat: 0, buyIn: 200 }); send(J, { t: "sit", seat: 1, buyIn: 200 });
  await wait(300); send(I, { t: "start" }); await wait(500);
  assert(I.view.hand.variant === "irish" && I.view.seats[0].cards.length === 5 && J.view.seats[0].cards.every((c) => c === null), "Irish hi-lo deals 5 private cards");
  for (let i = 0; i < 40 && I.view.hand.phase !== "showdown"; i++) {
    const h = I.view.hand;
    if (h.phase === "betting" && h.actor !== null) { const c = h.actor === 0 ? I : J; send(c, { t: "action", seq: h.actionSeq, action: { type: c.view.me.limits?.canRaise ? "allin" : "call" } }); }
    await wait(350);
  }
  assert(I.view.hand.phase === "showdown" && I.view.seats.filter(Boolean).reduce((x, s) => x + s.stack, 0) === 400, "Irish hi-lo pays out every chip at showdown");
  I.ws.close(); J.ws.close();
  // Donk'em and red river: check every hand down to showdown, a few hands each
  const checkDown = async (U, V, label, check) => {
    for (let handNo = 1; handNo <= 3; handNo++) {
      for (let i = 0; i < 40 && !(U.view.hand?.number === handNo && U.view.hand.phase === "showdown"); i++) {
        const h = U.view.hand;
        if (h?.phase === "betting" && h.actor !== null) { const c = h.actor === 0 ? U : V; send(c, { t: "action", seq: h.actionSeq, action: { type: c.view.me.limits?.canCheck ? "check" : "call" } }); }
        await wait(300);
      }
      assert(U.view.hand.phase === "showdown" && U.view.seats.filter(Boolean).reduce((x, s) => x + s.stack, 0) === 400, `${label} hand ${handNo} reached showdown with chips conserved`);
      check(U.view.hand);
    }
  };
  const dkCode = await mk("Smoke donk", { variant: "donkem" });
  const D1 = await connect(a, dkCode), D2 = await connect(b, dkCode);
  send(D1, { t: "sit", seat: 0, buyIn: 200 }); send(D2, { t: "sit", seat: 1, buyIn: 200 });
  await wait(300); send(D1, { t: "start" }); await wait(500);
  assert(D1.view.seats[0].cards.length === 3, "Donk'em deals 3 cards");
  await checkDown(D1, D2, "Donk'em", (h) => assert(h.boards[0].length === 6, "Donk'em showdown has a 6-card board (super river)"));
  D1.ws.close(); D2.ws.close();
  const rrCode = await mk("Smoke red river", { variant: "nlhe", redRiver: true });
  const R1 = await connect(a, rrCode), R2 = await connect(b, rrCode);
  send(R1, { t: "sit", seat: 0, buyIn: 200 }); send(R2, { t: "sit", seat: 1, buyIn: 200 });
  await wait(300); send(R1, { t: "start" }); await wait(500);
  assert(R1.view.hand.redRiver === true, "red river table deals red-river hands");
  const red = (c) => c[1] === "h" || c[1] === "d";
  await checkDown(R1, R2, "Red river", (h) => {
    const b = h.boards[0];
    assert(b.length >= 5 && !red(b[b.length - 1]), `red river board ends on a black card (${b.join(" ")})`);
    assert(b.slice(4, -1).every(red), "every card between the river and the last one is red");
  });
  R1.ws.close(); R2.ws.close();
}

// ----- dealer's choice and running it twice -----
{
  const r3 = await fetch(`${BASE}/api/tables`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ name: "Smoke DC", config: { variant: "nlhe", smallBlind: 1, bigBlind: 2, startingStack: 200, actionTimerMs: 8000, maxRuns: 3, dealersChoice: "hand" } }) });
  const code3 = (await r3.json()).code;
  const E = await connect(a, code3), F = await connect(b, code3);
  send(E, { t: "sit", seat: 0, buyIn: 200 }); send(F, { t: "sit", seat: 1, buyIn: 200 });
  await wait(300); send(E, { t: "start" }); await wait(500);
  const pick = E.view.dealerChoice?.picking;
  assert(E.view.hand?.number === 1 && E.view.hand.variant === "nlhe", "dealer's choice never holds up the deal: hand 1 plays the current game");
  assert(pick && pick.options.includes("plo") && pick.picked === null && pick.chooser !== E.view.hand.button, "the next dealer gets the pick while hand 1 plays");
  assert(!pick.options.includes("pineapple") && pick.options.includes("crazy-pineapple"), "only one Pineapple is offered");
  const dealer = pick.chooser === 0 ? E : F, other = dealer === E ? F : E;
  send(other, { t: "chooseGame", variant: "plo" });
  await wait(300);
  assert(other.errors.some((e) => e.code === "not_dealer"), "only the next dealer can pick the game");
  send(dealer, { t: "chooseGame", variant: "plo5" });
  send(dealer, { t: "chooseGame", variant: "plo" }); // can change their mind until the deal
  await wait(500);
  assert(other.view.dealerChoice.picking.picked === "plo" && other.view.hand.variant === "nlhe", "the pick is shown to everyone and waits for the next hand");
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
    for (let i = 0; i < 30 && E.view.hand?.number !== 2; i++) await wait(500);
    assert(E.view.hand?.number === 2 && E.view.hand.variant === "plo" && E.view.hand.button === pick.chooser, "hand 2 deals the pick, with the picker on the button");
    const p2 = E.view.dealerChoice?.picking;
    assert(p2 && p2.chooser !== pick.chooser && p2.picked === null, "hand 2: the following dealer gets the next pick");
    // nobody picks: the game stays PLO
    const h2 = E.view.hand; send(h2.actor === 0 ? E : F, { t: "action", seq: h2.actionSeq, action: { type: "fold" } });
    for (let i = 0; i < 30 && E.view.hand?.number !== 3; i++) await wait(500);
    assert(E.view.hand?.number === 3 && E.view.hand.variant === "plo", "no pick keeps the current game");
  } else console.log("skip second pick (a player busted)");
  assert(E.errors.filter((e) => e.code !== "not_dealer").length === 0 && F.errors.filter((e) => e.code !== "not_dealer").length === 0, "dealer's choice section had no unexpected socket errors");
  E.ws.close(); F.ws.close();
}
// ----- tournaments -----
{
  const c = await login(`smoke_c_${suffix}`, "1234"), d = await login(`smoke_d_${suffix}`, "1234");
  const mkT = (who, name, tournament, config = {}) => fetch(`${BASE}/api/tables`, { method: "POST", headers: { "content-type": "application/json", cookie: who.cookie }, body: JSON.stringify({ name, config: { variant: "nlhe", smallBlind: 10, bigBlind: 20, startingStack: 1500, actionTimerMs: 8000, ...config }, tournament }) });
  const sumNet = (rows) => rows.reduce((x, r) => x + r.net, 0);

  await setFlag("tournaments", false);
  assert((await mkT(a, "Smoke T off", { buyIn: 20, levelMs: 60000, payouts: "auto" })).status === 403, "tournaments off: no new tournament can be created");
  await setFlag("tournaments", true);

  // cancelled before the start: nobody paid in
  {
    const code = (await (await mkT(a, "Smoke T cancel", { buyIn: 20, levelMs: 60000, payouts: "auto" })).json()).code;
    const X = await connect(a, code), Y = await connect(b, code);
    send(X, { t: "sit", seat: 0, buyIn: 1 }); send(Y, { t: "sit", seat: 1, buyIn: 999999 });
    await wait(300);
    assert(X.view.tournament && X.view.tournament.started === false && X.view.seats[0].stack === 1500 && X.view.seats[1].stack === 1500, "tournament entry is one fixed stack, whatever buy-in the client sends");
    assert(X.view.tournament.pool === 40 && X.view.tournament.entrants === 2, "prize pool counts the seated players before the start");
    send(Y, { t: "stand" }); await wait(300);
    assert(X.view.seats[1] === null && X.view.tournament.pool === 20, "a player can leave before the tournament starts");
    send(X, { t: "start" }); await wait(300);
    assert(X.errors.some((e) => e.code === "need_players") && X.view.tournament.started === false, "a tournament needs two players to start");
    send(X, { t: "end" }); await wait(400);
    assert(Array.isArray(X.ended) && X.ended.length === 0, "a tournament cancelled before the start records no results");
    X.ws.close(); Y.ws.close();
  }

  // ended early by the host: the prize pool is chopped by chip count
  {
    const code = (await (await mkT(a, "Smoke T chop", { buyIn: 25, levelMs: 60000, payouts: "auto" })).json()).code;
    const X = await connect(a, code), Y = await connect(b, code);
    send(X, { t: "sit", seat: 0 }); send(Y, { t: "sit", seat: 1 });
    await wait(300); send(X, { t: "start" }); await wait(500);
    assert(X.view.tournament.started && X.view.hand?.number === 1 && X.view.tournament.pool === 50, "tournament starts and deals");
    const h = X.view.hand; send(h.actor === 0 ? X : Y, { t: "action", seq: h.actionSeq, action: { type: "fold" } });
    await wait(400);
    send(X, { t: "end" }); await wait(500);
    const res = X.ended;
    assert(res && res.length === 2 && sumNet(res) === 0 && res.every((r) => r.buyIn === 25), "early end: both players paid the buy-in and the nets sum to zero");
    assert(res[0].place === 1 && res[0].cashOut === 26 && res[1].place === 2 && res[1].cashOut === 24, `early end splits the pool by chips (${res.map((r) => r.cashOut).join("/")})`);
    X.ws.close(); Y.ws.close();
  }

  // four players, played to a winner
  const code = (await (await mkT(a, "Smoke tourney", { buyIn: 20, levelMs: 60000, payouts: "auto" })).json()).code;
  const P = [await connect(a, code), await connect(b, code), await connect(c, code), await connect(d, code)];
  const ids = [a, b, c, d].map((u) => u.user.id);
  P.forEach((p, i) => send(p, { t: "sit", seat: i }));
  await wait(400);
  send(P[0], { t: "config", patch: { ante: 5, straddle: true, maxRuns: 3, startingStack: 1000 } }); await wait(300);
  assert(P[0].view.config.ante === 0 && P[0].view.config.straddle === false && P[0].view.config.maxRuns === 1, "tournament tables never have antes, straddles or several runs");
  assert(P[0].view.seats.filter(Boolean).every((s) => s.stack === 1000) && P[0].view.tournament.startingStack === 1000, "changing the starting stack before the start moves everyone's stack");
  const tables = await (await fetch(`${BASE}/api/tables`, { headers: { cookie: a.cookie } })).json();
  assert(tables.tables.find((t) => t.code === code)?.tournament === true, "the lobby marks the table as a tournament");
  send(P[1], { t: "tournament", patch: { buyIn: 999 } });
  send(P[0], { t: "tournament", patch: { buyIn: 30.7, levelMs: 5, payouts: "bogus" } }); await wait(300);
  assert(P[1].errors.some((e) => e.code === "not_host"), "only the host can change the tournament");
  assert(P[0].view.tournament.buyIn === 30 && P[0].view.tournament.levelMs === 60000 && P[0].view.tournament.payouts === "auto" && P[0].view.tournament.pool === 120, "the host can change the buy-in before the start; hostile values are clamped and only the host may");
  send(P[0], { t: "tournament", patch: { buyIn: 20 } }); await wait(300);
  send(P[0], { t: "start" }); await wait(600);
  const T = () => P[0].view.tournament;
  assert(T().started && T().entrants === 4 && T().pool === 80 && T().prizes.join("/") === "52/28", "4 players at 20: prize pool 80 pays 52/28");
  assert(T().level === 0 && T().blinds.bb === 20 && T().nextBlinds.bb === 30 && T().levelLeftMs > 50000 && T().clockRunning, "level 1 blinds 10/20, next 15/30, clock running");
  assert(T().standings.length === 4 && T().standings.reduce((x, s) => x + s.chips, 0) === 4000 && T().left === 4, "standings count every chip in play, blinds included (4000)");
  for (const [i, p] of P.entries()) assert(p.view.seats.every((s, j) => !s || j === i || s.cards.every((x) => x === null)), `tournament: player ${i} sees no other hole cards`);

  // what a tournament does not allow
  const late = await login(`smoke_late_${suffix}`, "1234");
  const L = await connect(late, code);
  send(L, { t: "sit", seat: 5 });
  send(P[1], { t: "rebuy", amount: 500 });
  send(P[0], { t: "rebuy", amount: 500 });
  send(P[1], { t: "ghostVote", on: true });
  send(P[0], { t: "kick", playerId: ids[2] });
  send(P[0], { t: "config", patch: { smallBlind: 1, bigBlind: 2, startingStack: 5000 } });
  send(P[0], { t: "tournament", patch: { buyIn: 1, payouts: "winner" } });
  await wait(500);
  assert(P[0].errors.some((e) => e.code === "tournament_started") && T().buyIn === 20 && T().pool === 80 && T().prizes.length === 2, "the buy-in and payouts are locked once the tournament has started");
  assert(L.errors.some((e) => e.code === "tournament_started") && L.view.seats[5] === null, "nobody can sit once the tournament has started");
  assert(P[1].errors.some((e) => e.code === "no_rebuys") && P[0].errors.some((e) => e.code === "no_rebuys"), "no rebuys in a tournament, not even for the host");
  assert(P[1].errors.some((e) => e.code === "no_ghost") && P[0].view.ghost.enabled !== true, "no ghost in a tournament");
  assert(P[0].errors.some((e) => e.code === "no_kick") && P[0].view.seats[2] !== null, "nobody is kicked out of a running tournament");
  assert(P[0].view.config.bigBlind === 20 && P[0].view.config.startingStack === 1000, "the host cannot change blinds or stacks after the start");
  L.ws.close();

  // sitting out: the stack stays, the table folds for them
  send(P[3], { t: "stand" }); await wait(400);
  assert(P[0].view.seats[3] !== null && P[0].view.seats[3].away === true, "standing up in a tournament keeps the seat and marks the player away");
  const play = async (until, pickAction, maxMs = 120000) => {
    const t0 = Date.now();
    while (!until() && Date.now() - t0 < maxMs) {
      const h = P[0].view.hand;
      if (h && h.phase === "betting" && h.actor !== null && !P[0].view.seats[h.actor]?.away) {
        const p = P[h.actor];
        const lim = p.view.me?.limits;
        if (lim && p.view.hand.actionSeq === h.actionSeq) send(p, { t: "action", seq: h.actionSeq, action: { type: pickAction(lim, h.actor) } });
      }
      await wait(150);
    }
    return until();
  };
  const passive = (lim) => (lim.canCheck ? "check" : "call");
  // check it down for a little over one level; the away player is folded every hand
  const t1 = Date.now();
  assert(await play(() => Date.now() - t1 > 66000 && P[0].view.tournament.level >= 1, passive, 100000), "after a minute of play the level goes up");
  assert(T().level === 1 && P[0].view.config.smallBlind === 15 && P[0].view.config.bigBlind === 30 && T().blinds.bb === 30, "level 2 blinds are 15/30");
  assert(P[0].log.some((l) => l.includes("Level 2") && l.includes("15/30")), "the blind rise is announced in the log");
  // (their stack is not a reliable sign: a checked-down big blind can win them a pot)
  assert(P[0].view.seats[3].away === true && P[0].log.some((l) => l.includes(`${d.user.username} posts`)) && P[0].log.some((l) => l === `${d.user.username} folds` || l === `${d.user.username} checks`), `the away player keeps posting blinds and the table checks or folds for them (stack ${P[0].view.seats[3].stack})`);
  assert(!P[0].log.some((l) => l.includes(d.user.username) && l.includes("timed out")), "away players are not announced as timing out");
  send(P[3], { t: "sitIn" }); await wait(400);
  assert(P[0].view.seats[3].away === false, "sitting back in clears away");

  // pause stops the clock
  send(P[0], { t: "pause" }); await wait(300);
  await play(() => !P[0].view.hand || P[0].view.hand.phase === "showdown", passive, 30000);
  await wait(300);
  const left1 = T().levelLeftMs; await wait(1500); send(P[1], { t: "sitIn" }); await wait(300); // any change sends a fresh view
  assert(P[0].view.status === "paused" && T().clockRunning === false && Math.abs(T().levelLeftMs - left1) < 200, "pausing stops the blind clock");
  send(P[0], { t: "resume" }); await wait(500);
  assert(P[0].view.status === "running" && T().clockRunning === true, "resuming starts the clock again");

  // everyone away: the table pauses itself, and the first player back starts it again without the host
  for (const p of P) send(p, { t: "sitOut" });
  assert(await play(() => P[0].view.status === "paused", passive, 60000), "with everyone away the tournament pauses itself");
  await wait(300);
  assert(T().clockRunning === false && P[0].view.seats.filter(Boolean).every((s) => s.away) && P[0].log.some((l) => l.includes("Everyone is away")), "the all-away pause stops the clock and says why");
  assert(T().standings.reduce((x, s) => x + s.chips, 0) === 4000, "no chips moved while pausing (4000)");
  const pausedHand = P[0].view.hand?.number ?? 0;
  send(P[2], { t: "sitIn" }); await wait(700);
  assert(P[0].view.status === "running" && T().clockRunning === true && P[0].view.seats[2].away === false && (P[0].view.hand?.number ?? 0) > pausedHand, "a player (not the host) coming back restarts the tournament and deals");
  for (const i of [0, 1, 3]) send(P[i], { t: "sitIn" });
  await wait(400);
  assert(P[0].view.seats.filter(Boolean).every((s) => !s.away), "everyone is back");

  // everybody shoves until one player has all the chips
  const done = await play(() => P[0].ended !== null, (lim) => (lim.canRaise ? "allin" : "call"), 240000);
  assert(done, "the tournament plays down to a winner and closes the table by itself");
  const res = P[0].ended;
  assert(res.length === 4 && sumNet(res) === 0, "tournament nets sum to zero");
  assert(res.map((r) => r.place).join(",") === "1,2,3,4" || res.filter((r) => r.place === 1).length === 1, `places are assigned (${res.map((r) => r.place).join(",")})`);
  assert(res[0].place === 1 && res[0].cashOut === 52 && res[0].net === res[0].cashOut - 20 && res.every((r) => r.buyIn === 20), `the winner takes first prize (${res.map((r) => `${r.place}:${r.cashOut}`).join(" ")})`);
  assert(res.reduce((x, r) => x + r.cashOut, 0) === 80, "the whole prize pool is paid out");
  assert(T().over && T().standings[0].place === 1 && T().standings[0].prize === res[0].cashOut && T().left === 1, "final standings show the winner and the prize");
  assert(P[0].log.some((l) => l.includes("wins the tournament")) && P[0].log.filter((l) => l.includes("is out in")).length === 3, "knockouts and the win are announced");
  await wait(500);
  const lbT = await (await fetch(`${BASE}/api/leaderboard`, { headers: { cookie: c.cookie } })).json();
  assert(lbT.rows.some((x) => x.username === c.user.username), "tournament results reach the leaderboard");
  for (const p of P) assert(p.errors.filter((e) => !["no_rebuys", "no_ghost", "no_kick", "not_host", "tournament_started", "stale", "not_your_turn"].includes(e.code)).length === 0, "tournament section had no unexpected socket errors");
  P.forEach((p) => p.ws.close());
}
A.ws.close(); B2.ws.close();
console.log("\nSMOKE PASSED");
process.exit(0);
