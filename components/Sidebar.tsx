"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, Lock, LogOut, Moon, MoreHorizontal, Search, SquarePen, Sun, Trash2, Users, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Preview } from "@/components/bits";
import { Logo } from "@/components/Logo";
import type { Plain, Typing } from "@/components/Messenger";
import type { User } from "@/lib/api";
import { chatApi, listTime, otherOf, presenceLabel, titleOf, type Conversation, type Person } from "@/lib/chat";
import { cn } from "@/lib/utils";

type Filter = "all" | "unread" | "groups";

/** The left column: my chats, newest first, with search (my chats + everyone on Pacewise), filters and the menu. */
export function Sidebar(props: {
  user: User; convs: Conversation[]; loaded: boolean; error: string | null; plain: Record<string, Plain>; typing: Typing; activeId: string | null;
  onOpen: (id: string) => void; onStartDirect: (userId: string) => void; onNewChat: () => void; onNewGroup: () => void; onDeleteChat: (c: Conversation) => void;
  light: boolean; setLight: (v: boolean) => void; onLock: () => void; onSignOut: () => void; notificationsAllowed: boolean; onAskNotifications: () => void;
}) {
  const { user, convs, plain, typing, activeId, onOpen } = props;
  const me = user.id;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [menu, setMenu] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  /** The small menu on one chat row (hover arrow or right-click). */
  const [rowMenu, setRowMenu] = useState<{ c: Conversation; x: number; y: number } | null>(null);
  const rowMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rowMenu) return;
    const down = (e: PointerEvent) => { if (!rowMenuRef.current?.contains(e.target as Node)) setRowMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setRowMenu(null); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [rowMenu]);

  const term = q.trim().toLowerCase();
  const shown = useMemo(() => convs.filter((c) => {
    if (filter === "unread" && !c.unread) return false;
    if (filter === "groups" && c.type !== "group") return false;
    if (!term) return true;
    const other = otherOf(c, me);
    return titleOf(c, me).toLowerCase().includes(term) || (other?.username ?? "").toLowerCase().includes(term.replace(/^@/, ""));
  }), [convs, filter, term, me]);

  // Searching also looks through everyone on Pacewise.
  useEffect(() => {
    if (!term) { setPeople([]); return; }
    let live = true;
    const t = window.setTimeout(() => {
      chatApi.users(term, 0, 20).then((r) => { if (live) setPeople(r.items); }, () => undefined);
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [term]);
  const directWith = new Set(convs.filter((c) => c.type === "direct").map((c) => otherOf(c, me)?.id));
  const newPeople = people.filter((p) => !directWith.has(p.id));

  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [menu]);

  const item = "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink hover:bg-overlay/[0.06]";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar id={me} name={user.name} url={user.avatarUrl} size={36} />
          <Logo />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={props.onNewChat} aria-label="New chat" title="New chat" className="flex h-10 w-10 items-center justify-center rounded-full text-brand hover:bg-brand/10"><SquarePen className="h-[22px] w-[22px]" strokeWidth={2} /></button>
          <div ref={menuRef} className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu} className="flex h-10 w-10 items-center justify-center rounded-full text-brand hover:bg-brand/10"><MoreHorizontal className="h-6 w-6" strokeWidth={2.25} /></button>
            {menu && (
              <div role="menu" className="pw-menu glass-in absolute right-0 top-11 z-50 w-60 overflow-hidden py-1.5">
                <button role="menuitem" className={item} onClick={() => { setMenu(false); props.onNewGroup(); }}><Users className="h-4 w-4 text-ink-muted" /> New group</button>
                {!props.notificationsAllowed && <button role="menuitem" className={item} onClick={() => { setMenu(false); props.onAskNotifications(); }}><Bell className="h-4 w-4 text-ink-muted" /> Turn on notifications</button>}
                <button role="menuitem" className={item} onClick={() => { setMenu(false); props.setLight(!props.light); }}>{props.light ? <Moon className="h-4 w-4 text-ink-muted" /> : <Sun className="h-4 w-4 text-ink-muted" />} {props.light ? "Dark" : "Light"} theme</button>
                <button role="menuitem" className={item} onClick={() => { setMenu(false); props.onLock(); }}><Lock className="h-4 w-4 text-ink-muted" /> Lock chats</button>
                <div className="my-1 border-t border-overlay/10" />
                <div className="px-4 pb-1 pt-1.5"><p className="truncate text-sm text-ink">{user.name}</p><p className="truncate text-xs text-ink-faint">@{user.username}</p></div>
                <button role="menuitem" className={cn(item, "text-accent-extreme")} onClick={() => { setMenu(false); props.onSignOut(); }}><LogOut className="h-4 w-4" /> Log out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <h1 className="shrink-0 px-4 pb-2 text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">Chats</h1>
      <div className="shrink-0 px-4 pb-3">
        <label className="pw-search flex h-10 items-center gap-2.5 rounded-[12px] px-3 text-ink-muted focus-within:ring-2 focus-within:ring-brand/40">
          <Search className="h-4 w-4 shrink-0" />
          <span className="sr-only">Search chats and people</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or start a new chat" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </label>
        <div className="pw-seg mt-3 flex rounded-[10px] p-[3px]" role="tablist" aria-label="Filter chats">
          {(["all", "unread", "groups"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={cn("flex-1 rounded-[8px] py-1 text-[13px] font-medium capitalize transition-colors", filter === f ? "pw-seg-on text-ink" : "text-ink-muted")}>{f}</button>
          ))}
        </div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {props.error && <p className="px-4 py-6 text-sm text-accent-extreme" role="alert">{props.error}</p>}
        {!props.loaded && !props.error && <p className="px-4 py-6 text-sm text-ink-muted">Loading chats…</p>}
        {props.loaded && shown.length === 0 && !term && (
          <div className="px-6 py-10 text-center text-sm text-ink-muted">
            {filter === "all" ? <>No chats yet. <button className="text-brand underline-offset-4 hover:underline" onClick={props.onNewChat}>Start one</button> with anyone on Pacewise.</> : filter === "unread" ? "No unread chats." : "You are not in any groups yet."}
          </div>
        )}
        {term && shown.length > 0 && <p className="px-4 pb-1 pt-3 text-[13px] font-semibold text-ink-muted">Chats</p>}
        <ul>
          {shown.map((c) => {
            const other = otherOf(c, me);
            const who = Object.keys(typing[c.id] ?? {});
            const typingText = who.length ? (c.type === "group" ? `${c.members.find((m) => m.id === who[0])?.name.split(" ")[0] ?? "Someone"} is typing…` : "typing…") : null;
            return (
              <li key={c.id} className="group relative" onContextMenu={(e) => { e.preventDefault(); setRowMenu({ c, x: e.clientX, y: e.clientY }); }}>
                <button type="button" onClick={() => onOpen(c.id)} aria-current={activeId === c.id ? "true" : undefined}
                  className={cn("flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-overlay/[0.04]", activeId === c.id && "bg-brand/10 hover:bg-brand/10")}>
                  <Avatar id={c.type === "group" ? c.id : other?.id ?? c.id} name={titleOf(c, me)} url={other?.avatarUrl} group={c.type === "group"} online={c.type === "direct" && other?.id !== me && other?.online} size={52} />
                  <span className="min-w-0 flex-1 border-b border-overlay/[0.06] pb-2.5 pt-0.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[16px] font-semibold text-ink">{titleOf(c, me)}</span>
                      <span className={cn("shrink-0 text-xs", c.unread ? "text-brand" : "text-ink-faint")}>{listTime(c.lastMessageAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2 text-sm text-ink-muted">
                      {typingText ? <span className="truncate text-brand">{typingText}</span> : <Preview c={c} me={me} plain={props.plain} />}
                      {c.unread > 0 && <span className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{c.unread > 99 ? "99+" : c.unread}</span>}
                      <span className="w-5 shrink-0" aria-hidden />
                    </span>
                  </span>
                </button>
                <button type="button" aria-label={`Options for ${titleOf(c, me)}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setRowMenu({ c, x: r.right - 192, y: r.bottom + 4 }); }}
                  className="absolute bottom-4 right-3 flex h-6 w-6 items-center justify-center rounded-full text-ink-muted opacity-0 transition-opacity hover:bg-overlay/[0.08] focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60">
                  <ChevronDown className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
        {term && newPeople.length > 0 && (
          <>
            <p className="px-4 pb-1 pt-4 text-[13px] font-semibold text-ink-muted">People on Pacewise</p>
            <ul>
              {newPeople.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => { setQ(""); props.onStartDirect(p.id); }} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-overlay/[0.05]">
                    <Avatar id={p.id} name={p.name} url={p.avatarUrl} online={p.online} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold text-ink">{p.name}</span>
                      <span className="block truncate text-xs text-ink-muted">@{p.username} · {presenceLabel(p)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {term && shown.length === 0 && newPeople.length === 0 && <p className="px-6 py-10 text-center text-sm text-ink-muted">No chats or people match “{q.trim()}”.</p>}
        {rowMenu && (
          <div ref={rowMenuRef} role="menu" className="pw-menu glass-in fixed z-[130] w-48 overflow-hidden py-1.5"
            style={{ left: Math.max(8, Math.min(rowMenu.x, window.innerWidth - 200)), top: Math.min(rowMenu.y, window.innerHeight - 60) }}>
            <button role="menuitem" type="button" onClick={() => { const c = rowMenu.c; setRowMenu(null); props.onDeleteChat(c); }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-accent-extreme hover:bg-overlay/[0.06]"><Trash2 className="h-4 w-4" /> Delete chat</button>
          </div>
        )}
        {props.loaded && <p className="flex items-center justify-center gap-1.5 px-6 py-6 text-xs text-ink-faint"><Lock className="h-3 w-3" /> Your personal messages are end-to-end encrypted</p>}
      </div>
    </div>
  );
}
