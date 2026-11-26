"use client";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowDown, ArrowUp, Ban, ChevronDown, ChevronLeft, Copy, CornerUpLeft, FileText, Flag, Info, KeyRound, Lock, MoreHorizontal, Mic, Paperclip, Pause, Phone, Play, Smile, Trash2, UserCheck, Video, X } from "lucide-react";
import { DeleteDialog } from "@/components/DeleteDialog";
import { Avatar } from "@/components/Avatar";
import { Ticks, TypingDots, tickState } from "@/components/bits";
import type { Plain, Thread } from "@/components/Messenger";
import { ButtonWheel } from "@/components/WheelSpinner";
import LiquidGlass from "@/components/LiquidGlass";
import { clockOf, dayChip, nameColor, nameOf, otherOf, presenceLabel, sameDay, systemText, titleOf, type Conversation, type Message } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { fileLabel, fileUrl, isAudio, isImage, kindLabel, MAX_FILE_BYTES, saveFile, sizeLabel } from "@/lib/files";
import type { PlainFile } from "@/components/Messenger";

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
/**
 * Touch gestures on a message, as in other chat apps:
 *  - press and hold (about half a second, without moving) opens its options; a small vibration confirms it;
 *  - swipe it to the right to reply: the bubble follows the finger, a reply arrow fades in, and letting go past the
 *    mark starts a reply (the bubble springs back either way).
 */
const touch: { id?: number; x: number; y: number; fired: boolean; swiping: boolean; dx: number; bubble: HTMLElement | null; icon: HTMLElement | null } =
  { x: 0, y: 0, fired: false, swiping: false, dx: 0, bubble: null, icon: null };
const SWIPE_REPLY = 56;
function gestures(open: (x: number, y: number) => void, reply: (() => void) | null) {
  const cancel = () => { window.clearTimeout(touch.id); touch.id = undefined; };
  const settle = () => {
    const { bubble, icon } = touch;
    if (bubble) { bubble.style.transition = "transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)"; bubble.style.transform = ""; window.setTimeout(() => { bubble.style.transition = ""; }, 240); }
    if (icon) { icon.style.transition = "opacity 0.15s"; icon.style.opacity = "0"; }
  };
  return {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      cancel();
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      Object.assign(touch, { x: t.clientX, y: t.clientY, fired: false, swiping: false, dx: 0,
        bubble: e.currentTarget.querySelector<HTMLElement>('[id^="msg-"]'), icon: e.currentTarget.querySelector<HTMLElement>("[data-swipe-icon]") });
      touch.id = window.setTimeout(() => {
        touch.fired = true; touch.id = undefined;
        try { navigator.vibrate?.(12); } catch { /* not supported */ }
        open(touch.x, touch.y);
      }, 480);
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
      if (Math.hypot(dx, dy) > 10) cancel(); // moving: not a press
      if (!reply || touch.fired) return;
      if (!touch.swiping && dx > 12 && dx > Math.abs(dy) * 1.5) touch.swiping = true;
      if (!touch.swiping) return;
      touch.dx = Math.max(0, dx);
      const d = touch.dx < SWIPE_REPLY ? touch.dx : SWIPE_REPLY + (touch.dx - SWIPE_REPLY) * 0.25; // a little resistance past the mark
      if (touch.bubble) { touch.bubble.style.transition = ""; touch.bubble.style.transform = `translateX(${Math.min(d, 90)}px)`; }
      if (touch.icon) { touch.icon.style.transition = ""; touch.icon.style.opacity = String(Math.min(1, touch.dx / SWIPE_REPLY)); }
    },
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => {
      cancel();
      if (touch.swiping) {
        if (touch.dx >= SWIPE_REPLY && reply) { try { navigator.vibrate?.(10); } catch { /* not supported */ } reply(); }
        settle(); touch.swiping = false; e.preventDefault(); return;
      }
      if (touch.fired) { e.preventDefault(); touch.fired = false; }
    },
    onTouchCancel: () => { cancel(); if (touch.swiping) { settle(); touch.swiping = false; } },
  };
}

