import { Ghost, Check, Crown, Send, UserX, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage, ClientMessage, HandRecordView, HandSummary, LogLine, SessionResultRow, TableConfig, TableView, TournamentInfo, TournamentSetup } from "@shared/protocol";
import type { Flags } from "@shared/flags";
import { TAUNTS } from "@shared/protocol";
import { HandsList, ReplayView } from "./Replay";
import { GAME_GUIDE } from "@shared/guide";
import { DealersChoicePicker } from "./Guide";
import { FeedbackSheet } from "./Feedback";
import { VARIANTS } from "@engine/variants";
import { ordinal } from "@engine/tournament";
import { TournamentFields } from "./Tournament";
import { fmtChips, fmtNet } from "../lib/format";
import { navigate } from "../lib/router";
import { VariantPicker } from "../pages/Lobby";
import { Field, Modal, Sheet } from "./ui";

export function SitSheet({ open, seat, config, tournament, onClose, onSit }: { open: boolean; seat: number | null; config: TableConfig; tournament?: TournamentInfo | null; onClose: () => void; onSit: (seat: number, buyIn: number) => void }) {
  const [buyIn, setBuyIn] = useState(config.startingStack);
  useEffect(() => setBuyIn(config.startingStack), [config.startingStack, open]);
  const min = config.bigBlind;
  const max = config.startingStack;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v || 0)));
  if (tournament) {
    // one fixed entry: everyone pays the same and starts with the same stack
    return (
      <Sheet open={open} onClose={onClose} title={`Enter the tournament · seat ${(seat ?? 0) + 1}`}>
        <div className="space-y-4">
          <div className="card-surface divide-y divide-border text-sm">
            <p className="flex justify-between gap-3 px-3 py-2.5"><span className="text-muted">Entry</span><span className="num font-extrabold text-gold-bright">{tournament.buyIn > 0 ? fmtChips(tournament.buyIn) : "Free"}</span></p>
            <p className="flex justify-between gap-3 px-3 py-2.5"><span className="text-muted">You start with</span><span className="num font-extrabold">{config.startingStack.toLocaleString()} chips</span></p>
            <p className="flex justify-between gap-3 px-3 py-2.5"><span className="text-muted">Blinds</span><span className="num font-semibold">{fmtChips(config.smallBlind)}/{fmtChips(config.bigBlind)}, up every {Math.round(tournament.levelMs / 60_000)} min</span></p>
          </div>
          <p className="text-xs text-muted">{tournament.buyIn > 0 ? "Your entry goes into the prize pool. " : ""}One entry, no rebuys. You can leave your seat until the host starts; after that you play until you're out of chips or you have them all.</p>
          <button className="btn btn-primary w-full" onClick={() => seat !== null && onSit(seat, config.startingStack)}>Join the tournament</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} title={`Sit at seat ${(seat ?? 0) + 1}`}>
      <div className="space-y-4">
        <Field label="Buy-in" hint={`Between ${min} and ${max}`}>
          <div className="flex items-center gap-3">
            <input type="range" className="range flex-1" min={min} max={max} value={buyIn} onChange={(e) => setBuyIn(Number(e.target.value))}
              style={{ ["--fill" as string]: `${((buyIn - min) / Math.max(1, max - min)) * 100}%` }} aria-label="Buy-in amount" />
            <input className="input w-28 text-right font-bold num" type="number" inputMode="numeric" value={buyIn} min={min} max={max}
              onChange={(e) => setBuyIn(Number(e.target.value))} onBlur={() => setBuyIn(clamp(buyIn))} />
          </div>
        </Field>
        <div className="flex gap-2">
          {[0.5, 1].map((f) => (
            <button key={f} className="chip-toggle flex-1" aria-pressed={buyIn === clamp(max * f)} onClick={() => setBuyIn(clamp(max * f))}>{f === 1 ? "Max" : "Half"}</button>
          ))}
        </div>
        <button className="btn btn-primary w-full" onClick={() => seat !== null && onSit(seat, clamp(buyIn))}>Sit down with {fmtChips(clamp(buyIn))}</button>
      </div>
    </Sheet>
  );
}

