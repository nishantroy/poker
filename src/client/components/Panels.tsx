import { Ghost, Check, Crown, Send, UserX, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage, ClientMessage, HandRecordView, HandSummary, LogLine, SessionResultRow, TableConfig, TableView } from "@shared/protocol";
import type { Flags } from "@shared/flags";
import { TAUNTS } from "@shared/protocol";
import { HandsList, ReplayView } from "./Replay";
import { VARIANTS } from "@engine/variants";
import { fmtChips, fmtNet } from "../lib/format";
import { navigate } from "../lib/router";
import { VariantPicker } from "../pages/Lobby";
import { Field, Modal, Sheet } from "./ui";

export function SitSheet({ open, seat, config, onClose, onSit }: { open: boolean; seat: number | null; config: TableConfig; onClose: () => void; onSit: (seat: number, buyIn: number) => void }) {
  const [buyIn, setBuyIn] = useState(config.startingStack);
  useEffect(() => setBuyIn(config.startingStack), [config.startingStack, open]);
  const min = config.bigBlind;
  const max = config.startingStack;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v || 0)));
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

export function PlayerMenu({ open, onClose, view, send }: { open: boolean; onClose: () => void; view: TableView; send: (m: ClientMessage) => void }) {
  const me = view.me.seat !== null ? view.seats[view.me.seat] : null;
  const [rebuy, setRebuy] = useState(view.config.startingStack);
  const pending = view.rebuyRequests.find((r) => r.playerId === view.me.userId);
  const act = (m: ClientMessage) => { send(m); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="You">
      <div className="space-y-3">
        {me ? (
          <>
            <div className="card-surface p-3 flex items-center justify-between">
              <div>
                <p className="font-bold">{me.name} · seat {me.seat + 1}</p>
                <p className="text-sm text-muted">Stack <span className="num text-gold-bright font-bold">{me.stack.toLocaleString()}</span> · bought in {me.totalBuyIn.toLocaleString()}{me.pendingAdd ? ` · +${me.pendingAdd} after this hand` : ""}</p>
              </div>
            </div>
            {me.status === "sittingOut" ? (
              <button className="btn btn-green w-full" onClick={() => act({ t: "sitIn" })}>I'm back — deal me in</button>
            ) : (
              <button className="btn w-full" onClick={() => act({ t: "sitOut" })}>Sit out next hand</button>
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
          </>
        ) : (
          <p className="text-muted text-sm">Tap an empty seat to join the game.</p>
        )}
        <button className="btn btn-ghost w-full" onClick={() => navigate("/")}>Back to lobby</button>
      </div>
    </Sheet>
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
          <p className="text-xs text-muted">A ghost is dealt in every hand but never bets. It always sees showdown and can only win there. When it wins, its whole stack rides as dead money in the next main pot.</p>
          {g.enabled && <p className="text-xs mt-1">Ghost stack: <span className="num font-bold text-gold-bright">{g.stack.toLocaleString()}</span></p>}
        </div>
      </div>
      {blocked ? (
        <p className="text-xs text-dim">The ghost can only be sent away once someone takes its chips at showdown.</p>
      ) : (
        <button className={`btn w-full ${want ? "btn-primary" : ""}`} disabled={!!vote?.voted} onClick={() => send({ t: "ghostVote", on: want })}>
          {vote?.voted ? `Voted · ${vote.votes}/${vote.needed}` : want ? `Vote to summon the ghost${vote ? ` (${vote.votes}/${vote.needed})` : ""}` : `Vote to banish the ghost${vote ? ` (${vote.votes}/${vote.needed})` : ""}`}
        </button>
      )}
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
  const dirty = JSON.stringify(cfg) !== JSON.stringify(view.config);
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
            <button className="btn btn-green" onClick={() => send({ t: view.status === "paused" ? "resume" : "start" })}>{view.status === "paused" ? "Resume" : "Start game"}</button>
          )}
          <button className="btn btn-danger" onClick={() => { if (confirm("End the session for everyone and record results?")) send({ t: "end" }); }}>End session</button>
        </div>

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
          <p className="text-xs text-dim">{VARIANTS[cfg.variant].name}</p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Small"><input className="input" type="number" inputMode="numeric" min={1} value={cfg.smallBlind} onChange={num("smallBlind")} /></Field>
            <Field label="Big"><input className="input" type="number" inputMode="numeric" min={1} value={cfg.bigBlind} onChange={num("bigBlind")} /></Field>
            <Field label="Ante"><input className="input" type="number" inputMode="numeric" min={0} value={cfg.ante} onChange={num("ante")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Max buy-in"><input className="input" type="number" inputMode="numeric" min={1} value={cfg.startingStack} onChange={num("startingStack")} /></Field>
            <Field label="Timer (s)"><input className="input" type="number" inputMode="numeric" min={5} max={300} value={Math.round(cfg.actionTimerMs / 1000)} onChange={(e) => set("actionTimerMs", Number(e.target.value) * 1000)} /></Field>
          </div>
          {view.flags.squid && <BoardsPicker boards={cfg.boards} squid={cfg.squid} onChange={(b, sq) => setCfg((c) => ({ ...c, boards: b, squid: sq }))} />}
          <button className="btn btn-primary w-full" disabled={!dirty} onClick={() => send({ t: "config", patch: cfg })}>Apply settings</button>
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
                <p className="flex-1 text-sm"><span className="font-bold">{p.name}</span> {p.isHost && <Crown size={14} className="inline text-gold" aria-label="host" />} <span className="text-muted">· seat {p.seat + 1} · {p.stack.toLocaleString()}</span></p>
                {!p.isHost && (
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

export function LogChat({ open, onClose, log, chat, send, tab, setTab, hands, records, mySeat, flags }: {
  open: boolean; onClose: () => void; log: LogLine[]; chat: ChatMessage[]; send: (m: ClientMessage) => void; tab: SideTab; setTab: (t: SideTab) => void;
  hands: HandSummary[] | null; records: Record<number, HandRecordView>; mySeat: number | null; flags: Flags;
}) {
  const tabs = ((["log", "chat", "hands"] as const).filter((t) => t === "log" || (t === "chat" && flags.chat) || (t === "hands" && flags.replays)));
  useEffect(() => { if (!tabs.includes(tab)) setTab("log"); }, [tabs, tab, setTab]);
  const [text, setText] = useState("");
  const [openHand, setOpenHand] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && tab !== "hands") endRef.current?.scrollIntoView({ block: "end" });
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
  return (
    <Sheet open={open} onClose={onClose} title={tab === "log" ? "Hand log" : tab === "chat" ? "Chat" : openHand !== null ? "Replay" : "Hands"} side="right">
      <div className="flex flex-col h-full min-h-[50dvh]">
        <div className="grid gap-1 p-1 rounded-xl bg-surface-2 mb-3" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setOpenHand(null); }} className={`min-h-[40px] rounded-lg text-sm font-semibold ${tab === t ? "bg-surface-3" : "text-muted"}`}>{t === "log" ? "Log" : t === "chat" ? "Chat" : "Hands"}</button>
          ))}
        </div>
        {tab === "hands" ? (
          <div className="flex-1 overflow-y-auto scroll-thin pb-2 max-h-[70dvh]">
            {openHand === null ? <HandsList hands={hands} onOpen={openReplay} send={send} /> : <ReplayView rec={records[openHand]} onBack={() => setOpenHand(null)} send={send} mySeat={mySeat} equityOn={flags.equity} />}
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto scroll-thin text-sm space-y-1 pb-2 max-h-[60dvh]">
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
    </Sheet>
  );
}

export function TauntSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: number) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Taunt">
      <div className="grid grid-cols-3 gap-2">
        {TAUNTS.map((t, i) => (
          <button key={i} className="card-surface p-3 flex flex-col items-center gap-1 hover:bg-surface-2 active:scale-95 transition-transform" onClick={() => { onPick(i); onClose(); }}>
            <span className="text-2xl" aria-hidden="true">{t.emoji}</span>
            <span className="text-xs font-semibold text-center leading-tight">{t.text}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-dim mt-3">Everyone at the table sees it for a few seconds. One every few seconds, be nice-ish.</p>
    </Sheet>
  );
}

export function EndedModal({ results, me }: { results: SessionResultRow[]; me: string }) {
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
