"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ChevronUp, Eye, Palette, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { DeleteDialog } from "@/components/DeleteDialog";
import LiquidGlass from "@/components/LiquidGlass";
import { ButtonWheel, PanelLoader } from "@/components/WheelSpinner";
import type { User } from "@/lib/api";
import { chatApi, listTime, type CallPerson, type StatusGroup, type StatusItem } from "@/lib/chat";
import { cn } from "@/lib/utils";

/** Text status backgrounds (white text stays readable on each). */
const COLOURS = ["#0B7F79", "#1F6FEB", "#7444E0", "#C2185B", "#C2570D", "#2E7D32", "#37474F"];
const SHOW_MS = 5000;
const when = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return new Date().toDateString() === d.toDateString() ? `Today, ${t}` : `Yesterday, ${t}`;
};

/** A photo picked for a status, shrunk to at most 1080 px on its long side, as a JPEG data URL. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1080 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("That file is not a picture we can read.")); };
    img.src = src;
  });
}

/** The ring around a status photo: one arc per update, coloured while any are unseen. */
function Ring({ count, seen, children, size = 52 }: { count: number; seen: boolean; children: React.ReactNode; size?: number }) {
  const r = size / 2 - 1.5, c = 2 * Math.PI * r, gap = count > 1 ? 4 : 0, seg = c / Math.max(1, count);
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {count > 0 && (
        <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
          {Array.from({ length: count }, (_, i) => (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.4} strokeLinecap="round"
              stroke={seen ? "rgb(var(--ink-faint))" : "#25B5AC"} strokeDasharray={`${Math.max(1, seg - gap)} ${c}`} strokeDashoffset={-i * seg} />
          ))}
        </svg>
      )}
      {children}
    </span>
  );
}

