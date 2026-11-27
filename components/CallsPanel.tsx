"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, Phone, PhoneMissed, Trash2, Video } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { DeleteDialog } from "@/components/DeleteDialog";
import { PanelLoader } from "@/components/WheelSpinner";
import { chatApi, type CallLogEntry } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { dropCalls } from "@/lib/calls";

/** "3:12" / "1:02:05" */
const dur = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** What a row says under the name (the kind of call shows as its icon), and whether it is a missed call (red). */
function describe(c: CallLogEntry): { text: string; missed: boolean } {
  if (c.outcome === "answered") return { text: `${c.direction === "out" ? "Outgoing" : "Incoming"}${c.seconds ? ` · ${dur(c.seconds)}` : ""}`, missed: false };
  if (c.direction === "in") return c.outcome === "declined" ? { text: "Declined", missed: false } : { text: "Missed", missed: true };
  if (c.outcome === "declined") return { text: "Outgoing · Declined", missed: false };
  if (c.outcome === "busy") return { text: "Outgoing · Busy", missed: false };
  if (c.outcome === "unanswered") return { text: "Outgoing · No answer", missed: false };
  if (c.outcome === "ringing") return { text: "Outgoing", missed: false };
  return { text: "Outgoing · Cancelled", missed: false };
}
/** One time on the right, as the Phone app: the time today, "Yesterday", the weekday this week, else the date. */
function when(iso: string): string {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return clock(iso);
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
/** Calls in a row with the same person, the same day and the same kind of outcome fold into one row, as "Name (3)". */
type Row = { c: CallLogEntry; count: number; ids: string[] };
function fold(list: CallLogEntry[]): Row[] {
  const rows: Row[] = [];
  for (const c of list) {
    const last = rows[rows.length - 1];
    const same = last && last.c.peers[0]?.id === c.peers[0]?.id && new Date(last.c.startedAt).toDateString() === new Date(c.startedAt).toDateString() && describe(last.c).missed === describe(c).missed;
    if (same) { last.count++; last.ids.push(c.id); } else rows.push({ c, count: 1, ids: [c.id] });
  }
  return rows;
}

/**
 * Calls, as in WhatsApp: every call I made or got, newest first. An arrow shows its direction (red when missed),
 * then the kind, how it went and how long it lasted; the button on the right calls back the same way.
 */
export function CallsPanel({ me, onClose, onCall, asTab = false }: { me: string; onClose: () => void; onCall: (c: CallLogEntry, video: boolean) => void; /** In the bottom nav: a big title like Chats, no back arrow. */ asTab?: boolean }) {
  const [list, setList] = useState<CallLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [only, setOnly] = useState<"all" | "missed">("all");
  // Select mode (iOS Recents' Edit): tick calls, then delete them together. A folded row "(3)" stands for all its calls.
  const [picked, setPicked] = useState<string[][] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const isPicked = (ids: string[]) => !!picked?.some((g) => g[0] === ids[0]);
  const toggle = (ids: string[]) => setPicked((p) => (p ? (p.some((g) => g[0] === ids[0]) ? p.filter((g) => g[0] !== ids[0]) : [...p, ids]) : p));
  const pickedIds = (picked ?? []).flat();
  const rows = useMemo(() => fold((list ?? []).filter((c) => only === "all" || describe(c).missed)), [list, only]);
  useEffect(() => { chatApi.calls().then(setList, (e) => setError(e instanceof Error ? e.message : "Could not load your calls.")); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key !== "Escape" || clearing || deleting) return; if (picked) setPicked(null); else onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, clearing, deleting, picked]);
  const btn = "h-9 rounded-full px-3 text-[15px] font-medium text-brand transition-colors hover:bg-overlay/[0.06]";
  const actions = list && list.length > 0 && (picked
    ? <button type="button" onClick={() => setPicked(null)} className={cn(btn, "font-semibold")}>Done</button>
    : <><button type="button" onClick={() => setPicked([])} className={btn}>Select</button><button type="button" onClick={() => setClearing(true)} className={btn}>Clear</button></>);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", !asTab && "slide-in-left")}>
      {asTab ? (
        <>
          <header className="flex h-14 shrink-0 items-center justify-end px-4 pt-1">
            {actions}
          </header>
          <h1 className="shrink-0 px-4 pb-3 pt-1 text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">Calls</h1>
        </>
      ) : (
        <header className="flex h-16 shrink-0 items-center gap-4 px-4">
          <button type="button" onClick={onClose} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-overlay/[0.08]"><ArrowLeft className="h-5 w-5" /></button>
          <h2 className="flex-1 text-lg text-ink">Calls</h2>
          {actions}
        </header>
      )}
      {list && list.length > 0 && (
        <div className="shrink-0 px-4 pb-2">
          <div className="pw-seg flex rounded-[9px] p-[2px]" role="tablist" aria-label="Show calls">
            {(["all", "missed"] as const).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={only === f} onClick={() => setOnly(f)}
                className={cn("flex-1 rounded-[7px] py-[5px] text-[13px] font-semibold capitalize transition-colors", only === f ? "pw-seg-on text-ink" : "text-ink-muted")}>{f}</button>
            ))}
          </div>
        </div>
      )}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-8">
        {error && <p className="px-4 py-3 text-[14px] text-accent-extreme" role="alert">{error}</p>}
        {!list && !error && <PanelLoader label="Loading calls" />}
        {list && rows.length === 0 && (
          <div className="flex flex-col items-center px-8 pt-20 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-brand/[0.12] text-brand">{only === "missed" ? <PhoneMissed className="h-7 w-7" /> : <Phone className="h-7 w-7" />}</span>
            <p className="mt-4 text-[17px] font-semibold text-ink">{only === "missed" ? "No missed calls" : "No recent calls"}</p>
            <p className="mt-1 max-w-[260px] text-[14px] leading-snug text-ink-muted">{only === "missed" ? "Calls you didn't pick up will show here." : "Voice and video calls you make and get will show here. Start one from any chat."}</p>
          </div>
        )}
        {rows.length > 0 && (
          <ul className="pt-1">
            {rows.map(({ c, count, ids }) => {
              const p = c.peers[0];
              const others = c.peers.length - 1;
              const { text, missed } = describe(c);
              const Kind = c.video ? Video : Phone;
              const Dir = missed ? PhoneMissed : c.direction === "out" ? ArrowUpRight : ArrowDownLeft;
              return (
                <li key={c.id} onClick={picked ? () => toggle(ids) : undefined} aria-selected={picked ? isPicked(ids) : undefined}
                  className={cn("group flex items-center gap-3 pl-4 transition-colors hover:bg-overlay/[0.03]", picked && "cursor-pointer", isPicked(ids) && "bg-brand/[0.06] hover:bg-brand/[0.08]")}>
                  {picked && (
                    <span className={cn("grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 transition-colors", isPicked(ids) ? "border-brand bg-brand text-white" : "border-overlay/25")} aria-hidden>
                      {isPicked(ids) && <Check className="h-3.5 w-3.5" strokeWidth={3.2} />}
                    </span>
                  )}
                  <Avatar id={p?.id ?? c.id} name={p?.name ?? "Call"} url={p?.avatarUrl} size={42} />
                  <span className="flex min-h-[62px] min-w-0 flex-1 items-center gap-2 border-b border-overlay/[0.08] py-2 pr-3 group-last:border-transparent">
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[16px] font-semibold leading-tight", missed ? "text-[rgb(var(--missed))]" : "text-ink")}>
                        {p?.name ?? "Unknown"}{others > 0 ? ` +${others}` : ""}{count > 1 && <span className="font-normal"> ({count})</span>}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-muted">
                        <Kind className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
                        <Dir className={cn("h-3 w-3 shrink-0", missed ? "text-[rgb(var(--missed))]" : c.outcome === "answered" ? "text-accent-medium" : "text-ink-faint")} strokeWidth={2.5} aria-hidden />
                        <span className="truncate">{text}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-[14px] tabular-nums text-ink-faint">{when(c.startedAt)}</span>
                    {!picked && <button type="button" onClick={() => onCall(c, c.video)} disabled={!p || p.id === me} aria-label={`${c.video ? "Video" : "Voice"} call ${p?.name ?? ""}`} title={c.video ? "Video call" : "Voice call"}
                      className="ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/[0.12] text-brand transition-transform active:scale-90 disabled:opacity-30"><Kind className="h-[17px] w-[17px]" strokeWidth={2} /></button>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {picked && (
        <div className="pw-bar flex shrink-0 items-center gap-3 border-t border-overlay/10 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <span className="flex-1 text-[15px] font-semibold text-ink">{picked.length ? `${picked.length} selected` : "Select calls"}</span>
          <button type="button" disabled={!pickedIds.length} onClick={() => setDeleting(true)}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-[#F2453D] transition-colors enabled:hover:bg-[#F2453D]/10 disabled:opacity-35"><Trash2 className="h-[17px] w-[17px]" />Delete</button>
        </div>
      )}
      {deleting && (
        <DeleteDialog title={pickedIds.length === 1 ? "Delete this call?" : `Delete ${pickedIds.length} calls?`} body="They will be removed from your call history. The other people keep theirs."
          me={{ label: "Delete", run: async () => { await chatApi.deleteCalls(pickedIds); setList((l) => (l ?? []).filter((x) => !pickedIds.includes(x.id))); setPicked(null); dropCalls(pickedIds); } }}
          onClose={() => setDeleting(false)} />
      )}
      {clearing && (
        <DeleteDialog title="Clear call log?" body="All your calls will be removed from this list. The people you called keep their own call history." busyLabel="Clearing…"
          me={{ label: "Clear", run: async () => { await chatApi.clearCalls(); setList([]); dropCalls(null); } }} onClose={() => setClearing(false)} />
      )}
    </div>
  );
}