export function ChatWindow({ conv, me, thread, plain, typing, hasKey, onBack, onInfo, onSend, onRetry, onDelete, onDeleteChat, onOlder, onTyping, onCopied, onCall, onReport, onBlock }: {
  conv: Conversation; me: string; thread: Thread | undefined; plain: Record<string, Plain>; typing: Record<string, number>; hasKey: boolean;
  onBack: () => void; onInfo: () => void; onSend: (text: string, replyTo: string | null, file?: File) => Promise<void>; onRetry: (m: Message) => void; onDelete: (m: Message, scope: "me" | "everyone") => Promise<void>; onDeleteChat: () => void;
  onOlder: () => Promise<void>; onTyping: () => void; onCopied: () => void;
  /** Audio call (one-to-one chats) and Report spam. */
  onCall?: (video: boolean) => void; onReport?: () => void; /** Block (true) or unblock (false) the other person in a one-to-one chat. */ onBlock?: (on: boolean) => void;
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
  const [callMenu, setCallMenu] = useState(false);
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
    return p && "text" in p ? (p.text || (p.file ? fileLabel(p.file) : "")) : "Encrypted message";
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
            <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", live ? "text-brand" : "text-ink-muted")}>
              {typers.length > 0 && <TypingDots />}
              <span className="truncate">{subtitle}</span>
            </span>
          </span>
        </button>
        {/* Call and the chat menu in one liquid-glass capsule, as the flip book's buttons. */}
        <div className="pw-corner-pill shrink-0 text-brand" role="group" aria-label="Call and chat menu">
          <span className="pw-corner-lg" aria-hidden><LiquidGlass width="100%" height="100%" radius={26} blur={4} /></span>
        {!isGroup && !self && onCall && !conv.blockedByMe && (
          <div className="relative">
            {/* the call button opens a small menu: audio or video */}
            <button type="button" onClick={() => setCallMenu((v) => !v)} aria-label={`Call ${titleOf(conv, me)}`} aria-haspopup="menu" aria-expanded={callMenu} title="Call"
              className="pw-corner-in !w-[60px] gap-0.5 [grid-auto-flow:column]"><Phone size={20} strokeWidth={1.75} aria-hidden /><ChevronDown className={cn("h-3 w-3 transition-transform", callMenu && "rotate-180")} strokeWidth={2.25} aria-hidden /></button>
            {callMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setCallMenu(false)} aria-hidden />
                <div role="menu" className="pw-menu glass-in absolute right-0 top-[60px] z-50 w-52 overflow-hidden py-1.5">
                  <button role="menuitem" type="button" onClick={() => { setCallMenu(false); onCall(false); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-ink hover:bg-overlay/[0.06]"><Phone className="h-[18px] w-[18px] text-brand" /> Audio call</button>
                  <button role="menuitem" type="button" onClick={() => { setCallMenu(false); onCall(true); }} className="flex w-full items-center gap-3 border-t border-overlay/10 px-4 py-2.5 text-left text-[15px] text-ink hover:bg-overlay/[0.06]"><Video className="h-[18px] w-[18px] text-brand" /> Video call</button>
                </div>
              </>
            )}
          </div>
        )}
        {!isGroup && !self && onCall && !conv.blockedByMe && <span className="pw-corner-sep" aria-hidden />}
        <div className="relative">
          <button type="button" onClick={() => setHeadMenu((v) => !v)} aria-label="Chat menu" aria-haspopup="menu" aria-expanded={headMenu} title="Menu" className="pw-corner-in"><MoreHorizontal size={20} strokeWidth={1.75} aria-hidden /></button>
          {headMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setHeadMenu(false)} aria-hidden />
              <div role="menu" className="pw-menu glass-in absolute right-0 top-[60px] z-50 w-56 overflow-hidden py-1.5">
                <button role="menuitem" type="button" onClick={() => { setHeadMenu(false); onInfo(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink hover:bg-overlay/[0.06]"><Info className="h-4 w-4 text-ink-muted" /> {isGroup ? "Group info" : "Contact info"}</button>
                {!self && onReport && <button role="menuitem" type="button" onClick={() => { setHeadMenu(false); onReport(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-accent-extreme hover:bg-overlay/[0.06]"><Flag className="h-4 w-4" /> Report spam</button>}
                {!isGroup && !self && onBlock && (conv.blockedByMe
                  ? <button role="menuitem" type="button" onClick={() => { setHeadMenu(false); onBlock(false); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink hover:bg-overlay/[0.06]"><UserCheck className="h-4 w-4 text-ink-muted" /> Unblock</button>
                  : <button role="menuitem" type="button" onClick={() => { setHeadMenu(false); onBlock(true); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-accent-extreme hover:bg-overlay/[0.06]"><Ban className="h-4 w-4" /> Block</button>)}
                <button role="menuitem" type="button" onClick={() => { setHeadMenu(false); onDeleteChat(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-accent-extreme hover:bg-overlay/[0.06]"><Trash2 className="h-4 w-4" /> Delete chat</button>
              </div>
            </>
          )}
        </div>
        </div>
      </header>

      <div className="chat-aurora relative min-h-0 flex-1">
        <div ref={scroller} onScroll={() => void onScroll()} className="chat-wallpaper thin-scroll absolute inset-0 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-6">
          {/* One centred reading column on wide screens, so a conversation never stretches edge to edge. */}
          <div className="mx-auto w-full max-w-[860px]">
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
                <div className={cn("group relative flex touch-pan-y [-webkit-touch-callout:none] [@media(hover:none)]:select-none", mine ? "justify-end" : "justify-start", startsRun ? "mt-2" : "mt-0.5")}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ m, x: e.clientX, y: e.clientY }); }}
                  {...gestures((x, y) => setMenu({ m, x, y }), m.deleted ? null : () => setReply(m))}>
                  {/* the reply arrow that fades in while the message is swiped to the right */}
                  {!m.deleted && <span data-swipe-icon className="pointer-events-none absolute left-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-overlay/10 text-ink-muted opacity-0" aria-hidden><CornerUpLeft className="h-4 w-4" /></span>}
                  {/* No tails: a run of messages stacks, with tighter corners on the side they come from. */}
                  <div id={`msg-${m.id}`}
                    onClick={(e) => {
                      if ((e.target as Element).closest("a, button, input, audio, img, [role=slider]") || (window.getSelection()?.toString() ?? "")) return;
                      setMenu({ m, x: e.clientX, y: e.clientY });
                    }}
                    className={cn("relative max-w-[82%] cursor-pointer rounded-[18px] px-3 pb-[7px] pt-[7px] text-[15px] leading-[1.4] sm:max-w-[68%]",
                    // A deleted message is a quiet placeholder: an outline, no colour fill (mine or theirs).
                    m.deleted ? "border border-overlay/15 bg-transparent text-ink-muted" : mine ? "bubble-mine" : "bubble-theirs text-ink",
                    mine ? [!startsRun && "rounded-tr-[6px]", !endsRun && "rounded-br-[6px]"] : [!startsRun && "rounded-tl-[6px]", !endsRun && "rounded-bl-[6px]"])}>
                    {isGroup && !mine && startsRun && <p className="mb-0.5 px-1 text-[13px] font-medium" style={{ color: nameColor(m.senderId) }}>{nameOf(conv.members, m.senderId, me)}</p>}
                    {quoted && (
                      <button type="button" onClick={() => jumpTo(quoted.id)} className={cn("mb-1.5 block w-full overflow-hidden rounded-xl border-l-[3px] px-2.5 py-1.5 text-left", mine ? "border-white/80 bg-white/15" : "bg-brand/[0.07]")} style={mine ? undefined : { borderColor: nameColor(quoted.senderId) }}>
                        <span className="block text-xs font-semibold" style={{ color: mine ? "#fff" : nameColor(quoted.senderId) }}>{nameOf(conv.members, quoted.senderId, me)}</span>
                        <span className={cn("line-clamp-2 block text-xs", mine ? "text-white/80" : "text-ink-muted")}>{textOf(quoted)}</span>
                      </button>
                    )}
                    <div className="whitespace-pre-wrap break-words px-0.5">
                      {m.deleted ? (
                        <span className="inline-flex items-center gap-1.5 text-[14px] italic text-ink-muted"><Ban className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />{mine ? "You deleted this message" : "This message was deleted"}</span>
                      ) : p && "text" in p ? (
                        <>
                          {p.file && <Attachment file={p.file} conversationId={conv.id} mine={mine} sending={m.status === "sending"} />}
                          {p.text ? <Linked text={p.text} onBrand={mine} /> : null}
                        </>
                      ) : p && "error" in p ? (
                        <span className={cn("flex items-center gap-1.5 italic", mine ? "text-white/80" : "text-ink-muted")}><AlertCircle className="h-4 w-4" />Couldn&apos;t decrypt this message</span>
                      ) : (
                        <span className={cn("flex items-center gap-1.5 italic", mine ? "text-white/80" : "text-ink-muted")}><Lock className="h-4 w-4" />Waiting for this message. This may take a while.</span>
                      )}
                      {/* room for the time and ticks on the last line */}
                      {!(p && "text" in p && p.file && isAudio(p.file.type) && !p.text) && <span className={cn("inline-block", m.deleted ? "w-11" : mine ? "w-[4.6rem]" : "w-12")} aria-hidden />}
                    </div>
                    <span className={cn("absolute bottom-[7px] right-3 flex items-center gap-1 text-[11px] tabular-nums leading-none", mine && !m.deleted ? "text-white/75" : "text-ink-faint")}>
                      {clockOf(m.createdAt)}
                      {state && !m.deleted && <Ticks state={state} onBrand />}
                      {state === "failed" && <AlertCircle className="h-3.5 w-3.5 text-accent-extreme" aria-label="Not sent" />}
                    </span>
                    {!m.deleted && (
                      <button type="button" aria-label="Reply" title="Reply" onClick={() => setReply(m)}
                        className={cn("absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-overlay/10 text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100",
                          // just outside the bubble (left of mine, right of theirs): it never covers the text, time or ticks
                          mine ? "-left-9" : "-right-9",
                          // touch screens: swipe the message to the right to reply instead
                          "[@media(hover:none)]:hidden")}>
                        <CornerUpLeft className="h-4 w-4" />
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
              <TypingDots className="gap-1 text-ink-muted [&>span]:h-2 [&>span]:w-2" />
            </span></div>
          )}
          </div>
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
            ? "Waiting for this chat's encryption key. It arrives as soon as another member opens Palk."
            : `${waitingFor} hasn't opened Palk yet. Your messages stay encrypted; they can read them once they open it while you are online.`}
        </div>
      )}

      {conv.blockedByMe ? (
        /* Blocked: no message box, just what happened and the way back. */
        <div className="pw-bar flex shrink-0 flex-col items-center gap-1 border-t border-overlay/10 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-center">
          <p className="text-[14px] text-ink-muted">You blocked {titleOf(conv, me)}.</p>
          {onBlock && <button type="button" onClick={() => onBlock(false)} className="text-[15px] font-semibold text-brand">Tap to unblock</button>}
        </div>
      ) : (
      <Composer key={conv.id} disabled={!hasKey} reply={reply} replyName={reply ? nameOf(conv.members, reply.senderId, me) : ""} replyText={reply ? textOf(reply) : ""}
        onCancelReply={() => setReply(null)} onTyping={onTyping}
        onSend={async (t, f) => { const r = reply?.id ?? null; setReply(null); await onSend(t, r, f); requestAnimationFrame(() => toBottom(true)); }} />
      )}

      {menu && (
        <MessageMenu x={menu.x} y={menu.y} deleted={menu.m.deleted} canCopy={(() => { const p = plain[menu.m.id]; return !!p && "text" in p && !!p.text; })()} onClose={() => setMenu(null)}
          onReply={() => { setReply(menu.m); setMenu(null); }}
          onCopy={() => { const p = plain[menu.m.id]; if (p && "text" in p) void navigator.clipboard?.writeText(p.text).then(onCopied, () => undefined); setMenu(null); }}
          onDelete={() => { setDelMsg(menu.m); setMenu(null); }} />
      )}
      {delMsg && (
        <DeleteDialog title="Delete message?" onClose={() => setDelMsg(null)}
          body={delMsg.senderId === me && !delMsg.deleted && !delMsg.status ? "This message will be removed from your chat." : "This message will be removed from your chat only. Others in this chat will still see it."}
          me={{ label: "Delete", run: () => onDelete(delMsg, "me") }}
          everyone={delMsg.senderId === me && !delMsg.deleted && !delMsg.status ? { label: "Delete for Everyone", hint: "The message will be removed for all participants and replaced with “This message was deleted.”", confirm: "Delete for All", run: () => onDelete(delMsg, "everyone") } : undefined} />
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
  disabled: boolean; reply: Message | null; replyName: string; replyText: string; onCancelReply: () => void; onSend: (text: string, file?: File) => Promise<void>; onTyping: () => void;
}) {
  const [text, setText] = useState("");
  /** A file picked to send (any type, up to 25 MB), shown above the field until it is sent. */
  const [attached, setAttached] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { setFileError(`"${f.name}" is ${sizeLabel(f.size)}. Files can be up to 25 MB.`); return; }
    if (f.size === 0) { setFileError(`"${f.name}" is empty.`); return; }
    setFileError(null);
    setAttached(f);
    area.current?.focus();
  };
  const [emoji, setEmoji] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  /** A voice message being recorded: started when the box is empty and the mic is tapped; sent with the send button. */
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; send: boolean } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recStart, setRecStart] = useState(0);
  const [recNow, setRecNow] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return;
    const i = window.setInterval(() => {
      setRecNow(Date.now());
      if (Date.now() - recStart > 10 * 60_000) stopRecording(true); // at most 10 minutes
    }, 250);
    return () => window.clearInterval(i);
  }, [recording, recStart]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { rec.current?.stream.getTracks().forEach((tr) => tr.stop()); }, []);

  const startRecording = async () => {
    if (disabled || recording) return;
    setRecError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setRecError("This browser cannot record audio."); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { setRecError("Allow the microphone to record a voice message."); return; }
    if (!hold.current.down) { stream.getTracks().forEach((tr) => tr.stop()); return; } // let go before it could start
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const box = { recorder, stream, chunks: [] as Blob[], send: false };
    recorder.ondataavailable = (e) => { if (e.data.size) box.chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (rec.current === box) rec.current = null;
      if (!box.send || !box.chunks.length) return;
      const mime = (recorder.mimeType || type || "audio/webm").split(";")[0];
      const blob = new Blob(box.chunks, { type: mime });
      if (blob.size > MAX_FILE_BYTES) { setRecError("That recording is too long to send."); return; }
      const file = new File([blob], `Voice message.${mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm"}`, { type: mime });
      void onSend("", file);
    };
    rec.current = box;
    recorder.start(250);
    setRecStart(Date.now()); setRecNow(Date.now()); setRecording(true);
    onTyping();
  };
  /** Ends the recording: send = true sends it, false throws it away. */
  const stopRecording = (send: boolean) => {
    const r = rec.current;
    setRecording(false);
    if (!r) return;
    r.send = send;
    if (r.recorder.state !== "inactive") r.recorder.stop(); else r.stream.getTracks().forEach((tr) => tr.stop());
  };
  const recSecs = Math.max(0, Math.floor((recNow - recStart) / 1000));

  /**
   * The mic, as in WhatsApp: press and hold to record, let go to send. Sliding the finger to the left while holding
   * throws the recording away; a quick tap only shows how it works.
   */
  const hold = useRef<{ down: boolean; x: number; at: number }>({ down: false, x: 0, at: 0 });
  const [slide, setSlide] = useState(0);
  const [holdHint, setHoldHint] = useState(false);
  const CANCEL_AT = 110;
  const holdStart = (x: number) => {
    if (disabled || hold.current.down) return;
    hold.current = { down: true, x, at: Date.now() };
    setSlide(0); setHoldHint(false);
    try { navigator.vibrate?.(10); } catch { /* not supported */ }
    void startRecording();
  };
  const holdMove = (x: number) => {
    if (!hold.current.down) return;
    const dx = Math.max(0, hold.current.x - x);
    setSlide(dx);
    if (dx > CANCEL_AT) { hold.current.down = false; setSlide(0); stopRecording(false); try { navigator.vibrate?.([10, 40, 10]); } catch { /* not supported */ } }
  };
  const holdEnd = () => {
    if (!hold.current.down) return;
    hold.current.down = false;
    setSlide(0);
    if (Date.now() - hold.current.at < 400) {
      stopRecording(false);
      setHoldHint(true);
      window.setTimeout(() => setHoldHint(false), 2500);
      return;
    }
    stopRecording(true);
  };
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
    if ((!t && !attached) || disabled) return;
    if (t.length > 4000) return;
    setText("");
    const f = attached ?? undefined;
    setAttached(null);
    void onSend(t, f);
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
    <div className="pw-bar shrink-0 border-t border-overlay/10 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 group-data-[kb]/app:pb-2 sm:px-4">
      {attached && (
        <div className="mb-2 flex items-center gap-3 rounded-2xl bg-brand/[0.07] p-2.5">
          {isImage(attached.type) ? <LocalThumb file={attached} /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white"><FileText className="h-5 w-5" /></span>}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink">{attached.name}</span>
            <span className="block text-xs text-ink-muted">{kindLabel(attached.name, attached.type)} · {sizeLabel(attached.size)} · end-to-end encrypted</span>
          </span>
          <button type="button" onClick={() => setAttached(null)} aria-label="Remove attachment" className="text-ink-muted"><X className="h-4 w-4" /></button>
        </div>
      )}
      {fileError && <p className="mb-2 px-1 text-xs text-accent-extreme" role="alert">{fileError}</p>}
      {recError && <p className="mb-2 px-1 text-xs text-accent-extreme" role="alert">{recError}</p>}
      {holdHint && <p className="mb-2 px-1 text-right text-xs text-ink-muted" role="status">Hold to record, release to send</p>}
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
        {recording ? (
          <div className="flex min-h-[36px] flex-1 items-center gap-3 pl-1" role="status" aria-live="polite">
            <button type="button" onClick={() => stopRecording(false)} aria-label="Discard voice message" title="Discard"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent-extreme transition-colors hover:bg-accent-extreme/10"><Trash2 className="h-[20px] w-[20px]" strokeWidth={1.9} /></button>
            <span className="rec-dot h-2.5 w-2.5 shrink-0 rounded-full bg-accent-extreme" aria-hidden />
            <span className="text-[16px] tabular-nums text-ink">{Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, "0")}</span>
            <span className="ml-auto flex items-center gap-1 truncate pr-1 text-[14px] text-ink-muted transition-opacity" style={{ transform: `translateX(${-Math.min(slide, CANCEL_AT)}px)`, opacity: 1 - Math.min(slide, CANCEL_AT) / (CANCEL_AT * 1.4) }}>
              <ChevronLeft className="h-4 w-4" /> Slide to cancel
            </span>
          </div>
        ) : (<>
        <div ref={emojiRef} className="relative">
          <button type="button" onClick={() => setEmoji((v) => !v)} disabled={disabled} aria-label="Emoji" aria-expanded={emoji} className={cn("flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-40", emoji ? "text-brand" : "text-ink-muted hover:text-brand")}><Smile className="h-[22px] w-[22px]" /></button>
          {emoji && (
            <div className="pw-menu glass-in absolute bottom-12 left-0 z-40 grid w-[18rem] grid-cols-8 gap-1 rounded-2xl p-2">
              {EMOJI.map((e) => <button key={e} type="button" onClick={() => insert(e)} className="flex h-8 w-8 items-center justify-center rounded-lg text-xl hover:bg-overlay/[0.08]">{e}</button>)}
            </div>
          )}
        </div>
        {/* attach any file */}
        <button type="button" onClick={() => picker.current?.click()} disabled={disabled} aria-label="Attach a file" title="Attach a file"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-brand disabled:opacity-40"><Paperclip className="h-[21px] w-[21px]" /></button>
        <input ref={picker} type="file" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <label className="flex min-h-[36px] flex-1 items-center py-1.5">
          <span className="sr-only">Message</span>
          <textarea ref={area} value={text} rows={1} disabled={disabled} maxLength={4000}
            onChange={(e) => { setText(e.target.value); if (e.target.value) onTyping(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder={disabled ? "Waiting for the encryption key…" : "Type a message"}
            className="thin-scroll max-h-[140px] w-full resize-none bg-transparent text-[16px] leading-6 text-ink outline-none placeholder:text-ink-faint disabled:opacity-60" />
        </label>
        </>)}
        </div>
        {/* Empty box: a mic to record a voice message. Typing, a picked file or a recording: send. */}
        {!recording && (text.trim() || attached) ? (
          <button type="button" onClick={() => submit()} disabled={disabled} aria-label="Send"
            className="glass-fab flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-[0_4px_14px_rgb(var(--brand)/0.35)] disabled:opacity-35 disabled:shadow-none"><ArrowUp className="h-5 w-5" strokeWidth={2.5} /></button>
        ) : (
          <button type="button" disabled={disabled} aria-label="Hold to record a voice message, release to send" title="Hold to record, release to send"
            onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); holdStart(e.clientX); }}
            onPointerMove={(e) => holdMove(e.clientX)}
            onPointerUp={holdEnd} onPointerCancel={holdEnd} onLostPointerCapture={holdEnd}
            onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); holdStart(0); } }}
            onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); holdEnd(); } }}
            onContextMenu={(e) => e.preventDefault()}
            className={cn("glass-fab flex h-11 w-11 shrink-0 touch-none select-none items-center justify-center rounded-full bg-brand text-white shadow-[0_4px_14px_rgb(var(--brand)/0.35)] transition-transform duration-150 [-webkit-touch-callout:none] disabled:opacity-35 disabled:shadow-none",
              recording && "scale-[1.3] shadow-[0_6px_22px_rgb(var(--brand)/0.5)]")}><Mic className="h-5 w-5" strokeWidth={2.25} /></button>
        )}
      </div>
    </div>
  );
}

