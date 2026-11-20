"use client";
import { Ban, Check, CheckCheck, Clock3, Lock } from "lucide-react";
import { nameOf, systemText, type Conversation, type Message } from "@/lib/chat";
import type { Plain } from "@/components/Messenger";
import { cn } from "@/lib/utils";

export type TickState = "sending" | "failed" | "sent" | "delivered" | "read";

/** One tick: sent. Two grey: delivered to everyone. Two blue: read by everyone (members who joined later don't count). */
export function tickState(m: Message, c: Conversation, me: string): TickState {
  if (m.status) return m.status;
  const others = c.members.filter((x) => x.id !== me && (!x.joinedAt || x.joinedAt <= m.createdAt));
  if (others.length === 0) return "read";
  if (others.every((x) => x.lastReadAt && x.lastReadAt >= m.createdAt)) return "read";
  if (others.every((x) => x.lastDeliveredAt && x.lastDeliveredAt >= m.createdAt)) return "delivered";
  return "sent";
}

export function Ticks({ state, className }: { state: TickState; className?: string }) {
  const cls = cn("h-4 w-4 shrink-0", className);
  if (state === "sending") return <Clock3 className={cn(cls, "h-3.5 w-3.5 opacity-70")} aria-label="Sending" />;
  if (state === "failed") return null;
  if (state === "sent") return <Check className={cn(cls, "opacity-70")} aria-label="Sent" />;
  return <CheckCheck className={cn(cls, state === "read" ? "text-tick" : "opacity-70")} aria-label={state === "read" ? "Read" : "Delivered"} />;
}

/** The one-line preview under a chat's name. */
export function Preview({ c, me, plain }: { c: Conversation; me: string; plain: Record<string, Plain> }) {
  const m = c.lastMessage;
  if (!m) return <span className="flex items-center gap-1 text-ink-faint"><Lock className="h-3 w-3" /> End-to-end encrypted</span>;
  if (m.kind === "system") return <span className="truncate">{systemText(m, c.members, me)}</span>;
  const mine = m.senderId === me;
  const who = c.type === "group" && !mine ? `${nameOf(c.members, m.senderId, me, false)}: ` : "";
  if (m.deleted) return <span className="flex min-w-0 items-center gap-1 italic"><Ban className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{who}{mine ? "You deleted this message" : "This message was deleted"}</span></span>;
  const p = plain[m.id];
  const text = p && "text" in p ? p.text : p && "error" in p ? "Couldn't decrypt this message" : "Waiting for this message";
  return (
    <span className="flex min-w-0 items-center gap-1">
      {mine && <Ticks state={tickState(m, c, me)} />}
      <span className="truncate">{who}{text}</span>
    </span>
  );
}
