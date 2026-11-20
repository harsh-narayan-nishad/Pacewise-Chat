"use client";
import { useEffect, useState } from "react";
import { ButtonWheel } from "@/components/WheelSpinner";
import { cn } from "@/lib/utils";

export interface DeleteChoice { label: string; run: () => Promise<void> }

/** WhatsApp-style "Delete …?" box: one button per choice (Delete for everyone, Delete for me), then Cancel. */
export function DeleteDialog({ title, body, choices, onClose }: { title: string; body?: string; choices: DeleteChoice[]; onClose: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && busy === null) { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose, busy]);

  const pick = async (i: number) => {
    setBusy(i);
    setError(null);
    try { await choices[i].run(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete."); setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget && busy === null) onClose(); }}>
      <div className="glass-in w-full max-w-sm rounded-2xl border border-overlay/10 bg-canvas-raised p-6 shadow-themed">
        <h2 className="text-lg text-ink">{title}</h2>
        {body && <p className="mt-2 text-sm text-ink-muted">{body}</p>}
        {error && <p className="mt-3 text-sm text-accent-extreme" role="alert">{error}</p>}
        <div className="mt-5 flex flex-col items-end gap-1">
          {choices.map((c, i) => (
            <button key={c.label} type="button" disabled={busy !== null} onClick={() => void pick(i)}
              className={cn("flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-accent-extreme hover:bg-accent-extreme/10 disabled:opacity-50")}>
              {busy === i && <ButtonWheel size={14} />}{c.label}
            </button>
          ))}
          <button type="button" disabled={busy !== null} onClick={onClose} className="rounded-full px-4 py-2 text-sm font-medium text-brand hover:bg-brand/10 disabled:opacity-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}
