"use client";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowUp, Ban, ChevronDown, ChevronLeft, Copy, CornerUpLeft, Flag, Info, KeyRound, Lock, MoreHorizontal, Phone, Smile, Trash2, X } from "lucide-react";
import { DeleteDialog } from "@/components/DeleteDialog";
import { Avatar } from "@/components/Avatar";
import { Ticks, tickState } from "@/components/bits";
import type { Plain, Thread } from "@/components/Messenger";
import { ButtonWheel } from "@/components/WheelSpinner";
import { clockOf, dayChip, nameColor, nameOf, otherOf, presenceLabel, sameDay, systemText, titleOf, type Conversation, type Message } from "@/lib/chat";
import { cn } from "@/lib/utils";

const EMOJI = "😀 😂 🤣 😊 😍 🥰 😘 😎 🤩 🥳 😇 🙂 😉 😌 🤔 🤗 😅 😴 🥲 😢 😭 😤 😡 😱 🙏 👍 👎 👏 🙌 👋 💪 🤝 ✌️ 👌 ❤️ 🧡 💛 💚 💙 💜 🔥 ✨ 🎉 💯 ✅ ❌ 📚 📖 ✍️ 🧠 ⏰ ☕".split(" ");
const URL_RX = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

/** Plain text with links made clickable. */
function Linked({ text, onBrand = false }: { text: string; onBrand?: boolean }) {
  const parts = text.split(URL_RX);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className={cn("break-all underline underline-offset-2", onBrand ? "text-white" : "text-brand")}>{p}</a> : <Fragment key={i}>{p}</Fragment>))}</>;
}

/**
 * One open chat: the header (who, online / last seen / typing…), the messages on the chat wallpaper (day chips,
 * bubbles with time and ticks, replies, deleted messages, group events), and the composer.
 */
