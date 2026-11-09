import { BarChart3, Bell, BellOff, Dices, Eye, Ghost, Link2, MessageSquare, Rabbit, ScrollText, Settings2, Smile, User } from "lucide-react";
import { APP_MARK, APP_NAME } from "@shared/brand";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, PublicSeat, TableView } from "@shared/protocol";
import { TAUNTS } from "@shared/protocol";
import { GHOST_SEAT } from "@engine/types";
import { playSfx, vibrate, type Sfx } from "../lib/sfx";
import { VARIANTS, fullBoardSize, type Variant } from "@engine/variants";
import { useTable } from "../lib/socket";
import { fmtChips } from "../lib/format";
import { Link } from "../lib/router";
import { PlayingCard } from "../components/Card";
import { BetChip, SeatView, warnMs } from "../components/Seat";
import { ActionBar, DiscardBar, RunChoiceBar, runsLabel } from "../components/ActionBar";
import { EndedModal, HostPanel, LogChat, PlayerMenu, SitSheet, TauntPopover, type SideTab } from "../components/Panels";
import { HudStrip, PlayerSheet } from "../components/Hud";
import { Toast } from "../components/ui";
import { NextGameStrip, RulesSheet } from "../components/Guide";
import { useAuth } from "../lib/auth";

/** Seat anchor positions (percent of the table area), index 0 = bottom centre, proceeding clockwise on screen. */
function anchors(n: number, landscape: boolean, areaH = 0): { x: number; y: number }[] {
  // the viewer's seat (avatar + nameplate + badge) needs ~100px below its centre so the bottom bar never covers it
  const bottomY = Math.min(landscape ? 90 : 86, areaH > 0 ? 100 - (100 * 100) / areaH : 100);
  const cx = 50;
  const cy = landscape ? 47 : 44;
  const rx = landscape ? 43 : 38;
  const ry = landscape ? 40 : 35;
  return Array.from({ length: n }, (_, i) => {
    const t = Math.PI / 2 + (i * 2 * Math.PI) / n;
    const p = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
    if (i === 0) p.y = bottomY; // the viewer's own seat sits below the felt
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

function useSounds(enabled: boolean) {
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem("fp:muted") === "1"; } catch { return false; }
  });
  const play = useCallback((name: Sfx) => {
    if (muted || !enabled) return;
    playSfx(name);
  }, [muted, enabled]);
  const toggle = () => setMuted((m) => { try { localStorage.setItem("fp:muted", m ? "0" : "1"); } catch { /* ignore */ } return !m; });
  return { muted, play, toggle };
}

/** Fire table sounds from state changes (bets, cards, wins, bad beats, Squid eliminations, ghost). */
function useTableSounds(view: TableView | null, play: (s: Sfx) => void, tauntCount: number) {
  const prev = useRef<TableView | null>(null);
  const prevTaunts = useRef(0);
  useEffect(() => {
    const p = prev.current;
    prev.current = view;
    if (!view || !p) return;
    const h = view.hand;
    const ph = p.hand;
    if (!h) return;
    const sameHand = ph && ph.number === h.number;
    if (!sameHand) {
      if (h.ghost) play("ghost");
      else play("card");
      return;
    }
    const cardsNow = h.boards.reduce((a, b) => a + b.length, 0);
    const cardsBefore = ph.boards.reduce((a, b) => a + b.length, 0);
    if (h.eliminated !== null && ph.eliminated === null) play("eliminate");
    else if (cardsNow > cardsBefore) play("card");
    let chip = false;
    let allin = false;
    let fold = false;
    for (const s of view.seats) {
      if (!s) continue;
      const q = p.seats[s.seat];
      if (!q) continue;
      if (s.streetBet > q.streetBet) chip = true;
      if (s.allIn && !q.allIn && s.inHand) allin = true;
      if (s.folded && !q.folded) fold = true;
    }
    if (allin) play("allin");
    else if (chip) play("chip");
    else if (fold) play("fold");
    if (h.phase === "showdown" && ph.phase !== "showdown") {
      if (h.result?.badBeat) {
        play("badbeat");
        vibrate(200);
      } else if (h.result && Object.keys(h.result.hands).length > 0) play("win");
    }
  }, [view, play]);
  useEffect(() => {
    if (tauntCount > prevTaunts.current) play("taunt");
    prevTaunts.current = tauntCount;
  }, [tauntCount, play]);
}

