"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Lock } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { NewChat } from "@/components/NewChat";
import { ProfilePanel } from "@/components/ProfilePanel";
import { BlockedPanel, ChatThemePanel } from "@/components/ChatSettings";
import { LinkDevicePanel } from "@/components/LinkDevicePanel";
import { CallsPanel } from "@/components/CallsPanel";
import { StatusTab } from "@/components/StatusTab";
import { BottomNav } from "@/components/BottomNav";
import { applyLook, loadLook } from "@/lib/look";
import { useFullScreen } from "@/lib/fullscreen";
import { disablePush, enablePush } from "@/lib/push";
import { ChatWindow } from "@/components/ChatWindow";
import { loadCalls } from "@/lib/calls";
import { InfoPanel } from "@/components/InfoPanel";
import { Logo } from "@/components/Logo";
import { DeleteDialog, type DeleteChoice, type EveryoneChoice } from "@/components/DeleteDialog";
import { CallLayer, type CallHandle } from "@/components/CallLayer";
import { ReportDialog } from "@/components/ReportDialog";
import { ApiError, type User } from "@/lib/api";
import { chatApi, otherOf, streamUrl, titleOf, type ChatEvent, type Conversation, type Message } from "@/lib/chat";
import { decryptMessage, encryptFile, encryptMessage, type FileMeta, type Identity } from "@/lib/crypto";
import { fileLabel, fileUrl } from "@/lib/files";
import { Keyring } from "@/lib/keyring";
import { cn } from "@/lib/utils";

/** What a message says once decrypted on this device. */
/** An attachment as this device knows it (`local` = a preview of a file I am sending, before it is uploaded). */
export type PlainFile = FileMeta & { local?: string };
export type Plain = { text: string; file?: PlainFile } | { locked: true } | { error: true };
export interface Thread { items: Message[]; hasMore: boolean; loaded: boolean }
/** conversation id → user id → typing until (ms). */
export type Typing = Record<string, Record<string, number>>;

const POLL_MS = 20_000;
const byRecent = (a: Conversation, b: Conversation) => b.lastMessageAt.localeCompare(a.lastMessageAt);

/**
 * The messenger: the chat list on the left, the open chat on the right (one at a time on a phone), contact / group
 * info on the far right. Live updates come over Server-Sent Events, with a 20-second check as a fallback (which also
 * keeps my "online" status fresh for the others). Everything is decrypted here, in the browser.
 */
/** The gap between two sections side by side during a swipe (as in To do). */
const PAGE_GAP = 16;

