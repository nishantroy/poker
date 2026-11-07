import { WifiOff } from "lucide-react";
import type { PublicSeat, TimerInfo } from "@shared/protocol";
import { fmtChips, initials } from "../lib/format";
import { PlayingCard } from "./Card";

export function TimerRing({ timer, offset, size = 66 }: { timer: TimerInfo; offset: number; size?: number }) {
  const r = size / 2 - 3;
  const circ = 2 * Math.PI * r;
  const elapsed = Math.max(0, Date.now() + offset - (timer.at - timer.durationMs));
  const remaining = timer.durationMs - elapsed;
  const urgent = remaining < Math.min(8000, timer.durationMs * 0.3);
  return (
    <svg className="timer-ring" viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, left: -5, top: -5 }} aria-hidden="true">
      <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} />
      <circle
        key={timer.at}
        className={`bar ${urgent ? "urgent" : ""}`}
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3}
        strokeDasharray={circ}
        style={{ ["--circ" as string]: circ, animationDuration: `${timer.durationMs}ms`, animationDelay: `${-elapsed}ms` }}
      />
    </svg>
  );
}

export function SeatView({ seat, isMe, acting, timer, offset, isButton, isWinner, winAmount, showdown, selectedCard, onSelectCard, cardSize, selectable, big, onTap, extra }: {
  seat: PublicSeat;
  isMe: boolean;
  acting: boolean;
  timer: TimerInfo | null;
  offset: number;
  isButton: boolean;
  isWinner: boolean;
  winAmount: number;
  showdown: boolean;
  selectedCard: number | null;
  onSelectCard?: (i: number) => void;
  cardSize: number;
  selectable: boolean;
  big: boolean;
  onTap?: () => void;
  extra?: React.ReactNode;
}) {
  const out = seat.status === "sittingOut" || (!seat.inHand && seat.stack === 0);
  const cards = seat.cards ?? [];
  const best = new Set(seat.bestCards ?? []);
  const showCards = cards.length > 0 && !(seat.folded && !isMe);
  return (
    <div className={`flex flex-col items-center ${seat.folded ? "opacity-80" : ""}`} style={{ width: big ? 140 : 96 }}>
      {big && isWinner && winAmount > 0 && <span className="mb-1 pill pill-gold anim-pop num">+{fmtChips(winAmount)}</span>}
      {showCards && (
        <div className={`flex ${big ? "-space-x-2 mb-1" : "-space-x-3 mb-[-14px]"} ${seat.folded ? "opacity-40" : ""}`} style={{ zIndex: 1 }}>
          {cards.map((c, i) => (
            <PlayingCard key={`${seat.seat}-${i}-${c ?? "x"}`} card={c} size={cardSize} deal
              dim={showdown && best.size > 0 && c !== null && !best.has(c)}
              best={showdown && c !== null && best.has(c)}
              selectable={selectable}
              selected={selectedCard === i}
              onClick={selectable && onSelectCard ? () => onSelectCard(i) : undefined}
            />
          ))}
        </div>
      )}
      <div className="relative" style={{ zIndex: 2 }}>
        <button type="button" onClick={onTap} className={`seat-avatar ${isMe ? "me" : ""} ${acting ? "acting" : ""} ${seat.folded ? "folded" : ""} ${out ? "out" : ""} ${isWinner ? "winner-glow" : ""}`} aria-label={`${seat.name}${isMe ? " (you)" : ""} — stats`}>
          {initials(seat.name)}
          {acting && timer && <TimerRing timer={timer} offset={offset} />}
          {seat.disconnected && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red flex items-center justify-center" title="Disconnected">
              <WifiOff size={12} aria-label="Disconnected" />
            </span>
          )}
        </button>
        {isButton && (
          <span className="absolute -left-3 bottom-0 w-6 h-6 rounded-full bg-white text-black text-[11px] font-black flex items-center justify-center shadow-pop" aria-label="Dealer button">D</span>
        )}
      </div>
      <div className={`mt-1 rounded-xl px-2.5 py-1 text-center min-w-[84px] ${isWinner ? "bg-gold text-on-gold" : "bg-black/60"} border border-border backdrop-blur-sm`} style={{ zIndex: 2 }}>
        <p className="text-[12px] font-bold leading-tight truncate max-w-[130px]">{big && showdown && seat.handName && !seat.folded ? seat.handName : seat.name}</p>
        <p className={`text-[13px] font-extrabold num leading-tight ${isWinner ? "" : "text-gold-bright"}`}>
          {seat.allIn && seat.inHand && !showdown ? "ALL-IN" : fmtChips(seat.stack)}
        </p>
      </div>
      {!big && extra}
      {!big && isWinner && winAmount > 0 && (
        <span className="mt-1 pill pill-gold anim-pop num">+{fmtChips(winAmount)}</span>
      )}
      {showdown && seat.handName && !seat.folded && !big && (
        <span className="mt-1 text-[11px] font-semibold text-center leading-tight bg-black/70 rounded-md px-1.5 py-0.5 anim-fade-up max-w-[150px]">{seat.handName}</span>
      )}
      {!seat.inHand && seat.status === "sittingOut" && <span className="mt-1 pill">sitting out</span>}
      {seat.inHand && seat.folded && !showdown && <span className="mt-1 pill">folded</span>}
    </div>
  );
}

export function BetChip({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  return (
    <span className="chip num" key={amount}>
      <span className="chip-dot" aria-hidden="true" />
      {fmtChips(amount)}
    </span>
  );
}
