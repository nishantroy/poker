import { DurableObject } from "cloudflare:workers";
import {
  EngineError, VARIANTS, advance, applyAction, canStartHand, computePots, createGame, forfeit, getLimits, isHandLive,
  participants, removePlayer, seatPlayer, startHand, timeout,
  type GameEvent, type GameState, type TableConfig,
} from "@engine/index";
import type {
  ChatMessage, ClientMessage, LogLine, PublicSeat, RebuyRequest, ServerMessage, SessionResultRow, TableStatus, TableView, TimerInfo,
} from "@shared/protocol";
import { LIMITS, validateConfig } from "@shared/protocol";
import { accounts, type Env } from "./env";

interface Departed {
  userId: string;
  name: string;
  buyIn: number;
  cashOut: number;
  handsPlayed: number;
  biggestPot: number;
}

interface Meta {
  code: string;
  name: string;
  hostId: string;
  hostName: string;
  status: TableStatus;
  createdAt: number;
  timer: TimerInfo | null;
  rebuyRequests: RebuyRequest[];
  departed: Departed[];
  logSeq: number;
  chatSeq: number;
  /** seats flagged to be removed at the end of the current hand */
  leaving: number[];
}

interface Attachment {
  userId: string;
  name: string;
}

const RUNOUT_PAUSE_MS = 1400;
const NEXT_HAND_DELAY_MS = 3500;
const NEXT_HAND_DELAY_SHOWDOWN_MS = 6000;
const DISCARD_TIMER_MS = 20_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, hand INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hands (number INTEGER PRIMARY KEY, variant TEXT NOT NULL, board TEXT NOT NULL, events TEXT NOT NULL, result TEXT, ended_at INTEGER NOT NULL);
`;

export class TableDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private meta: Meta | null = null;
  private game: GameState | null = null;
  private pendingLog: LogLine[] = [];
  private unsentLog: LogLine[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(SCHEMA);
      this.load();
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---------- persistence ----------

  private load() {
    const rows = this.sql.exec<{ key: string; value: string }>("SELECT key, value FROM kv").toArray();
    for (const r of rows) {
      if (r.key === "meta") this.meta = JSON.parse(r.value) as Meta;
      if (r.key === "game") this.game = JSON.parse(r.value) as GameState;
    }
  }

  private save() {
    if (this.meta) this.sql.exec("INSERT OR REPLACE INTO kv (key, value) VALUES ('meta', ?)", JSON.stringify(this.meta));
    if (this.game) this.sql.exec("INSERT OR REPLACE INTO kv (key, value) VALUES ('game', ?)", JSON.stringify(this.game));
    for (const l of this.pendingLog) {
      this.sql.exec("INSERT OR REPLACE INTO log (id, ts, hand, kind, text) VALUES (?, ?, ?, ?, ?)", l.id, l.ts, l.handNumber, l.kind, l.text);
    }
    if (this.pendingLog.length) {
      this.sql.exec("DELETE FROM log WHERE id < (SELECT MAX(id) FROM log) - 400");
      this.unsentLog.push(...this.pendingLog);
      this.pendingLog = [];
    }
  }

  // ---------- RPC (from the Worker) ----------

  async init(args: { code: string; name: string; hostId: string; hostName: string; config: TableConfig }): Promise<void> {
    if (this.meta) return;
    this.meta = {
      code: args.code, name: args.name, hostId: args.hostId, hostName: args.hostName, status: "waiting",
      createdAt: Date.now(), timer: null, rebuyRequests: [], departed: [], logSeq: 0, chatSeq: 0, leaving: [],
    };
    this.game = createGame(validateConfig(args.config));
    this.log("system", `Table created by ${args.hostName}.`);
    this.save();
  }

  async summary(): Promise<{ code: string; name: string; status: TableStatus; hostId: string; hostName: string; config: TableConfig; players: number } | null> {
    if (!this.meta || !this.game) return null;
    return {
      code: this.meta.code, name: this.meta.name, status: this.meta.status, hostId: this.meta.hostId, hostName: this.meta.hostName,
      config: this.game.config, players: this.game.seats.filter(Boolean).length,
    };
  }

  // ---------- WebSocket lifecycle ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    if (!this.meta || !this.game) return new Response("table not found", { status: 404 });
    const userId = request.headers.get("x-user-id");
    const name = request.headers.get("x-user-name");
    if (!userId || !name) return new Response("unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, name } satisfies Attachment);

    // reconnect: clear disconnected flag
    const seat = this.seatOf(userId);
    if (seat && seat.disconnected) {
      seat.disconnected = false;
      this.save();
      this.broadcast();
    } else {
      this.sendState(server);
    }
    this.send(server, { t: "log", lines: this.recentLog() });
    this.send(server, { t: "chat", messages: this.recentChat() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || !this.meta || !this.game) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.send(ws, { t: "error", code: "bad_json", message: "Malformed message" });
    }
    try {
      this.handle(ws, att, msg);
    } catch (e) {
      if (e instanceof EngineError) {
        this.send(ws, { t: "error", code: e.code, message: e.message });
        // resync the sender so their UI matches the server
        this.sendState(ws);
      } else {
        console.error("table error", e);
        this.send(ws, { t: "error", code: "internal", message: "Something went wrong" });
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.onGone(ws);
  }
  async webSocketError(ws: WebSocket): Promise<void> {
    this.onGone(ws);
  }

  private onGone(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || !this.game) return;
    const others = this.ctx.getWebSockets(att.userId).filter((s) => s !== ws);
    if (others.length) return;
    const seat = this.seatOf(att.userId);
    if (seat && !seat.disconnected) {
      seat.disconnected = true;
      this.save();
      this.broadcast();
    }
  }

  // ---------- message handling ----------

  private handle(ws: WebSocket, att: Attachment, msg: ClientMessage) {
    const meta = this.meta!;
    const isHost = att.userId === meta.hostId;
    const requireHost = () => {
      if (!isHost) throw new EngineError("not_host", "Only the host can do that");
    };
    if (meta.status === "ended" && msg.t !== "ping" && msg.t !== "chat") {
      throw new EngineError("ended", "This table has ended");
    }

    switch (msg.t) {
      case "ping":
        return this.send(ws, { t: "pong", serverTime: Date.now() });

      case "chat": {
        const text = String(msg.text ?? "").trim().slice(0, LIMITS.maxChatLen);
        if (!text) return;
        const m: ChatMessage = { id: ++meta.chatSeq, userId: att.userId, name: att.name, text, ts: Date.now() };
        this.sql.exec("INSERT INTO chat (id, ts, user_id, name, text) VALUES (?, ?, ?, ?, ?)", m.id, m.ts, m.userId, m.name, m.text);
        this.sql.exec("DELETE FROM chat WHERE id < (SELECT MAX(id) FROM chat) - 100");
        this.save();
        for (const s of this.ctx.getWebSockets()) this.send(s, { t: "chat", messages: [m] });
        return;
      }

      case "sit": {
        const g = this.game!;
        if (this.seatOf(att.userId)) throw new EngineError("already_seated", "You are already seated");
        const seatNo = Number(msg.seat);
        const maxBuy = g.config.startingStack;
        const buyIn = Math.floor(Number(msg.buyIn));
        if (!Number.isFinite(buyIn) || buyIn < g.config.bigBlind || buyIn > maxBuy) {
          throw new EngineError("bad_buyin", `Buy-in must be between ${g.config.bigBlind} and ${maxBuy}`);
        }
        const prior = meta.departed.find((d) => d.userId === att.userId);
        this.game = seatPlayer(g, seatNo, att.userId, att.name, buyIn);
        const seat = this.game.seats[seatNo]!;
        if (prior) {
          // returning player: carry their earlier buy-ins into the running totals
          seat.totalBuyIn += prior.buyIn;
          seat.handsPlayed += prior.handsPlayed;
          seat.biggestPot = prior.biggestPot;
          seat.stack += 0;
          meta.departed = meta.departed.filter((d) => d !== prior);
          // their earlier cash-out is money already in their pocket; keep it as a separate ledger entry
          meta.departed.push({ ...prior, handsPlayed: 0, buyIn: 0 });
        }
        this.log("system", `${att.name} sat down with ${buyIn}.`);
        this.afterChange();
        void accounts(this.env).updateTable(meta.code, { players: this.playerCount(), memberId: att.userId });
        return;
      }

      case "stand": {
        const seat = this.seatOf(att.userId);
        if (!seat) throw new EngineError("not_seated", "You are not seated");
        this.leaveSeat(seat.seat, "left the table");
        return;
      }

      case "sitOut": {
        const seat = this.seatOf(att.userId);
        if (!seat) throw new EngineError("not_seated", "You are not seated");
        seat.status = "sittingOut";
        this.log("system", `${seat.name} is sitting out.`);
        this.afterChange();
        return;
      }

      case "sitIn": {
        const seat = this.seatOf(att.userId);
        if (!seat) throw new EngineError("not_seated", "You are not seated");
        seat.status = "active";
        seat.disconnected = false;
        this.log("system", `${seat.name} is back in.`);
        this.afterChange();
        return;
      }

      case "action": {
        const g = this.game!;
        const seat = this.seatOf(att.userId);
        if (!seat) throw new EngineError("not_seated", "You are not seated");
        if (!g.hand) throw new EngineError("no_hand", "No hand in progress");
        if (typeof msg.seq === "number" && msg.seq !== g.hand.actionSeq) {
          throw new EngineError("stale", "That action is out of date");
        }
        const res = applyAction(g, seat.seat, msg.action);
        this.applyStep(res.state, res.events);
        return;
      }

      case "rebuy": {
        const g = this.game!;
        const seat = this.seatOf(att.userId);
        if (!seat) throw new EngineError("not_seated", "You are not seated");
        const amount = Math.floor(Number(msg.amount));
        if (!Number.isFinite(amount) || amount < g.config.bigBlind || amount > g.config.startingStack) {
          throw new EngineError("bad_amount", `Rebuy must be between ${g.config.bigBlind} and ${g.config.startingStack}`);
        }
        if (isHost) {
          this.grantRebuy(seat.seat, amount);
        } else {
          meta.rebuyRequests = meta.rebuyRequests.filter((r) => r.playerId !== att.userId);
          meta.rebuyRequests.push({ playerId: att.userId, name: att.name, amount, seat: seat.seat });
          this.log("system", `${att.name} requested a rebuy of ${amount}.`);
        }
        this.afterChange();
        return;
      }

      case "approveRebuy": {
        requireHost();
        const req = meta.rebuyRequests.find((r) => r.playerId === msg.playerId);
        if (!req) return;
        meta.rebuyRequests = meta.rebuyRequests.filter((r) => r !== req);
        if (msg.approve) this.grantRebuy(req.seat, req.amount);
        else this.log("system", `Rebuy for ${req.name} was declined.`);
        this.afterChange();
        return;
      }

      case "start": {
        requireHost();
        if (meta.status === "running") return;
        meta.status = "running";
        this.log("system", "Game started.");
        if (canStartHand(this.game!)) this.beginHand();
        else this.afterChange();
        this.syncTableStatus();
        return;
      }

      case "pause": {
        requireHost();
        if (meta.status !== "running") return;
        meta.status = "paused";
        this.log("system", "Game paused. The current hand will finish.");
        this.afterChange();
        this.syncTableStatus();
        return;
      }

      case "resume": {
        requireHost();
        if (meta.status !== "paused") return;
        meta.status = "running";
        this.log("system", "Game resumed.");
        if (!isHandLive(this.game!) && canStartHand(this.game!)) this.beginHand();
        else this.afterChange();
        this.syncTableStatus();
        return;
      }

      case "kick": {
        requireHost();
        const seat = this.seatOf(msg.playerId);
        if (!seat) return;
        if (seat.playerId === meta.hostId) throw new EngineError("bad_kick", "You cannot kick yourself");
        this.leaveSeat(seat.seat, "was removed by the host");
        return;
      }

      case "config": {
        requireHost();
        const g = this.game!;
        const merged = validateConfig({ ...g.config, ...msg.patch, maxSeats: g.config.maxSeats });
        const changes: string[] = [];
        if (merged.variant !== g.config.variant) changes.push(`game → ${VARIANTS[merged.variant].name}`);
        if (merged.smallBlind !== g.config.smallBlind || merged.bigBlind !== g.config.bigBlind) changes.push(`blinds → ${merged.smallBlind}/${merged.bigBlind}`);
        if (merged.ante !== g.config.ante) changes.push(`ante → ${merged.ante}`);
        if (merged.actionTimerMs !== g.config.actionTimerMs) changes.push(`timer → ${Math.round(merged.actionTimerMs / 1000)}s`);
        if (merged.startingStack !== g.config.startingStack) changes.push(`buy-in → ${merged.startingStack}`);
        g.config = merged; // takes effect from the next hand; live hand keeps its own variant copy
        if (changes.length) this.log("system", `Host changed ${changes.join(", ")}${isHandLive(g) ? " (from next hand)" : ""}.`);
        this.afterChange();
        void accounts(this.env).updateTable(meta.code, {
          variant: merged.variant, smallBlind: merged.smallBlind, bigBlind: merged.bigBlind,
        });
        return;
      }

      case "end": {
        requireHost();
        this.endSession();
        return;
      }

      default:
        throw new EngineError("bad_message", "Unknown message");
    }
  }

  // ---------- game flow ----------

  private beginHand() {
    const g = this.game!;
    // players who dropped off before the hand sit out automatically
    for (const s of g.seats) if (s && s.disconnected && s.status === "active") {
      s.status = "sittingOut";
      this.log("system", `${s.name} is sitting out (disconnected).`);
    }
    if (!canStartHand(g)) {
      this.meta!.status = this.meta!.status === "running" ? "waiting" : this.meta!.status;
      this.log("system", "Waiting for at least two players with chips.");
      this.afterChange();
      this.syncTableStatus();
      return;
    }
    const res = startHand(g);
    this.applyStep(res.state, res.events);
  }

  /** Commit a new engine state, log events, schedule the next timer, persist, and broadcast. */
  private applyStep(state: GameState, events: GameEvent[]) {
    const prev = this.game!;
    this.game = state;
    this.logEvents(prev, state, events);
    if (state.hand && state.hand.phase === "showdown" && (!prev.hand || prev.hand.phase !== "showdown")) {
      this.onHandEnded(events);
    }
    this.afterChange();
  }

  private onHandEnded(events: GameEvent[]) {
    const g = this.game!;
    const h = g.hand!;
    this.sql.exec(
      "INSERT OR REPLACE INTO hands (number, variant, board, events, result, ended_at) VALUES (?, ?, ?, ?, ?, ?)",
      h.number, h.variant, JSON.stringify(h.board), JSON.stringify(events), JSON.stringify(h.result), Date.now(),
    );
    this.sql.exec("DELETE FROM hands WHERE number < ? ", h.number - 200);
    // remove players who left mid-hand
    const meta = this.meta!;
    for (const seatNo of meta.leaving) {
      const seat = g.seats[seatNo];
      if (seat) this.departSeat(seatNo);
    }
    meta.leaving = [];
  }

  private afterChange() {
    this.schedule();
    this.save();
    this.broadcast();
  }

  /** Decide the next alarm from the current state. */
  private schedule() {
    const g = this.game!;
    const meta = this.meta!;
    const now = Date.now();
    let timer: TimerInfo | null = null;
    const h = g.hand;
    if (h && h.phase === "betting" && h.actor !== null) {
      timer = { kind: "action", at: now + g.config.actionTimerMs, durationMs: g.config.actionTimerMs };
    } else if (h && h.phase === "discard") {
      timer = { kind: "discard", at: now + DISCARD_TIMER_MS, durationMs: DISCARD_TIMER_MS };
    } else if (h && h.phase === "runout") {
      timer = { kind: "runout", at: now + RUNOUT_PAUSE_MS, durationMs: RUNOUT_PAUSE_MS };
    } else if ((!h || h.phase === "showdown") && meta.status === "running") {
      const contested = !!h?.result && Object.keys(h.result.hands).length > 0;
      const d = contested ? NEXT_HAND_DELAY_SHOWDOWN_MS : NEXT_HAND_DELAY_MS;
      timer = { kind: "nextHand", at: now + d, durationMs: d };
    }
    // keep an existing timer of the same kind for the same action step (don't reset the clock on unrelated changes)
    const seq = h?.actionSeq ?? -1;
    const prevKey = (meta as Meta & { timerKey?: string }).timerKey;
    const key = timer ? `${timer.kind}:${h?.number ?? 0}:${seq}` : null;
    if (timer && prevKey === key && meta.timer && meta.timer.at > now) {
      return; // same step, timer already running
    }
    (meta as Meta & { timerKey?: string }).timerKey = key ?? undefined;
    meta.timer = timer;
    if (timer) void this.ctx.storage.setAlarm(timer.at);
    else void this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const g = this.game;
    const meta = this.meta;
    if (!g || !meta || !meta.timer) return;
    const kind = meta.timer.kind;
    meta.timer = null;
    try {
      const h = g.hand;
      if (kind === "action" && h && h.phase === "betting" && h.actor !== null) {
        const res = timeout(g);
        this.applyStep(res.state, res.events);
      } else if (kind === "discard" && h && h.phase === "discard") {
        const res = timeout(g);
        this.applyStep(res.state, res.events);
      } else if (kind === "runout" && h && h.phase === "runout") {
        const res = advance(g);
        this.applyStep(res.state, res.events);
      } else if (kind === "nextHand" && meta.status === "running" && !isHandLive(g)) {
        this.beginHand();
      } else {
        this.afterChange();
      }
    } catch (e) {
      console.error("alarm error", e);
      this.afterChange();
    }
  }

  // ---------- seats ----------

  private seatOf(userId: string) {
    return this.game?.seats.find((s) => s?.playerId === userId) ?? null;
  }

  private playerCount() {
    return this.game?.seats.filter(Boolean).length ?? 0;
  }

  private grantRebuy(seatNo: number, amount: number) {
    const g = this.game!;
    const seat = g.seats[seatNo];
    if (!seat) return;
    const inHand = isHandLive(g) && g.hand!.players.some((p) => p.seat === seatNo);
    if (inHand) {
      seat.pendingAdd += amount;
      this.log("system", `${seat.name} rebuys ${amount} (added after this hand).`);
    } else {
      seat.stack += amount;
      seat.totalBuyIn += amount;
      this.log("system", `${seat.name} rebuys ${amount}.`);
    }
    if (seat.status === "sittingOut" && !seat.disconnected) seat.status = "active";
  }

  private leaveSeat(seatNo: number, verb: string) {
    const g = this.game!;
    const seat = g.seats[seatNo]!;
    const meta = this.meta!;
    const inHand = isHandLive(g) && g.hand!.players.some((p) => p.seat === seatNo && !p.folded);
    this.log("system", `${seat.name} ${verb}.`);
    if (inHand) {
      seat.status = "sittingOut";
      if (!meta.leaving.includes(seatNo)) meta.leaving.push(seatNo);
      const res = forfeit(g, seatNo);
      this.applyStep(res.state, res.events);
      return;
    }
    this.departSeat(seatNo);
    this.afterChange();
    void accounts(this.env).updateTable(meta.code, { players: this.playerCount() });
  }

  /** Move a seat's totals into the departed ledger and free the seat. */
  private departSeat(seatNo: number) {
    const g = this.game!;
    const seat = g.seats[seatNo];
    if (!seat) return;
    const meta = this.meta!;
    const prior = meta.departed.find((d) => d.userId === seat.playerId);
    const entry: Departed = {
      userId: seat.playerId, name: seat.name,
      buyIn: seat.totalBuyIn + (prior?.buyIn ?? 0),
      cashOut: seat.stack + seat.pendingAdd * 0 + (prior?.cashOut ?? 0),
      handsPlayed: seat.handsPlayed + (prior?.handsPlayed ?? 0),
      biggestPot: Math.max(seat.biggestPot, prior?.biggestPot ?? 0),
    };
    meta.departed = meta.departed.filter((d) => d.userId !== seat.playerId);
    meta.departed.push(entry);
    meta.rebuyRequests = meta.rebuyRequests.filter((r) => r.playerId !== seat.playerId);
    this.game = removePlayer(g, seatNo);
  }

  private sessionResults(): SessionResultRow[] {
    const g = this.game!;
    const meta = this.meta!;
    const rows = new Map<string, SessionResultRow>();
    for (const d of meta.departed) {
      rows.set(d.userId, { userId: d.userId, name: d.name, buyIn: d.buyIn, cashOut: d.cashOut, net: d.cashOut - d.buyIn, handsPlayed: d.handsPlayed, biggestPot: d.biggestPot });
    }
    for (const s of g.seats) {
      if (!s) continue;
      const prev = rows.get(s.playerId);
      const buyIn = s.totalBuyIn + (prev?.buyIn ?? 0);
      const cashOut = s.stack + (prev?.cashOut ?? 0);
      rows.set(s.playerId, {
        userId: s.playerId, name: s.name, buyIn, cashOut, net: cashOut - buyIn,
        handsPlayed: s.handsPlayed + (prev?.handsPlayed ?? 0), biggestPot: Math.max(s.biggestPot, prev?.biggestPot ?? 0),
      });
    }
    return [...rows.values()].sort((a, b) => b.net - a.net);
  }

  private endSession() {
    const g = this.game!;
    const meta = this.meta!;
    if (isHandLive(g)) {
      // settle the live hand by returning every player's chips (the hand is void)
      const h = g.hand!;
      for (const p of h.players) g.seats[p.seat]!.stack += p.totalBet;
      h.phase = "showdown";
      h.actor = null;
      h.pendingDiscard = [];
      this.log("system", "Current hand voided; bets returned.");
    }
    meta.status = "ended";
    meta.timer = null;
    (meta as Meta & { timerKey?: string }).timerKey = undefined;
    void this.ctx.storage.deleteAlarm();
    const results = this.sessionResults();
    this.log("system", "Session ended by the host.");
    this.save();
    this.broadcast();
    for (const ws of this.ctx.getWebSockets()) this.send(ws, { t: "ended", results });
    const endedAt = Date.now();
    void accounts(this.env).recordResults(meta.code, meta.name, results, endedAt);
  }

  private syncTableStatus() {
    const meta = this.meta!;
    void accounts(this.env).updateTable(meta.code, { status: meta.status, players: this.playerCount() });
  }

  // ---------- views & messaging ----------

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closed */
    }
  }

  private sendState(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    this.send(ws, { t: "state", view: this.viewFor(att.userId) });
  }

  private broadcast() {
    const views = new Map<string, TableView>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      let v = views.get(att.userId);
      if (!v) {
        v = this.viewFor(att.userId);
        views.set(att.userId, v);
      }
      this.send(ws, { t: "state", view: v });
    }
    if (this.unsentLog.length) {
      const lines = this.unsentLog;
      this.unsentLog = [];
      for (const ws of this.ctx.getWebSockets()) this.send(ws, { t: "log", lines });
    }
  }

  private viewFor(userId: string): TableView {
    const g = this.game!;
    const meta = this.meta!;
    const h = g.hand;
    const mySeat = this.seatOf(userId);
    const showAll = !!h && (h.phase === "showdown" || h.phase === "runout");

    const seats: (PublicSeat | null)[] = g.seats.map((s) => {
      if (!s) return null;
      const hp = h?.players.find((p) => p.seat === s.seat) ?? null;
      const mine = s.playerId === userId;
      let cards: (Card | null)[] | null = null;
      if (hp) {
        const visible = mine || (hp.revealed && showAll && !hp.folded);
        cards = visible ? [...hp.hole] : hp.folded ? [] : hp.hole.map(() => null);
      }
      const shown = h?.result?.hands[s.seat];
      return {
        seat: s.seat, playerId: s.playerId, name: s.name, stack: s.stack, status: s.status, disconnected: s.disconnected,
        isHost: s.playerId === meta.hostId, inHand: !!hp, folded: hp?.folded ?? false, allIn: hp?.allIn ?? false,
        streetBet: hp?.streetBet ?? 0, totalBet: hp?.totalBet ?? 0, cards, discarded: hp?.discarded.length ?? 0,
        revealed: !!hp && hp.revealed && showAll, handName: shown?.name, bestCards: shown?.cards,
        pendingAdd: s.pendingAdd, totalBuyIn: s.totalBuyIn,
      };
    });

    let limits = null;
    if (h && h.phase === "betting" && mySeat && h.actor === mySeat.seat) {
      try { limits = getLimits(g, mySeat.seat); } catch { limits = null; }
    }

    const hand = h
      ? {
          number: h.number, variant: h.variant, street: h.street, phase: h.phase, board: [...h.board], actor: h.actor,
          currentBet: h.currentBet, minRaise: h.minRaise, pot: h.players.reduce((a, p) => a + p.totalBet, 0),
          pots: computePots(h.players.map((p) => ({ ...p, totalBet: p.totalBet - p.streetBet }))),
          pendingDiscard: [...h.pendingDiscard], result: h.result, actionSeq: h.actionSeq, button: h.button,
          smallBlindSeat: h.smallBlindSeat, bigBlindSeat: h.bigBlindSeat,
        }
      : null;

    return {
      code: meta.code, name: meta.name, status: meta.status, hostId: meta.hostId, config: g.config, seats, button: g.button,
      handCount: g.handCount, hand, timer: meta.timer, rebuyRequests: userId === meta.hostId ? meta.rebuyRequests : meta.rebuyRequests.filter((r) => r.playerId === userId),
      me: { userId, seat: mySeat?.seat ?? null, limits, isHost: userId === meta.hostId },
      serverTime: Date.now(),
    };
  }

  // ---------- log ----------

  private log(kind: LogLine["kind"], text: string) {
    const meta = this.meta!;
    const line: LogLine = { id: ++meta.logSeq, ts: Date.now(), handNumber: this.game?.hand?.number ?? 0, text, kind };
    this.pendingLog.push(line);
  }

  private recentLog(): LogLine[] {
    return this.sql.exec<{ id: number; ts: number; hand: number; kind: LogLine["kind"]; text: string }>(
      "SELECT id, ts, hand, kind, text FROM log ORDER BY id DESC LIMIT 60",
    ).toArray().reverse().map((r) => ({ id: r.id, ts: r.ts, handNumber: r.hand, kind: r.kind, text: r.text }));
  }

  private recentChat(): ChatMessage[] {
    return this.sql.exec<{ id: number; ts: number; user_id: string; name: string; text: string }>(
      "SELECT id, ts, user_id, name, text FROM chat ORDER BY id DESC LIMIT 40",
    ).toArray().reverse().map((r) => ({ id: r.id, ts: r.ts, userId: r.user_id, name: r.name, text: r.text }));
  }

  private logEvents(prev: GameState, state: GameState, events: GameEvent[]) {
    const name = (seat: number) => state.seats[seat]?.name ?? prev.seats[seat]?.name ?? `Seat ${seat + 1}`;
    for (const e of events) {
      switch (e.type) {
        case "handStarted":
          this.log("system", `— Hand #${e.handNumber} · ${VARIANTS[e.variant].short} · ${name(e.button)} has the button —`);
          break;
        case "blind":
          this.log("action", `${name(e.seat)} posts ${e.kind === "sb" ? "small blind" : e.kind === "bb" ? "big blind" : "ante"} ${e.amount}`);
          break;
        case "action": {
          const verb = e.action === "fold" ? "folds" : e.action === "check" ? "checks" : e.action === "call" ? `calls ${e.amount}` : e.action === "bet" ? `bets ${e.amount}` : `raises to ${e.amount}`;
          this.log("action", `${name(e.seat)} ${verb}${e.allIn ? " (all-in)" : ""}`);
          break;
        }
        case "discarded":
          this.log("action", `${name(e.seat)} discards`);
          break;
        case "timeout":
          this.log("system", `${name(e.seat)} timed out`);
          break;
        case "street":
          this.log("street", `${e.street[0]!.toUpperCase() + e.street.slice(1)}: ${e.board.join(" ")}`);
          break;
        case "showdown":
          this.log("result", `${name(e.seat)} shows ${e.cards.join(" ")} — ${e.handName}`);
          break;
        case "potAwarded":
          this.log("result", `${name(e.seat)} wins ${e.amount}${e.handName ? ` with ${e.handName}` : ""}`);
          break;
        case "returned":
          this.log("result", `${e.amount} returned to ${name(e.seat)}`);
          break;
        case "handEnded":
          break;
      }
    }
  }
}

type Card = import("@engine/cards").Card;