/** Status, as in WhatsApp: post a line of text or a photo for 24 hours, and see your contacts' updates. */
export function StatusTab({ me, version, onError }: { me: User; version: number; onError: (m: string) => void }) {
  const [data, setData] = useState<{ mine: StatusItem[]; others: StatusGroup[] } | null>(null);
  const [writing, setWriting] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ owner: CallPerson; items: StatusItem[]; mine: boolean; start: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => chatApi.statuses().then(setData, (e) => onError(e instanceof Error ? e.message : "Could not load status updates.")), [onError]);
  useEffect(() => { void load(); }, [load, version]);
  useEffect(() => { const t = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(t); }, [load]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try { setPhoto(await shrink(f)); } catch (e) { onError(e instanceof Error ? e.message : "Could not use that picture."); }
  };
  const meP: CallPerson = { id: me.id, name: me.name, username: me.username, avatarUrl: me.avatarUrl ?? null };
  const recent = data?.others.filter((g) => !g.allSeen) ?? [];
  const viewed = data?.others.filter((g) => g.allSeen) ?? [];
  const mine = data?.mine ?? [];

  const row = (key: string, person: CallPerson, items: StatusItem[], seen: boolean, title: string, sub: string, onClick: () => void, extra?: React.ReactNode) => (
    <li key={key}>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-overlay/[0.04]">
        <Ring count={items.length} seen={seen}><Avatar id={person.id} name={person.name} url={person.avatarUrl} size={44} />{extra}</Ring>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold text-ink">{title}</span>
          <span className="block truncate text-[13px] text-ink-muted">{sub}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-end gap-2 px-4 pt-1">
        <div className="pw-corner-pill text-brand" role="group" aria-label="New status">
          <span className="pw-corner-lg" aria-hidden><LiquidGlass width="100%" height="100%" radius={26} blur={4} /></span>
          <button type="button" onClick={() => setWriting(true)} aria-label="Write a text status" title="Text status" className="pw-corner-in"><Pencil size={20} strokeWidth={1.75} aria-hidden /></button>
          <span className="pw-corner-sep" aria-hidden />
          <button type="button" onClick={() => file.current?.click()} aria-label="Post a photo status" title="Photo status" className="pw-corner-in"><Camera size={20} strokeWidth={1.75} aria-hidden /></button>
        </div>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      </header>
      <h1 className="shrink-0 px-4 pb-3 pt-1 text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">Status</h1>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-6">
        {!data && <PanelLoader label="Loading status updates" />}
        {data && (
          <>
            <ul>
              {row("mine", meP, mine, true, "My status", mine.length ? `${mine.length} update${mine.length === 1 ? "" : "s"} · ${when(mine[mine.length - 1].createdAt)}` : "Tap to add a status update",
                () => (mine.length ? setViewing({ owner: meP, items: mine, mine: true, start: 0 }) : setWriting(true)),
                !mine.length ? (
                  // no status yet: a + in the middle of my photo
                  <span className="absolute grid h-11 w-11 place-items-center rounded-full bg-black/50" aria-hidden>
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-white shadow-[0_2px_6px_rgba(0,0,0,0.3)]"><Plus className="h-[18px] w-[18px]" strokeWidth={3} /></span>
                  </span>
                ) : undefined)}
            </ul>
            {recent.length > 0 && <p className="px-4 pb-1 pt-5 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Recent updates</p>}
            <ul>{recent.map((g) => row(g.user.id, g.user, g.items, false, g.user.name, when(g.latest), () => setViewing({ owner: g.user, items: g.items, mine: false, start: Math.max(0, g.items.findIndex((s) => !s.seen)) })))}</ul>
            {viewed.length > 0 && <p className="px-4 pb-1 pt-5 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Viewed updates</p>}
            <ul>{viewed.map((g) => row(g.user.id, g.user, g.items, true, g.user.name, when(g.latest), () => setViewing({ owner: g.user, items: g.items, mine: false, start: 0 })))}</ul>
            {!data.others.length && <p className="px-8 pt-10 text-center text-[14px] leading-snug text-ink-muted">Status updates from people you chat with show up here. They disappear after 24 hours.</p>}
          </>
        )}
      </div>

      {writing && <TextComposer onClose={() => setWriting(false)} onPosted={() => { setWriting(false); void load(); }} onError={onError} />}
      {photo && <PhotoComposer image={photo} onClose={() => setPhoto(null)} onPosted={() => { setPhoto(null); void load(); }} onError={onError} />}
      {viewing && <Viewer {...viewing} onClose={() => { setViewing(null); void load(); }} onError={onError} />}
    </div>
  );
}

function Overlay({ children, bg }: { children: React.ReactNode; bg: string }) {
  return createPortal(<div className="fade-in fixed inset-0 z-[170] flex flex-col text-white" style={{ background: bg }} role="dialog" aria-modal="true">{children}</div>, document.body);
}

function TextComposer({ onClose, onPosted, onError }: { onClose: () => void; onPosted: () => void; onError: (m: string) => void }) {
  const [text, setText] = useState("");
  const [bg, setBg] = useState(COLOURS[0]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose, busy]);
  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await chatApi.postStatus({ kind: "text", text: text.trim(), bg }); onPosted(); } catch (e) { onError(e instanceof Error ? e.message : "Could not post your status."); setBusy(false); }
  };
  return (
    <Overlay bg={bg}>
      <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full bg-black/20"><X className="h-5 w-5" /></button>
        <button type="button" onClick={() => setBg(COLOURS[(COLOURS.indexOf(bg) + 1) % COLOURS.length])} aria-label="Change colour" title="Change colour" className="grid h-10 w-10 place-items-center rounded-full bg-black/20"><Palette className="h-5 w-5" /></button>
      </div>
      <div className="flex flex-1 items-center justify-center px-8">
        <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus maxLength={700} placeholder="Type a status"
          className="w-full max-w-xl resize-none bg-transparent text-center text-[28px] font-medium leading-snug text-white outline-none placeholder:text-white/60 sm:text-[34px]" rows={4} />
      </div>
      <div className="flex justify-end p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => void post()} disabled={!text.trim() || busy} aria-label="Post status" className="grid h-14 w-14 place-items-center rounded-full bg-white text-[#0B0C0F] shadow-lg disabled:opacity-50">
          {busy ? <ButtonWheel size={18} /> : <Send className="h-6 w-6" />}
        </button>
      </div>
    </Overlay>
  );
}

function PhotoComposer({ image, onClose, onPosted, onError }: { image: string; onClose: () => void; onPosted: () => void; onError: (m: string) => void }) {
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose, busy]);
  const post = async () => {
    if (busy) return;
    setBusy(true);
    try { await chatApi.postStatus({ kind: "photo", image, text: caption.trim() || undefined }); onPosted(); } catch (e) { onError(e instanceof Error ? e.message : "Could not post your status."); setBusy(false); }
  };
  return (
    <Overlay bg="#000">
      <div className="flex items-center p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><X className="h-5 w-5" /></button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="" className="min-h-0 flex-1 object-contain" />
      <div className="flex items-center gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={700} placeholder="Add a caption…" className="h-12 min-w-0 flex-1 rounded-full bg-white/10 px-5 text-[16px] text-white outline-none placeholder:text-white/50" />
        <button type="button" onClick={() => void post()} disabled={busy} aria-label="Post status" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#0B7F79] text-white disabled:opacity-50">
          {busy ? <ButtonWheel size={16} /> : <Send className="h-5 w-5" />}
        </button>
      </div>
    </Overlay>
  );
}

