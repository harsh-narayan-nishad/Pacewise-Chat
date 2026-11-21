"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Flag } from "lucide-react";
import { ButtonWheel } from "@/components/WheelSpinner";
import { chatApi, titleOf, type Conversation, type ReportReason } from "@/lib/chat";
import { cn } from "@/lib/utils";

const REASONS: { id: ReportReason; label: string; hint: string }[] = [
  { id: "spam", label: "Spam", hint: "Unwanted ads, links or repeated messages" },
  { id: "harassment", label: "Harassment", hint: "Bullying, threats or abuse" },
  { id: "inappropriate", label: "Inappropriate", hint: "Offensive or explicit content" },
  { id: "impersonation", label: "Fake account", hint: "Pretending to be someone else" },
  { id: "other", label: "Something else", hint: "Tell us below" },
];

/**
 * Report spam (or abuse) from a chat. It goes to the Pacewise admins' Reports, like a report from anywhere else.
 * Messages are end-to-end encrypted, so admins cannot read them; the person may choose to include the last few
 * messages from the one they report. In a one-to-one chat they can also delete the chat at the same time.
 */
export function ReportDialog({ conv, me, recentFrom, onClose, onDone, onDeleteChat }: {
  conv: Conversation; me: string; recentFrom: (userId: string) => string[]; onClose: () => void; onDone: (m: string) => void; onDeleteChat: () => Promise<void>;
}) {
  const isGroup = conv.type === "group";
  const others = conv.members.filter((m) => m.id !== me);
  const [who, setWho] = useState(isGroup ? "" : others[0]?.id ?? "");
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [include, setInclude] = useState(false);
  const [alsoDelete, setAlsoDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const person = others.find((m) => m.id === who);
  const recent = who ? recentFrom(who) : [];

  async function submit() {
    if (!person || busy) return;
    setBusy(true); setError(null);
    const where = isGroup ? `the group "${conv.name}"` : "a one-to-one chat";
    let details = `Reported from Pacewise Chat, in ${where}.`;
    if (note.trim()) details += `\nNote: ${note.trim()}`;
    if (include && recent.length) details += `\nLast messages from them (shared by the reporter):\n${recent.map((t) => `- ${t.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}`;
    try {
      await chatApi.report(person.id, reason, details.slice(0, 1000));
      if (alsoDelete && !isGroup) await onDeleteChat();
      onDone(`Reported ${person.name.split(" ")[0]}. Thank you, our team will look into it.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the report.");
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fade-in fixed inset-0 z-[160] flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Report"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pw-menu glass-in flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden">
        <div className="thin-scroll overflow-y-auto p-5">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#F2453D]/12 text-[#F2453D]"><Flag className="h-5 w-5" /></span>
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">{person ? `Report ${person.name}` : `Report someone in ${titleOf(conv, me)}`}</h2>
          <p className="mt-1 text-[14px] leading-snug text-ink-muted">The Pacewise team reviews every report. {person?.name.split(" ")[0] ?? "They"} won&apos;t be told who reported them.</p>

          {isGroup && (
            <>
              <p className="mb-1.5 mt-5 text-[13px] font-semibold text-ink-muted">Who</p>
              <div className="flex flex-wrap gap-2">
                {others.map((m) => (
                  <button key={m.id} type="button" onClick={() => setWho(m.id)} aria-pressed={who === m.id}
                    className={cn("rounded-full px-3.5 py-1.5 text-[14px] transition-colors", who === m.id ? "bg-brand text-white" : "bg-overlay/[0.08] text-ink")}>{m.name}</button>
                ))}
              </div>
            </>
          )}

          <p className="mb-1.5 mt-5 text-[13px] font-semibold text-ink-muted">Why</p>
          <div className="overflow-hidden rounded-[12px] bg-overlay/[0.05]" role="radiogroup" aria-label="Reason">
            {REASONS.map((r, i) => (
              <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} onClick={() => setReason(r.id)}
                className={cn("flex w-full items-center gap-3 px-3.5 py-2.5 text-left", i > 0 && "border-t border-overlay/10")}>
                <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", reason === r.id ? "border-brand" : "border-overlay/30")}>{reason === r.id && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}</span>
                <span className="min-w-0">
                  <span className="block text-[15px] text-ink">{r.label}</span>
                  <span className="block text-[12.5px] text-ink-muted">{r.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-muted">Anything to add? (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} placeholder="What happened"
              className="pw-field w-full resize-none rounded-[12px] px-3.5 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink-faint" />
          </label>

          <label className={cn("mt-4 flex items-start gap-3", !recent.length && "opacity-50")}>
            <input type="checkbox" checked={include && recent.length > 0} disabled={!recent.length} onChange={(e) => setInclude(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
            <span className="text-[14px] leading-snug text-ink">
              Include their last {recent.length || 5} message{recent.length === 1 ? "" : "s"}
              <span className="block text-[12.5px] text-ink-muted">Chats are end-to-end encrypted, so our team can only see messages you choose to share.{!recent.length && " None loaded from them yet."}</span>
            </span>
          </label>
          {!isGroup && (
            <label className="mt-3 flex items-start gap-3">
              <input type="checkbox" checked={alsoDelete} onChange={(e) => setAlsoDelete(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
              <span className="text-[14px] leading-snug text-ink">Also delete this chat<span className="block text-[12.5px] text-ink-muted">It leaves your chat list (for you only).</span></span>
            </label>
          )}
          {error && <p className="mt-3 text-sm text-accent-extreme" role="alert">{error}</p>}
        </div>
        <div className="flex gap-2 border-t border-overlay/10 p-3">
          <button type="button" onClick={onClose} disabled={busy} className="h-11 flex-1 rounded-full bg-overlay/[0.08] text-[15px] font-medium text-ink disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={!person || busy} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[#F2453D] text-[15px] font-semibold text-white disabled:opacity-40">
            {busy && <ButtonWheel />}{busy ? "Sending…" : "Report"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
