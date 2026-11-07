import { BarChart3, Bell, BellOff, Link2, MessageSquare, Rabbit, ScrollText, Settings2, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, PublicSeat, TableView } from "@shared/protocol";
import { VARIANTS } from "@engine/variants";
import { useTable } from "../lib/socket";
import { fmtChips } from "../lib/format";
import { Link } from "../lib/router";
import { PlayingCard } from "../components/Card";
import { BetChip, SeatView } from "../components/Seat";
import { ActionBar, DiscardBar } from "../components/ActionBar";
import { EndedModal, HostPanel, LogChat, PlayerMenu, SitSheet, type SideTab } from "../components/Panels";
import { HudStrip, PlayerSheet } from "../components/Hud";
import { Toast } from "../components/ui";
import { useAuth } from "../lib/auth";

/** Seat anchor positions (percent of the table area), index 0 = bottom centre, proceeding clockwise on screen. */
function anchors(n: number, landscape: boolean): { x: number; y: number }[] {
  const cx = 50;
  const cy = landscape ? 47 : 44;
  const rx = landscape ? 43 : 38;
  const ry = landscape ? 40 : 35;
  return Array.from({ length: n }, (_, i) => {
    const t = Math.PI / 2 + (i * 2 * Math.PI) / n;
    const p = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
    if (i === 0) p.y = landscape ? 90 : 86; // the viewer's own seat sits below the felt
    return p;
  });
}

export const FELT_INSET = { portrait: "9% 13% 22% 13%", landscape: "9% 9% 12% 9%" };

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

function useBeep() {
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem("fp:muted") === "1"; } catch { return false; }
  });
  const ctxRef = useRef<AudioContext | null>(null);
  const beep = useCallback(() => {
    if (muted) return;
    try {
      ctxRef.current ??= new AudioContext();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.setValueAtTime(1175, ctx.currentTime + 0.09);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.26);
    } catch { /* no audio */ }
    try { navigator.vibrate?.(40); } catch { /* ignore */ }
  }, [muted]);
  const toggle = () => setMuted((m) => { try { localStorage.setItem("fp:muted", m ? "0" : "1"); } catch { /* ignore */ } return !m; });
  return { muted, beep, toggle };
}

