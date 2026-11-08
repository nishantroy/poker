import { Bug, ExternalLink, Lightbulb } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { Field, Sheet } from "./ui";

/** Bug report / idea form. The server files it as a GitHub issue (or hands back a prefilled GitHub link). */
export function FeedbackSheet({ open, onClose, context = {} }: { open: boolean; onClose: () => void; context?: Record<string, string | number | undefined> }) {
  const [kind, setKind] = useState<"bug" | "idea">("idea");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string; number?: number } | null>(null);
  useEffect(() => { if (open) { setErr(null); setDone(null); } }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.feedback({ kind, title: title.trim(), details: details.trim(), context: { page: location.pathname, ua: navigator.userAgent, ...context } });
      if (r.filed) {
        setDone({ url: r.url, number: r.number });
        setTitle("");
        setDetails("");
      } else {
        window.open(r.url, "_blank", "noopener");
        onClose();
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Send feedback">
      {done ? (
        <div className="space-y-4 text-center py-2">
          <p className="text-lg font-bold">Thanks, got it.</p>
          <p className="text-sm text-muted">It's filed as issue #{done.number}.</p>
          <a className="btn w-full" href={done.url} target="_blank" rel="noopener noreferrer">View on GitHub <ExternalLink size={16} aria-hidden="true" /></a>
          <button className="btn btn-ghost w-full" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Feedback type">
            <button type="button" className="chip-toggle !flex flex-row items-center justify-center gap-2 min-h-[44px] whitespace-nowrap" aria-pressed={kind === "bug"} onClick={() => setKind("bug")}><Bug size={16} className="shrink-0" aria-hidden="true" /> Report a bug</button>
            <button type="button" className="chip-toggle !flex flex-row items-center justify-center gap-2 min-h-[44px] whitespace-nowrap" aria-pressed={kind === "idea"} onClick={() => setKind("idea")}><Lightbulb size={16} className="shrink-0" aria-hidden="true" /> Suggest an idea</button>
          </div>
          <Field label="Title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required minLength={3}
              placeholder={kind === "bug" ? "Call button did nothing on the river" : "Let us straddle"} />
          </Field>
          <Field label="Details" hint={kind === "bug" ? "What happened, and what did you expect?" : "How should it work?"}>
            <textarea className="input min-h-[110px] py-3" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={4000} />
          </Field>
          <p className="text-xs text-dim">Posted publicly on GitHub with your username, the page you're on and your device type.</p>
          {err && <p className="text-sm text-[#ff8b8e]" role="alert">{err}</p>}
          <button className="btn btn-primary w-full" disabled={busy || title.trim().length < 3}>{busy ? "Sending…" : "Send"}</button>
        </form>
      )}
    </Sheet>
  );
}
