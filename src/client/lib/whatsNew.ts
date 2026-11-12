import { useMemo, useSyncExternalStore } from "react";
import { CHANGELOG, unseenIds, visibleChangelog, type VisibleEntry } from "@shared/changelog";
import type { Flags } from "@shared/flags";
import { useAuth } from "./auth";

/** The newest changelog entry this browser has seen. Shared by every component through a tiny store. */
const KEY = "fp:whatsNew";
const read = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
let seen = read();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

// another tab marked it seen
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => { if (e.key === KEY) { seen = e.newValue; emit(); } });
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** The player has looked (or waved the banner away): nothing is new any more. */
export function markWhatsNewSeen() {
  const newest = CHANGELOG[0]?.id ?? null;
  if (!newest || seen === newest) return;
  seen = newest;
  try { localStorage.setItem(KEY, newest); } catch { /* private mode: it stays new until the page reloads */ }
  emit();
}

export interface WhatsNew {
  /** False when the operator has switched the feature off or there is nothing to list. */
  enabled: boolean;
  entries: VisibleEntry[];
  /** Entries this browser has not seen yet, newest first. */
  unseen: VisibleEntry[];
}

export function useWhatsNew(flags: Flags): WhatsNew {
  const { user } = useAuth();
  const seenId = useSyncExternalStore(subscribe, () => seen);
  return useMemo(() => {
    const entries = flags.whatsNew ? visibleChangelog(flags) : [];
    const fresh = unseenIds(seenId, user?.createdAt);
    return { enabled: entries.length > 0, entries, unseen: entries.filter((e) => fresh.has(e.id)) };
  }, [flags, seenId, user?.createdAt]);
}
