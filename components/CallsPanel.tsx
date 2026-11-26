"use client";
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Phone, PhoneOff, Video } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { DeleteDialog } from "@/components/DeleteDialog";
import { PanelLoader } from "@/components/WheelSpinner";
import { chatApi, listTime, type CallLogEntry } from "@/lib/chat";
import { cn } from "@/lib/utils";

/** "3:12" / "1:02:05" */
const dur = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** What a row says under the name, and whether it is a missed call (red). */
function describe(c: CallLogEntry): { text: string; missed: boolean } {
  const kind = c.video ? "Video" : "Voice";
  if (c.outcome === "answered") return { text: `${c.direction === "out" ? "Outgoing" : "Incoming"} ${kind.toLowerCase()} call${c.seconds ? ` · ${dur(c.seconds)}` : ""}`, missed: false };
  if (c.direction === "in") return { text: c.outcome === "declined" ? `Declined ${kind.toLowerCase()} call` : `Missed ${kind.toLowerCase()} call`, missed: c.outcome !== "declined" };
  if (c.outcome === "declined" || c.outcome === "busy") return { text: `${kind} call · ${c.outcome === "busy" ? "Busy" : "Declined"}`, missed: false };
  if (c.outcome === "unanswered") return { text: `${kind} call · No answer`, missed: false };
  if (c.outcome === "ringing") return { text: `Outgoing ${kind.toLowerCase()} call`, missed: false };
  return { text: `${kind} call · Cancelled`, missed: false };
}

/**
 * Calls, as in WhatsApp: every call I made or got, newest first. An arrow shows its direction (red when missed),
 * then the kind, how it went and how long it lasted; the button on the right calls back the same way.
 */
export function CallsPanel({ me, onClose, onCall, asTab = false }: { me: string; onClose: () => void; onCall: (c: CallLogEntry, video: boolean) => void; /** In the bottom nav: a big title like Chats, no back arrow. */ asTab?: boolean }) {
  const [list, setList] = useState<CallLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  useEffect(() => { chatApi.calls().then(setList, (e) => setError(e instanceof Error ? e.message : "Could not load your calls.")); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !clearing) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, clearing]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", !asTab && "slide-in-left")}>
      {asTab ? (
        <>
          <header className="flex h-14 shrink-0 items-center justify-end px-4 pt-1">
            {list && list.length > 0 && <button type="button" onClick={() => setClearing(true)} className="h-9 rounded-full px-3 text-[14px] font-medium text-accent-extreme hover:bg-overlay/[0.06]">Clear call log</button>}
          </header>
          <h1 className="shrink-0 px-4 pb-3 pt-1 text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">Calls</h1>
        </>
      ) : (
        <header className="flex h-16 shrink-0 items-center gap-4 px-4">
          <button type="button" onClick={onClose} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-overlay/[0.08]"><ArrowLeft className="h-5 w-5" /></button>
          <h2 className="flex-1 text-lg text-ink">Calls</h2>
          {list && list.length > 0 && <button type="button" onClick={() => setClearing(true)} className="h-9 rounded-full px-3 text-[14px] font-medium text-accent-extreme hover:bg-overlay/[0.06]">Clear call log</button>}
        </header>
      )}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-8">
        {error && <p className="px-4 py-3 text-[14px] text-accent-extreme" role="alert">{error}</p>}
        {!list && !error && <PanelLoader label="Loading calls" />}
        {list && list.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-8 pt-16 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-overlay/[0.07] text-ink-muted"><Phone className="h-6 w-6" /></span>
            <p className="text-[16px] text-ink">No calls yet</p>
            <p className="text-[14px] text-ink-muted">Calls you make and get show up here. Start one from a chat with the phone button.</p>
          </div>
        )}
        {list && list.length > 0 && (
          <ul>
            {list.map((c) => {
              const p = c.peers[0];
              const others = c.peers.length - 1;
              const { text, missed } = describe(c);
              const Arrow = c.direction === "out" ? ArrowUpRight : ArrowDownLeft;
              const Kind = c.video ? Video : Phone;
              return (
                <li key={c.id} className="flex items-center gap-3 px-4">
                  <Avatar id={p?.id ?? c.id} name={p?.name ?? "Call"} url={p?.avatarUrl} size={44} />
                  <span className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 border-b border-overlay/[0.07] py-2">
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[16px] font-medium", missed ? "text-accent-extreme" : "text-ink")}>{p?.name ?? "Unknown"}{others > 0 ? ` and ${others} more` : ""}</span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[13px] text-ink-muted">
                        {missed ? <PhoneOff className="h-3.5 w-3.5 shrink-0 text-accent-extreme" aria-hidden /> : <Arrow className={cn("h-3.5 w-3.5 shrink-0", c.outcome === "answered" ? "text-accent-medium" : "text-ink-faint")} strokeWidth={2.5} aria-hidden />}
                        <span className="truncate">{text}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[13px] tabular-nums text-ink-faint">{listTime(c.startedAt)}{listTime(c.startedAt) !== clock(c.startedAt) && <span className="block">{clock(c.startedAt)}</span>}</span>
                    <button type="button" onClick={() => onCall(c, c.video)} disabled={!p || p.id === me} aria-label={`${c.video ? "Video" : "Voice"} call ${p?.name ?? ""}`} title={c.video ? "Video call" : "Voice call"}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-brand transition-colors hover:bg-overlay/[0.08] disabled:opacity-30"><Kind className="h-5 w-5" /></button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {clearing && (
        <DeleteDialog title="Clear call log?" body="All your calls will be removed from this list. The people you called keep their own call history." busyLabel="Clearing…"
          me={{ label: "Clear", run: async () => { await chatApi.clearCalls(); setList([]); } }} onClose={() => setClearing(false)} />
      )}
    </div>
  );
}
