import { DurableObject } from "cloudflare:workers";
import {
  EngineError, GHOST_SEAT, VARIANTS, advance, applyAction, canStartHand, computePots, createGame, forfeit, getLimits, isHandLive,
  participants, rabbitBoards, removePlayer, seatPlayer, setGhost, startHand, timeout,
  type GameEvent, type GameState, type TableConfig,
} from "@engine/index";
import { addHud, emptyHud, hudFromHand, type HandRecord, type HudCounters } from "@engine/hud";
import type {
  ChatMessage, ClientMessage, HandRecordView, HandSummary, LogLine, PublicGhost, PublicSeat, RebuyRequest, ServerMessage, SessionResultRow, TableOptions,
  TableStatus, TableView, TimerInfo,
} from "@shared/protocol";
import { LIMITS, TAUNTS, TAUNT_COOLDOWN_MS, defaultOptions, validateConfig } from "@shared/protocol";
import { type Flags, defaultFlags, normalizeFlags } from "@shared/flags";
import { accounts, type Env } from "./env";
import { errFields, slog, type LogFields, type LogLevel } from "./slog";

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
  /** host config change waiting for the next hand */
  pendingConfig: TableConfig | null;
  /** seats that were sat out automatically because they disconnected; they come back on reconnect */
  autoSatOut: number[];
  timerKey?: string;
  options: TableOptions;
  /** session HUD counters per userId */
  hud: Record<string, HudCounters>;
  /** hand record being built for the hand in progress */
  cur: { startedAt: number; events: GameEvent[]; startStacks: Record<number, number> } | null;
  /** hand numbers whose replays reveal every card */
  unlocked: number[];
  /** reveal votes per hand number: userIds */
  votes: Record<string, string[]>;
  /** rabbit hunt revealed for this hand number */
  rabbitShown: number | null;
  /** operator feature flags, pushed from AccountsDO and refreshed on every connection */
  flags: Flags;
  /** vote in progress to turn the ghost player on/off: voter userIds */
  ghostVote: { on: boolean; voters: string[] } | null;
  /** last taunt per userId (cooldown) */
  lastTaunt: Record<string, number>;
}

interface Attachment {
  userId: string;
  name: string;
}

