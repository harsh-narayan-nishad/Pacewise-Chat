"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, UserX } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ButtonWheel, PanelLoader } from "@/components/WheelSpinner";
import { chatApi, type Person } from "@/lib/chat";
import { BUBBLES, WALLPAPERS, loadLook, saveLook, type Look } from "@/lib/look";
import { cn } from "@/lib/utils";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 px-4">
      <button type="button" onClick={onClose} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-overlay/[0.08]"><ArrowLeft className="h-5 w-5" /></button>
      <h2 className="text-lg text-ink">{title}</h2>
    </header>
  );
}

const label = "px-4 pb-2 text-[13px] font-medium uppercase tracking-[0.06em] text-ink-muted";

/** Chat theme: the colour of my bubbles and the wallpaper, with a small live preview. Saved on this device. */
export function ChatThemePanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [look, setLook] = useState<Look>(loadLook);
  const pick = (l: Look) => { setLook(l); saveLook(l); };

  return (
    <div className="slide-in-left flex h-full min-h-0 flex-col">
      <Head title="Chat theme" onClose={onClose} />
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-8">
        {/* preview */}
        <div className="px-4 pb-6">
          <div className="chat-aurora overflow-hidden rounded-[18px] border border-overlay/10">
            <div className="chat-wallpaper flex flex-col gap-2 px-3 py-4" aria-hidden>
              <div className="bubble-theirs w-fit max-w-[75%] rounded-[18px] px-3 py-2 text-[15px] text-ink">Did you finish the plan?</div>
              <div className="bubble-mine ml-auto w-fit max-w-[75%] rounded-[18px] px-3 py-2 text-[15px]">Yes, sending it now 👍</div>
              <div className="bubble-mine ml-auto w-fit max-w-[75%] rounded-[18px] px-3 py-2 text-[15px]">Have a look tonight.</div>
            </div>
          </div>
        </div>

        <p className={label}>Message colour</p>
        <div className="grid grid-cols-4 gap-3 px-4 pb-7 sm:grid-cols-7" role="radiogroup" aria-label="Message colour">
          {BUBBLES.map((b) => {
            const on = look.bubble === b.id;
            return (
              <button key={b.id} type="button" role="radio" aria-checked={on} onClick={() => pick({ ...look, bubble: b.id })} className="flex flex-col items-center gap-1.5 outline-none">
                <span className={cn("grid h-11 w-11 place-items-center rounded-full text-white ring-offset-2 ring-offset-canvas transition-shadow", on ? "ring-2 ring-ink" : "ring-0")}
                  style={{ background: `linear-gradient(165deg, ${b.from}, ${b.mid} 52%, ${b.to})` }}>
                  {on && <Check className="h-5 w-5" strokeWidth={2.75} />}
                </span>
                <span className={cn("text-[12px]", on ? "text-ink" : "text-ink-muted")}>{b.name}</span>
              </button>
            );
          })}
        </div>

        <p className={label}>Wallpaper</p>
        <div className="grid grid-cols-3 gap-3 px-4" role="radiogroup" aria-label="Wallpaper">
          {WALLPAPERS.map((w) => {
            const on = look.wallpaper === w.id;
            return (
              <button key={w.id} type="button" role="radio" aria-checked={on} onClick={() => pick({ ...look, wallpaper: w.id })} className="flex flex-col items-center gap-1.5 outline-none">
                {/* each tile shows its own wallpaper, whatever is chosen */}
                <span data-wp={w.id} className={cn("wp-tile chat-aurora relative block h-24 w-full overflow-hidden rounded-[14px] border transition-shadow", on ? "border-transparent ring-2 ring-brand" : "border-overlay/10")}>
                  {on && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brand text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>}
                </span>
                <span className={cn("text-[12px]", on ? "text-ink" : "text-ink-muted")}>{w.name}</span>
              </button>
            );
          })}
        </div>
        <p className="px-4 pt-6 text-[13px] leading-snug text-ink-faint">The theme is saved on this device and applies to all your chats. Others see their own theme.</p>
      </div>
    </div>
  );
}

/** Blocked contacts: everyone I blocked, each with Unblock. */
export function BlockedPanel({ onClose, onUnblock }: { onClose: () => void; onUnblock: (userId: string) => Promise<void> }) {
  useEscape(onClose);
  const [list, setList] = useState<(Person & { blockedAt: string | null })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { chatApi.blocks().then(setList, (e) => setError(e instanceof Error ? e.message : "Could not load blocked contacts.")); }, []);

  const unblock = async (id: string) => {
    setBusy(id);
    try { await onUnblock(id); setList((l) => l?.filter((p) => p.id !== id) ?? null); } catch (e) { setError(e instanceof Error ? e.message : "Could not unblock."); } finally { setBusy(null); }
  };

  return (
    <div className="slide-in-left flex h-full min-h-0 flex-col">
      <Head title="Blocked contacts" onClose={onClose} />
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-8">
        {error && <p className="px-4 pb-3 text-[14px] text-accent-extreme" role="alert">{error}</p>}
        {!list && !error && <PanelLoader label="Loading blocked contacts" />}
        {list && list.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-8 pt-16 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-overlay/[0.07] text-ink-muted"><UserX className="h-6 w-6" /></span>
            <p className="text-[16px] text-ink">No blocked contacts</p>
            <p className="text-[14px] text-ink-muted">To block someone, open your chat with them and choose Block from the ⋯ menu.</p>
          </div>
        )}
        {list && list.length > 0 && (
          <>
            <p className="px-4 pb-3 text-[13px] leading-snug text-ink-muted">Blocked contacts can't message or call you, and you can't message or call them.</p>
            <ul>
              {list.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar id={p.id} name={p.name} url={p.avatarUrl} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] text-ink">{p.name}</span>
                    {p.username && <span className="block truncate text-[13px] text-ink-muted">@{p.username}</span>}
                  </span>
                  <button type="button" onClick={() => void unblock(p.id)} disabled={busy === p.id}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-overlay/[0.08] px-3.5 text-[14px] font-medium text-brand transition-colors hover:bg-overlay/[0.12] disabled:opacity-60">
                    {busy === p.id && <ButtonWheel size={12} />}Unblock
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