export function ChatWindow({ conv, me, thread, plain, typing, hasKey, onBack, onInfo, onSend, onRetry, onDelete, onDeleteChat, onOlder, onTyping, onCopied, onCall, onReport }: {
  conv: Conversation; me: string; thread: Thread | undefined; plain: Record<string, Plain>; typing: Record<string, number>; hasKey: boolean;
  onBack: () => void; onInfo: () => void; onSend: (text: string, replyTo: string | null) => Promise<void>; onRetry: (m: Message) => void; onDelete: (m: Message, scope: "me" | "everyone") => Promise<void>; onDeleteChat: () => void;
  onOlder: () => Promise<void>; onTyping: () => void; onCopied: () => void;
  /** Audio call (one-to-one chats) and Report spam. */
  onCall?: () => void; onReport?: () => void;
}) {
  const other = otherOf(conv, me);
  const isGroup = conv.type === "group";
  const self = !isGroup && other?.id === me;
  const items = thread?.items ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [reply, setReply] = useState<Message | null>(null);
  const [menu, setMenu] = useState<{ m: Message; x: number; y: number } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [headMenu, setHeadMenu] = useState(false);
  const [delMsg, setDelMsg] = useState<Message | null>(null);
  const first = useRef(true);
  const lastCount = useRef(0);

  // ---- header subtitle ----
  const typers = Object.keys(typing).filter((id) => id !== me);
  let subtitle: string;
  let live = false;
  if (typers.length) {
    live = true;
    subtitle = isGroup ? `${typers.map((id) => nameOf(conv.members, id, me, false)).join(", ")} ${typers.length === 1 ? "is" : "are"} typing…` : "typing…";
  } else if (isGroup) {
    subtitle = [...conv.members].sort((a, b) => (a.id === me ? 1 : b.id === me ? -1 : a.name.localeCompare(b.name))).map((m) => (m.id === me ? "You" : m.name.split(" ")[0])).join(", ");
  } else if (self) {
    subtitle = "Message yourself";
  } else {
    subtitle = other ? presenceLabel(other) : "";
    live = !!other?.online;
  }

  // ---- scrolling ----
  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useLayoutEffect(() => {
    if (!thread?.loaded) return;
    const grew = items.length - lastCount.current;
    const newest = items[items.length - 1];
    if (first.current) { first.current = false; toBottom(); }
    else if (grew > 0 && newest && newest.id !== undefined) {
      const appended = lastCount.current > 0 && items[lastCount.current - 1]?.id !== items[items.length - 1]?.id;
      if (appended) {
        if (atBottom || newest.senderId === me) toBottom(true);
        else setUnseen((n) => n + 1);
      }
    }
    lastCount.current = items.length;
  }, [items, thread?.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = async () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
    if (el.scrollTop < 80 && thread?.hasMore && !loadingOlder) {
      setLoadingOlder(true);
      const before = el.scrollHeight;
      await onOlder().catch(() => undefined);
      requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop += scroller.current.scrollHeight - before; setLoadingOlder(false); });
    }
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };

  const textOf = (m: Message) => {
    if (m.deleted) return "This message was deleted";
    const p = plain[m.id];
    return p && "text" in p ? p.text : "Encrypted message";
  };

  const waitingFor = !isGroup && other && other.id !== me && !other.publicKey ? other.name.split(" ")[0] : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="pw-bar relative z-20 flex h-16 shrink-0 items-center gap-2 border-b border-overlay/10 px-2 sm:px-4">
        <button type="button" onClick={onBack} aria-label="Back to chats" className="flex h-10 w-9 items-center justify-center rounded-full text-brand md:hidden"><ChevronLeft className="h-7 w-7" strokeWidth={2.25} /></button>
        <button type="button" onClick={onInfo} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={isGroup ? "Group info" : "Contact info"}>
          <Avatar id={isGroup ? conv.id : other?.id ?? conv.id} name={titleOf(conv, me)} url={other?.avatarUrl} group={isGroup} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-[16px] font-semibold text-ink">{titleOf(conv, me)}</span>
            <span className={cn("block truncate text-xs", live ? "text-brand" : "text-ink-muted")}>{subtitle}</span>
          </span>
        </button>
        {!isGroup && !self && onCall && (
          <button type="button" onClick={onCall} aria-label={`Audio call ${titleOf(conv, me)}`} title="Audio call" className="flex h-10 w-10 items-center justify-center rounded-full text-brand hover:bg-brand/10"><Phone className="h-[22px] w-[22px]" strokeWidth={2} /></button>
        )}
        <div className="relative">
          <button type="button" onClick={() => setHeadMenu((v) => !v)} aria-label="Chat menu" aria-expanded={headMenu} className="flex h-10 w-10 items-center justify-center rounded-full text-brand hover:bg-brand/10"><MoreHorizontal className="h-6 w-6" strokeWidth={2.25} /></button>
          {headMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setHeadMenu(false)} aria-hidden />
              <div role="menu" className="pw-menu glass-in absolute right-0 top-11 z-50 w-56 overflow-hidden py-1.5">
                <button role="menuitem" type="button" onClick={() => { setHeadMenu(false); onInfo(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink hover:bg-overlay/[0.06]"><Info className="h-4 w-4 text-ink-muted" /> {isGroup ? "Group info" : "Contact info"}</button>
                {!self && onReport && <button role="menuitem" type="button" onClick={() => { setHeadMenu(false); onReport(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-accent-extreme hover:bg-overlay/[0.06]"><Flag className="h-4 w-4" /> Report spam</button>}
                <button role="menuitem" type="button" onClick={() => { setHeadMenu(false); onDeleteChat(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-accent-extreme hover:bg-overlay/[0.06]"><Trash2 className="h-4 w-4" /> Delete chat</button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={() => void onScroll()} className="chat-wallpaper thin-scroll absolute inset-0 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-[6%]">
          {!thread?.loaded && <div className="flex justify-center py-10 text-ink-muted"><ButtonWheel size={22} /></div>}
          {thread?.hasMore && <div className="flex justify-center py-2 text-ink-muted">{loadingOlder ? <ButtonWheel size={18} /> : null}</div>}
          {thread?.loaded && !thread.hasMore && (
            <button type="button" onClick={onInfo} className="e2e-notice mx-auto mb-4 mt-2 flex max-w-md items-start gap-2.5 rounded-2xl px-3.5 py-2.5 text-left text-[12.5px] leading-snug">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
              <span>Messages are end-to-end encrypted. No one outside of this chat, not even Pacewise, can read them. Click to learn more.</span>
            </button>
          )}

          {items.map((m, i) => {
            const prev = items[i - 1];
            const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            const chip = newDay ? <div className="sticky top-1 z-10 my-2 flex justify-center"><span className="pw-chip rounded-full px-3 py-1 text-[12px] font-medium text-ink-muted">{dayChip(m.createdAt)}</span></div> : null;
            if (m.kind === "system") {
              return <Fragment key={m.id}>{chip}<div className="my-2 flex justify-center"><span className="pw-chip max-w-[85%] rounded-2xl px-3 py-1 text-center text-[12px] text-ink-muted">{systemText(m, conv.members, me)}</span></div></Fragment>;
            }
            const mine = m.senderId === me;
            const startsRun = newDay || !prev || prev.kind === "system" || prev.senderId !== m.senderId;
            const next = items[i + 1];
            const endsRun = !next || next.kind === "system" || next.senderId !== m.senderId || !sameDay(m.createdAt, next.createdAt);
            const p = plain[m.id];
            const quoted = m.replyTo ? items.find((x) => x.id === m.replyTo) : null;
            const state = mine ? tickState(m, conv, me) : null;
            return (
              <Fragment key={m.id}>
                {chip}
                <div className={cn("group flex", mine ? "justify-end" : "justify-start", startsRun ? "mt-2" : "mt-0.5")}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ m, x: e.clientX, y: e.clientY }); }}>
                  {/* No tails: a run of messages stacks, with tighter corners on the side they come from. */}
                  <div id={`msg-${m.id}`} className={cn("relative max-w-[82%] rounded-[20px] px-2.5 pb-1.5 pt-2 text-[15px] leading-[1.38] sm:max-w-[62%]",
                    mine ? "bubble-mine" : "bubble-theirs text-ink",
                    mine ? [!startsRun && "rounded-tr-[7px]", !endsRun && "rounded-br-[7px]"] : [!startsRun && "rounded-tl-[7px]", !endsRun && "rounded-bl-[7px]"])}>
                    {isGroup && !mine && startsRun && <p className="mb-0.5 px-1 text-[13px] font-medium" style={{ color: nameColor(m.senderId) }}>{nameOf(conv.members, m.senderId, me)}</p>}
                    {quoted && (
                      <button type="button" onClick={() => jumpTo(quoted.id)} className={cn("mb-1.5 block w-full overflow-hidden rounded-xl border-l-[3px] px-2.5 py-1.5 text-left", mine ? "border-white/80 bg-white/15" : "bg-brand/[0.07]")} style={mine ? undefined : { borderColor: nameColor(quoted.senderId) }}>
                        <span className="block text-xs font-semibold" style={{ color: mine ? "#fff" : nameColor(quoted.senderId) }}>{nameOf(conv.members, quoted.senderId, me)}</span>
                        <span className={cn("line-clamp-2 block text-xs", mine ? "text-white/80" : "text-ink-muted")}>{textOf(quoted)}</span>
                      </button>
                    )}
                    {/* on touch screens the ⌄ options button is always shown: keep the text clear of it */}
                    <div className="whitespace-pre-wrap break-words px-1 [@media(hover:none)]:pr-6">
                      {m.deleted ? (
                        <span className={cn("flex items-center gap-1.5 italic", mine ? "text-white/80" : "text-ink-muted")}><Ban className="h-4 w-4" />{mine ? "You deleted this message" : "This message was deleted"}</span>
                      ) : p && "text" in p ? (
                        <Linked text={p.text} onBrand={mine} />
                      ) : p && "error" in p ? (
                        <span className={cn("flex items-center gap-1.5 italic", mine ? "text-white/80" : "text-ink-muted")}><AlertCircle className="h-4 w-4" />Couldn&apos;t decrypt this message</span>
                      ) : (
                        <span className={cn("flex items-center gap-1.5 italic", mine ? "text-white/80" : "text-ink-muted")}><Lock className="h-4 w-4" />Waiting for this message. This may take a while.</span>
                      )}
                      {/* room for the time and ticks on the last line */}
                      <span className={cn("inline-block", mine ? "w-[4.6rem]" : "w-12")} aria-hidden />
                    </div>
                    <span className={cn("absolute bottom-1.5 right-2.5 flex items-center gap-1 text-[11px]", mine ? "text-white/75" : "text-ink-faint")}>
                      {clockOf(m.createdAt)}
                      {state && <Ticks state={state} onBrand />}
                      {state === "failed" && <AlertCircle className="h-3.5 w-3.5 text-accent-extreme" aria-label="Not sent" />}
                    </span>
                    {(
                      <button type="button" aria-label="Message options" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ m, x: r.left, y: r.bottom }); }}
                        className={cn("absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-60", mine ? "bg-white/20 text-white" : "bg-overlay/10 text-ink-muted")}>
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    )}
                    {state === "failed" && <button type="button" onClick={() => onRetry(m)} className="mt-1 block px-1 text-xs font-semibold text-white underline underline-offset-2">Not sent. Tap to retry</button>}
                  </div>
                </div>
              </Fragment>
            );
          })}
          {typers.length > 0 && (
            <div className="mt-2 flex justify-start"><span className="bubble-theirs flex items-center gap-1 rounded-[20px] rounded-bl-[7px] px-3.5 py-3" aria-label="typing">
              {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted" style={{ animationDelay: `${d * 0.15}s` }} />)}
            </span></div>
          )}
        </div>
        {!atBottom && (
          <button type="button" onClick={() => { toBottom(true); setUnseen(0); }} aria-label="Scroll to the newest message"
            className="pw-float absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full text-brand">
            <ChevronDown className="h-5 w-5" strokeWidth={2.25} />
            {unseen > 0 && <span className="absolute -top-1.5 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold text-white">{unseen}</span>}
          </button>
        )}
      </div>

      {(!hasKey || waitingFor) && (
        <div className="pw-bar flex shrink-0 items-start gap-2 border-t border-overlay/10 px-4 py-2 text-xs text-ink-muted">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-fast" />
          {!hasKey
            ? "Waiting for this chat's encryption key. It arrives as soon as another member opens Pacewise Chat."
            : `${waitingFor} hasn't opened Pacewise Chat yet. Your messages stay encrypted; they can read them once they open it while you are online.`}
        </div>
      )}

      <Composer key={conv.id} disabled={!hasKey} reply={reply} replyName={reply ? nameOf(conv.members, reply.senderId, me) : ""} replyText={reply ? textOf(reply) : ""}
        onCancelReply={() => setReply(null)} onTyping={onTyping}
        onSend={async (t) => { const r = reply?.id ?? null; setReply(null); await onSend(t, r); requestAnimationFrame(() => toBottom(true)); }} />

      {menu && (
        <MessageMenu x={menu.x} y={menu.y} deleted={menu.m.deleted} canCopy={!!plain[menu.m.id] && "text" in (plain[menu.m.id] as object)} onClose={() => setMenu(null)}
          onReply={() => { setReply(menu.m); setMenu(null); }}
          onCopy={() => { const p = plain[menu.m.id]; if (p && "text" in p) void navigator.clipboard?.writeText(p.text).then(onCopied, () => undefined); setMenu(null); }}
          onDelete={() => { setDelMsg(menu.m); setMenu(null); }} />
      )}
      {delMsg && (
        <DeleteDialog title="Delete message?" onClose={() => setDelMsg(null)}
          body={delMsg.senderId === me && !delMsg.deleted && !delMsg.status ? "Delete for everyone: it is replaced by \"This message was deleted\" for everyone. Delete for me: it disappears from your view only." : "It disappears from your view only. The others still see it."}
          choices={[
            ...(delMsg.senderId === me && !delMsg.deleted && !delMsg.status ? [{ label: "Delete for everyone", run: () => onDelete(delMsg, "everyone") }] : []),
            { label: "Delete for me", run: () => onDelete(delMsg, "me") },
          ]} />
      )}
    </div>
  );
}

function MessageMenu({ x, y, deleted, canCopy, onClose, onReply, onCopy, onDelete }: { x: number; y: number; deleted: boolean; canCopy: boolean; onClose: () => void; onReply: () => void; onCopy: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y, window.innerHeight - h - 8)) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);
  const item = "flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-ink hover:bg-overlay/[0.06]";
  return createPortal(
    <div ref={ref} role="menu" className="pw-menu glass-in fixed z-[130] w-52 overflow-hidden py-1.5" style={pos}>
      {!deleted && <button role="menuitem" className={item} onClick={onReply}><CornerUpLeft className="h-4 w-4 text-ink-muted" /> Reply</button>}
      {canCopy && <button role="menuitem" className={item} onClick={onCopy}><Copy className="h-4 w-4 text-ink-muted" /> Copy</button>}
      <button role="menuitem" className={cn(item, "text-accent-extreme")} onClick={onDelete}><Trash2 className="h-4 w-4" /> Delete</button>
    </div>,
    document.body,
  );
}