export function TablePage({ code }: { code: string }) {
  const { view, log, chat, status, error, ended, send, offset, notFound, hands, records } = useTable(code);
  const { flags: authFlags } = useAuth();
  const landscape = useMedia("(orientation: landscape) and (min-width: 640px)");
  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [panel, setPanel] = useState<null | "host" | "me" | "log">(null);
  const [logTab, setLogTab] = useState<SideTab>("log");
  const [hudPref, setHudOn] = useState(() => { try { return localStorage.getItem("fp:hud") !== "0"; } catch { return true; } });
  const flags = view?.flags ?? authFlags;
  const hudOn = hudPref && flags.hud;
  const toggleHud = () => setHudOn((v) => { try { localStorage.setItem("fp:hud", v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const [playerSheet, setPlayerSheet] = useState<number | null>(null);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { muted, beep, toggle } = useBeep();
  const lastSeenChat = useRef(0);
  const [unreadChat, setUnreadChat] = useState(0);

  useEffect(() => {
    if (!error) return;
    setToast(error.message);
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [error]);

  // unread chat badge
  useEffect(() => {
    if (panel === "log" && logTab === "chat") {
      lastSeenChat.current = chat.length;
      setUnreadChat(0);
    } else setUnreadChat(Math.max(0, chat.length - lastSeenChat.current));
  }, [chat.length, panel, logTab]);

  // your-turn alert
  const myTurn = !!view && !!view.hand && view.hand.phase === "betting" && view.me.seat !== null && view.hand.actor === view.me.seat;
  const turnKey = myTurn ? `${view!.hand!.number}:${view!.hand!.actionSeq}` : null;
  const lastTurnKey = useRef<string | null>(null);
  useEffect(() => {
    if (turnKey && turnKey !== lastTurnKey.current) {
      lastTurnKey.current = turnKey;
      if (flags.sounds) beep();
    }
  }, [turnKey, beep, flags.sounds]);

  useEffect(() => { setSelectedCard(null); }, [view?.hand?.number, view?.hand?.phase]);
  useEffect(() => {
    document.title = view ? `${view.name} · Friends Poker` : "Friends Poker";
    return () => { document.title = "Friends Poker"; };
  }, [view?.name]);

  const act = useCallback((a: Action) => {
    if (!view?.hand) return;
    send({ t: "action", action: a, seq: view.hand.actionSeq });
  }, [send, view?.hand]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/t/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setToast("Could not copy. The code is " + code);
      setTimeout(() => setToast(null), 2500);
    }
  };

  if (notFound) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-xl font-bold">No table with code {code}</p>
        <Link to="/" className="btn btn-primary">Back to lobby</Link>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-3 text-muted">
        <div className="w-10 h-10 rounded-full border-2 border-gold border-t-transparent animate-spin" />
        <p>{status === "reconnecting" ? "Reconnecting…" : "Joining table…"}</p>
        {status === "closed" && <Link to="/" className="btn">Back to lobby</Link>}
      </div>
    );
  }

  const hand = view.hand;
  const n = view.config.maxSeats;
  const pos = anchors(n, landscape);
  const mySeat = view.me.seat;
  const rot = mySeat ?? 0;
  const showdown = !!hand && hand.phase === "showdown";
  const winners = new Map<number, number>();
  if (showdown && hand.result) {
    for (const p of hand.result.pots) for (const w of p.winners) winners.set(w.seat, (winners.get(w.seat) ?? 0) + w.amount);
  }
  const amDiscarding = !!hand && hand.phase === "discard" && mySeat !== null && hand.pendingDiscard.includes(mySeat);
  const variant = VARIANTS[hand?.variant ?? view.config.variant];
  const feltWidth = landscape ? Math.min(window.innerWidth, 1100) * 0.82 : Math.min(window.innerWidth, 560) * 0.74;
  const boardSize = Math.max(34, Math.min(64, Math.floor((feltWidth - 56) / 5 - 6)));
  const myCardSize = landscape ? 60 : variant.holeCards >= 5 ? 44 : variant.holeCards === 4 ? 50 : 60;
  const otherCardSize = landscape ? 30 : variant.holeCards >= 5 ? 20 : 26;
  const bottomWinner = showdown && winners.size > 0 ? [...winners.entries()].sort((a, b) => b[1] - a[1])[0] : null;
  const bottomWinnerSeat = bottomWinner ? view.seats[bottomWinner[0]] : null;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ paddingTop: "var(--sat)" }}>
      <Toast message={toast} />

      {/* top bar */}
      <header className="flex items-center gap-2 px-3 py-2 shrink-0">
        <Link to="/" className="btn btn-ghost btn-sm -ml-2 px-2" aria-label="Lobby">
          <span className="font-extrabold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>FP</span>
        </Link>
        <button className="flex items-center gap-2 min-w-0 flex-1 text-left" onClick={copyLink} aria-label={`Copy table link (code ${code})`}>
          <span className="pill pill-gold shrink-0 num">{variant.short} {view.config.smallBlind}/{view.config.bigBlind}</span>
          <span className={`truncate font-bold text-sm min-w-0 ${copied ? "" : "hidden sm:inline"}`}>{copied ? <span className="text-green-bright">Link copied</span> : view.name}</span>
          <Link2 size={13} className="text-dim shrink-0" aria-hidden="true" />
        </button>
        {status !== "open" && <span className="pill pill-red shrink-0">{status === "reconnecting" ? "reconnecting…" : status}</span>}
        {flags.hud && (
          <button className="btn btn-ghost btn-sm px-2" onClick={toggleHud} aria-label={hudOn ? "Hide HUD" : "Show HUD"} aria-pressed={hudOn}>
            <BarChart3 size={18} className={hudOn ? "text-gold" : ""} />
          </button>
        )}
        {flags.sounds && (
          <button className="btn btn-ghost btn-sm px-2" onClick={toggle} aria-label={muted ? "Unmute turn alerts" : "Mute turn alerts"} aria-pressed={!muted}>
            {muted ? <BellOff size={18} /> : <Bell size={18} />}
          </button>
        )}
        <button className="btn btn-ghost btn-sm px-2 relative" onClick={() => setPanel("log")} aria-label={flags.chat ? "Log and chat" : "Hand log"}>
          {unreadChat > 0 && flags.chat ? <MessageSquare size={18} /> : <ScrollText size={18} />}
          {unreadChat > 0 && flags.chat && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-gold text-on-gold text-[10px] font-black flex items-center justify-center">{unreadChat}</span>}
        </button>
        <button className="btn btn-ghost btn-sm px-2" onClick={() => setPanel("me")} aria-label="Your options"><User size={18} /></button>
        {view.me.isHost && (
          <button className="btn btn-ghost btn-sm px-2 relative" onClick={() => setPanel("host")} aria-label="Host controls">
            <Settings2 size={18} className="text-gold" />
            {view.rebuyRequests.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red" />}
          </button>
        )}
      </header>

      {/* table */}
      <div className="relative flex-1 min-h-0 mx-2">
        <div className="absolute" style={{ inset: landscape ? FELT_INSET.landscape : FELT_INSET.portrait }}>
          <div className="felt" />
          {/* centre: pot + board */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6">
            {hand ? (
              <>
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  <span className="pill text-[12px] normal-case tracking-normal bg-black/55 px-3 py-1">
                    <span className="text-muted">Pot</span> <span className="num text-gold-bright text-sm">{fmtChips(hand.pot)}</span>
                  </span>
                  {hand.pots.length > 1 && hand.pots.map((p, i) => (
                    <span key={i} className="pill num">{i === 0 ? "main" : `side ${i}`} {fmtChips(p.amount)}</span>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {Array.from({ length: 5 }, (_, i) => {
                    const c = hand.board[i];
                    const r = hand.rabbit?.[i - hand.board.length];
                    if (!c && r) return <div key={r} className="relative"><PlayingCard card={r} size={boardSize} deal dim /><span className="absolute -top-2 left-1/2 -translate-x-1/2 pill text-[9px] px-1.5 py-0"><Rabbit size={10} aria-hidden="true" /></span></div>;
                    return c ? (
                      <PlayingCard key={c} card={c} size={boardSize} deal best={showdown && bottomWinnerSeat?.bestCards?.includes(c)} dim={showdown && !!bottomWinnerSeat?.bestCards && !bottomWinnerSeat.bestCards.includes(c)} />
                    ) : (
                      <div key={i} className="rounded-md border border-white/15" style={{ width: boardSize, height: boardSize * 1.4 }} aria-hidden="true" />
                    );
                  })}
                </div>
                <CenterStatus view={view} landscape={landscape} />
              </>
            ) : (
              <div className="text-center">
                <p className="font-extrabold text-lg" style={{ fontFamily: "var(--font-display)" }}>{view.status === "ended" ? "Session over" : "Waiting to start"}</p>
                <p className="text-sm text-muted">
                  {view.seats.filter(Boolean).length < 2 ? "Need at least 2 players" : view.me.isHost ? "Tap Start when everyone is seated" : "The host will start the game"}
                </p>
                <button className="mt-2 pill normal-case tracking-normal text-xs px-3 py-1 whitespace-nowrap" onClick={copyLink}>
                  Code <span className="font-black tracking-[0.15em] text-text">{code}</span>
                </button>
                <p className="text-[11px] text-dim mt-1">Tap the code to copy the invite link</p>
                {view.me.isHost && view.status !== "ended" && view.seats.filter(Boolean).length >= 2 && (
                  <button className="btn btn-green mt-3 anim-pop" onClick={() => send({ t: "start" })}>Start game</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* seats */}
        {Array.from({ length: n }, (_, seatNo) => {
          const p = pos[(seatNo - rot + n) % n]!;
          const seat = view.seats[seatNo];
          const betPos = { x: 50 + (p.x - 50) * 0.58, y: 50 + (p.y - 50) * 0.56 };
          return (
            <div key={seatNo}>
              {seat ? (
                <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                  <SeatView
                    seat={seat}
                    isMe={seat.seat === mySeat}
                    acting={!!hand && hand.phase === "betting" && hand.actor === seat.seat}
                    timer={view.timer && view.timer.kind === "action" ? view.timer : null}
                    offset={offset}
                    isButton={!!hand && hand.button === seat.seat}
                    isWinner={winners.has(seat.seat)}
                    winAmount={winners.get(seat.seat) ?? 0}
                    showdown={showdown}
                    selectedCard={seat.seat === mySeat ? selectedCard : null}
                    onSelectCard={seat.seat === mySeat ? (i) => setSelectedCard((s) => (s === i ? null : i)) : undefined}
                    cardSize={seat.seat === mySeat ? myCardSize : otherCardSize}
                    selectable={amDiscarding && seat.seat === mySeat}
                    big={seat.seat === mySeat}
                    onTap={() => setPlayerSheet(seat.seat)}
                    extra={hudOn ? <HudStrip counters={view.hud[seat.playerId]} /> : null}
                  />
                </div>
              ) : (
                <button
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full border-2 border-dashed border-white/25 text-white/60 text-xs font-bold hover:border-gold hover:text-gold transition-colors disabled:opacity-30"
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                  disabled={mySeat !== null || view.status === "ended"}
                  onClick={() => setSitSeat(seatNo)}
                  aria-label={`Sit at seat ${seatNo + 1}`}
                >
                  {mySeat === null ? "SIT" : ""}
                </button>
              )}
              {seat && seat.streetBet > 0 && !showdown && (
                <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${betPos.x}%`, top: `${betPos.y}%`, zIndex: 3 }}>
                  <BetChip amount={seat.streetBet} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* bottom bar */}
      <div className="shrink-0 px-3 pt-2 relative" style={{ paddingBottom: "calc(var(--sab) + 10px)" }}>
        <div className="max-w-xl mx-auto relative">
          {myTurn && view.me.limits ? (
            <ActionBar view={view} onAction={act} />
          ) : amDiscarding ? (
            <DiscardBar selected={selectedCard} count={hand!.pendingDiscard.length} onDiscard={() => selectedCard !== null && act({ type: "discard", amount: selectedCard })} />
          ) : (
            <StatusBar view={view} onSit={() => setSitSeat(firstEmpty(view.seats))} onStart={() => send({ t: "start" })} onRabbit={() => send({ t: "rabbit" })} />
          )}
        </div>
      </div>

      <SitSheet open={sitSeat !== null} seat={sitSeat} config={view.config} onClose={() => setSitSeat(null)} onSit={(seat, buyIn) => { send({ t: "sit", seat, buyIn }); setSitSeat(null); }} />
      <HostPanel open={panel === "host"} onClose={() => setPanel(null)} view={view} send={send} />
      <PlayerMenu open={panel === "me"} onClose={() => setPanel(null)} view={view} send={send} />
      <LogChat open={panel === "log"} onClose={() => setPanel(null)} log={log} chat={chat} send={send} tab={logTab} setTab={setLogTab} hands={hands} records={records} mySeat={mySeat} flags={flags} />
      <PlayerSheet seat={playerSheet !== null ? view.seats[playerSheet] ?? null : null} session={playerSheet !== null ? view.hud[view.seats[playerSheet]?.playerId ?? ""] : undefined} onClose={() => setPlayerSheet(null)} />
      {ended && <EndedModal results={ended} me={view.me.userId} />}
    </div>
  );
}

function firstEmpty(seats: (PublicSeat | null)[]): number {
  const i = seats.findIndex((s) => !s);
  return i < 0 ? 0 : i;
}

function CenterStatus({ view, landscape }: { view: TableView; landscape: boolean }) {
  const hand = view.hand!;
  let text: string | null = null;
  let tone = "text-muted";
  if (hand.phase === "showdown" && hand.result) {
    const best = hand.result.pots.flatMap((p) => p.winners).sort((a, b) => b.amount - a.amount)[0];
    if (best) {
      const name = view.seats[best.seat]?.name ?? "";
      text = `${name} wins ${fmtChips(best.amount)}${best.handName ? ` · ${best.handName}` : ""}`;
      tone = "text-gold-bright";
    }
  } else if (hand.phase === "discard") {
    text = "Players are discarding…";
  } else if (hand.phase === "runout") {
    text = "All-in · dealing";
  } else if (hand.actor !== null) {
    const a = view.seats[hand.actor];
    text = hand.actor === view.me.seat ? "Your turn" : `${a?.name ?? ""} to act`;
    if (hand.actor === view.me.seat) tone = "text-gold-bright";
  }
  if (!text) return null;
  return <p className={`text-xs font-semibold text-center ${tone} ${landscape ? "text-sm" : ""} bg-black/40 rounded-full px-3 py-1 anim-fade-up`} key={text}>{text}</p>;
}

function StatusBar({ view, onSit, onStart, onRabbit }: { view: TableView; onSit: () => void; onStart: () => void; onRabbit: () => void }) {
  const hand = view.hand;
  const mySeat = view.me.seat !== null ? view.seats[view.me.seat] : null;
  const players = view.seats.filter(Boolean).length;
  let text: string;
  let action: { label: string; onClick: () => void; cls: string } | null = null;
  if (view.status === "ended") text = "This session has ended.";
  else if (!mySeat) {
    text = players >= view.config.maxSeats ? "Table is full — you're spectating." : "Tap an empty seat to join.";
    if (players < view.config.maxSeats) action = { label: "Take a seat", onClick: onSit, cls: "btn-primary" };
  } else if (mySeat.status === "sittingOut") text = "You're sitting out. Open your menu to come back.";
  else if (mySeat.stack === 0 && !mySeat.inHand) text = "You're out of chips. Rebuy from your menu.";
  else if (!hand || hand.phase === "showdown") {
    if (view.status === "running") text = view.timer?.kind === "nextHand" ? "Next hand starting…" : players < 2 ? "Waiting for another player…" : "Waiting…";
    else if (view.status === "paused") text = "Game paused by the host.";
    else {
      text = view.me.isHost ? (players >= 2 ? "Everyone seated? Start the game." : "Share the link so friends can join.") : "Waiting for the host to start.";
      if (view.me.isHost && players >= 2) action = { label: "Start game", onClick: onStart, cls: "btn-green" };
    }
  } else if (hand.phase === "discard") text = "Waiting for others to discard…";
  else if (hand.phase === "runout") text = "Running it out…";
  else if (!mySeat.inHand) text = "You'll be dealt in next hand.";
  else if (mySeat.folded) text = "You folded. Hand in progress.";
  else {
    const a = hand.actor !== null ? view.seats[hand.actor] : null;
    text = a ? `Waiting for ${a.name}…` : "Hand in progress.";
  }
  if (hand?.rabbitAvailable && !action) action = { label: "Rabbit hunt", onClick: onRabbit, cls: "" };
  return (
    <div className="card-surface px-4 py-3 flex items-center gap-3 min-h-[56px]">
      <p className="text-sm text-muted flex-1">{text}</p>
      {action && <button className={`btn btn-sm ${action.cls}`} onClick={action.onClick}>{action.label === "Rabbit hunt" && <Rabbit size={16} aria-hidden="true" />}{action.label}</button>}
    </div>
  );
}
