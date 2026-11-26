"use client";
import { Ban, Check, CheckCheck, Clock3, Lock } from "lucide-react";
import { nameOf, systemText, type Conversation, type Message } from "@/lib/chat";
import type { Plain } from "@/components/Messenger";
import { cn } from "@/lib/utils";
import { fileLabel } from "@/lib/files";

export type TickState = "sending" | "failed" | "sent" | "delivered" | "read";

/** One tick: sent. Two grey: delivered to everyone. Two green: read by everyone (members who joined later don't count). */
export function tickState(m: Message, c: Conversation, me: string): TickState {
  if (m.status) return m.status;
  const others = c.members.filter((x) => x.id !== me && (!x.joinedAt || x.joinedAt <= m.createdAt));
  if (others.length === 0) return "read";
  if (others.every((x) => x.lastReadAt && x.lastReadAt >= m.createdAt)) return "read";
  if (others.every((x) => x.lastDeliveredAt && x.lastDeliveredAt >= m.createdAt)) return "delivered";
  return "sent";
}

export function Ticks({ state, className, onBrand = false }: { state: TickState; className?: string; /** On my bubble: white ticks, bright green when read. */ onBrand?: boolean }) {
  const cls = cn("h-4 w-4 shrink-0", className);
  if (state === "sending") return <Clock3 className={cn(cls, "h-3.5 w-3.5 opacity-70")} aria-label="Sending" />;
  if (state === "failed") return null;
  if (state === "sent") return <Check className={cn(cls, "opacity-70")} aria-label="Sent" />;
  const read = state === "read";
  return <CheckCheck className={cn(cls, onBrand ? (read ? "text-[#6BF59A]" : "opacity-60") : read ? "text-tick" : "opacity-70")} strokeWidth={read ? 2.5 : 2} aria-label={read ? "Read" : "Delivered"} />;
}

/** The one-line preview under a chat's name. */
export function Preview({ c, me, plain }: { c: Conversation; me: string; plain: Record<string, Plain> }) {
  const m = c.lastMessage;
  if (!m) return <span className="flex items-center gap-1 text-ink-faint"><Lock className="h-3 w-3" /> End-to-end encrypted</span>;
  if (m.kind === "system") return <span className="truncate">{systemText(m, c.members, me)}</span>;
  const mine = m.senderId === me;
  const who = c.type === "group" && !mine ? `${nameOf(c.members, m.senderId, me, false)}: ` : "";
  if (m.deleted) return <span className="flex min-w-0 items-center gap-1 italic"><Ban className="h-3.5 w-3.5 shrink-0" /><span className="truncate pr-1">{who}{mine ? "You deleted this message" : "This message was deleted"}</span></span>;
  const p = plain[m.id];
  const text = p && "text" in p ? (p.text || (p.file ? fileLabel(p.file) : "")) : p && "error" in p ? "Couldn't decrypt this message" : "Waiting for this message";
  return (
    <span className="flex min-w-0 items-center gap-1">
      {mine && <Ticks state={tickState(m, c, me)} />}
      <span className="truncate">{who}{text}</span>
    </span>
  );
}

/** The animated three dots of "typing…": a soft wave, in the colour of the text around it. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-[3px]", className)} aria-hidden>
      {[0, 1, 2].map((d) => <span key={d} className="pw-typing-dot h-[5px] w-[5px] rounded-full bg-current" style={{ animationDelay: `${d * 0.16}s` }} />)}
    </span>
  );
}