/** Type, Enter to send (Shift+Enter for a new line), emoji, and the message being replied to. */
function Composer({ disabled, reply, replyName, replyText, onCancelReply, onSend, onTyping }: {
  disabled: boolean; reply: Message | null; replyName: string; replyText: string; onCancelReply: () => void; onSend: (text: string) => Promise<void>; onTyping: () => void;
}) {
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);
  useEffect(() => { if (reply) area.current?.focus(); }, [reply]);
  useEffect(() => {
    if (!emoji) return;
    const down = (e: PointerEvent) => { if (!emojiRef.current?.contains(e.target as Node)) setEmoji(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [emoji]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    if (t.length > 4000) return;
    setText("");
    void onSend(t);
    area.current?.focus();
  };
  const insert = (e: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? text.length;
    const next = text.slice(0, at) + e + text.slice(el?.selectionEnd ?? at);
    setText(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + e.length, at + e.length); });
  };

  return (
    <div className="pw-bar shrink-0 border-t border-overlay/10 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-4">
      {reply && (
        <div className="mb-2 flex items-start gap-2 rounded-2xl bg-brand/[0.07] p-2.5">
          <div className="min-w-0 flex-1 border-l-[3px] pl-2.5" style={{ borderColor: nameColor(reply.senderId) }}>
            <p className="text-xs font-medium" style={{ color: nameColor(reply.senderId) }}>{replyName}</p>
            <p className="line-clamp-2 text-xs text-ink-muted">{replyText}</p>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="text-ink-muted"><X className="h-4 w-4" /></button>
        </div>
      )}
      <div className="flex items-end gap-2">
        {/* One rounded field with the emoji button inside it, and a round blue send button. */}
        <div className="pw-field flex min-h-[44px] flex-1 items-end gap-0.5 rounded-[22px] py-1 pl-1 pr-3.5">
        <div ref={emojiRef} className="relative">
          <button type="button" onClick={() => setEmoji((v) => !v)} disabled={disabled} aria-label="Emoji" aria-expanded={emoji} className={cn("flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-40", emoji ? "text-brand" : "text-ink-muted hover:text-brand")}><Smile className="h-[22px] w-[22px]" /></button>
          {emoji && (
            <div className="pw-menu glass-in absolute bottom-12 left-0 z-40 grid w-[18rem] grid-cols-8 gap-1 rounded-2xl p-2">
              {EMOJI.map((e) => <button key={e} type="button" onClick={() => insert(e)} className="flex h-8 w-8 items-center justify-center rounded-lg text-xl hover:bg-overlay/[0.08]">{e}</button>)}
            </div>
          )}
        </div>
        <label className="flex min-h-[36px] flex-1 items-center py-1.5">
          <span className="sr-only">Message</span>
          <textarea ref={area} value={text} rows={1} disabled={disabled} maxLength={4000}
            onChange={(e) => { setText(e.target.value); if (e.target.value) onTyping(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder={disabled ? "Waiting for the encryption key…" : "Type a message"}
            className="thin-scroll max-h-[140px] w-full resize-none bg-transparent text-[16px] leading-6 text-ink outline-none placeholder:text-ink-faint disabled:opacity-60" />
        </label>
        </div>
        <button type="button" onClick={submit} disabled={disabled || !text.trim()} aria-label="Send"
          className="glass-fab flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-[0_4px_14px_rgb(var(--brand)/0.35)] disabled:opacity-35 disabled:shadow-none"><ArrowUp className="h-5 w-5" strokeWidth={2.5} /></button>
      </div>
    </div>
  );
}