export function PlayerMenu({ open, onClose, view, send, news, onNews }: {
  open: boolean; onClose: () => void; view: TableView; send: (m: ClientMessage) => void;
  /** Unseen changelog entries; null hides the What's new row. */
  news: number | null; onNews: () => void;
}) {
  const me = view.me.seat !== null ? view.seats[view.me.seat] : null;
  const [rebuy, setRebuy] = useState(view.config.startingStack);
  const pending = view.rebuyRequests.find((r) => r.playerId === view.me.userId);
  const act = (m: ClientMessage) => { send(m); onClose(); };
  const [feedback, setFeedback] = useState(false);
  const t = view.tournament;
  const myPlace = t?.standings.find((s) => s.userId === view.me.userId)?.place ?? null;
  return (
    <>
    <FeedbackSheet open={feedback} onClose={() => setFeedback(false)} context={{ variant: view.hand?.variant ?? view.config.variant, hand: view.hand?.number }} />
    <Sheet open={open} onClose={onClose} title="You">
      <div className="space-y-3">
        {me ? (
          <>
            <div className="card-surface p-3 flex items-center justify-between">
              <div>
                <p className="font-bold">{me.name} · seat {me.seat + 1}</p>
                <p className="text-sm text-muted">Stack <span className="num text-gold-bright font-bold">{me.stack.toLocaleString()}</span> · {t ? (t.buyIn > 0 ? `entry ${fmtChips(t.buyIn)}` : "free entry") : `bought in ${me.totalBuyIn.toLocaleString()}`}{me.pendingAdd ? ` · +${me.pendingAdd} after this hand` : ""}</p>
              </div>
            </div>
            {t ? (
              !t.started ? (
                <>
                  <p className="text-sm text-muted">You're in. The host starts the tournament once everyone has a seat; until then you can still leave.</p>
                  <button className="btn btn-danger w-full" onClick={() => act({ t: "stand" })}>Leave my seat</button>
                </>
              ) : myPlace !== null && myPlace !== 1 ? (
                <p className="text-sm text-muted">You finished {ordinal(myPlace)}. You can keep watching.</p>
              ) : t.over ? null : (
                <>
                  {me.away
                    ? <button className="btn btn-green w-full" onClick={() => act({ t: "sitIn" })}>I'm back</button>
                    : <button className="btn w-full" onClick={() => act({ t: "sitOut" })}>Sit out</button>}
                  <p className="text-xs text-muted">Nobody leaves a tournament with chips. While you sit out you are still dealt in: your hands are checked or folded at once and your blinds keep going in.</p>
                </>
              )
            ) : (<>
            {me.status === "sittingOut" ? (
              <button className="btn btn-green w-full" onClick={() => act({ t: "sitIn" })}>Deal me back in</button>
            ) : (
              <button className="btn w-full" onClick={() => act({ t: "sitOut" })}>Sit out next hand</button>
            )}
            {view.flags.straddle && view.config.straddle && (
              <Toggle label="Straddle under the gun" hint={`Whenever you're first to act after the big blind, post ${view.config.bigBlind * 2} (2× the big blind) before the deal. You act last preflop. Needs 3+ players.`}
                checked={view.me.straddle} onChange={(on) => send({ t: "straddle", on })} />
            )}
            <div className="card-surface p-3 space-y-2">
              <p className="font-semibold text-sm">Rebuy / top-up {view.me.isHost ? "" : <span className="text-muted font-normal">(needs host approval)</span>}</p>
              {pending ? (
                <p className="text-sm text-muted">Request for {pending.amount} is waiting for the host.</p>
              ) : (
                <div className="flex gap-2">
                  <input className="input num font-bold" type="number" inputMode="numeric" min={view.config.bigBlind} max={view.config.startingStack} value={rebuy} onChange={(e) => setRebuy(Number(e.target.value))} aria-label="Rebuy amount" />
                  <button className="btn btn-primary" onClick={() => act({ t: "rebuy", amount: rebuy })}>{view.me.isHost ? "Add" : "Request"}</button>
                </div>
              )}
            </div>
            {view.flags.ghost && <GhostVote view={view} send={send} />}
            <button className="btn btn-danger w-full" onClick={() => { if (confirm("Stand up and leave your seat? Your chips are cashed out.")) act({ t: "stand" }); }}>Stand up</button>
            </>)}
          </>
        ) : (
          <p className="text-muted text-sm">{t?.started && myPlace !== null && myPlace !== 1 ? `You finished ${ordinal(myPlace)}. You can keep watching.` : t?.started ? "This tournament is under way, so the seats are closed. You can watch." : t ? "Tap an empty seat to enter the tournament." : "Tap an empty seat to join the game."}</p>
        )}
        {news !== null && <button className="btn btn-ghost w-full" onClick={onNews}>What's new {news > 0 && <span className="pill pill-gold">New</span>}</button>}
        {view.flags.feedback && <button className="btn btn-ghost w-full" onClick={() => { onClose(); setFeedback(true); }}>Send feedback or an idea</button>}
        <button className="btn btn-ghost w-full" onClick={() => navigate("/")}>Back to lobby</button>
      </div>
    </Sheet>
    </>
  );
}

/** Vote to bring the ghost in or send it away. Majority of seated players. */
function GhostVote({ view, send }: { view: TableView; send: (m: ClientMessage) => void }) {
  const g = view.ghost;
  const want = !g.enabled;
  const vote = g.vote && g.vote.on === want ? g.vote : null;
  const blocked = !want && g.stack > 0;
  return (
    <div className="card-surface p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="anim-ghost text-violet mt-0.5" aria-hidden="true"><Ghost size={22} /></span>
        <div className="flex-1">
          <p className="font-semibold text-sm">Ghost player {g.enabled ? <span className="pill pill-green ml-1">in play</span> : <span className="pill ml-1">off</span>}</p>
          <p className="text-xs text-muted">The ghost is dealt every hand, never bets, and can only win at showdown. When it wins, its stack rides as dead money in the next main pot.</p>
          {g.enabled && <p className="text-xs mt-1">Ghost stack: <span className="num font-bold text-gold-bright">{g.stack.toLocaleString()}</span></p>}
        </div>
      </div>
      {blocked ? (
        <p className="text-xs text-dim">You can vote the ghost out once someone busts it.</p>
      ) : (
        <button className={`btn w-full ${want ? "btn-primary" : ""}`} disabled={!!vote?.voted} onClick={() => send({ t: "ghostVote", on: want })}>
          {vote?.voted ? `Voted · ${vote.votes}/${vote.needed}` : want ? `Vote to summon the ghost${vote ? ` (${vote.votes}/${vote.needed})` : ""}` : `Vote to banish the ghost${vote ? ` (${vote.votes}/${vote.needed})` : ""}`}
        </button>
      )}
    </div>
  );
}

/** Most times an all-in board may be run. */
export function RunsPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="label mb-0">Run it up to</span>
        <div className="flex gap-1.5" role="group" aria-label="Most runs when all-in">
          {[["1", "Once"], ["2", "Twice"], ["3", "3×"]].map(([n, l]) => (
            <button type="button" key={n} className="chip-toggle min-w-[56px]" aria-pressed={value === Number(n)} onClick={() => onChange(Number(n))}>{l}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-dim">When players are all-in, everyone in the hand picks how many times to run the rest of the board. The lowest pick wins.</p>
    </div>
  );
}

/** 1 / 2 / 3 boards plus the Squid Game elimination toggle. */
export function BoardsPicker({ boards, squid, onChange }: { boards: number; squid: boolean; onChange: (boards: number, squid: boolean) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="label mb-0">Boards</span>
        <div className="flex gap-1.5" role="group" aria-label="Number of boards">
          {[1, 2, 3].map((n) => (
            <button type="button" key={n} className="chip-toggle min-w-[44px]" aria-pressed={boards === n} onClick={() => onChange(n, n > 1 && squid)}>{n}</button>
          ))}
        </div>
      </div>
      {boards > 1 && (
        <Toggle label="Squid Game 🦑" hint="When the river comes, the board with the lowest river card is eliminated before river betting. Ties: turn, then flop cards from last to first." checked={squid} onChange={(v) => onChange(boards, v)} />
      )}
      {boards > 1 && !squid && <p className="text-xs text-dim">Without Squid Game every pot is split equally between the boards.</p>}
    </div>
  );
}

export function HostPanel({ open, onClose, view, send }: { open: boolean; onClose: () => void; view: TableView; send: (m: ClientMessage) => void }) {
  const [cfg, setCfg] = useState<TableConfig>(view.config);
  useEffect(() => { if (open) setCfg(view.config); }, [open, view.config]);
  const t = view.tournament;
  const started = !!t?.started;
  const tourNow: TournamentSetup | null = t ? { buyIn: t.buyIn, levelMs: t.levelMs, payouts: t.payouts } : null;
  const tourKey = JSON.stringify(tourNow);
  const [tour, setTour] = useState<TournamentSetup | null>(tourNow);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setTour(tourNow); }, [open, tourKey]);
  const cfgDirty = JSON.stringify(cfg) !== JSON.stringify(view.config);
  const tourDirty = !!tour && !started && JSON.stringify(tour) !== tourKey;
  const dirty = cfgDirty || tourDirty;
  const apply = () => {
    if (cfgDirty) send({ t: "config", patch: cfg });
    if (tourDirty && tour) send({ t: "tournament", patch: tour });
  };
  const endLabel = view.endPending ? "Ending after this hand" : !t ? "End session" : started ? "End tournament" : "Cancel tournament";
  const endConfirm = !t ? "End the session for everyone and record results? A hand in progress is played out first."
    : started ? "End the tournament now? A hand in progress is played out first. Prize money not yet won is split between the players left by chip count."
    : "Cancel the tournament? Nobody pays and nothing is recorded.";
  const set = <K extends keyof TableConfig>(k: K, v: TableConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const num = (k: keyof TableConfig) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);
  const players = view.seats.filter((s): s is NonNullable<typeof s> => !!s);
  return (
    <Sheet open={open} onClose={onClose} title="Host controls">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          {view.status === "running" ? (
            <button className="btn" onClick={() => send({ t: "pause" })}>Pause after this hand</button>
          ) : (
            <button className="btn btn-green" disabled={!!t && !started && players.length < 2} onClick={() => send({ t: view.status === "paused" ? "resume" : "start" })}>{view.status === "paused" ? "Resume" : t ? "Start tournament" : "Start game"}</button>
          )}
          <button className="btn btn-danger" disabled={view.endPending} onClick={() => { if (confirm(endConfirm)) send({ t: "end" }); }}>{endLabel}</button>
        </div>
        {t && !started && <p className="text-xs text-muted -mt-2">Seats close when you start: no late entries and no rebuys. {players.length < 2 ? "You need at least 2 players." : `${players.length} players are in.`}</p>}

        {view.rebuyRequests.length > 0 && (
          <section>
            <h3 className="label">Rebuy requests</h3>
            <ul className="space-y-2">
              {view.rebuyRequests.map((r) => (
                <li key={r.playerId} className="card-surface p-3 flex items-center gap-2">
                  <p className="flex-1 text-sm"><span className="font-bold">{r.name}</span> wants <span className="num font-bold text-gold-bright">{r.amount}</span></p>
                  <button className="btn btn-green btn-sm" onClick={() => send({ t: "approveRebuy", playerId: r.playerId, approve: true })} aria-label={`Approve ${r.name}`}><Check size={18} /></button>
                  <button className="btn btn-danger btn-sm" onClick={() => send({ t: "approveRebuy", playerId: r.playerId, approve: false })} aria-label={`Decline ${r.name}`}><X size={18} /></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="label">Game settings <span className="normal-case font-normal text-dim">(apply from the next hand)</span></h3>
          <VariantPicker value={cfg.variant} onChange={(v) => set("variant", v)} allowAll={view.flags.variants} />
          <p className="text-xs text-dim">{VARIANTS[cfg.variant].name} · {GAME_GUIDE[cfg.variant].tagline}</p>
          {started ? (
            <p className="text-xs text-muted">The blinds follow the level clock and the stacks are set, so they can't be changed now. You can still change the game.</p>
          ) : (
            <div className={`grid gap-2 ${t ? "grid-cols-2" : "grid-cols-3"}`}>
              <Field label={t ? "First small blind" : "Small"}><input className="input" type="number" inputMode="numeric" min={1} value={cfg.smallBlind} onChange={num("smallBlind")} /></Field>
              <Field label={t ? "First big blind" : "Big"}><input className="input" type="number" inputMode="numeric" min={1} value={cfg.bigBlind} onChange={num("bigBlind")} /></Field>
              {!t && <Field label="Ante"><input className="input" type="number" inputMode="numeric" min={0} value={cfg.ante} onChange={num("ante")} /></Field>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {!started && <Field label={t ? "Starting stack" : "Max buy-in"}><input className="input" type="number" inputMode="numeric" min={1} value={cfg.startingStack} onChange={num("startingStack")} /></Field>}
            <Field label="Timer (s)"><input className="input" type="number" inputMode="numeric" min={5} max={300} value={Math.round(cfg.actionTimerMs / 1000)} onChange={(e) => set("actionTimerMs", Number(e.target.value) * 1000)} /></Field>
          </div>
          {t && !started && tour && <TournamentFields value={tour} onChange={setTour} />}
          {view.flags.squid && <BoardsPicker boards={cfg.boards} squid={cfg.squid} onChange={(b, sq) => setCfg((c) => ({ ...c, boards: b, squid: sq, redRiver: b > 1 ? false : c.redRiver }))} />}
          {view.flags.redRiver && cfg.boards === 1 && <Toggle label="Red river" hint="When the river is red, keep dealing until a black card lands. One betting round after. Single board only; never run twice." checked={cfg.redRiver} onChange={(v) => set("redRiver", v)} />}
          {view.flags.runItTwice && !t && <RunsPicker value={cfg.maxRuns} onChange={(n) => set("maxRuns", n)} />}
          {view.flags.shortDeck && <Toggle label="Short deck (6+)" hint={`Removes the 2s through 5s (36 cards). Flush beats full house, trips beat a straight, A-6-7-8-9 is a straight.${VARIANTS[cfg.variant].hiLo ? " Not used for PLO Hi-Lo, which always plays the full deck." : ""}`} checked={cfg.shortDeck} onChange={(v) => set("shortDeck", v)} />}
          {view.flags.straddle && !t && <Toggle label="Allow straddles" hint="Under the gun may post 2× the big blind before the deal and act last preflop." checked={cfg.straddle} onChange={(v) => set("straddle", v)} />}
          {view.flags.dealersChoice && view.flags.variants && <DealersChoicePicker value={cfg.dealersChoice} onChange={(v) => set("dealersChoice", v)} />}
          <button className="btn btn-primary w-full" disabled={!dirty} onClick={apply}>Apply settings</button>
        </section>

        <section className="space-y-2">
          <h3 className="label">Table options</h3>
          {view.flags.rabbitHunt && <Toggle label="Rabbit hunting" hint="After an early finish, anyone seated can reveal the cards that would have come." checked={view.options.rabbitHunt} onChange={(v) => send({ t: "options", patch: { rabbitHunt: v } })} />}
          {view.flags.replays && <Toggle label="Auto-reveal replays" hint="Show every hole card and equities in replays without a majority vote." checked={view.options.autoUnlockReplays} onChange={(v) => send({ t: "options", patch: { autoUnlockReplays: v } })} />}
        </section>

        <section>
          <h3 className="label">Players</h3>
          <ul className="card-surface divide-y divide-border">
            {players.map((p) => (
              <li key={p.playerId} className="flex items-center gap-2 p-3">
                <p className="flex-1 text-sm"><span className="font-bold">{p.name}</span> {p.isHost && <Crown size={14} className="inline text-gold" aria-label="host" />} <span className="text-muted">· seat {p.seat + 1} · {p.stack.toLocaleString()}</span>{p.away && <span className="pill ml-1.5">away</span>}</p>
                {!p.isHost && !started && (
                  <button className="btn btn-danger btn-xs" onClick={() => { if (confirm(`Remove ${p.name} from the table?`)) send({ t: "kick", playerId: p.playerId }); }} aria-label={`Remove ${p.name}`}><UserX size={16} /> Kick</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Sheet>
  );
}

export type SideTab = "log" | "chat" | "hands";

/**
 * Log / chat / hands. Never modal: on desktop it's docked beside the table and open by default;
 * on phones it drops down under the header (the felt's lower half, your cards and the action bar stay usable).
 */
export function LogChat({ open, mode, onClose, log, chat, send, tab, setTab, hands, records, mySeat, flags }: {
  open: boolean; mode: "dock" | "drop"; onClose: () => void; log: LogLine[]; chat: ChatMessage[]; send: (m: ClientMessage) => void; tab: SideTab; setTab: (t: SideTab) => void;
  hands: HandSummary[] | null; records: Record<number, HandRecordView>; mySeat: number | null; flags: Flags;
}) {
  const tabs = ((["log", "chat", "hands"] as const).filter((t) => t === "log" || (t === "chat" && flags.chat) || (t === "hands" && flags.replays)));
  useEffect(() => { if (!tabs.includes(tab)) setTab("log"); }, [tabs, tab, setTab]);
  const [text, setText] = useState("");
  const [openHand, setOpenHand] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && tab !== "hands") endRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, log.length, chat.length, tab]);
  useEffect(() => { if (!open) setOpenHand(null); }, [open]);
  const openReplay = (n: number) => { setOpenHand(n); send({ t: "getHand", number: n }); };
  // refresh the open record whenever the hands list changes (votes, unlocks)
  const handsKey = hands ? hands.map((h) => `${h.number}:${h.votes}:${h.unlocked ? 1 : 0}`).join("|") : "";
  useEffect(() => {
    if (openHand !== null && hands) send({ t: "getHand", number: openHand });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsKey]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    send({ t: "chat", text: t });
    setText("");
  };
  if (!open) return null;
  return (
    <section className={mode === "dock" ? "logchat-dock" : "logchat-drop anim-fade-up"} aria-label="Log and chat">
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 grid gap-1 p-1 rounded-xl bg-surface-2" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} role="tablist">
            {tabs.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setOpenHand(null); }} className={`min-h-[34px] rounded-lg text-sm font-semibold ${tab === t ? "bg-surface-3" : "text-muted"}`}>{t === "log" ? "Log" : t === "chat" ? "Chat" : "Hands"}</button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm px-2" onClick={onClose} aria-label={mode === "dock" ? "Hide panel" : "Close"}><X size={18} /></button>
        </div>
        {tab === "hands" ? (
          <div className="flex-1 min-h-0 overflow-y-auto scroll-thin pb-2">
            {openHand === null ? <HandsList hands={hands} onOpen={openReplay} send={send} /> : <ReplayView rec={records[openHand]} onBack={() => setOpenHand(null)} send={send} mySeat={mySeat} equityOn={flags.equity} />}
          </div>
        ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin text-sm space-y-1 pb-2">
          {tab === "log"
            ? log.map((l) => (
                <p key={l.id} className={`leading-snug ${l.kind === "result" ? "text-gold-bright font-semibold" : l.kind === "street" ? "text-blue font-semibold" : l.kind === "system" ? "text-dim" : "text-muted"}`}>{l.text}</p>
              ))
            : chat.map((m) => (
                <p key={m.id} className="leading-snug"><span className="font-bold text-violet">{m.name}</span> <span className="text-text">{m.text}</span></p>
              ))}
          <div ref={endRef} />
        </div>
        )}
        {tab === "chat" && (
          <form onSubmit={submit} className="flex gap-2 pt-2 border-t border-border">
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={300} aria-label="Chat message" />
            <button className="btn btn-primary px-4" aria-label="Send"><Send size={18} /></button>
          </form>
        )}
      </div>
    </section>
  );
}

/** Taunt picker: a small popover above the button. The table stays visible and playable underneath. */
export function TauntPopover({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.("[data-taunt-toggle]")) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className="taunt-pop anim-fade-up" role="menu" aria-label="Send a taunt">
      {TAUNTS.map((t, i) => (
        <button key={i} role="menuitem" className="taunt-pop-item" onClick={() => { onPick(i); onClose(); }}>
          <span className="text-lg leading-none" aria-hidden="true">{t.emoji}</span>
          <span className="leading-tight">{t.text}</span>
        </button>
      ))}
    </div>
  );
}

export function EndedModal({ results, me, tournament }: { results: SessionResultRow[]; me: string; tournament?: boolean }) {
  if (tournament) {
    const rows = [...results].sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || b.cashOut - a.cashOut);
    return (
      <Modal open title="Tournament over">
        {rows.length === 0 ? (
          <p className="text-sm text-muted mb-4">The tournament was called off before it started. Nobody paid and nothing was recorded.</p>
        ) : (
          <table className="w-full text-sm mb-4">
            <thead className="text-xs uppercase tracking-wider text-dim">
              <tr><th className="text-left py-1.5 font-semibold w-12">Place</th><th className="text-left py-1.5 font-semibold">Player</th><th className="text-right py-1.5 font-semibold">Prize</th><th className="text-right py-1.5 font-semibold">Net</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className={`border-t border-border ${r.userId === me ? "bg-brand/10" : ""}`}>
                  <td className="py-2 text-muted num">{r.place ? (r.place === 1 ? "🏆" : ordinal(r.place)) : ""}</td>
                  <td className="py-2 font-semibold">{r.name}</td>
                  <td className="py-2 text-right num font-bold text-gold-bright">{r.cashOut > 0 ? r.cashOut.toLocaleString() : <span className="text-dim font-normal">0</span>}</td>
                  <td className={`py-2 text-right font-bold num ${r.net > 0 ? "text-green-bright" : r.net < 0 ? "text-[#ff8b8e]" : ""}`}>{fmtNet(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button className="btn btn-primary w-full" onClick={() => navigate("/")}>Back to lobby</button>
      </Modal>
    );
  }
  return (
    <Modal open title="Session over">
      <table className="w-full text-sm mb-4">
        <thead className="text-xs uppercase tracking-wider text-dim">
          <tr><th className="text-left py-1.5 font-semibold">Player</th><th className="text-right py-1.5 font-semibold">In</th><th className="text-right py-1.5 font-semibold">Out</th><th className="text-right py-1.5 font-semibold">Net</th></tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.userId} className={`border-t border-border ${r.userId === me ? "bg-brand/10" : ""}`}>
              <td className="py-2 font-semibold">{r.name}</td>
              <td className="py-2 text-right text-muted num">{r.buyIn.toLocaleString()}</td>
              <td className="py-2 text-right text-muted num">{r.cashOut.toLocaleString()}</td>
              <td className={`py-2 text-right font-bold num ${r.net > 0 ? "text-green-bright" : r.net < 0 ? "text-[#ff8b8e]" : ""}`}>{fmtNet(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn btn-primary w-full" onClick={() => navigate("/")}>Back to lobby</button>
    </Modal>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="w-full card-surface p-3 flex items-center gap-3 text-left">
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <span className={`relative inline-block w-12 h-7 rounded-full transition-colors ${checked ? "bg-green" : "bg-surface-3"}`} aria-hidden="true">
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}
