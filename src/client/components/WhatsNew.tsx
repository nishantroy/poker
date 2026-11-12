import { ChevronRight, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { markWhatsNewSeen, type WhatsNew } from "../lib/whatsNew";
import { Sheet } from "./ui";

/** "Nov 10" from YYYY-MM-DD, in the reader's language. */
function fmtDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Recent changes, newest first. Opening it counts as having seen everything. */
export function WhatsNewSheet({ open, onClose, news }: { open: boolean; onClose: () => void; news: WhatsNew }) {
  // remember what was new when the sheet opened, so the tags stay while it is being read
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setFresh(new Set(news.unseen.map((e) => e.id)));
  }
  useEffect(() => { if (open) markWhatsNewSeen(); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="What's new">
      <ol className="space-y-5">
        {news.entries.map((e) => (
          <li key={e.id}>
            <p className="text-xs text-dim mb-0.5 flex items-center gap-2">
              <time dateTime={e.date}>{fmtDay(e.date)}</time>
              {fresh.has(e.id) && <span className="pill pill-gold">New</span>}
            </p>
            <h3 className="font-bold mb-1.5">{e.title}</h3>
            <ul className="space-y-1.5 text-sm text-muted list-disc pl-5 marker:text-dim">
              {e.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

/** Lobby banner: shown until the player opens the list or waves it away. */
export function WhatsNewBanner({ news, onOpen }: { news: WhatsNew; onOpen: () => void }) {
  const first = news.unseen[0];
  if (!first) return null;
  const more = news.unseen.length - 1;
  return (
    <div className="whats-new-banner mb-4 anim-fade-up">
      <button className="flex-1 min-w-0 flex items-center gap-3 p-3 text-left" onClick={onOpen}>
        <Sparkles size={18} className="text-gold shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-gold-bright">New</span>
          <span className="block font-semibold text-sm truncate">{first.title}{more > 0 && <span className="text-muted font-normal"> and {more} more</span>}</span>
        </span>
        <span className="text-sm text-muted hidden sm:inline">See what's new</span>
        <ChevronRight size={16} className="text-dim shrink-0" aria-hidden="true" />
      </button>
      <button className="btn btn-ghost btn-sm px-2 mr-1" onClick={markWhatsNewSeen} aria-label="Dismiss what's new"><X size={16} /></button>
    </div>
  );
}

/** Small dot for a button that leads to something unseen. The parent needs `relative`. */
export function NewDot() {
  return <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-gold" role="img" aria-label="Something new" />;
}
