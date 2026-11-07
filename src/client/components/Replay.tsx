import { ArrowLeft, Lock, Rabbit, Unlock, Vote } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, HandRecordView, HandSummary } from "@shared/protocol";
import { VARIANTS } from "@engine/variants";
import { fmtChips, fmtNet, timeAgo } from "../lib/format";
import { buildStages, equityRequest, streetLabel, type Stage } from "../lib/replay";
import type { EquityResponse } from "../lib/equity.worker";
import { PlayingCard } from "./Card";

export function HandsList({ hands, onOpen, send }: { hands: HandSummary[] | null; onOpen: (n: number) => void; send: (m: ClientMessage) => void }) {
  useEffect(() => { send({ t: "listHands" }); }, [send]);
  if (hands === null) return <div className="skeleton h-24 rounded-2xl" />;
  if (hands.length === 0) return <p className="text-sm text-muted">No finished hands yet.</p>;
  return (
    <ul className="space-y-2">
      {hands.map((h) => (
        <li key={h.number}>
          <button className="w-full card-surface p-3 flex items-center gap-3 text-left hover:bg-surface-2 transition-colors" onClick={() => onOpen(h.number)}>
            <span className="text-sm font-black num text-dim w-9">#{h.number}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{h.winners.join(", ") || "—"} <span className="text-muted font-normal">won</span> <span className="num text-gold-bright">{fmtChips(h.pot)}</span></p>
              <p className="text-xs text-muted">{VARIANTS[h.variant].short} · {h.board.length ? h.board.join(" ") : "no flop"} · {timeAgo(h.endedAt)}</p>
            </div>
            {h.unlocked ? <Unlock size={16} className="text-green-bright shrink-0" aria-label="Unlocked" /> : <Lock size={16} className="text-dim shrink-0" aria-label="Locked" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ReplayView({ rec, onBack, send, mySeat, equityOn = true }: { rec: HandRecordView | undefined; onBack: () => void; send: (m: ClientMessage) => void; mySeat: number | null; equityOn?: boolean }) {
  const stages = useMemo(() => (rec ? buildStages(rec) : []), [rec]);
  const [equity, setEquity] = useState<Record<string, { seats: number[]; equity: number[]; exact: boolean }>>({});
  const [computing, setComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    setEquity({});
    if (!rec || !equityOn) return;
    const req = equityRequest(rec, stages, ++reqId.current);
    if (!req) return;
    workerRef.current ??= new Worker(new URL("../lib/equity.worker.ts", import.meta.url), { type: "module" });
    const w = workerRef.current;
    setComputing(true);
    const onMsg = (ev: MessageEvent<EquityResponse>) => {
      if (ev.data.id !== reqId.current) return;
      const next: typeof equity = {};
      for (const s of ev.data.stages) next[s.key] = s;
      setEquity(next);
      if (ev.data.stages.length === req.stages.length) setComputing(false);
    };
    w.addEventListener("message", onMsg);
    w.postMessage(req);
    return () => w.removeEventListener("message", onMsg);
  }, [rec, stages, equityOn]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  if (!rec) {
    return (
      <div className="space-y-3">
        <button className="btn btn-ghost btn-sm -ml-2" onClick={onBack}><ArrowLeft size={18} /> Hands</button>
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    );
  }
  const name = (seat: number) => rec.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat + 1}`;
  const locked = !rec.unlocked;

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-2">
        <button className="btn btn-ghost btn-sm -ml-2" onClick={onBack} aria-label="Back to hands"><ArrowLeft size={18} /></button>
        <h3 className="font-extrabold text-base" style={{ fontFamily: "var(--font-display)" }}>Hand #{rec.number} <span className="text-muted font-semibold">· {VARIANTS[rec.variant].name}</span></h3>
      </div>

      {locked ? (
        <div className="card-surface p-3 flex items-start gap-3">
          <Lock size={18} className="text-gold shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Hidden cards and equities are locked</p>
            <p className="text-xs text-muted">A majority of the {rec.players.length} players dealt in must agree to reveal them. {rec.votes}/{rec.votesNeeded} votes so far.</p>
          </div>
          {rec.eligible && (
            <button className="btn btn-primary btn-sm" disabled={rec.voted} onClick={() => send({ t: "vote", number: rec.number })}>
              <Vote size={16} aria-hidden="true" /> {rec.voted ? "Voted" : "Reveal"}
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted flex items-center gap-1.5"><Unlock size={14} className="text-green-bright" aria-hidden="true" /> All cards revealed. Equity = share of the pot each hand expects {computing ? "(computing…)" : ""}. {VARIANTS[rec.variant].discardTo ? "Pineapple equities use the cards each player kept." : ""}</p>
      )}

      {stages.map((st) => (
        <StageBlock key={st.key} st={st} rec={rec} eq={equity[st.key]} name={name} mySeat={mySeat} locked={locked} equityOn={equityOn} />
      ))}

      <section className="card-surface p-3 space-y-2">
        <h4 className="text-xs uppercase tracking-wider text-dim font-semibold">Result</h4>
        {rec.result ? (
          <>
            {rec.result.pots.map((p, i) => (
              <p key={i} className="text-sm">
                <span className="text-muted">{rec.result!.pots.length > 1 ? (i === 0 ? "Main pot" : `Side pot ${i}`) : "Pot"} {fmtChips(p.amount)} →</span>{" "}
                {p.winners.map((w) => `${name(w.seat)} ${fmtChips(w.amount)}${w.handName ? ` (${w.handName})` : ""}`).join(", ")}
              </p>
            ))}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {rec.players.map((p) => {
                const net = rec.result!.net[p.seat] ?? 0;
                return <span key={p.seat} className={`pill normal-case tracking-normal ${net > 0 ? "pill-green" : net < 0 ? "pill-red" : ""}`}>{p.name} {fmtNet(net)}</span>;
              })}
            </div>
          </>
        ) : <p className="text-sm text-muted">No result recorded.</p>}
        {rec.rabbit.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Rabbit size={16} className="text-muted" aria-hidden="true" />
            <span className="text-xs text-muted">Would have come:</span>
            <div className="flex gap-1">{rec.rabbit.map((c) => <PlayingCard key={c} card={c} size={28} dim />)}</div>
          </div>
        )}
      </section>
    </div>
  );
}

function StageBlock({ st, rec, eq, name, mySeat, locked, equityOn }: { st: Stage; rec: HandRecordView; eq?: { seats: number[]; equity: number[]; exact: boolean }; name: (s: number) => string; mySeat: number | null; locked: boolean; equityOn: boolean }) {
  const eqOf = (seat: number) => (eq ? eq.equity[eq.seats.indexOf(seat)] : undefined);
  const best = eq ? Math.max(...eq.equity) : -1;
  return (
    <section className="card-surface p-3 space-y-2">
      <div className="flex items-center gap-3">
        <h4 className="text-xs uppercase tracking-wider text-dim font-semibold w-14">{streetLabel(st.street)}</h4>
        <div className="flex gap-1">{st.board.map((c) => <PlayingCard key={c} card={c} size={30} />)}</div>
        {eq && !eq.exact && <span className="text-[10px] text-dim ml-auto">simulated</span>}
      </div>
      <ul className="space-y-1.5">
        {st.seats.map((seat) => {
          const p = rec.players.find((x) => x.seat === seat)!;
          const e = eqOf(seat);
          const folded = st.foldedHere.includes(seat);
          const acts = st.actions.filter((a) => a.seat === seat);
          return (
            <li key={seat} className={`flex items-center gap-2 ${folded ? "opacity-60" : ""}`}>
              <div className="flex -space-x-1.5 shrink-0">
                {p.hole.map((c, i) => <PlayingCard key={i} card={c} size={24} />)}
              </div>
              <span className={`text-sm font-semibold w-20 truncate shrink-0 ${seat === mySeat ? "text-blue" : ""}`}>{name(seat)}</span>
              <div className="flex-1 min-w-0">
                {locked || !equityOn ? (
                  <div className="h-2 rounded-full bg-surface-3" />
                ) : e === undefined ? (
                  <div className="h-2 rounded-full skeleton" />
                ) : (
                  <div className="h-2 rounded-full bg-surface-3 overflow-hidden"><div className={`h-full rounded-full ${e === best ? "bg-gold" : "bg-blue"}`} style={{ width: `${e}%`, transition: "width 400ms var(--ease-out-quint)" }} /></div>
                )}
              </div>
              <span className={`text-sm num font-bold w-12 text-right shrink-0 ${locked || !equityOn ? "text-dim" : e === best ? "text-gold-bright" : ""}`}>{locked || !equityOn ? "–" : e === undefined ? "" : `${e}%`}</span>
              <div className="hidden sm:flex gap-1 flex-wrap justify-end w-36 shrink-0">
                {acts.map((a, i) => <span key={i} className={`pill normal-case tracking-normal ${a.kind === "fold" ? "pill-red" : a.kind === "bet" || a.kind === "raise" ? "pill-gold" : ""}`}>{a.text}</span>)}
              </div>
            </li>
          );
        })}
      </ul>
      {st.actions.length > 0 && (
        <p className="sm:hidden text-xs text-muted leading-relaxed">
          {st.actions.map((a, i) => <span key={i}><span className="font-semibold text-text">{name(a.seat)}</span> {a.text}{i < st.actions.length - 1 ? " · " : ""}</span>)}
        </p>
      )}
    </section>
  );
}
