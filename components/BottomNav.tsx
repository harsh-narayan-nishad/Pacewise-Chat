"use client";
import { CircleDashed, MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "chats" | "status" | "calls";
const TABS: { id: Tab; label: string; icon: typeof Phone }[] = [
  { id: "chats", label: "Chats", icon: MessageCircle },
  { id: "status", label: "Status", icon: CircleDashed },
  { id: "calls", label: "Calls", icon: Phone },
];

/** The bottom nav, as in WhatsApp: Chats (with how many have unread messages), Status and Calls. 60 px + its 1 px line = the message bar beside it (8 + 44 + 8 + 1), so their top lines meet in one straight line. */
export function BottomNav({ tab, onTab, unread }: { tab: Tab; onTab: (t: Tab) => void; unread: number }) {
  return (
    <nav className="pw-bar shrink-0 border-t border-overlay/10 pb-[env(safe-area-inset-bottom)]" aria-label="Sections">
      <ul className="grid grid-cols-3">
        {TABS.map(({ id, label, icon: Icon }) => {
          const on = tab === id;
          return (
            <li key={id}>
              <button type="button" onClick={() => onTab(id)} aria-current={on ? "page" : undefined}
                className={cn("relative flex h-[60px] w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", on ? "text-brand" : "text-ink-muted hover:text-ink")}>
                <span className={cn("grid h-7 w-14 place-items-center rounded-full transition-colors", on && "bg-brand/[0.14]")}>
                  <Icon className="h-[21px] w-[21px]" strokeWidth={on ? 2.2 : 1.8} />
                </span>
                {label}
                {id === "chats" && unread > 0 && (
                  <span className="absolute left-1/2 top-1.5 ml-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