/** A preview of a picked image, before it is sent. */
function LocalThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <span className="h-11 w-11 shrink-0 rounded-xl bg-overlay/10" />;
}

/**
 * An attachment in a bubble. Images show inline (downloaded and decrypted here, on this device); any other file is a
 * card with its name, kind and size that decrypts and saves on tap.
 */
function Attachment({ file, conversationId, mine, sending }: { file: PlainFile; conversationId: string; mine: boolean; sending: boolean }) {
  const [url, setUrl] = useState<string | null>(file.local ?? null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const image = isImage(file.type);
  useEffect(() => {
    if (!image || file.local || !file.id) return;
    let live = true;
    fileUrl(conversationId, file).then((u) => { if (live) setUrl(u); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [image, file, conversationId]);

  const open = async () => {
    if (!file.id || busy) return;
    setBusy(true); setFailed(false);
    try { await saveFile(conversationId, file); } catch { setFailed(true); } finally { setBusy(false); }
  };

  if (isAudio(file.type)) return <VoiceNote file={file} conversationId={conversationId} mine={mine} sending={sending} />;
  if (image) {
    return (
      <button type="button" onClick={() => void open()} disabled={!file.id} aria-label={`Save ${file.name}`} className="mb-1.5 block w-fit overflow-hidden rounded-[14px]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.name} className={cn("block h-auto max-h-72 w-auto max-w-[260px] object-cover", sending && "opacity-70")} />
        ) : (
          <span className={cn("flex h-40 w-[240px] items-center justify-center text-xs", mine ? "bg-white/15 text-white/80" : "bg-overlay/[0.06] text-ink-muted")}>
            {failed ? "Couldn't load this photo" : <ButtonWheel size={18} />}
          </span>
        )}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => void open()} disabled={!file.id || busy} aria-label={`Save ${file.name}`}
      className={cn("mb-1.5 flex w-full min-w-[220px] max-w-[300px] items-center gap-3 rounded-[14px] p-2.5 text-left", mine ? "bg-white/15" : "bg-brand/[0.07]")}>
      <span className={cn("flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl text-[9px] font-bold tracking-wide", mine ? "bg-white text-brand" : "bg-brand text-white")}>
        <FileText className="h-[18px] w-[18px]" />{kindLabel(file.name, file.type)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[14px] font-medium", mine ? "text-white" : "text-ink")}>{file.name}</span>
        <span className={cn("block text-xs", mine ? "text-white/75" : "text-ink-muted")}>{sending ? "Encrypting and sending…" : failed ? "Couldn't download. Tap to retry" : sizeLabel(file.size)}</span>
      </span>
      {file.id && <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", mine ? "bg-white/20 text-white" : "bg-brand/10 text-brand")}>{busy ? <ButtonWheel size={14} /> : <ArrowDown className="h-4 w-4" strokeWidth={2.25} />}</span>}
    </button>
  );
}

/** Bars for a voice message's waveform, from the recording itself (loudness per slice, softened); flat until read. */
const BARS = 34;
async function waveOf(url: string): Promise<number[]> {
  const buf = await (await fetch(url)).arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const peaks = Array.from({ length: BARS }, (_, i) => {
      let sum = 0;
      for (let k = i * step; k < Math.min(data.length, (i + 1) * step); k++) sum += data[k] * data[k];
      return Math.sqrt(sum / step);
    });
    const max = Math.max(...peaks, 0.0001);
    return peaks.map((v) => 0.18 + 0.82 * Math.pow(v / max, 0.7));
  } finally { void ctx.close(); }
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * A voice message in a bubble, as Apple shows audio: a round play button, the recording's own waveform that fills in
 * as it plays (tap or drag on it to jump), and its length underneath, level with the message time. The file is
 * decrypted on this device as soon as it is shown (voice messages are small), so the waveform and length are there
 * before it plays.
 */
function VoiceNote({ file, conversationId, mine, sending }: { file: PlainFile; conversationId: string; mine: boolean; sending: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(file.local ?? null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [len, setLen] = useState(0);
  const [wave, setWave] = useState<number[] | null>(null);

  useEffect(() => {
    if (url || !file.id) return;
    let live = true;
    fileUrl(conversationId, file).then((u) => { if (live) setUrl(u); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [url, file, conversationId]);
  useEffect(() => {
    if (!url) return;
    let live = true;
    waveOf(url).then((w) => { if (live) setWave(w); }, () => undefined);
    return () => { live = false; };
  }, [url]);

  // Recorded audio often has no length until read once: read it to the end quietly, then rewind.
  const onMeta = () => {
    const a = audio.current;
    if (!a) return;
    if (Number.isFinite(a.duration)) { setLen(a.duration); return; }
    a.currentTime = 1e9;
    a.addEventListener("timeupdate", function fix() { a.removeEventListener("timeupdate", fix); setLen(a.duration); a.currentTime = 0; setPos(0); });
  };
  const toggle = () => {
    const a = audio.current;
    if (!a || !url) return;
    if (playing) a.pause(); else void a.play().catch(() => setFailed(true));
  };
  const seek = (clientX: number) => {
    const a = audio.current, r = bar.current?.getBoundingClientRect();
    if (!a || !r || !len) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    a.currentTime = f * len; setPos(a.currentTime);
  };
  const played = len ? pos / len : 0;
  const ready = !!url && !failed;
  const on = mine ? "bg-white" : "bg-brand";
  const off = mine ? "bg-white/40" : "bg-ink-faint/60";
  return (
    <div className="mb-[-2px] flex w-[230px] max-w-full items-center gap-2.5 pt-0.5">
      <button type="button" onClick={toggle} disabled={!ready || sending} aria-label={playing ? "Pause voice message" : "Play voice message"}
        className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full transition-transform active:scale-90 disabled:opacity-50", mine ? "bg-white text-brand" : "bg-brand text-white")}>
        {!url && !failed ? <ButtonWheel size={14} /> : playing ? <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />}
      </button>
      <div className="min-w-0 flex-1">
        {/* the waveform: played bars in full colour; tap or drag to jump */}
        <div ref={bar} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(len)} aria-valuenow={Math.round(pos)} tabIndex={ready ? 0 : -1}
          onPointerDown={(e) => { if (!ready) return; e.currentTarget.setPointerCapture(e.pointerId); seek(e.clientX); }}
          onPointerMove={(e) => { if (e.buttons & 1) seek(e.clientX); }}
          onKeyDown={(e) => { const a = audio.current; if (!a || !len) return; if (e.key === "ArrowRight") a.currentTime = Math.min(len, a.currentTime + 2); if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - 2); }}
          className="flex h-7 cursor-pointer touch-none items-center gap-[2px] outline-none">
          {(wave ?? Array(BARS).fill(0.18)).map((h, i) => (
            <span key={i} className={cn("w-[3px] flex-1 rounded-full transition-colors", (i + 0.5) / BARS <= played ? on : off)} style={{ height: `${Math.round(h * 100)}%` }} />
          ))}
        </div>
        <span className={cn("block text-[11px] leading-[14px] tabular-nums", mine ? "text-white/75" : "text-ink-faint")}>
          {sending ? "Sending…" : failed ? "Couldn't load" : playing || pos ? mmss(pos) : len ? mmss(len) : "0:00"}
        </span>
      </div>
      {url && <audio ref={audio} src={url} preload="metadata" onLoadedMetadata={onMeta} onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0); }} className="hidden" />}
    </div>
  );
}
