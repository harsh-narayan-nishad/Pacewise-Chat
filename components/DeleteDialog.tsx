"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { ButtonWheel } from "@/components/WheelSpinner";
import { cn } from "@/lib/utils";

export interface DeleteChoice { label: string; run: () => Promise<void> }
/** The optional "for everyone" part: a checkbox in the dialog (its label, a short line under it, and what it does). */
export interface EveryoneChoice { label: string; hint: string; run: () => Promise<void>; /** The red button's text while the box is ticked (default "Delete"). */ confirm?: string }

/**
 * "Delete …?" as an iOS-style alert: a small rounded card, the title and one short line centred; when it can also be
 * deleted for everyone, a checkbox for that; then Cancel and Delete side by side under a hairline (Delete in red).
 * `me` is what Delete does by default; with the box ticked it does `everyone` instead.
 */
export function DeleteDialog({ title, body, me, everyone, onClose, busyLabel = "Deleting…" }: { title: string; body?: string; me: DeleteChoice; everyone?: EveryoneChoice; onClose: () => void; /** The red button's text while it works. */ busyLabel?: string }) {
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose, busy]);

  const go = async () => {
    setBusy(true);
    setError(null);
    try { await (all && everyone ? everyone.run() : me.run()); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete."); setBusy(false); }
  };

  return createPortal(
    <div className="fade-in fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-8" role="alertdialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pw-menu glass-in w-full max-w-[320px] overflow-hidden text-center">
        <div className="px-5 pb-4 pt-5">
          <h2 className="text-[17px] font-semibold leading-snug text-ink">{title}</h2>
          {body && <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{body}</p>}
          {everyone && (
            <button type="button" role="checkbox" aria-checked={all} disabled={busy} onClick={() => setAll((v) => !v)}
              className="mt-4 flex w-full items-start gap-3 text-left disabled:opacity-60">
              <span className={cn("mt-px grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border-2 transition-colors",
                all ? "border-[#FF3B30] bg-[#FF3B30] text-white" : "border-overlay/30")}>
                {all && <Check className="h-3.5 w-3.5" strokeWidth={3.2} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium leading-tight text-ink">{everyone.label}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted">{everyone.hint}</span>
              </span>
            </button>
          )}
          {error && <p className="mt-3 text-[13px] text-accent-extreme" role="alert">{error}</p>}
        </div>
        <div className="grid grid-cols-2 border-t border-overlay/15">
          <button type="button" onClick={onClose} disabled={busy} className="h-11 text-[17px] text-brand transition-colors active:bg-overlay/[0.08] disabled:opacity-40">Cancel</button>
          <button type="button" onClick={() => void go()} disabled={busy} aria-busy={busy}
            className="inline-flex h-11 items-center justify-center gap-2 border-l border-overlay/15 text-[17px] font-semibold text-[#FF3B30] transition-colors active:bg-overlay/[0.08] disabled:opacity-70">
            {busy && <ButtonWheel size={14} />}{busy ? busyLabel : all && everyone ? (everyone.confirm ?? "Delete") : me.label}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
