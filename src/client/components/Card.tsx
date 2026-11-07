import type { Card as CardT } from "@engine/cards";

const SUIT_PATHS: Record<string, string> = {
  s: "M12 2C9 7 4 9.5 4 14a4 4 0 0 0 7 2.6c-.2 1.7-1 3-2.5 4.4h7c-1.5-1.4-2.3-2.7-2.5-4.4A4 4 0 0 0 20 14c0-4.5-5-7-8-12z",
  h: "M12 21s-8-5.3-8-11.3A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.7C20 15.7 12 21 12 21z",
  d: "M12 2l8 10-8 10-8-10z",
  c: "M12 2a4 4 0 0 0-3.6 5.8A4 4 0 1 0 10.5 16c-.2 1.7-1 3.2-2.5 5h8c-1.5-1.8-2.3-3.3-2.5-5a4 4 0 1 0 2.1-8.2A4 4 0 0 0 12 2z",
};

export function SuitIcon({ suit, className }: { suit: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={SUIT_PATHS[suit] ?? ""} fill="currentColor" />
    </svg>
  );
}

const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
const RANK_NAME: Record<string, string> = { T: "10", J: "J", Q: "Q", K: "K", A: "A" };

export function PlayingCard({ card, size, className = "", dim, best, deal, onClick, selected, selectable }: {
  card: CardT | null;
  size?: number;
  className?: string;
  dim?: boolean;
  best?: boolean;
  deal?: boolean;
  onClick?: () => void;
  selected?: boolean;
  selectable?: boolean;
}) {
  const style = size ? ({ "--card-w": `${size}px` } as React.CSSProperties) : undefined;
  const cls = ["pcard", dim ? "dim" : "", best ? "best" : "", deal ? "deal" : "", selected ? "selected" : "", selectable ? "selectable" : "", className];
  if (!card) {
    return <div className={[...cls, "back"].join(" ")} style={style} aria-label="Face-down card" role="img" />;
  }
  const rank = card[0]!;
  const suit = card[1]!;
  const red = suit === "h" || suit === "d";
  const label = `${RANK_NAME[rank] ?? rank} of ${SUIT_NAME[suit]}`;
  const inner = (
    <>
      <div className="flex items-center gap-[2px]">
        <span className="rank">{RANK_NAME[rank] ?? rank}</span>
        <SuitIcon suit={suit} className="suit-sm" />
      </div>
      <SuitIcon suit={suit} className="suit-lg" />
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={[...cls, red ? "red" : ""].join(" ")} style={style} aria-label={label} aria-pressed={selected} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return (
    <div className={[...cls, red ? "red" : ""].join(" ")} style={style} role="img" aria-label={label}>
      {inner}
    </div>
  );
}
