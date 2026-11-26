"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, ChevronRight, Maximize, Minimize, Lock, LogOut, Moon, MoreHorizontal, Palette, Search, SquarePen, Sun, Trash2, UserX, Users, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import LiquidGlass from "@/components/LiquidGlass";
import { Preview, TypingDots } from "@/components/bits";
import type { Plain, Typing } from "@/components/Messenger";
import type { User } from "@/lib/api";
import { chatApi, listTime, otherOf, presenceLabel, titleOf, type Conversation, type Person } from "@/lib/chat";
import { cn } from "@/lib/utils";

type Filter = "all" | "unread" | "groups";

/** The left column: my chats, newest first, with search (my chats + everyone on Pacewise), filters and the menu. */
export function Sidebar(props: {
  user: User; convs: Conversation[]; loaded: boolean; error: string | null; plain: Record<string, Plain>; typing: Typing; activeId: string | null;
  onOpen: (id: string) => void; onStartDirect: (userId: string) => void; onNewChat: () => void; onNewGroup: () => void; onDeleteChat: (c: Conversation) => void;
  light: boolean; setLight: (v: boolean) => void; onProfile: () => void; fullScreen: { canFull: boolean; on: boolean; toggleFull: () => void }; onTheme: () => void; onBlocked: () => void; onLock: () => void; onSignOut: () => void; notificationsAllowed: boolean; onAskNotifications: () => void;
}) {
  const { user, convs, plain, typing, activeId, onOpen } = props;
  const me = user.id;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [menu, setMenuOpen] = useState(false);
  /** The menu's short closing animation is playing (it stays on screen until it ends). */
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const setMenu = (v: boolean | ((m: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(menu && !closing) : v;
    window.clearTimeout(closeTimer.current);
    if (next) { setClosing(false); setMenuOpen(true); return; }
    if (!menu) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => { setMenuOpen(false); setClosing(false); }, 140);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const [people, setPeople] = useState<Person[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);
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
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); menuBtn.current?.focus(); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [menu]);
  // Opened from the keyboard: the first item takes focus, so the arrows work straight away.
  useEffect(() => {
    if (menu && !closing && document.activeElement === menuBtn.current && menuBtn.current?.matches(":focus-visible")) menuBox.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Up / Down / Home / End move between the items; Tab leaves and closes the menu. */
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") { setMenu(false); return; }
    const items = [...(menuBox.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to]?.focus();
  };

  /** Menu rows as in To do's pull-down menus: the label on the left, its icon on the right, hairlines between. */
  const item = "flex w-full items-center gap-2.5 px-4 py-[11px] text-left text-[16px] text-ink outline-none transition-colors duration-100 hover:bg-overlay/[0.06] active:bg-overlay/[0.12] focus-visible:bg-overlay/[0.07]";
  const icon = "h-[18px] w-[18px] shrink-0";
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* One 16 px edge for everything in this column: header, title, search, filters and the rows. */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4 pt-1">
        <button type="button" onClick={props.onProfile} className="pw-corner shrink-0" title={`${user.name} · @${user.username}`} aria-label="Edit profile">
          <span className="pw-corner-lg" aria-hidden><LiquidGlass width="100%" height="100%" radius={26} blur={4} /></span>
          <Avatar id={me} name={user.name} url={user.avatarUrl} size={40} />
          <span className="sr-only">Pacewise Chat</span>
        </button>
        <div className="flex items-center">
          <div ref={menuRef} className="relative">
            {/* New chat and the menu in one liquid-glass capsule, exactly like the flip book's buttons at its top right. */}
            <div className="pw-corner-pill text-brand" role="group" aria-label="New chat and menu">
              <span className="pw-corner-lg" aria-hidden><LiquidGlass width="100%" height="100%" radius={26} blur={4} /></span>
              <button type="button" onClick={() => { setMenu(false); props.onNewChat(); }} aria-label="New chat" title="New chat" className="pw-corner-in"><SquarePen size={20} strokeWidth={1.75} aria-hidden /></button>
              <span className="pw-corner-sep" aria-hidden />
              <button ref={menuBtn} type="button" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-haspopup="menu" aria-expanded={menu && !closing} title="Menu" className="pw-corner-in"><MoreHorizontal size={20} strokeWidth={1.75} aria-hidden /></button>
            </div>
            {menu && (
              <>
                {/* The screen behind dims; a tap there closes the menu. */}
                <div className={cn("pw-menu-backdrop fixed inset-0 z-40", closing ? "menu-fade-out" : "fade-in")} aria-hidden onClick={() => setMenu(false)} />
                <div ref={menuBox} role="menu" aria-label="Menu" onKeyDown={onMenuKey} className={cn("pw-menu absolute right-0 top-[60px] z-50 w-[300px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[14px]", closing ? "menu-pop-out" : "menu-pop")}>
                  {/* Who is signed in; a tap opens the profile to edit it. */}
                  <button role="menuitem" className={cn(item, "gap-3 py-3")} onClick={() => { setMenu(false); props.onProfile(); }}>
                    <Avatar id={me} name={user.name} url={user.avatarUrl} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold leading-tight text-ink">{user.name}</span>
                      <span className="mt-0.5 block truncate text-[13px] leading-tight text-ink-muted">@{user.username}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2.25} />
                  </button>
                  <div className="border-t-[7px] border-overlay/[0.07]">
                    <button role="menuitem" className={cn(item, "border-b border-overlay/10")} onClick={() => { setMenu(false); props.onNewGroup(); }}><span className="flex-1">New group</span><Users className={icon} strokeWidth={1.75} /></button>
                    {!props.notificationsAllowed && <button role="menuitem" className={cn(item, "border-b border-overlay/10")} onClick={() => { setMenu(false); props.onAskNotifications(); }}><span className="flex-1">Turn on notifications</span><Bell className={icon} strokeWidth={1.75} /></button>}
                    <button role="menuitem" className={cn(item, "border-b border-overlay/10")} onClick={() => { setMenu(false); props.setLight(!props.light); }}><span className="flex-1">{props.light ? "Dark" : "Light"} theme</span>{props.light ? <Moon className={icon} strokeWidth={1.75} /> : <Sun className={icon} strokeWidth={1.75} />}</button>
                    {props.fullScreen.canFull && <button role="menuitem" className={cn(item, "border-b border-overlay/10")} onClick={() => { props.fullScreen.toggleFull(); setMenu(false); }}><span className="flex-1">Full screen</span><span className="text-[15px] text-ink-muted">{props.fullScreen.on ? "On" : "Off"}</span>{props.fullScreen.on ? <Minimize className={icon} strokeWidth={1.75} /> : <Maximize className={icon} strokeWidth={1.75} />}</button>}
                    <button role="menuitem" className={cn(item, "border-b border-overlay/10")} onClick={() => { setMenu(false); props.onTheme(); }}><span className="flex-1">Chat theme</span><Palette className={icon} strokeWidth={1.75} /></button>
                    <button role="menuitem" className={cn(item, "border-b border-overlay/10")} onClick={() => { setMenu(false); props.onBlocked(); }}><span className="flex-1">Blocked contacts</span><UserX className={icon} strokeWidth={1.75} /></button>
                    <button role="menuitem" className={item} onClick={() => { setMenu(false); props.onLock(); }}><span className="flex-1">Lock chats</span><Lock className={icon} strokeWidth={1.75} /></button>
                  </div>
                  <div className="border-t-[7px] border-overlay/[0.07]">
                    <button role="menuitem" className={cn(item, "text-[#F2453D]")} onClick={() => { setMenu(false); props.onSignOut(); }}><span className="flex-1">Log out</span><LogOut className={icon} strokeWidth={1.75} /></button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <h1 className="shrink-0 px-4 pb-3 pt-1 text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">Chats</h1>
      <div className="shrink-0 px-4 pb-3">
        <label className="pw-search flex h-10 items-center gap-2 rounded-[11px] px-3 text-ink-muted focus-within:ring-2 focus-within:ring-brand/40">
          <Search className="h-4 w-4 shrink-0" />
          <span className="sr-only">Search chats and people</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or start a new chat" className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </label>
        <div className="pw-seg mt-2.5 flex rounded-[9px] p-[2px]" role="tablist" aria-label="Filter chats">
          {(["all", "unread", "groups"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={cn("flex-1 rounded-[7px] py-[5px] text-[13px] font-semibold capitalize transition-colors", filter === f ? "pw-seg-on text-ink" : "text-ink-muted")}>{f}</button>
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
        <ul className="px-2">
          {shown.map((c) => {
            const other = otherOf(c, me);
            const who = Object.keys(typing[c.id] ?? {});
            const typingText = who.length ? (c.type === "group" ? `${c.members.find((m) => m.id === who[0])?.name.split(" ")[0] ?? "Someone"} is typing…` : "typing…") : null;
            return (
              <li key={c.id} className="group relative" onContextMenu={(e) => { e.preventDefault(); setRowMenu({ c, x: e.clientX, y: e.clientY }); }}>
                <button type="button" onClick={() => onOpen(c.id)} aria-current={activeId === c.id ? "true" : undefined}
                  className={cn("flex w-full items-center gap-3 rounded-none px-2 text-left transition-colors hover:bg-overlay/[0.04]", activeId === c.id && "bg-brand/[0.12] hover:bg-brand/[0.12]")}>
                  <Avatar id={c.type === "group" ? c.id : other?.id ?? c.id} name={titleOf(c, me)} url={other?.avatarUrl} group={c.type === "group"} online={c.type === "direct" && other?.id !== me && other?.online} size={48} />
                  <span className={cn("flex min-h-[68px] min-w-0 flex-1 flex-col justify-center border-b py-2.5", activeId === c.id ? "border-transparent" : "border-overlay/[0.07]")}>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[16px] font-semibold leading-snug text-ink">{titleOf(c, me)}</span>
                      <span className={cn("shrink-0 text-[13px] tabular-nums", c.unread ? "font-medium text-brand" : "text-ink-faint")}>{listTime(c.lastMessageAt)}</span>
                    </span>
                    <span className="mt-0.5 flex min-h-[20px] items-center justify-between gap-2 text-[14px] leading-snug text-ink-muted">
                      <span className="flex min-w-0 flex-1">{typingText ? <span className="flex min-w-0 items-center gap-1.5 text-brand"><TypingDots /><span className="truncate">{typingText}</span></span> : <Preview c={c} me={me} plain={props.plain} />}</span>
                      {/* Flush right, under the time; on hover the options arrow takes its place. */}
                      {c.unread > 0 ? <span className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white transition-opacity group-hover:opacity-0">{c.unread > 99 ? "99+" : c.unread}</span>
                        : <span className="w-6 shrink-0" aria-hidden />}
                    </span>
                  </span>
                </button>
                <button type="button" aria-label={`Options for ${titleOf(c, me)}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setRowMenu({ c, x: r.right - 192, y: r.bottom + 4 }); }}
                  className="absolute bottom-[13px] right-[18px] flex h-6 w-6 items-center justify-center rounded-full text-ink-muted opacity-0 transition-opacity hover:bg-overlay/[0.08] focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60">
                  <ChevronDown className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
        {term && newPeople.length > 0 && (
          <>
            <p className="px-4 pb-1 pt-4 text-[13px] font-semibold text-ink-muted">People on Pacewise</p>
            <ul className="px-2">
              {newPeople.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => { setQ(""); props.onStartDirect(p.id); }} className="flex w-full items-center gap-3 rounded-none px-2 py-2.5 text-left hover:bg-overlay/[0.05]">
                    <Avatar id={p.id} name={p.name} url={p.avatarUrl} online={p.online} size={48} />
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