export function TablePage({ code }: { code: string }) {
  const { view, log, chat, status, error, ended, send, offset, notFound, hands, records, taunts } = useTable(code);
  const { flags: authFlags } = useAuth();
  const landscape = useMedia("(orientation: landscape) and (min-width: 640px)");
  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [panel, setPanel] = useState<null | "host" | "me" | "log">(null);
  const [logTab, setLogTab] = useState<SideTab>(authFlags.chat ? "chat" : "log");
  // desktop: log/chat docked beside the table, open by default (remembered per browser)
  const wide = useMedia("(min-width: 1024px) and (orientation: landscape)");
  const [dockPref, setDockPref] = useState(() => { try { return localStorage.getItem("fp:dock") !== "0"; } catch { return true; } });
  const setDock = (v: boolean) => { setDockPref(v); try { localStorage.setItem("fp:dock", v ? "1" : "0"); } catch { /* ignore */ } };
  const logOpen = wide ? dockPref : panel === "log";
  const toggleLog = () => (wide ? setDock(!dockPref) : setPanel(panel === "log" ? null : "log"));
  const [hudPref, setHudOn] = useState(() => { try { return localStorage.getItem("fp:hud") !== "0"; } catch { return true; } });
  const flags = view?.flags ?? authFlags;
  const hudOn = hudPref && flags.hud;
  const toggleHud = () => setHudOn((v) => { try { localStorage.setItem("fp:hud", v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const [playerSheet, setPlayerSheet] = useState<number | null>(null);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { muted, play, toggle } = useSounds(flags.sounds);
  useTableSounds(view, play, taunts.length);
  const [tauntOpen, setTauntOpen] = useState(false);
  const closeTaunt = useCallback(() => setTauntOpen(false), []);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesFor, setRulesFor] = useState<Variant | null>(null);
  const [areaH, setAreaH] = useState(0);
  const areaObs = useRef<ResizeObserver | null>(null);
  const areaRef = useCallback((el: HTMLDivElement | null) => {
    areaObs.current?.disconnect();
    if (!el) return;
    areaObs.current = new ResizeObserver(([e]) => setAreaH(Math.round(e!.contentRect.height)));
    areaObs.current.observe(el);
  }, []);
  const [splash, setSplash] = useState<number | null>(null);
  const lastSeenChat = useRef(0);
  const [unreadChat, setUnreadChat] = useState(0);

  useEffect(() => {
    if (!error) return;
    setToast(error.message);
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [error]);

  // your turn: get sheets out of the way of the action bar
  const myTurnKey = view && view.me.seat !== null && view.hand?.actor === view.me.seat ? `${view.hand.number}:${view.hand.actionSeq}` : null;
  useEffect(() => {
    if (!myTurnKey) return;
    setPanel((p) => (p === "log" ? p : null));
    setRulesOpen(false);
    setTauntOpen(false);
  }, [myTurnKey]);

  // unread chat badge
  useEffect(() => {
    if (logOpen && logTab === "chat") {
      lastSeenChat.current = chat.length;
      setUnreadChat(0);
    } else setUnreadChat(Math.max(0, chat.length - lastSeenChat.current));
  }, [chat.length, logOpen, logTab]);

  // your-turn alert
  const myTurn = !!view && !!view.hand && view.hand.phase === "betting" && view.me.seat !== null && view.hand.actor === view.me.seat;
  const turnKey = myTurn ? `${view!.hand!.number}:${view!.hand!.actionSeq}` : null;
  const lastTurnKey = useRef<string | null>(null);
  useEffect(() => {
    if (turnKey && turnKey !== lastTurnKey.current) {
      lastTurnKey.current = turnKey;
      play("turn");
      vibrate(40);
    }
  }, [turnKey, play]);

  // your clock is running out: a tick each second from when the ring turns red (8s) (double beep on the last one)
  const myClock = myTurn && view!.timer?.kind === "action" ? view!.timer.at : null;
  const myClockMs = myTurn && view!.timer?.kind === "action" ? view!.timer.durationMs : 0;
  useEffect(() => {
    if (myClock === null) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const now = Date.now() + offset;
    for (let sLeft = Math.floor(warnMs(myClockMs) / 1000); sLeft >= 1; sLeft--) {
      const at = myClock - sLeft * 1000 - now;
      if (at < 0) continue;
      timers.push(setTimeout(() => { play(sLeft === 1 ? "tickLast" : "tick"); if (sLeft <= 3) vibrate(30); }, at));
    }
    return () => timers.forEach(clearTimeout);
  }, [myClock, myClockMs, offset, play]);

  // bad beat splash: show once per hand for a few seconds
  const badBeatKey = view?.hand?.result?.badBeat && flags.badBeat ? view.hand.number : null;
  useEffect(() => {
    if (badBeatKey === null) return;
    setSplash(badBeatKey);
    const t = setTimeout(() => setSplash(null), 4200);
    return () => clearTimeout(t);
  }, [badBeatKey]);

  useEffect(() => { setSelectedCard(null); }, [view?.hand?.number, view?.hand?.phase]);
  useEffect(() => {
    document.title = view ? `${view.name} · ${APP_NAME}` : APP_NAME;
    return () => { document.title = APP_NAME; };
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
        <div className="w-10 h-10 rounded-full border-2 border-brand border-t-transparent animate-spin" />
        <p>{status === "reconnecting" ? "Reconnecting…" : "Joining table…"}</p>
        {status === "closed" && <Link to="/" className="btn">Back to lobby</Link>}
      </div>
    );
  }

  const hand = view.hand;
  const n = view.config.maxSeats;
  const pos = anchors(n, landscape, areaH);
  const mySeat = view.me.seat;
  const rot = mySeat ?? 0;
  const showdown = !!hand && hand.phase === "showdown";
  const winners = new Map<number, number>();
  if (showdown && hand.result) {
    for (const p of hand.result.pots) for (const w of p.winners) winners.set(w.seat, (winners.get(w.seat) ?? 0) + w.amount);
  }
  const amDiscarding = !!hand && hand.phase === "discard" && mySeat !== null && hand.pendingDiscard.includes(mySeat);
  const amPickingRuns = !!hand?.runChoice && mySeat !== null && hand.runChoice.pending.includes(mySeat);
  const variant = VARIANTS[hand?.variant ?? view.config.variant];
  const feltWidth = landscape ? Math.min(window.innerWidth - (wide && logOpen ? 340 : 0), 1100) * 0.82 : Math.min(window.innerWidth, 560) * 0.74;
  const boardCount = hand?.boards.length ?? 1;
  // several boards stack vertically, so their cards shrink to keep the centre column clear of the side seats
  const boardCap = landscape ? [64, 48, 40] : [64, 34, 28];
  // slots per board: 5 normally, 6 for Donk'em; a red river can run longer, so cards shrink (and wrap past 8)
  const slots = Math.max(fullBoardSize(variant), ...(hand?.boards.map((b, i) => b.length + (hand.rabbit?.[i]?.length ?? 0)) ?? [0]));
  const perRow = Math.min(slots, 8);
  const boardSize = Math.max(boardCount > 1 || perRow > 5 ? 24 : 34, Math.min(boardCap[Math.min(boardCount, 3) - 1]!, Math.floor((feltWidth - (perRow > 5 ? 40 : 56)) / perRow - 8)));
  const ghost = hand?.ghost ?? null;
  const badBeat = hand?.result?.badBeat ?? null;
  const seatName = (seat: number) => (seat === GHOST_SEAT ? "Ghost" : view.seats[seat]?.name ?? "");
  const myCardSize = landscape ? 60 : variant.holeCards >= 5 ? 44 : variant.holeCards === 4 ? 50 : 60;
  const otherCardSize = landscape ? 30 : variant.holeCards >= 5 ? 20 : 26;
  const bottomWinner = showdown && winners.size > 0 ? [...winners.entries()].sort((a, b) => b[1] - a[1])[0] : null;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ paddingTop: "var(--sat)" }}>
      <Toast message={toast} />

      {/* top bar */}
      <header className="flex items-center gap-2 px-3 py-2 shrink-0">
        <Link to="/" className="btn btn-ghost btn-sm -ml-2 px-2" aria-label="Lobby">
          <span className="font-extrabold tracking-wider text-gradient-gold" style={{ fontFamily: "var(--font-display)" }}>{APP_MARK}</span>
        </Link>
        <button className="pill pill-gold shrink-0 num min-h-[32px]" onClick={() => setRulesOpen(true)} aria-label={`How to play ${variant.name}`}>{view.dealerChoice && <Dices size={12} className="inline -mt-0.5 mr-1" aria-label="Dealer's choice" />}{variant.short}{(hand ? hand.shortDeck : view.config.shortDeck && !variant.hiLo) ? " 6+" : ""}{(hand ? hand.redRiver : view.config.redRiver) && <span className="inline-block w-2 h-2 rounded-full bg-[#ff3b5c] ml-1 align-middle" role="img" aria-label="Red river" />} {view.config.smallBlind}/{view.config.bigBlind}</button>
        <button className="flex items-center gap-2 min-w-0 flex-1 text-left" onClick={copyLink} aria-label={`Copy table link (code ${code})`}>
          <span className={`truncate font-bold text-sm min-w-0 ${copied ? "" : "hidden sm:inline"}`}>{copied ? <span className="text-green-bright">Link copied</span> : view.name}</span>
          <Link2 size={13} className="text-dim shrink-0" aria-hidden="true" />
        </button>
        {status !== "open" && <span className="pill pill-red shrink-0">{status === "reconnecting" ? "reconnecting…" : status}</span>}
        {flags.hud && (
          <button className="btn btn-ghost btn-sm px-2" onClick={toggleHud} aria-label={hudOn ? "Hide HUD" : "Show HUD"} aria-pressed={hudOn}>
            <BarChart3 size={18} className={hudOn ? "text-text" : ""} />
          </button>
        )}
        {flags.sounds && (
          <button className="btn btn-ghost btn-sm px-2" onClick={toggle} aria-label={muted ? "Unmute turn alerts" : "Mute turn alerts"} aria-pressed={!muted}>
            {muted ? <BellOff size={18} /> : <Bell size={18} />}
          </button>
        )}
        <button className="btn btn-ghost btn-sm px-2 relative" onClick={toggleLog} aria-label={flags.chat ? "Log and chat" : "Hand log"} aria-expanded={logOpen}>
          {unreadChat > 0 && flags.chat ? <MessageSquare size={18} /> : <ScrollText size={18} />}
          {unreadChat > 0 && flags.chat && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand text-on-brand text-[10px] font-black flex items-center justify-center">{unreadChat}</span>}
        </button>
        <button className="btn btn-ghost btn-sm px-2" onClick={() => setPanel("me")} aria-label="Your options"><User size={18} /></button>
        {view.me.isHost && (
          <button className="btn btn-ghost btn-sm px-2 relative" onClick={() => setPanel("host")} aria-label="Host controls">
            <Settings2 size={18} />
            {view.rebuyRequests.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red" />}
          </button>
        )}
      </header>
      {view.dealerChoice?.picking && view.status === "running" && (
        <NextGameStrip
          chooserName={view.seats[view.dealerChoice.picking.chooser]?.name ?? "The next dealer"}
          mine={view.dealerChoice.picking.chooser === view.me.seat}
          options={view.dealerChoice.picking.options}
          current={view.config.variant}
          picked={view.dealerChoice.picking.picked}
          mode={view.dealerChoice.mode}
          onPick={(variant) => send({ t: "chooseGame", variant })}
          onRules={(v) => { setRulesFor(v); setRulesOpen(true); }}
        />
      )}

      <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 flex flex-col">
      {/* table */}
      <div ref={areaRef} className="relative flex-1 min-h-0 mx-2">
        {!wide && logOpen && <div className="absolute inset-x-0 top-0 z-40"><LogChat open={logOpen} mode={"drop"} onClose={() => (wide ? setDock(false) : setPanel(null))} log={log} chat={chat} send={send} tab={logTab} setTab={setLogTab} hands={hands} records={records} mySeat={mySeat} flags={flags} /></div>}
        <div className="absolute" style={{ inset: landscape ? FELT_INSET.landscape : FELT_INSET.portrait }}>
          <div className="felt" />
          {/* centre: pot + board */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6">
            {hand ? (
              <>
                <div className="flex items-center gap-2 flex-wrap justify-center">
                {ghost && (
                  <div className={`flex items-center gap-1.5 rounded-lg px-2 py-0.5 border max-w-[200px] ${showdown && ghost.won > 0 ? "bg-gold text-on-gold border-transparent" : "bg-black/55 border-border"} anim-fade-up`} aria-label="Ghost player" title={showdown && ghost.handName ? `Ghost: ${ghost.handName}` : "Ghost player"}>
                    <span className="anim-ghost text-muted" aria-hidden="true"><Ghost size={18} /></span>
                    <div className="flex -space-x-2">
                      {ghost.cards.map((c, i) => <PlayingCard key={`g${i}${c ?? "x"}`} card={c} size={landscape ? 26 : 20} deal best={showdown && !!c && !!ghost.bestCards?.includes(c)} />)}
                    </div>
                    <div className="leading-tight min-w-0">
                      <p className="text-[10px] font-bold truncate max-w-[110px]">{showdown && ghost.handName ? ghost.handName : "Ghost"}</p>
                      <p className={`text-[10px] num font-extrabold ${showdown && ghost.won > 0 ? "" : "text-gold-bright"}`}>{showdown && ghost.won > 0 ? `+${fmtChips(ghost.won)}` : ghost.stake > 0 ? `${fmtChips(ghost.stake)} dead` : "no stake"}</p>
                    </div>
                  </div>
                )}
                  <span className="pill text-[12px] normal-case tracking-normal bg-black/55 px-3 py-1">
                    <span className="text-muted">Pot</span> <span className="num text-gold-bright text-sm">{fmtChips(hand.pot)}</span>
                  </span>
                  {hand.pots.length > 1 && hand.pots.map((p, i) => (
                    <span key={i} className="pill num">{i === 0 ? "main" : `side ${i}`} {fmtChips(p.amount)}</span>
                  ))}
                  {ghost && ghost.stake > 0 && <span className="pill num inline-flex items-center gap-1"><Ghost size={11} aria-hidden="true" /> {fmtChips(ghost.stake)}</span>}
                  {hand.deadMoney > 0 && <span className="pill num inline-flex items-center gap-1" title="The ghost's leftover chips, dead money in the main pot"><Ghost size={11} aria-hidden="true" /> {fmtChips(hand.deadMoney)} dead</span>}
                </div>
                <div className={`flex flex-col ${boardCount > 1 ? "gap-1" : "gap-1.5"}`}>
                  {hand.boards.map((board, bi) => {
                    const bestCards = showdown && bottomWinner ? hand.result?.pots.flatMap((p) => p.winners).find((w) => w.seat === bottomWinner[0] && (w.board ?? 0) === bi)?.cards : undefined;
                    return (
                      <div key={bi} className={`flex flex-wrap justify-center gap-1.5 ${hand.eliminated === bi ? "board-out rounded-md" : ""}`} style={{ maxWidth: perRow * (boardSize + 6) }}>
                        {Array.from({ length: slots }, (_, i) => {
                          const c = board[i];
                          const r = hand.rabbit?.[bi]?.[i - board.length];
                          if (!c && r) return <div key={r} className="relative"><PlayingCard card={r} size={boardSize} deal dim /><span className="absolute -top-2 left-1/2 -translate-x-1/2 pill text-[9px] px-1.5 py-0"><Rabbit size={10} aria-hidden="true" /></span></div>;
                          return c ? (
                            <PlayingCard key={c} card={c} size={boardSize} deal best={!!bestCards?.includes(c)} dim={!!bestCards && !bestCards.includes(c)} />
                          ) : (
                            <div key={i} className="rounded-md border border-white/15" style={{ width: boardSize, height: boardSize * 1.4 }} aria-hidden="true" />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <CenterStatus view={view} landscape={landscape} />
              </>
            ) : (
              <div className="text-center">
                <p className="font-extrabold text-lg" style={{ fontFamily: "var(--font-display)" }}>{view.status === "ended" ? "Session over" : "Waiting to start"}</p>
                <p className="text-sm text-muted">
                  {view.seats.filter(Boolean).length < 2 ? "Need at least 2 players" : view.me.isHost ? "Tap Start once everyone's seated" : "The host will start the game"}
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
          const betPos = { x: 50 + (p.x - 50) * 0.7, y: 50 + (p.y - 50) * 0.66 };
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
                <div className="absolute -translate-x-1/2 -translate-y-1/2" style={seatNo === mySeat
                  // your own bet sits beside your cards, not on top of them
                  ? { left: `calc(50% - ${Math.round(myCardSize * (1 + 0.6 * (variant.holeCards - 1)) / 2 + 40)}px)`, top: `calc(${p.y}% - ${Math.round(myCardSize * 0.95)}px)`, zIndex: 3 }
                  : { left: `${betPos.x}%`, top: `${betPos.y}%`, zIndex: 3 }}>
                  <BetChip amount={seat.streetBet} />
                </div>
              )}
            </div>
          );
        })}

        {/* taunt bubbles */}
        {flags.taunts && taunts.map((t) => {
          const p = t.seat !== null ? pos[(t.seat - rot + n) % n]! : { x: 50, y: 6 };
          const tt = TAUNTS[t.id];
          if (!tt) return null;
          return (
            <div key={t.key} className="absolute anim-bubble pointer-events-none" style={{ left: `${p.x}%`, top: `calc(${p.y}% - ${t.seat === mySeat ? 96 : 58}px)`, zIndex: 6, transform: "translate(-50%, 0)" }} role="status">
              <div className="bg-white text-black rounded-2xl px-3 py-1.5 shadow-pop text-sm font-bold whitespace-nowrap flex items-center gap-1.5">
                <span aria-hidden="true">{tt.emoji}</span>{tt.text}
                {t.seat === null && <span className="text-[10px] text-black/60 font-semibold">· {t.name}</span>}
              </div>
              <div className="w-3 h-3 bg-white rotate-45 mx-auto -mt-1.5" aria-hidden="true" />
            </div>
          );
        })}

        {/* bad beat splash */}
        {splash !== null && badBeat && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none anim-shake">
            <div className="anim-badbeat text-center px-6 py-5 rounded-3xl bg-black/80 border-2 border-red shadow-pop backdrop-blur-sm max-w-[90%]">
              <p className="text-[11px] uppercase tracking-[0.3em] text-[#ff8b8e] font-black">💔 Bad beat</p>
              <p className="text-3xl font-black leading-tight mt-1" style={{ fontFamily: "var(--font-display)" }}>{badBeat.victim === mySeat ? "You got rivered" : `${seatName(badBeat.victim)} got rivered`}</p>
              <p className="text-sm text-muted mt-2"><span className="num font-bold text-text">{Math.round(badBeat.equity)}%</span> to win with one card to come</p>
              <p className="text-xs text-dim mt-1">{badBeat.victimHand} <span className="text-[#ff8b8e]">lost to</span> {badBeat.winnerHand} <span className="text-muted">({seatName(badBeat.winner)})</span></p>
            </div>
          </div>
        )}
      </div>

      {/* bottom bar */}
      <div className="shrink-0 px-3 pt-2 relative" style={{ paddingBottom: "calc(var(--sab) + 10px)" }}>
        <div className="max-w-xl mx-auto relative flex items-stretch gap-2">
          <TauntPopover open={tauntOpen && flags.taunts} onClose={closeTaunt} onPick={(id) => send({ t: "taunt", id })} />
          {flags.taunts && !(myTurn && view.me.limits) && !amDiscarding && !amPickingRuns && (
            <button data-taunt-toggle className="btn btn-sm px-3 shrink-0" onClick={() => setTauntOpen((o) => !o)} aria-label="Send a taunt" aria-expanded={tauntOpen}><Smile size={18} /></button>
          )}
          <div className="flex-1 min-w-0">
          {myTurn && view.me.limits ? (
            <ActionBar view={view} onAction={act} />
          ) : amPickingRuns ? (
            <RunChoiceBar max={hand!.runChoice!.max} pendingCount={hand!.runChoice!.pending.length} onPick={(runs) => send({ t: "runs", runs })} />
          ) : amDiscarding ? (
            <DiscardBar selected={selectedCard} count={hand!.pendingDiscard.length} onDiscard={() => selectedCard !== null && act({ type: "discard", amount: selectedCard })} />
          ) : (
            <StatusBar view={view} onSit={() => setSitSeat(firstEmpty(view.seats))} onStart={() => send({ t: "start" })} onRabbit={() => send({ t: "rabbit" })} onShow={() => send({ t: "show" })} />
          )}
          </div>
        </div>
      </div>
      </div>
      {wide && logOpen && <LogChat open={logOpen} mode={"dock"} onClose={() => (wide ? setDock(false) : setPanel(null))} log={log} chat={chat} send={send} tab={logTab} setTab={setLogTab} hands={hands} records={records} mySeat={mySeat} flags={flags} />}
      </div>
      <RulesSheet open={rulesOpen} onClose={() => { setRulesOpen(false); setRulesFor(null); }} current={rulesFor ?? hand?.variant ?? view.config.variant} flags={flags} />

      <SitSheet open={sitSeat !== null} seat={sitSeat} config={view.config} onClose={() => setSitSeat(null)} onSit={(seat, buyIn) => { send({ t: "sit", seat, buyIn }); setSitSeat(null); }} />
      <HostPanel open={panel === "host"} onClose={() => setPanel(null)} view={view} send={send} />
      <PlayerMenu open={panel === "me"} onClose={() => setPanel(null)} view={view} send={send} />
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
  const all = hand.result?.pots.flatMap((p) => p.winners) ?? [];
  if (hand.phase === "showdown" && hand.result && all.some((w) => w.half === "low")) {
    // hi-lo split: name the high and low winners
    const nameOf = (seat: number) => (seat === GHOST_SEAT ? "👻 Ghost" : view.seats[seat]?.name ?? "");
    const who = (half: "high" | "low") => [...new Set(all.filter((w) => w.half === half).map((w) => nameOf(w.seat)))].join(" & ");
    text = `${who("high")} wins high · ${who("low")} wins low`;
    tone = "text-gold-bright";
  } else if (hand.phase === "showdown" && hand.result) {
    const best = hand.result.pots.flatMap((p) => p.winners).sort((a, b) => b.amount - a.amount)[0];
    if (best) {
      const name = best.seat === GHOST_SEAT ? "👻 Ghost" : view.seats[best.seat]?.name ?? "";
      const totalWon = hand.result.pots.flatMap((p) => p.winners).filter((w) => w.seat === best.seat).reduce((a, w) => a + w.amount, 0);
      text = `${name} wins ${fmtChips(totalWon)}${best.handName ? ` · ${best.handName}` : ""}`;
      tone = "text-gold-bright";
    }
  } else if (hand.phase === "discard") {
    text = "Players are discarding…";
  } else if (hand.phase === "runChoice") {
    text = "All-in · run it twice?";
    tone = "text-cyan-bright";
  } else if (hand.phase === "runout") {
    text = hand.runs > 1 ? `All-in · running it ${runsLabel(hand.runs)}` : "All-in · dealing";
  } else if (hand.actor !== null) {
    const a = view.seats[hand.actor];
    text = hand.actor === view.me.seat ? "Your turn" : `${a?.name ?? ""} to act`;
    if (hand.actor === view.me.seat) tone = "text-brand-bright";
  }
  if (!text) return null;
  return <p className={`text-xs font-semibold text-center ${tone} ${landscape ? "text-sm" : ""} bg-black/40 rounded-full px-3 py-1 anim-fade-up`} key={text}>{text}</p>;
}

function StatusBar({ view, onSit, onStart, onRabbit, onShow }: { view: TableView; onSit: () => void; onStart: () => void; onRabbit: () => void; onShow: () => void }) {
  const hand = view.hand;
  const mySeat = view.me.seat !== null ? view.seats[view.me.seat] : null;
  const players = view.seats.filter(Boolean).length;
  let text: string;
  let action: { label: string; onClick: () => void; cls: string } | null = null;
  if (view.status === "ended") text = "This session has ended.";
  else if (!mySeat) {
    text = players >= view.config.maxSeats ? "Table's full. You're watching." : "Tap an empty seat to join.";
    if (players < view.config.maxSeats) action = { label: "Take a seat", onClick: onSit, cls: "btn-primary" };
  } else if (mySeat.status === "sittingOut") text = "You're sitting out. Open your menu to come back.";
  else if (mySeat.stack === 0 && !mySeat.inHand) text = "You're out of chips. Rebuy from your menu.";
  else if (!hand || hand.phase === "showdown") {
    if (view.status === "running") text = view.timer?.kind === "nextHand" ? "Next hand starting…" : "Waiting for another player. The next hand deals itself.";
    else if (view.status === "paused") text = "Game paused by the host.";
    else {
      text = view.me.isHost ? (players >= 2 ? "Everyone seated? Start the game." : "Share the link so friends can join.") : "Waiting for the host to start.";
      if (view.me.isHost && players >= 2) action = { label: "Start game", onClick: onStart, cls: "btn-green" };
    }
  } else if (hand.phase === "discard") text = "Waiting for others to discard…";
  else if (hand.phase === "runChoice") {
    const mine = hand.runChoice?.mine;
    text = mine ? `You picked ${runsLabel(mine)}. Waiting on ${hand.runChoice!.pending.map((x) => view.seats[x]?.name ?? "").join(", ")}…` : "Players in the hand are picking how many runs…";
  }
  else if (hand.phase === "runout") text = hand.runs > 1 ? `Running it ${runsLabel(hand.runs)}…` : "Running it out…";
  else if (!mySeat.inHand) text = "You'll be dealt in next hand.";
  else if (mySeat.folded) text = "You folded. Hand in progress.";
  else {
    const a = hand.actor !== null ? view.seats[hand.actor] : null;
    text = a ? `Waiting for ${a.name}…` : "Hand in progress.";
  }
  const extra: { label: string; onClick: () => void; cls: string; icon?: React.ReactNode }[] = [];
  const canShow = view.flags.showCards && hand?.phase === "showdown" && !!mySeat?.inHand && !mySeat.revealed && (mySeat.cards?.length ?? 0) > 0;
  if (canShow) extra.push({ label: "Show cards", onClick: onShow, cls: "btn-primary", icon: <Eye size={16} aria-hidden="true" /> });
  if (hand?.rabbitAvailable && !action) extra.push({ label: "Rabbit", onClick: onRabbit, cls: "", icon: <Rabbit size={16} aria-hidden="true" /> });
  return (
    <div className="card-surface px-4 py-3 flex items-center gap-2 min-h-[56px]">
      <p className="text-sm text-muted flex-1 min-w-0">{text}</p>
      {action && <button className={`btn btn-sm ${action.cls}`} onClick={action.onClick}>{action.label}</button>}
      {extra.map((x) => <button key={x.label} className={`btn btn-sm shrink-0 ${x.cls}`} onClick={x.onClick}>{x.icon}{x.label}</button>)}
    </div>
  );
}