const RUNOUT_PAUSE_MS = 1400;
const NEXT_HAND_DELAY_MS = 3500;
const NEXT_HAND_DELAY_SHOWDOWN_MS = 6000;
const DISCARD_TIMER_MS = 20_000;
const BAD_BEAT_EXTRA_MS = 3000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, hand INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hands (number INTEGER PRIMARY KEY, variant TEXT NOT NULL, board TEXT NOT NULL, events TEXT NOT NULL, result TEXT, ended_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hand_records (number INTEGER PRIMARY KEY, record TEXT NOT NULL, ended_at INTEGER NOT NULL);
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

  // ---------- structured logs (see slog.ts) ----------

  /** One structured log line with table context. */
  private slog(level: LogLevel, evt: string, fields: LogFields = {}) {
    const g = this.game;
    slog(level, evt, { table: this.meta?.code, hand: g?.hand?.number ?? 0, phase: g?.hand?.phase ?? null, status: this.meta?.status, ...fields });
  }

  /** Compact seat snapshot for logs. Never includes cards. */
  private seatsSnapshot() {
    return (this.game?.seats ?? []).flatMap((s) => (s ? [{ seat: s.seat, name: s.name, stack: s.stack, status: s.status, disc: s.disconnected }] : []));
  }

  /** Admin debug snapshot: full server state with live hole cards and the deck hidden. */
  async debugSnapshot(): Promise<unknown> {
    if (!this.meta || !this.game) return null;
    const g = structuredClone(this.game);
    if (g.hand && g.hand.phase !== "showdown") {
      g.hand.deck = [];
      for (const p of g.hand.players) p.hole = p.hole.map(() => "??" as never);
      if (g.hand.ghost) g.hand.ghost.hole = g.hand.ghost.hole.map(() => "??" as never);
    } else if (g.hand) g.hand.deck = [];
    const { hud: _hud, ...meta } = this.meta;
    let alarmAt: number | null = null;
    try { alarmAt = await this.ctx.storage.getAlarm(); } catch { /* ignore */ }
    return {
      now: Date.now(), alarmAt, meta, game: g,
      sockets: this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Attachment | null)?.name ?? "?"),
      log: this.sql.exec<{ ts: number; hand: number; kind: string; text: string }>("SELECT ts, hand, kind, text FROM log ORDER BY id DESC LIMIT 150").toArray().reverse(),
    };
  }

  // ---------- persistence ----------

  private load() {
    const rows = this.sql.exec<{ key: string; value: string }>("SELECT key, value FROM kv").toArray();
    for (const r of rows) {
      if (r.key === "meta") {
        const m = JSON.parse(r.value) as Partial<Meta>;
        this.meta = {
          ...m, options: { ...defaultOptions(), ...(m.options ?? {}) }, hud: m.hud ?? {}, cur: m.cur ?? null, unlocked: m.unlocked ?? [],
          votes: m.votes ?? {}, rabbitShown: m.rabbitShown ?? null, pendingConfig: m.pendingConfig ?? null, autoSatOut: m.autoSatOut ?? [],
          flags: normalizeFlags(m.flags), ghostVote: m.ghostVote ?? null, lastTaunt: m.lastTaunt ?? {},
        } as Meta;
      }
      if (r.key === "game") {
        const g = JSON.parse(r.value) as GameState & { hand: (GameState["hand"] & { board?: Card[] }) | null };
        // forward-compatible defaults for states saved by earlier versions
        g.config = validateConfig(g.config);
        g.ghost ??= { enabled: false, stack: 0 };
        if (g.hand) {
          g.hand.boards ??= [g.hand.board ?? []];
          g.hand.eliminated ??= null;
          g.hand.ghost ??= null;
          if (g.hand.result) {
            g.hand.result.boardHands ??= [];
            g.hand.result.ghost ??= null;
            g.hand.result.badBeat ??= null;
          }
        }
        this.game = g;
      }
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

  async init(args: { code: string; name: string; hostId: string; hostName: string; config: TableConfig; flags?: Flags }): Promise<void> {
    if (this.meta) return;
    this.meta = {
      code: args.code, name: args.name, hostId: args.hostId, hostName: args.hostName, status: "waiting",
      createdAt: Date.now(), timer: null, rebuyRequests: [], departed: [], logSeq: 0, chatSeq: 0, leaving: [],
      pendingConfig: null, autoSatOut: [], options: defaultOptions(), hud: {}, cur: null, unlocked: [], votes: {}, rabbitShown: null,
      flags: args.flags ? normalizeFlags(args.flags) : defaultFlags(),
      ghostVote: null, lastTaunt: {},
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

  /** Pushed by AccountsDO when an admin flips a flag. */
  async setFlags(flags: Flags): Promise<void> {
    if (!this.meta || !this.game) return;
    this.applyFlags(normalizeFlags(flags), true);
  }

  private applyFlags(flags: Flags, announce: boolean) {
    const meta = this.meta!;
    const g = this.game!;
    const changed = JSON.stringify(flags) !== JSON.stringify(meta.flags);
    if (changed) this.slog("info", "flags.apply", { flags, pushed: announce });
    meta.flags = flags;
    // Variants off: fall back to Hold'em, from the next hand if one is live.
    const target = meta.pendingConfig ?? g.config;
    if (!flags.variants && target.variant !== "nlhe") {
      const cfg = { ...target, variant: "nlhe" as const };
      if (isHandLive(g)) meta.pendingConfig = cfg;
      else g.config = cfg;
      this.log("system", `Omaha and Pineapple are switched off for now; this table plays Hold'em${isHandLive(g) ? " from the next hand" : ""}.`);
      void accounts(this.env).updateTable(meta.code, { variant: "nlhe", smallBlind: cfg.smallBlind, bigBlind: cfg.bigBlind });
    }
    const target2 = meta.pendingConfig ?? g.config;
    if (!flags.squid && target2.boards > 1) {
      const cfg = { ...target2, boards: 1, squid: false };
      if (isHandLive(g)) meta.pendingConfig = cfg;
      else g.config = cfg;
      this.log("system", `Multi-board games are switched off for now; this table deals one board${isHandLive(g) ? " from the next hand" : ""}.`);
    }
    if (!flags.ghost && meta.ghostVote) meta.ghostVote = null;
    if (changed && announce) this.afterChange();
    else if (changed) this.save();
  }

  // ---------- WebSocket lifecycle ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    if (!this.meta || !this.game) return new Response("table not found", { status: 404 });
    const userId = request.headers.get("x-user-id");
    const name = request.headers.get("x-user-name");
    if (!userId || !name) return new Response("unauthorized", { status: 401 });
    const rawFlags = request.headers.get("x-flags");
    if (rawFlags) {
      try { this.applyFlags(normalizeFlags(JSON.parse(rawFlags)), false); } catch { /* ignore malformed */ }
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, name } satisfies Attachment);

    // reconnect: clear disconnected flag
    const seat = this.seatOf(userId);
    this.slog("info", "ws.connect", { user: name, userId, seat: seat?.seat ?? null, wasDisconnected: seat?.disconnected ?? null, autoSatOut: seat ? this.meta.autoSatOut.includes(seat.seat) : null, sockets: this.ctx.getWebSockets().length });
    if (seat && (seat.disconnected || this.meta.autoSatOut.includes(seat.seat))) {
      seat.disconnected = false;
      if (this.meta.autoSatOut.includes(seat.seat)) {
        this.meta.autoSatOut = this.meta.autoSatOut.filter((x) => x !== seat.seat);
        if (seat.status === "sittingOut") {
          seat.status = "active";
          this.log("system", `${seat.name} is back.`);
        }
      }
      this.afterChange();
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
    if (msg.t !== "ping" && msg.t !== "listHands" && msg.t !== "getHand") {
      const m = msg as unknown as Record<string, unknown>;
      const detail: LogFields = {};
      if (msg.t === "action") Object.assign(detail, { action: msg.action.type, amount: msg.action.amount, seq: msg.seq, actor: this.game.hand?.actor ?? null, actionSeq: this.game.hand?.actionSeq ?? null });
      else if (msg.t === "chat") detail.len = String(m.text ?? "").length;
      else for (const [k, v] of Object.entries(m)) if (k !== "t" && (typeof v !== "object" || v === null)) detail[k] = v;
      this.slog("info", `msg.${msg.t}`, { user: att.name, seat: this.seatOf(att.userId)?.seat ?? null, ...detail });
    }
    try {
      this.handle(ws, att, msg);
    } catch (e) {
      if (e instanceof EngineError) {
        this.slog("warn", "msg.rejected", { t: msg.t, user: att.name, code: e.code, message: e.message });
        this.send(ws, { t: "error", code: e.code, message: e.message });
        // resync the sender so their UI matches the server
        this.sendState(ws);
      } else {
        this.slog("error", "msg.crash", { t: msg.t, user: att.name, ...errFields(e) });
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
    const seat = this.seatOf(att.userId);
    this.slog("info", "ws.close", { user: att.name, seat: seat?.seat ?? null, otherSockets: others.length });
    if (others.length) return;
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

    const requireFlag = (on: boolean) => {
      if (!on) throw new EngineError("disabled", "That feature is switched off right now");
    };

    switch (msg.t) {
      case "ping":
        return this.send(ws, { t: "pong", serverTime: Date.now() });

      case "chat": {
        requireFlag(meta.flags.chat);
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
        meta.autoSatOut = meta.autoSatOut.filter((x) => x !== seat.seat);
        this.log("system", `${seat.name} is sitting out.`);
        this.afterChange();
        return;
      }

      case "sitIn": {
        const seat = this.seatOf(att.userId);
        if (!seat) throw new EngineError("not_seated", "You are not seated");
        seat.status = "active";
        seat.disconnected = false;
        meta.autoSatOut = meta.autoSatOut.filter((x) => x !== seat.seat);
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
        if (!meta.flags.variants && merged.variant !== "nlhe") throw new EngineError("disabled", "Omaha and Pineapple are switched off right now");
        if (!meta.flags.squid && merged.boards > 1) throw new EngineError("disabled", "Multi-board games are switched off right now");
        const changes: string[] = [];
        if (merged.boards !== g.config.boards || merged.squid !== g.config.squid) changes.push(merged.boards === 1 ? "one board" : `${merged.boards} boards${merged.squid ? " (Squid Game)" : ""}`);
        if (merged.variant !== g.config.variant) changes.push(`game → ${VARIANTS[merged.variant].name}`);
        if (merged.smallBlind !== g.config.smallBlind || merged.bigBlind !== g.config.bigBlind) changes.push(`blinds → ${merged.smallBlind}/${merged.bigBlind}`);
        if (merged.ante !== g.config.ante) changes.push(`ante → ${merged.ante}`);
        if (merged.actionTimerMs !== g.config.actionTimerMs) changes.push(`timer → ${Math.round(merged.actionTimerMs / 1000)}s`);
        if (merged.startingStack !== g.config.startingStack) changes.push(`buy-in → ${merged.startingStack}`);
        if (isHandLive(g)) meta.pendingConfig = merged; // applied by beginHand so the live hand's rules never change
        else g.config = merged;
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

      case "options": {
        requireHost();
        const patch = msg.patch ?? {};
        if (typeof patch.rabbitHunt === "boolean") meta.options.rabbitHunt = patch.rabbitHunt;
        if (typeof patch.autoUnlockReplays === "boolean") meta.options.autoUnlockReplays = patch.autoUnlockReplays;
        this.log("system", `Host set rabbit hunting ${meta.options.rabbitHunt ? "on" : "off"} and replay reveals to ${meta.options.autoUnlockReplays ? "automatic" : "majority vote"}.`);
        this.afterChange();
        return;
      }

      case "rabbit": {
        const g = this.game!;
        const h = g.hand;
        if (!this.seatOf(att.userId)) throw new EngineError("not_seated", "Only seated players can rabbit hunt");
        requireFlag(meta.flags.rabbitHunt);
        if (!meta.options.rabbitHunt) throw new EngineError("rabbit_off", "Rabbit hunting is turned off");
        if (!h || h.phase !== "showdown" || h.boards[0]!.length >= 5) throw new EngineError("no_rabbit", "Nothing to rabbit hunt");
        if (meta.rabbitShown === h.number) return;
        meta.rabbitShown = h.number;
        const cards = rabbitBoards(h);
        this.log("system", `${att.name} rabbit hunts: ${cards.map((b) => b.join(" ")).join(" | ")} would have come.`);
        this.afterChange();
        return;
      }

      case "ghostVote": {
        requireFlag(meta.flags.ghost);
        const g = this.game!;
        const mine = this.seatOf(att.userId);
        if (!mine) throw new EngineError("not_seated", "Only seated players can vote on the ghost");
        const on = !!msg.on;
        if (on === g.ghost.enabled) return;
        if (!on && g.ghost.stack > 0) throw new EngineError("ghost_has_chips", "The ghost still has chips; beat it at showdown first");
        const seated = g.seats.filter((s): s is NonNullable<typeof s> => !!s);
        const needed = Math.floor(seated.length / 2) + 1;
        if (!meta.ghostVote || meta.ghostVote.on !== on) meta.ghostVote = { on, voters: [] };
        if (!meta.ghostVote.voters.includes(att.userId)) meta.ghostVote.voters.push(att.userId);
        const count = meta.ghostVote.voters.filter((id) => seated.some((s) => s.playerId === id)).length;
        if (count >= needed) {
          this.game = setGhost(g, on);
          meta.ghostVote = null;
          this.log("system", on ? `👻 The ghost player joins${isHandLive(g) ? " from the next hand" : ""}. It never bets, always sees showdown, and only wins there.` : "The ghost player leaves the table.");
        } else {
          this.log("system", `${att.name} voted to turn the ghost ${on ? "on" : "off"} (${count}/${needed}).`);
        }
        this.afterChange();
        return;
      }

      case "taunt": {
        requireFlag(meta.flags.taunts);
        const id = Number(msg.id);
        if (!Number.isInteger(id) || id < 0 || id >= TAUNTS.length) throw new EngineError("bad_taunt", "Unknown taunt");
        const now = Date.now();
        const last = meta.lastTaunt[att.userId] ?? 0;
        if (now - last < TAUNT_COOLDOWN_MS) throw new EngineError("taunt_cooldown", "Easy there — one taunt every few seconds");
        meta.lastTaunt[att.userId] = now;
        for (const k of Object.keys(meta.lastTaunt)) if (now - meta.lastTaunt[k]! > 60_000) delete meta.lastTaunt[k];
        this.save();
        const seat = this.seatOf(att.userId)?.seat ?? null;
        const t = { userId: att.userId, name: att.name, seat, id, ts: now };
        for (const s of this.ctx.getWebSockets()) this.send(s, { t: "taunt", taunt: t });
        return;
      }

      case "listHands": {
        requireFlag(meta.flags.replays);
        this.send(ws, { t: "hands", hands: this.handSummaries(att.userId) });
        return;
      }

      case "getHand": {
        requireFlag(meta.flags.replays);
        const rec = this.loadRecord(Number(msg.number));
        if (!rec) throw new EngineError("no_such_hand", "That hand is not available");
        this.send(ws, { t: "hand", hand: this.recordView(rec, att.userId) });
        return;
      }

      case "vote": {
        requireFlag(meta.flags.replays);
        const n = Number(msg.number);
        const rec = this.loadRecord(n);
        if (!rec) throw new EngineError("no_such_hand", "That hand is not available");
        if (!rec.players.some((p) => p.playerId === att.userId)) throw new EngineError("not_in_hand", "Only players dealt into the hand can vote");
        if (meta.unlocked.includes(n)) return;
        const key = String(n);
        const list = meta.votes[key] ?? [];
        if (!list.includes(att.userId)) list.push(att.userId);
        meta.votes[key] = list;
        const needed = Math.floor(rec.players.length / 2) + 1;
        if (list.length >= needed) {
          meta.unlocked.push(n);
          delete meta.votes[key];
          this.log("system", `Hand #${n} replay unlocked: all cards and equities are now visible.`);
        } else {
          this.log("system", `${att.name} voted to reveal hand #${n} (${list.length}/${needed}).`);
        }
        this.save();
        this.broadcast();
        for (const sock of this.ctx.getWebSockets()) {
          const a = sock.deserializeAttachment() as Attachment | null;
          if (a) this.send(sock, { t: "hands", hands: this.handSummaries(a.userId) });
        }
        return;
      }

      default:
        throw new EngineError("bad_message", "Unknown message");
    }
  }

  // ---------- game flow ----------

  private beginHand() {
    const g = this.game!;
    const meta = this.meta!;
    if (meta.pendingConfig) {
      g.config = meta.pendingConfig;
      meta.pendingConfig = null;
    }
    // players who dropped off before the hand sit out automatically (and return when they reconnect)
    for (const s of g.seats) if (s && s.disconnected && s.status === "active") {
      s.status = "sittingOut";
      if (!meta.autoSatOut.includes(s.seat)) meta.autoSatOut.push(s.seat);
      this.log("system", `${s.name} is sitting out (disconnected).`);
      this.slog("info", "seat.autoSitOut", { seat: s.seat, user: s.name });
    }
    if (!canStartHand(g)) {
      // Stay "running": the next hand is dealt automatically once two players can play again (see schedule()).
      this.slog("info", "hand.skip", { reason: "fewer_than_two_participants", participants: participants(g).length, seats: this.seatsSnapshot() });
      this.log("system", "Waiting for at least two players with chips.");
      this.afterChange();
      this.syncTableStatus();
      return;
    }
    let res;
    try {
      res = startHand(g, undefined, { allowGhost: meta.flags.ghost });
    } catch (e) {
      if (e instanceof EngineError && e.code === "deck_short") {
        this.slog("warn", "hand.skip", { reason: "deck_short", message: e.message, seats: this.seatsSnapshot(), config: g.config, ghost: g.ghost });
        meta.status = "waiting";
        this.log("system", `${e.message}. Someone needs to sit out, or the host can change the game.`);
        this.afterChange();
        this.syncTableStatus();
        return;
      }
      throw e;
    }
    const nh = res.state.hand!;
    this.slog("info", "hand.start", {
      hand: nh.number, variant: nh.variant, boards: nh.boards.length, button: nh.button, sb: nh.smallBlindSeat, bb: nh.bigBlindSeat,
      players: nh.players.map((p) => p.seat), ghost: nh.ghost ? nh.ghost.stake : null, seats: this.seatsSnapshot(),
    });
    this.applyStep(res.state, res.events);
  }

  /** Commit a new engine state, log events, schedule the next timer, persist, and broadcast. */
  private applyStep(state: GameState, events: GameEvent[]) {
    const prev = this.game!;
    const meta = this.meta!;
    this.game = state;
    if (state.hand && (!prev.hand || prev.hand.number !== state.hand.number)) {
      const startStacks: Record<number, number> = {};
      for (const p of state.hand.players) startStacks[p.seat] = (state.seats[p.seat]?.stack ?? 0) + p.totalBet;
      meta.cur = { startedAt: Date.now(), events: [], startStacks };
      meta.rabbitShown = null;
    }
    if (meta.cur) meta.cur.events.push(...events);
    this.logEvents(prev, state, events);
    if (state.hand && state.hand.phase === "showdown" && (!prev.hand || prev.hand.phase !== "showdown")) {
      this.onHandEnded(events);
    }
    this.afterChange();
  }

  private onHandEnded(_events: GameEvent[]) {
    const g = this.game!;
    const h = g.hand!;
    const meta = this.meta!;
    const now = Date.now();
    const rec: HandRecord = {
      number: h.number, variant: h.variant, button: h.button, smallBlindSeat: h.smallBlindSeat, bigBlindSeat: h.bigBlindSeat,
      blinds: { sb: g.config.smallBlind, bb: g.config.bigBlind, ante: g.config.ante },
      players: h.players.map((p) => ({
        seat: p.seat, playerId: p.playerId, name: g.seats[p.seat]?.name ?? "?", hole: [...p.hole], discarded: [...p.discarded],
        startStack: meta.cur?.startStacks[p.seat] ?? 0, revealed: p.revealed && !p.folded, folded: p.folded,
      })),
      boards: h.boards.map((b) => [...b]), eliminated: h.eliminated, rabbit: rabbitBoards(h), events: meta.cur?.events ?? [], result: h.result,
      ghost: h.ghost ? { hole: [...h.ghost.hole], discarded: [...h.ghost.discarded], stake: h.ghost.stake, won: h.result?.ghost?.won ?? 0 } : null,
      startedAt: meta.cur?.startedAt ?? now, endedAt: now,
    };
    this.sql.exec("INSERT OR REPLACE INTO hand_records (number, record, ended_at) VALUES (?, ?, ?)", h.number, JSON.stringify(rec), now);
    this.sql.exec("DELETE FROM hand_records WHERE number < ?", h.number - 150);
    this.slog("info", "hand.end", {
      durationMs: now - rec.startedAt, net: h.result?.net ?? null, ghostWon: h.result?.ghost?.won ?? null, eliminated: h.eliminated, badBeat: !!h.result?.badBeat,
      showdown: h.result ? Object.keys(h.result.hands).length > 0 : null, seats: this.seatsSnapshot(),
    });
    meta.cur = null;
    if (meta.options.autoUnlockReplays && !meta.unlocked.includes(h.number)) meta.unlocked.push(h.number);
    if (meta.unlocked.length > 200) meta.unlocked = meta.unlocked.slice(-200);
    // session HUD
    const per = hudFromHand(rec);
    for (const p of rec.players) {
      const c = per[p.seat];
      if (!c) continue;
      meta.hud[p.playerId] = addHud(meta.hud[p.playerId] ?? emptyHud(), c);
    }
    // remove players who left mid-hand
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
    } else if ((!h || h.phase === "showdown") && meta.status === "running" && canStartHand(g)) {
      const contested = !!h?.result && Object.keys(h.result.hands).length > 0;
      const d = (contested ? NEXT_HAND_DELAY_SHOWDOWN_MS : NEXT_HAND_DELAY_MS) + (h?.result?.badBeat && meta.flags.badBeat ? BAD_BEAT_EXTRA_MS : 0);
      timer = { kind: "nextHand", at: now + d, durationMs: d };
    }
    // keep an existing timer of the same kind for the same action step (don't reset the clock on unrelated changes)
    const seq = h?.actionSeq ?? -1;
    const prevKey = meta.timerKey;
    const key = timer ? `${timer.kind}:${h?.number ?? 0}:${seq}` : null;
    if (timer && prevKey === key && meta.timer && meta.timer.at > now) {
      return; // same step, timer already running
    }
    if (key !== (prevKey ?? null)) {
      this.slog("debug", "timer.set", { kind: timer?.kind ?? null, delayMs: timer ? timer.at - now : null, actor: h?.actor ?? null, canStart: canStartHand(g) });
    }
    meta.timerKey = key ?? undefined;
    meta.timer = timer;
    if (timer) void this.ctx.storage.setAlarm(timer.at);
    else void this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const g = this.game;
    const meta = this.meta;
    if (!g || !meta || !meta.timer) return;
    const kind = meta.timer.kind;
    this.slog("info", "alarm", { kind, lateMs: Date.now() - meta.timer.at, actor: g.hand?.actor ?? null });
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
        this.slog("info", "alarm.noop", { kind });
        this.afterChange();
      }
    } catch (e) {
      this.slog("error", "alarm.crash", { kind, ...errFields(e) });
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
      cashOut: seat.stack + (prior?.cashOut ?? 0),
      handsPlayed: seat.handsPlayed + (prior?.handsPlayed ?? 0),
      biggestPot: Math.max(seat.biggestPot, prior?.biggestPot ?? 0),
    };
    meta.departed = meta.departed.filter((d) => d.userId !== seat.playerId);
    meta.departed.push(entry);
    meta.rebuyRequests = meta.rebuyRequests.filter((r) => r.playerId !== seat.playerId);
    meta.autoSatOut = meta.autoSatOut.filter((x) => x !== seatNo);
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
      if (h.ghost) g.ghost.stack += h.ghost.stake;
      h.phase = "showdown";
      h.actor = null;
      h.pendingDiscard = [];
      this.log("system", "Current hand voided; bets returned.");
    }
    this.slog("info", "session.end", { seats: this.seatsSnapshot(), departed: meta.departed.length });
    meta.status = "ended";
    meta.timer = null;
    meta.timerKey = undefined;
    void this.ctx.storage.deleteAlarm();
    const results = this.sessionResults();
    this.log("system", "Session ended by the host.");
    this.save();
    this.broadcast();
    for (const ws of this.ctx.getWebSockets()) this.send(ws, { t: "ended", results });
    const endedAt = Date.now();
    void accounts(this.env).recordResults(meta.code, meta.name, results, endedAt);
    void accounts(this.env).recordHud(meta.code, meta.hud);
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

    let ghostView: PublicGhost | null = null;
    if (h?.ghost) {
      const gh = h.ghost;
      const open = gh.revealed && showAll;
      const best = h.result?.ghost ? Object.values(h.result.ghost.hands).sort((a, b) => b.score - a.score)[0] : undefined;
      ghostView = { cards: open ? [...gh.hole] : gh.hole.map(() => null), stake: gh.stake, handName: open ? best?.name : undefined, bestCards: open ? best?.cards : undefined, won: h.result?.ghost?.won ?? 0 };
    }
    const hand = h
      ? {
          number: h.number, variant: h.variant, street: h.street, phase: h.phase, boards: h.boards.map((b) => [...b]), eliminated: h.eliminated, ghost: ghostView, actor: h.actor,
          currentBet: h.currentBet, minRaise: h.minRaise, pot: h.players.reduce((a, p) => a + p.totalBet, 0),
          pots: computePots(h.players.map((p) => ({ ...p, totalBet: p.totalBet - p.streetBet }))),
          pendingDiscard: [...h.pendingDiscard], result: h.result && !meta.flags.badBeat ? { ...h.result, badBeat: null } : h.result, actionSeq: h.actionSeq, button: h.button,
          smallBlindSeat: h.smallBlindSeat, bigBlindSeat: h.bigBlindSeat,
          rabbit: h.phase === "showdown" && meta.rabbitShown === h.number ? rabbitBoards(h) : null,
          rabbitAvailable: h.phase === "showdown" && h.boards[0]!.length < 5 && meta.flags.rabbitHunt && meta.options.rabbitHunt && meta.rabbitShown !== h.number && !!mySeat,
        }
      : null;

    return {
      code: meta.code, name: meta.name, status: meta.status, hostId: meta.hostId, config: g.config, seats, button: g.button,
      handCount: g.handCount, hand, timer: meta.timer, options: meta.options, hud: meta.flags.hud ? meta.hud : {}, flags: meta.flags,
      ghost: {
        enabled: g.ghost.enabled, stack: g.ghost.stack,
        vote: meta.ghostVote ? {
          on: meta.ghostVote.on, votes: meta.ghostVote.voters.filter((id) => g.seats.some((s) => s?.playerId === id)).length,
          needed: Math.floor(g.seats.filter(Boolean).length / 2) + 1, voted: meta.ghostVote.voters.includes(userId),
        } : null,
      },
      rebuyRequests: userId === meta.hostId ? meta.rebuyRequests : meta.rebuyRequests.filter((r) => r.playerId === userId),
      me: { userId, seat: mySeat?.seat ?? null, limits, isHost: userId === meta.hostId },
      serverTime: Date.now(),
    };
  }

  // ---------- replays ----------

  private loadRecord(n: number): HandRecord | null {
    if (!Number.isInteger(n)) return null;
    const row = this.sql.exec<{ record: string }>("SELECT record FROM hand_records WHERE number = ?", n).toArray()[0];
    return row ? (JSON.parse(row.record) as HandRecord) : null;
  }

  private voteInfo(rec: HandRecord, userId: string) {
    const meta = this.meta!;
    const list = meta.votes[String(rec.number)] ?? [];
    return {
      unlocked: meta.unlocked.includes(rec.number),
      votes: list.length,
      votesNeeded: Math.floor(rec.players.length / 2) + 1,
      voted: list.includes(userId),
      eligible: rec.players.some((p) => p.playerId === userId),
    };
  }

  private handSummaries(userId: string): HandSummary[] {
    const rows = this.sql.exec<{ record: string }>("SELECT record FROM hand_records ORDER BY number DESC LIMIT 60").toArray();
    return rows.map((r) => {
      const rec = JSON.parse(r.record) as HandRecord;
      const pot = rec.players.reduce((a, p) => a + (rec.result ? -(rec.result.net[p.seat] ?? 0) : 0), 0);
      const totalPot = rec.result ? rec.result.pots.reduce((a, p) => a + p.amount, 0) : pot;
      const winners = [...new Set((rec.result?.pots ?? []).flatMap((p) => p.winners.map((w) => w.seat === GHOST_SEAT ? "Ghost" : rec.players.find((x) => x.seat === w.seat)?.name ?? "?")))];
      return { number: rec.number, variant: rec.variant, pot: totalPot, winners, boards: rec.boards ?? [], endedAt: rec.endedAt, ...this.voteInfo(rec, userId) };
    });
  }

  private recordView(rec: HandRecord, userId: string): HandRecordView {
    const info = this.voteInfo(rec, userId);
    return {
      ...rec,
      players: rec.players.map((p) => {
        const visible = info.unlocked || p.playerId === userId || p.revealed;
        return { ...p, hole: visible ? p.hole : p.hole.map(() => null), discarded: visible ? p.discarded : p.discarded.map(() => null) };
      }),
      ...info,
    };
  }

  // ---------- log ----------

  private log(kind: LogLine["kind"], text: string) {
    const meta = this.meta!;
    const line: LogLine = { id: ++meta.logSeq, ts: Date.now(), handNumber: this.game?.hand?.number ?? 0, text, kind };
    this.pendingLog.push(line);
    this.slog("debug", "table.log", { kind, text });
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
    const name = (seat: number) => (seat === GHOST_SEAT ? "👻 Ghost" : state.seats[seat]?.name ?? prev.seats[seat]?.name ?? `Seat ${seat + 1}`);
    const boardLabel = (b: number | undefined) => (b === undefined ? "" : ` on board ${b + 1}`);
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
          this.log("street", `${e.street[0]!.toUpperCase() + e.street.slice(1)}: ${e.boards.map((b) => b.join(" ")).join("  |  ")}`);
          break;
        case "boardEliminated":
          this.log("street", `🦑 Board ${e.board + 1} is eliminated (lowest river: ${e.river}).`);
          break;
        case "ghostDealt":
          this.log("system", e.stake > 0 ? `👻 The ghost is dealt in with ${e.stake} dead money in the main pot.` : "👻 The ghost is dealt in.");
          break;
        case "ghostShown":
          this.log("result", e.handName ? `👻 Ghost shows ${e.cards.join(" ")} — ${e.handName}${e.won ? ` and takes ${e.won}` : ""}` : `👻 Ghost had ${e.cards.join(" ")}`);
          break;
        case "badBeat":
          this.log("result", `💔 BAD BEAT: ${name(e.victim)} was ${Math.round(e.equity)}% to win with one card to come.`);
          break;
        case "showdown":
          this.log("result", `${name(e.seat)} shows ${e.cards.join(" ")} — ${e.handName}`);
          break;
        case "potAwarded":
          this.log("result", `${name(e.seat)} wins ${e.amount}${e.handName ? ` with ${e.handName}` : ""}${boardLabel(e.board)}`);
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