/** Full screen: one update at a time, 5 s each; tap the left or right side to go back or on, hold to pause. */
function Viewer({ owner, items: initial, mine, start, onClose, onError }: { owner: CallPerson; items: StatusItem[]; mine: boolean; start: number; onClose: () => void; onError: (m: string) => void }) {
  const [items, setItems] = useState(initial);
  const [i, setI] = useState(start);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewers, setViewers] = useState<(CallPerson & { at: string })[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const s = items[i];
  const hold = paused || viewers !== null || deleting;

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") prev(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });
  // count this one as seen
  useEffect(() => { if (s && !mine && !s.seen) void chatApi.viewStatus(s.id).catch(() => undefined); }, [s, mine]);
  // the bar fills over 5 s (time held down does not count), then the next one
  const elapsed = useRef(0);
  useEffect(() => { elapsed.current = 0; setProgress(0); }, [i]);
  useEffect(() => {
    if (hold || !s) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const p = Math.min(1, elapsed.current / SHOW_MS);
      setProgress(p);
      if (p >= 1) { next(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hold, i]); // eslint-disable-line react-hooks/exhaustive-deps
  function next() { setI((x) => { if (x + 1 >= items.length) { onClose(); return x; } return x + 1; }); }
  function prev() { setI((x) => Math.max(0, x - 1)); elapsed.current = 0; setProgress(0); }

  if (!s) return null;
  return (
    <Overlay bg={s.kind === "text" ? s.bg : "#000"}>
      <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/45 to-transparent px-3 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex gap-1">
          {items.map((x, k) => (
            <span key={x.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
              <span className="block h-full bg-white" style={{ width: `${k < i ? 100 : k === i ? progress * 100 : 0}%` }} />
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Avatar id={owner.id} name={owner.name} url={owner.avatarUrl} size={36} />
          <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{mine ? "My status" : owner.name}</span><span className="block text-[12px] text-white/75">{listTime(s.createdAt)}</span></span>
          {mine && <button type="button" onClick={() => setDeleting(true)} aria-label="Delete this status" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10"><Trash2 className="h-5 w-5" /></button>}
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
      </div>

      {/* the update; tap the left third to go back, elsewhere to go on; hold to pause */}
      <div className="relative flex flex-1 select-none items-center justify-center"
        onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX - r.left < r.width / 3) prev(); else next(); }}>
        {s.kind === "text" ? (
          <p className="max-w-xl whitespace-pre-wrap break-words px-8 text-center text-[28px] font-medium leading-snug sm:text-[34px]">{s.text}</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.image ?? ""} alt={s.text || "Status photo"} className="max-h-full max-w-full object-contain" draggable={false} />
        )}
        {s.kind === "photo" && s.text && <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-6 pb-6 pt-10 text-center text-[16px]">{s.text}</p>}
      </div>

      {mine && (
        <div className="flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          <button type="button" onClick={() => { setViewers([]); void chatApi.statusViewers(s.id).then(setViewers, () => setViewers([])); }} className="flex flex-col items-center gap-0.5 text-[14px]">
            <ChevronUp className="h-4 w-4" /><span className="flex items-center gap-1.5"><Eye className="h-4 w-4" />{s.views ?? 0}</span>
          </button>
        </div>
      )}
      {viewers && (
        <div className="absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto rounded-t-[20px] bg-canvas-raised text-ink">
          <div className="sticky top-0 flex items-center justify-between bg-canvas-raised px-4 py-3">
            <span className="text-[16px] font-semibold">Viewed by {viewers.length}</span>
            <button type="button" onClick={() => setViewers(null)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-overlay/[0.08]"><X className="h-5 w-5" /></button>
          </div>
          {viewers.length === 0 && <p className="px-4 pb-6 text-[14px] text-ink-muted">No views yet.</p>}
          <ul className="pb-4">
            {viewers.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-2">
                <Avatar id={v.id} name={v.name} url={v.avatarUrl} size={40} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{v.name}</span><span className="block text-[13px] text-ink-muted">{when(v.at)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {deleting && (
        <DeleteDialog title="Delete this status update?" body="It will be deleted for everyone who received it." me={{
          label: "Delete", run: async () => {
            try {
              await chatApi.deleteStatus(s.id);
              const rest = items.filter((x) => x.id !== s.id);
              if (!rest.length) { onClose(); return; }
              setItems(rest); setI((x) => Math.min(x, rest.length - 1));
            } catch (e) { onError(e instanceof Error ? e.message : "Could not delete it."); throw e; }
          },
        }} onClose={() => setDeleting(false)} />
      )}
    </Overlay>
  );
}
