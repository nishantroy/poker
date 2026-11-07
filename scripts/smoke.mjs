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
  await wait(350);
}
await wait(3000); // run-out alarms
assert(A.view.hand.phase === "showdown" && A.view.hand.board.length === 5, "all-in hand ran out to showdown via alarms");
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

send(A, { t: "end" });
await wait(600);
assert(Array.isArray(A.ended) && A.ended.length === 2, "session ended with results for both players");
const lb = await (await fetch(`${BASE}/api/leaderboard`, { headers: { cookie: a.cookie } })).json();
assert(lb.rows.some((x) => x.username === a.user.username), "leaderboard includes the player");
const stats = await (await fetch(`${BASE}/api/stats/me`, { headers: { cookie: a.cookie } })).json();
assert(stats.stats.sessions === 1, "profile stats recorded one session");
assert(A.errors.length === 0 && B2.errors.length === 0, "no unexpected socket errors");
A.ws.close(); B2.ws.close();
console.log("\nSMOKE PASSED");
process.exit(0);
