import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function Sheet({ open, onClose, title, children, side = "bottom" }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; side?: "bottom" | "right" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const panelCls =
    side === "right"
      ? "absolute right-0 top-0 h-full w-full max-w-md anim-fade-up"
      : "absolute left-0 right-0 bottom-0 max-h-[88dvh] rounded-t-3xl anim-slide-up mx-auto max-w-2xl";
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div className={`${panelCls} bg-surface border border-border shadow-pop flex flex-col`} style={{ paddingBottom: "max(var(--sab), 8px)" }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn btn-ghost btn-sm -mr-2" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto scroll-thin px-5 pb-5 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function Modal({ open, title, children }: { open: boolean; title?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md card-surface shadow-pop p-5 anim-pop">
        {title && <h2 className="text-xl font-bold mb-3">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-red/90 text-white text-sm font-semibold shadow-pop anim-fade-up" style={{ top: "calc(var(--sat) + 12px)" }} role="alert">
      {message}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-dim mt-1">{hint}</span>}
    </label>
  );
}