export function Messenger({ user, identity, light, setLight, onLock, onSignOut, onUserChange }: {
  user: User; identity: Identity; light: boolean; setLight: (v: boolean) => void; onLock: () => void; onSignOut: () => void; onUserChange: (u: User) => void;
}) {
  const me = user.id;
  const ring = useMemo(() => new Keyring(identity, me), [identity, me]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [plain, setPlain] = useState<Record<string, Plain>>({});
  const [typing, setTyping] = useState<Typing>({});
  const [panel, setPanel] = useState<null | "chat" | "group" | "profile" | "theme" | "blocked" | "link">(null);
  /** The bottom nav: Chats, Status and Calls (as in WhatsApp). */
  const [tab, setTab] = useState<"chats" | "status" | "calls">("chats");
  /** Bumped when a contact posts or deletes a status, so an open Status tab reloads. */
  const [statusVersion, setStatusVersion] = useState(0);

  /**
   * Phones: swipe left / right to go to the next / previous section of the bottom nav, exactly as in To do: the page
   * follows the finger once the swipe is clearly sideways (vertical scrolling is left alone), the next section is right
   * there beside it, it resists at the first and last section, and on release it either springs back or slides out
   * while the next one slides in. A quick flick is enough; a slow drag has to pass a third of the width. A swipe that
   * starts in a field or in something that scrolls sideways stays there.
   */
  const pagesRef = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState<{ tab: "chats" | "status" | "calls"; dir: 1 | -1 } | null>(null);
  const peekRef = useRef<{ tab: "chats" | "status" | "calls"; dir: 1 | -1 } | null>(null);
  const tabRef = useRef(tab); tabRef.current = tab;
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const el = pagesRef.current;
    if (!phone || !el || panel) return;
    const order = ["chats", "status", "calls"] as const;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const EASE = "cubic-bezier(0.25, 1, 0.5, 1)";
    let g: { x: number; y: number; lock: "x" | "y" | null; dx: number; vx: number; lastX: number; lastT: number } | null = null;
    let animating = false;
    const scrollsSideways = (n: EventTarget | null) => {
      for (let e = n instanceof Element ? n : null; e && e !== el; e = e.parentElement) {
        if (e.matches("input, textarea, select, [contenteditable=true], [role=slider]")) return true;
        const ox = getComputedStyle(e).overflowX;
        if ((ox === "auto" || ox === "scroll") && e.scrollWidth > e.clientWidth + 1) return true;
      }
      return false;
    };
    const place = (x: number, ms = 0, ease = EASE) => {
      el.style.transition = ms ? `left ${ms}ms ${ease}, opacity ${ms}ms ${ease}` : "none";
      el.style.left = `${x}px`;
    };
    const clear = () => { el.style.transition = ""; el.style.left = ""; };
    clear();
    const showPeek = (next: (typeof order)[number] | undefined, dir: 1 | -1) => {
      if (reduced) return;
      if (!next) { if (peekRef.current) { peekRef.current = null; flushSync(() => setPeek(null)); } return; }
      if (peekRef.current?.tab === next) return;
      const v = { tab: next, dir };
      peekRef.current = v;
      flushSync(() => setPeek(v));
    };
    const dropPeek = () => { peekRef.current = null; setPeek(null); };
    const after = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
    /** iOS-style rubber band past the first / last section. */
    const rubber = (x: number, w: number) => Math.sign(x) * (1 - 1 / ((Math.abs(x) * 0.55) / w + 1)) * w;

    const down = (e: TouchEvent) => {
      if (animating || e.touches.length !== 1 || scrollsSideways(e.target)) { g = null; return; }
      const x = e.touches[0].clientX;
      g = { x, y: e.touches[0].clientY, lock: null, dx: 0, vx: 0, lastX: x, lastT: performance.now() };
    };
    const move = (e: TouchEvent) => {
      if (!g || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.lock) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        g.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
      }
      if (g.lock !== "x") return;
      e.preventDefault(); // the page moves sideways, so it must not scroll up / down at the same time
      const now = performance.now();
      const dt = Math.max(1, now - g.lastT);
      g.vx = 0.8 * ((t.clientX - g.lastX) / dt) + 0.2 * g.vx;
      g.lastX = t.clientX;
      g.lastT = now;
      g.dx = dx;
      const i = order.indexOf(tabRef.current);
      const edge = (dx > 0 && i === 0) || (dx < 0 && i === order.length - 1);
      showPeek(edge ? undefined : order[i + (dx < 0 ? 1 : -1)], dx < 0 ? 1 : -1);
      if (!reduced) place(edge ? rubber(dx, el.clientWidth) : dx);
    };
    const up = () => {
      const s = g;
      g = null;
      if (!s || s.lock !== "x") return;
      const w = el.clientWidth;
      const i = order.indexOf(tabRef.current);
      const dir = s.dx < 0 ? 1 : -1;
      const next = order[i + dir];
      const flick = Math.abs(s.vx) > 0.35 && Math.sign(s.vx) === Math.sign(s.dx);
      const go = !!next && (Math.abs(s.dx) > w / 3 || flick);
      if (!go) {
        if (reduced) { clear(); dropPeek(); return; }
        animating = true;
        place(0, 380, "cubic-bezier(0.34, 1.3, 0.64, 1)"); // a soft spring back
        after(390, () => { clear(); dropPeek(); animating = false; });
        return;
      }
      if (reduced) { clear(); dropPeek(); setTab(next); return; }
      animating = true;
      // both pages glide on together until the next one fills the width; it then simply becomes the open section
      const dist = w + PAGE_GAP;
      const out = Math.min(300, Math.max(160, (dist - Math.abs(s.dx)) / Math.max(0.8, Math.abs(s.vx))));
      showPeek(next, dir as 1 | -1);
      place(-dir * dist, out);
      after(out, () => {
        el.style.transition = "none";
        flushSync(() => { peekRef.current = null; setPeek(null); setTab(next); });
        clear();
        animating = false;
      });
    };
    const cancel = () => {
      if (g?.lock === "x" && !reduced) { animating = true; place(0, 300); after(310, () => { clear(); dropPeek(); animating = false; }); }
      g = null;
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up, { passive: true });
    el.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", down); el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up); el.removeEventListener("touchcancel", cancel);
      clear();
    };
  }, [phone, panel]);

  /** A sign-in QR code opened with the phone's own camera app (…/?link=<id>): go straight to approving it. */
  const [linkId, setLinkId] = useState<string | null>(null);
  useEffect(() => {
    const u = new URL(window.location.href);
    const id = u.searchParams.get("link");
    if (!id) return;
    u.searchParams.delete("link");
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    setLinkId(id); setPanel("link");
  }, []);
  /** The chat whose other person is about to be blocked (the confirmation is open). */
  const [blocking, setBlocking] = useState<Conversation | null>(null);
  useEffect(() => { applyLook(loadLook()); }, []);
  /**
   * Phones: while the on-screen keyboard is up, Palk fills only the part of the screen above it (as WhatsApp does),
   * so the message box sits right on top of the keyboard and the conversation stays visible above it. iPhones do not
   * shrink the page for the keyboard, so the visible area is followed here; Android does it itself (see layout.tsx).
   */
  const [kb, setKb] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      const open = window.matchMedia("(max-width: 767px)").matches && vv.height < window.innerHeight - 80;
      setKb(open ? { top: vv.offsetTop, height: vv.height } : null);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); };
  }, []);
  // Calls ring this device even when Palk is closed (once notifications are allowed).
  useEffect(() => { void enablePush(); }, []);
  /**
   * Opened from an incoming-call notification (…/?call=<id>, &answer=1 for Answer): the ring this device missed while
   * Palk was closed comes from the server, is handed to the call screen as if it had just arrived, and is picked up
   * at once for Answer. Waits for the chat list, so the call screen knows who is calling.
   */
  const [pendingCall, setPendingCall] = useState<{ id: string; answer: boolean } | null>(null);
  useEffect(() => {
    const u = new URL(window.location.href);
    const id = u.searchParams.get("call");
    if (!id) return;
    const answer = u.searchParams.get("answer") === "1";
    u.searchParams.delete("call"); u.searchParams.delete("answer");
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    setPendingCall({ id, answer });
  }, []);
  useEffect(() => {
    if (!pendingCall || !loaded) return;
    const { id, answer } = pendingCall;
    setPendingCall(null);
    chatApi.pendingRing(id).then(({ ring }) => {
      if (!ring) { flash("That call has ended."); return; }
      callRef.current?.signal({ type: "call", conversationId: ring.conversationId, from: ring.from, data: { callId: id, kind: ring.kind, video: ring.video, sdp: ring.sdp || undefined, people: ring.people } });
      for (const candidate of ring.ice[ring.from] ?? []) callRef.current?.signal({ type: "call", from: ring.from, data: { callId: id, kind: "ice", candidate } });
      if (answer) window.setTimeout(() => callRef.current?.pickUp(id), 300);
    }, () => flash("Could not pick up the call."));
  }, [pendingCall, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const fullScreen = useFullScreen();
  const [info, setInfo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const convsRef = useRef(convs); convsRef.current = convs;
  const threadsRef = useRef(threads); threadsRef.current = threads;
  const plainRef = useRef(plain); plainRef.current = plain;
  const activeRef = useRef(activeId); activeRef.current = activeId;

  /**
   * The phone's Back button (or back swipe) steps back inside Palk, as in To do: each layer that opens (a chat, a
   * sidebar screen such as Profile or New chat, the contact info) gets its own browser history entry, and Back closes
   * the top one: info, then the sidebar screen, then the chat. Only from the chat list does Back leave the app.
   */
  const panelRef = useRef(panel); panelRef.current = panel;
  const infoRef = useRef(info); infoRef.current = info;
  const pushed = useRef(0);
  const skipPops = useRef(0);
  const layers = (activeId ? 1 : 0) + (panel ? 1 : 0) + (info && activeId ? 1 : 0);
  useEffect(() => {
    if (layers > pushed.current) {
      while (pushed.current < layers) window.history.pushState({ palk: ++pushed.current }, "");
    } else if (layers < pushed.current) {
      // closed with an on-screen button: take its history entries back off too, so Back stays in step
      const n = pushed.current - layers;
      pushed.current = layers;
      skipPops.current += 1;
      window.history.go(-n);
    }
  }, [layers]);
  useEffect(() => {
    const onPop = () => {
      if (skipPops.current > 0) { skipPops.current -= 1; return; }
      pushed.current = Math.max(0, pushed.current - 1);
      if (infoRef.current && activeRef.current) setInfo(false);
      else if (panelRef.current) setPanel(null);
      else if (activeRef.current) setActiveId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const active = convs.find((c) => c.id === activeId) ?? null;

  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3500); }, []);

  // ---- decryption ----
  const decrypt = useCallback(async (msgs: Message[], force = false) => {
    const out: Record<string, Plain> = {};
    await Promise.all(msgs.map(async (m) => {
      if (m.kind !== "text" || m.deleted || !m.ct) return;
      const had = plainRef.current[m.id];
      if (had && !force && !("locked" in had)) return;
      const key = ring.get(m.conversationId, m.epoch);
      if (!key) { out[m.id] = { locked: true }; return; }
      try {
        const d = await decryptMessage(key, { conversationId: m.conversationId, messageId: m.id, senderId: m.senderId, epoch: m.epoch }, m.iv, m.ct);
        const had = plainRef.current[m.id];
        const local = had && "file" in had ? had.file?.local : undefined;
        out[m.id] = { text: d.t, ...(d.f ? { file: { ...d.f, ...(local ? { local } : {}) } } : {}) };
      } catch {
        out[m.id] = { error: true };
      }
    }));
    if (Object.keys(out).length) setPlain((p) => ({ ...p, ...out }));
  }, [ring]);

  // ---- the chat list (and keys) ----
  const running = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do {
        again.current = false;
        void loadCalls().catch(() => undefined); // call cards are ready before a chat opens
        let list = await chatApi.conversations();
        // Open my copies of each chat's keys; seed new chats and share keys with members who are waiting.
        list = await Promise.all(list.map(async (c) => (await ring.sync(c).catch(() => null)) ?? c));
        setConvs(list.sort(byRecent));
        setLoaded(true);
        setLoadError(null);
        await decrypt(list.flatMap((c) => (c.lastMessage ? [c.lastMessage] : [])));
        // Messages that were waiting for a key may open now.
        const locked = Object.values(threadsRef.current).flatMap((t) => t.items).filter((m) => { const p = plainRef.current[m.id]; return p && "locked" in p; });
        if (locked.length) await decrypt(locked, true);
        if (activeRef.current && !list.some((c) => c.id === activeRef.current)) { setActiveId(null); setInfo(false); }
      } while (again.current);
    } catch (e) {
      if (!loaded) setLoadError(e instanceof Error ? e.message : "Could not load your chats.");
    } finally {
      running.current = false;
    }
  }, [ring, decrypt, loaded]);

  const timer = useRef<number | null>(null);
  const soon = useCallback((ms = 250) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void refresh(), ms);
  }, [refresh]);

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // ---- read receipts ----
  const markRead = useCallback((id: string) => {
    if (document.visibilityState !== "visible") return;
    const c = convsRef.current.find((x) => x.id === id);
    if (!c) return;
    const mine = c.members.find((m) => m.id === me);
    const items = threadsRef.current[id]?.items ?? [];
    const lastIn = [...items].reverse().find((m) => m.senderId !== me && !m.status);
    const newer = lastIn && (!mine?.lastReadAt || lastIn.createdAt > mine.lastReadAt);
    if (!c.unread && !newer) return;
    setConvs((cs) => cs.map((x) => (x.id === id ? { ...x, unread: 0, members: x.members.map((m) => (m.id === me ? { ...m, lastReadAt: new Date().toISOString() } : m)) } : x)));
    void chatApi.read(id).catch(() => undefined);
  }, [me]);

  // ---- a chat's messages ----
  const openThread = useCallback(async (id: string) => {
    if (!threadsRef.current[id]?.loaded) {
      try {
        const r = await chatApi.messages(id, { limit: 50 });
        setThreads((t) => ({ ...t, [id]: { items: r.items, hasMore: r.hasMore, loaded: true } }));
        threadsRef.current = { ...threadsRef.current, [id]: { items: r.items, hasMore: r.hasMore, loaded: true } };
        await decrypt(r.items);
      } catch (e) {
        flash(e instanceof Error ? e.message : "Could not load messages.");
      }
    }
    markRead(id);
  }, [decrypt, markRead, flash]);

  const loadOlder = useCallback(async (id: string) => {
    const t = threadsRef.current[id];
    if (!t?.hasMore || !t.items.length) return;
    const r = await chatApi.messages(id, { before: t.items[0].createdAt, limit: 50 });
    setThreads((all) => ({ ...all, [id]: { ...all[id], items: [...r.items, ...all[id].items], hasMore: r.hasMore } }));
    await decrypt(r.items);
  }, [decrypt]);

  const open = useCallback((id: string) => {
    setActiveId(id);
    setPanel(null);
    void openThread(id);
  }, [openThread]);

  // ---- live events ----
  /** Audio calls (one-to-one chats) and reporting spam. */
  const callRef = useRef<CallHandle>(null);
  const [reporting, setReporting] = useState<Conversation | null>(null);
  /** The last few messages someone sent in a chat (decrypted here), which the reporter may choose to include. */
  const recentFrom = useCallback((cid: string, userId: string) => (threadsRef.current[cid]?.items ?? [])
    .filter((m) => m.senderId === userId && m.kind === "text" && !m.deleted)
    .map((m) => plainRef.current[m.id]).filter((p): p is { text: string } => !!p && "text" in p).map((p) => p.text).slice(-5), []);

  const handle = useCallback((e: ChatEvent) => {
    if (e.type === "call") { callRef.current?.signal(e); return; }
    if (e.type === "status") { setStatusVersion((v) => v + 1); return; }
    const cid = e.conversationId;
    if (e.type === "typing" && cid && e.from) {
      setTyping((t) => ({ ...t, [cid]: { ...(t[cid] ?? {}), [e.from!]: Date.now() + 5000 } }));
      return;
    }
    if (e.type === "message" && cid) {
      const m = e.data as Message;
      if (threadsRef.current[cid]?.loaded) {
        setThreads((t) => {
          const th = t[cid];
          if (!th) return t;
          const exists = th.items.some((x) => x.id === m.id);
          return { ...t, [cid]: { ...th, items: exists ? th.items.map((x) => (x.id === m.id ? { ...m } : x)) : [...th.items, m] } };
        });
      }
      setTyping((t) => (t[cid]?.[m.senderId] ? { ...t, [cid]: { ...t[cid], [m.senderId]: 0 } } : t));
      void decrypt([m]).then(() => {
        if (m.senderId === me) return;
        if (activeRef.current === cid && document.visibilityState === "visible") window.setTimeout(() => markRead(cid), 300);
        else notify(m);
      });
      soon();
      return;
    }
    if (e.type === "message-deleted" && cid) {
      const mid = (e.data as { id: string }).id;
      setThreads((t) => (t[cid] ? { ...t, [cid]: { ...t[cid], items: t[cid].items.map((x) => (x.id === mid ? { ...x, deleted: true, ct: "", iv: "" } : x)) } } : t));
      soon();
      return;
    }
    soon(e.type === "keys" ? 600 : 250);
  }, [decrypt, markRead, soon, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRef = useRef(handle); handleRef.current = handle;
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let retry: number | null = null;
    const connect = async () => {
      // A request first, so an expired access token is refreshed before the stream uses it.
      await chatApi.myKeys().catch(() => undefined);
      const url = await streamUrl();
      if (closed || !url) return;
      es = new EventSource(url);
      es.addEventListener("chat", (ev) => { try { handleRef.current(JSON.parse((ev as MessageEvent).data) as ChatEvent); } catch { /* ignore */ } });
      es.addEventListener("connected", () => soon(0));
      es.onerror = () => {
        es?.close();
        if (!closed) retry = window.setTimeout(() => void connect(), 4000);
      };
    };
    void connect();
    return () => { closed = true; es?.close(); if (retry) window.clearTimeout(retry); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Back to the tab: catch up and mark the open chat read.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
      if (activeRef.current) markRead(activeRef.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, markRead]);

  // Typing indicators fade out on their own.
  useEffect(() => {
    const id = window.setInterval(() => setTyping((t) => {
      const now = Date.now();
      let changed = false;
      const next: Typing = {};
      for (const [c, who] of Object.entries(t)) {
        const keep = Object.fromEntries(Object.entries(who).filter(([, until]) => until > now));
        if (Object.keys(keep).length !== Object.keys(who).length) changed = true;
        if (Object.keys(keep).length) next[c] = keep;
      }
      return changed ? next : t;
    }), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Unread count in the tab title.
  const unread = convs.reduce((a, c) => a + (c.unread > 0 ? 1 : 0), 0);
  useEffect(() => { document.title = unread ? `(${unread}) Palk` : "Palk"; }, [unread]);

  // ---- browser notifications (only when allowed, and only while the tab is in the background) ----
  function notify(m: Message) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    const c = convsRef.current.find((x) => x.id === m.conversationId);
    const p = plainRef.current[m.id];
    const sender = c?.members.find((x) => x.id === m.senderId)?.name ?? "New message";
    const title = c?.type === "group" ? `${sender} @ ${c.name}` : sender;
    try {
      const n = new Notification(title, { body: p && "text" in p ? (p.text || (p.file ? fileLabel(p.file) : "New message")) : "New message", tag: m.conversationId });
      n.onclick = () => { window.focus(); open(m.conversationId); n.close(); };
    } catch { /* not supported here */ }
  }

  // ---- sending ----
  const upsertMessage = useCallback((cid: string, m: Message, replaceId = m.id) => {
    setThreads((t) => {
      const th = t[cid] ?? { items: [], hasMore: false, loaded: true };
      const exists = th.items.some((x) => x.id === replaceId);
      return { ...t, [cid]: { ...th, items: exists ? th.items.map((x) => (x.id === replaceId ? m : x)) : [...th.items, m] } };
    });
    setConvs((cs) => cs.map((c) => (c.id === cid ? { ...c, lastMessage: m, lastMessageAt: m.createdAt } : c)).sort(byRecent));
  }, []);

  /** Attachments waiting to be uploaded (by message id), and ones already uploaded (so a retry does not upload again). */
  const pendingFiles = useRef(new Map<string, File>());
  const uploaded = useRef(new Map<string, FileMeta>());
  const deliver = useCallback(async (cid: string, id: string, text: string, replyTo: string | null, tries = 0): Promise<void> => {
    let c = convsRef.current.find((x) => x.id === cid);
    if (!c) return;
    let key = ring.get(c.id, c.epoch);
    if (!key) {
      c = (await ring.sync(c).catch(() => null)) ?? c;
      key = ring.get(c.id, c.epoch);
    }
    if (!key) throw new Error("This chat's encryption key has not reached you yet.");
    // An attachment: encrypted here with its own key and uploaded once (kept for a retry), then named in the message.
    let f: FileMeta | undefined = uploaded.current.get(id);
    const file = pendingFiles.current.get(id);
    if (file && !f) {
      const sealedFile = await encryptFile(await file.arrayBuffer());
      const { fileId } = await chatApi.uploadFile(c.id, sealedFile.data);
      f = { id: fileId, name: file.name, size: file.size, type: file.type || "application/octet-stream", key: sealedFile.key, iv: sealedFile.iv };
      uploaded.current.set(id, f);
    }
    const sealed = await encryptMessage(key, { conversationId: c.id, messageId: id, senderId: me, epoch: c.epoch }, { t: text, ...(f ? { f } : {}) });
    try {
      const saved = await chatApi.send(c.id, { id, epoch: c.epoch, ...sealed, replyTo, fileId: f?.id ?? null });
      if (f) {
        const done = f;
        pendingFiles.current.delete(id); uploaded.current.delete(id);
        const mark = (p: Record<string, Plain>) => { const had = p[id]; const local = had && "file" in had ? had.file?.local : undefined; return { ...p, [id]: { text, file: { ...done, ...(local ? { local } : {}) } } }; };
        plainRef.current = mark(plainRef.current);
        setPlain(mark);
      }
      upsertMessage(cid, saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === "KEY_ROTATED" && tries < 2) {
        await refresh();
        return deliver(cid, id, text, replyTo, tries + 1);
      }
      throw e;
    }
  }, [ring, me, upsertMessage, refresh]);

  const sendTo = useCallback(async (cid: string | null, text: string, replyTo: string | null, file?: File) => {
    const c = convsRef.current.find((x) => x.id === cid);
    if (!c) return;
    const id = crypto.randomUUID();
    lastTyping.current = 0; // the next keystroke announces "typing…" again straight away
    const draft: Message = { id, conversationId: c.id, senderId: me, kind: "text", epoch: c.epoch, iv: "", ct: "", replyTo, event: null, deleted: false, createdAt: new Date().toISOString(), status: "sending" };
    // The file stays on this device until it is uploaded: a preview straight away, and a retry if sending fails.
    const draftFile: PlainFile | undefined = file ? { id: "", name: file.name, size: file.size, type: file.type || "application/octet-stream", key: "", iv: "", local: URL.createObjectURL(file) } : undefined;
    if (file) pendingFiles.current.set(id, file);
    setPlain((p) => ({ ...p, [id]: { text, ...(draftFile ? { file: draftFile } : {}) } }));
    plainRef.current = { ...plainRef.current, [id]: { text, ...(draftFile ? { file: draftFile } : {}) } };
    upsertMessage(c.id, draft);
    try {
      await deliver(c.id, id, text, replyTo);
    } catch (e) {
      upsertMessage(c.id, { ...draft, status: "failed" });
      flash(e instanceof Error ? e.message : "Message not sent.");
    }
  }, [me, upsertMessage, deliver, flash]);
  const send = useCallback((text: string, replyTo: string | null, file?: File) => sendTo(activeRef.current, text, replyTo, file), [sendTo]);

  /**
   * Forward a message to other chats. Each chat has its own key, so the text is encrypted again for each one, and an
   * attachment is decrypted here and uploaded again (once per chat). Chats whose history is not open yet stay unloaded,
   * so opening them later still fetches everything.
   */
  const forward = useCallback(async (targets: Conversation[], text: string, file: PlainFile | undefined, fromCid: string) => {
    let blob: File | undefined;
    try {
      if (file) {
        const href = file.local ?? (file.id ? await fileUrl(fromCid, file) : null);
        if (!href) throw new Error("This attachment is still sending.");
        blob = new File([await (await fetch(href)).blob()], file.name, { type: file.type });
      }
    } catch (e) { flash(e instanceof Error ? e.message : "Couldn't forward this attachment."); return; }
    for (const c of targets) {
      if (!threadsRef.current[c.id]) {
        setThreads((t) => (t[c.id] ? t : { ...t, [c.id]: { items: [], hasMore: false, loaded: false } }));
        threadsRef.current = { ...threadsRef.current, [c.id]: { items: [], hasMore: false, loaded: false } };
      }
      await sendTo(c.id, text, null, blob);
    }
    flash(targets.length === 1 ? `Forwarded to ${titleOf(targets[0], me)}.` : `Forwarded to ${targets.length} chats.`);
  }, [sendTo, flash, me]);

  const retry = useCallback(async (m: Message) => {
    const p = plainRef.current[m.id];
    if (!p || !("text" in p)) return;
    upsertMessage(m.conversationId, { ...m, status: "sending" });
    try { await deliver(m.conversationId, m.id, p.text, m.replyTo); } catch (e) {
      upsertMessage(m.conversationId, { ...m, status: "failed" });
      flash(e instanceof Error ? e.message : "Message not sent.");
    }
  }, [deliver, upsertMessage, flash]);

  /** Delete a message for me (gone from my view only) or for everyone ("This message was deleted"). */
  const remove = useCallback(async (m: Message, scope: "me" | "everyone") => {
    const drop = () => setThreads((t) => ({ ...t, [m.conversationId]: { ...t[m.conversationId], items: t[m.conversationId].items.filter((x) => x.id !== m.id) } }));
    if (m.status) { drop(); return; } // never reached the server
    await chatApi.deleteMessage(m.conversationId, m.id, scope);
    if (scope === "me") drop();
    else setThreads((t) => ({ ...t, [m.conversationId]: { ...t[m.conversationId], items: t[m.conversationId].items.map((x) => (x.id === m.id ? { ...x, deleted: true, ct: "", iv: "" } : x)) } }));
    soon();
  }, [soon]);

  /** Delete a whole chat for me, or for everyone in it. */
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const removeChat = useCallback(async (c: Conversation, scope: "me" | "everyone") => {
    await chatApi.deleteChat(c.id, scope);
    setConvs((cs) => cs.filter((x) => x.id !== c.id));
    setThreads((t) => { const n = { ...t }; delete n[c.id]; return n; });
    if (activeRef.current === c.id) { setActiveId(null); setInfo(false); }
    flash(scope === "everyone" ? "Chat deleted for everyone." : c.type === "group" ? "You exited and deleted the group." : "Chat deleted.");
    soon(600);
  }, [flash, soon]);
  /** Selected chats (the list's select mode): delete them all for me, one after another, with one message at the end. */
  const removeChats = useCallback(async (cs: Conversation[]) => {
    for (const c of cs) {
      await chatApi.deleteChat(c.id, "me");
      setConvs((list) => list.filter((x) => x.id !== c.id));
      setThreads((t) => { const n = { ...t }; delete n[c.id]; return n; });
      if (activeRef.current === c.id) { setActiveId(null); setInfo(false); }
    }
    flash(cs.length === 1 ? "Chat deleted." : `${cs.length} chats deleted.`);
    soon(600);
  }, [flash, soon]);
  /** Selected chats: mark them all as read. */
  const markChatsRead = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const now = new Date().toISOString();
    setConvs((cs) => cs.map((x) => (ids.includes(x.id) ? { ...x, unread: 0, members: x.members.map((m) => (m.id === me ? { ...m, lastReadAt: now } : m)) } : x)));
    for (const id of ids) void chatApi.read(id).catch(() => undefined);
  }, [me]);
  /** Delete a chat: for me by default; a checkbox deletes it for everyone (one-to-one chats, and groups I run). */
  const deleteChoices = (c: Conversation): { title: string; body: string; me: DeleteChoice; everyone?: EveryoneChoice } => {
    const name = titleOf(c, me);
    const group = c.type === "group";
    const canAll = !group || c.myRole === "admin";
    return {
      title: group ? `Delete “${name}”?` : `Delete chat with ${name}?`,
      body: group
        ? `You will leave this group, and it will be removed from your chat list.${canAll ? "" : " Only group admins can delete it for all members."}`
        : "This chat will be removed from your chat list. It will reappear if you receive a new message.",
      me: { label: group ? "Leave Group" : "Delete", run: () => removeChat(c, "me") },
      everyone: canAll ? {
        label: group ? "Delete for All Members" : "Delete for Everyone",
        hint: group
          ? "The group and its entire message history will be permanently deleted for every member."
          : `All messages will be permanently deleted for you and ${name.split(" ")[0]}.`,
        confirm: group ? "Delete Group" : "Delete for All",
        run: () => removeChat(c, "everyone"),
      } : undefined,
    };
  };

  const lastTyping = useRef(0);
  const typed = useCallback(() => {
    const id = activeRef.current;
    if (!id || Date.now() - lastTyping.current < 3000) return;
    lastTyping.current = Date.now();
    void chatApi.typing(id).catch(() => undefined);
  }, []);

  // ---- starting chats, group changes ----
  const put = useCallback((c: Conversation) => {
    setConvs((cs) => [c, ...cs.filter((x) => x.id !== c.id)].sort(byRecent));
    convsRef.current = [c, ...convsRef.current.filter((x) => x.id !== c.id)];
  }, []);
  const startDirect = useCallback(async (userId: string) => {
    try {
      let c = await chatApi.direct(userId);
      c = (await ring.sync(c).catch(() => null)) ?? c;
      put(c);
      open(c.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not start the chat.");
    }
  }, [ring, put, open, flash]);
  const createGroup = useCallback(async (name: string, ids: string[], description: string) => {
    let c = await chatApi.group(name, ids, description || undefined);
    c = (await ring.sync(c).catch(() => null)) ?? c;
    put(c);
    open(c.id);
  }, [ring, put, open]);
  /** After a change in the info panel: keep the new state, seed / share any new key, reload the messages. */
  const changed = useCallback(async (c: Conversation | null | undefined, reloadMessages = true) => {
    if (!c) { setActiveId(null); setInfo(false); await refresh(); return; }
    c = (await ring.sync(c).catch(() => null)) ?? c;
    put(c);
    if (reloadMessages) {
      setThreads((t) => { const n = { ...t }; delete n[c!.id]; return n; });
      threadsRef.current = { ...threadsRef.current, [c.id]: { items: [], hasMore: false, loaded: false } };
      await openThread(c.id);
    }
  }, [ring, put, refresh, openThread]);

  const notificationsAllowed = typeof Notification !== "undefined" && Notification.permission === "granted";
  const askNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") return flash("This browser cannot show notifications.");
    const r = await Notification.requestPermission();
    flash(r === "granted" ? "Notifications are on." : "Notifications are blocked for this site.");
    if (r === "granted") void enablePush(); // calls now ring this device even when Palk is closed
  }, [flash]);

  /** One bottom-nav section's page. */
  const renderTab = (which: "chats" | "status" | "calls") =>
    which === "status" ? <StatusTab me={user} version={statusVersion} onError={flash} />
    : which === "calls" ? (
      <CallsPanel me={me} asTab onClose={() => setTab("chats")} onCall={(entry, video) => {
        const c = convsRef.current.find((x) => x.id === entry.conversationId);
        if (c) callRef.current?.start(c, video); else flash("Open a chat with them to call.");
      }} />
    ) : (
      <Sidebar user={user} convs={convs} loaded={loaded} error={loadError} plain={plain} typing={typing} activeId={activeId} onOpen={open} onStartDirect={(id) => void startDirect(id)}
            onNewChat={() => setPanel("chat")} onNewGroup={() => setPanel("group")} onProfile={() => setPanel("profile")} fullScreen={fullScreen} onTheme={() => setPanel("theme")} onBlocked={() => setPanel("blocked")} onLinkDevice={() => { setLinkId(null); setPanel("link"); }} light={light} setLight={setLight} onLock={onLock} onSignOut={() => { void disablePush().finally(onSignOut); }}
            onDeleteChat={setDeleting} onDeleteChats={removeChats} onMarkRead={markChatsRead} notificationsAllowed={notificationsAllowed} onAskNotifications={() => void askNotifications()} />
    );

  /** Blocks or unblocks someone, then marks my one-to-one chat with them. */
  const setBlocked = async (userId: string, on: boolean) => {
    if (!userId) return;
    await (on ? chatApi.block(userId) : chatApi.unblock(userId));
    setConvs((cs) => cs.map((c) => (c.type === "direct" && otherOf(c, me)?.id === userId ? { ...c, blockedByMe: on } : c)));
    flash(on ? "Contact blocked." : "Contact unblocked.");
  };

  return (
    <div data-kb={kb ? "" : undefined} className="group/app flex h-[100dvh] w-full overflow-hidden bg-canvas pt-[max(env(safe-area-inset-top),12px)] md:pt-0"
      style={kb ? { position: "fixed", left: 0, right: 0, top: kb.top, height: kb.height } : undefined}>
      <aside className={cn("pw-side relative h-full w-full shrink-0 flex-col border-r border-overlay/10 bg-canvas md:flex md:w-[360px] lg:w-[400px]", activeId ? "hidden" : "flex")}>
        {panel === "profile" ? (
          <ProfilePanel user={user} onClose={() => setPanel(null)} onSaved={onUserChange} />
        ) : panel === "theme" ? (
          <ChatThemePanel onClose={() => setPanel(null)} />
        ) : panel === "link" ? (
          <LinkDevicePanel initialId={linkId} onClose={() => { setPanel(null); setLinkId(null); }} />
        ) : panel === "blocked" ? (
          <BlockedPanel onClose={() => setPanel(null)} onUnblock={(id) => setBlocked(id, false)} />
        ) : panel ? (
          <NewChat mode={panel} me={me} onClose={() => setPanel(null)} onMode={setPanel} onPick={(id) => void startDirect(id)} onCreateGroup={createGroup} />
        ) : (
          // the open section, and while a swipe is under way the next one beside it (as in To do)
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div ref={pagesRef} className="relative h-full">
              {[{ t: tab, isPeek: false }, ...(peek && peek.tab !== tab ? [{ t: peek.tab, isPeek: true }] : [])].map(({ t: pt, isPeek }) => (
                <div key={pt} aria-hidden={isPeek || undefined} {...(isPeek ? ({ inert: "" } as Record<string, string>) : {})}
                  className={isPeek ? "pw-peek pointer-events-none absolute top-0 h-full w-full" : "h-full"}
                  style={isPeek && peek ? { left: peek.dir > 0 ? `calc(100% + ${PAGE_GAP}px)` : `calc(-100% - ${PAGE_GAP}px)` } : undefined}>
                  {renderTab(pt)}
                </div>
              ))}
            </div>
          </div>
        )}
        {!panel && <BottomNav tab={tab} onTab={setTab} unread={convs.filter((c) => c.unread > 0).length} />}
      </aside>

      <section className={cn("relative h-full min-w-0 flex-1 flex-col", activeId ? "flex" : "hidden md:flex")}>
        {active ? (
          <ChatWindow key={active.id} onCall={(video) => callRef.current?.start(active, video)} onReport={() => setReporting(active)} onBlock={(on) => (on ? setBlocking(active) : void setBlocked(otherOf(active, me)?.id ?? "", false).catch((e) => flash(e instanceof Error ? e.message : "Could not unblock.")))} conv={active} me={me} thread={threads[active.id]} plain={plain} typing={typing[active.id] ?? {}} hasKey={!!ring.get(active.id, active.epoch)}
            onBack={() => { setActiveId(null); setInfo(false); }} onInfo={() => setInfo(true)} chats={convs} onForward={(cs, text, file) => forward(cs, text, file, active.id)} onSend={send} onRetry={(m) => void retry(m)} onDelete={remove} onDeleteChat={() => setDeleting(active)}
            onOlder={() => loadOlder(active.id)} onTyping={typed} onCopied={() => flash("Message copied.")} />
        ) : (
          <div className="chat-wallpaper chat-aurora flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Logo size="lg" />
            <p className="max-w-sm text-sm text-ink-muted">Send and receive messages with anyone on Pacewise. Pick a chat, or start a new one.</p>
            <p className="absolute bottom-8 flex items-center gap-1.5 text-xs text-ink-faint"><Lock className="h-3 w-3" /> Your personal messages are end-to-end encrypted</p>
          </div>
        )}
      </section>

      {info && active && (
        <InfoPanel conv={active} me={me} identity={identity} onClose={() => setInfo(false)} onMessage={(id) => { setInfo(false); void startDirect(id); }} onChanged={changed} onError={flash} onDeleteChat={() => setDeleting(active)} onReport={() => setReporting(active)} />
      )}

      {deleting && <DeleteDialog {...deleteChoices(deleting)} onClose={() => setDeleting(null)} />}
      {blocking && (
        <DeleteDialog title={`Block ${titleOf(blocking, me)}?`} body="Blocked contacts can't message or call you, and you can't message or call them. They won't be told." busyLabel="Blocking…"
          me={{ label: "Block", run: () => setBlocked(otherOf(blocking, me)?.id ?? "", true) }} onClose={() => setBlocking(null)} />
      )}
      {reporting && <ReportDialog conv={reporting} me={me} recentFrom={(u) => recentFrom(reporting.id, u)} onClose={() => setReporting(null)} onDone={flash} onDeleteChat={() => removeChat(reporting, "me")} />}
      <CallLayer ref={callRef} me={me} convs={() => convsRef.current} onError={flash} />
      {toast && (
        <div role="status" className="glass-in fixed bottom-6 left-1/2 z-[150] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-canvas shadow-themed">{toast}</div>
      )}
      <span className="sr-only" aria-live="polite">{active ? `Chat with ${titleOf(active, me)}` : ""}</span>
    </div>
  );
}
