"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { NewChat } from "@/components/NewChat";
import { ChatWindow } from "@/components/ChatWindow";
import { InfoPanel } from "@/components/InfoPanel";
import { Logo } from "@/components/Logo";
import { DeleteDialog, type DeleteChoice } from "@/components/DeleteDialog";
import { CallLayer, type CallHandle } from "@/components/CallLayer";
import { ReportDialog } from "@/components/ReportDialog";
import { ApiError, type User } from "@/lib/api";
import { chatApi, streamUrl, titleOf, type ChatEvent, type Conversation, type Message } from "@/lib/chat";
import { decryptMessage, encryptFile, encryptMessage, type FileMeta, type Identity } from "@/lib/crypto";
import { fileLabel } from "@/lib/files";
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
export function Messenger({ user, identity, light, setLight, onLock, onSignOut }: {
  user: User; identity: Identity; light: boolean; setLight: (v: boolean) => void; onLock: () => void; onSignOut: () => void;
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
  const [panel, setPanel] = useState<null | "chat" | "group">(null);
  const [info, setInfo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const convsRef = useRef(convs); convsRef.current = convs;
  const threadsRef = useRef(threads); threadsRef.current = threads;
  const plainRef = useRef(plain); plainRef.current = plain;
  const activeRef = useRef(activeId); activeRef.current = activeId;
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
  useEffect(() => { document.title = unread ? `(${unread}) Pacewise Chat` : "Pacewise Chat"; }, [unread]);

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

  const send = useCallback(async (text: string, replyTo: string | null, file?: File) => {
    const c = convsRef.current.find((x) => x.id === activeRef.current);
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
  const deleteChoices = (c: Conversation): { title: string; body: string; choices: DeleteChoice[] } => {
    const name = titleOf(c, me);
    const everyone = c.type === "direct" || c.myRole === "admin";
    const choices: DeleteChoice[] = [];
    if (everyone) choices.push({ label: "Delete for everyone", run: () => removeChat(c, "everyone") });
    choices.push({ label: c.type === "group" ? "Exit and delete for me" : "Delete for me", run: () => removeChat(c, "me") });
    const body = c.type === "group"
      ? `Delete for me: you exit the group and it leaves your list.${everyone ? " Delete for everyone: the group and all its messages are deleted for every member." : " Only group admins can delete it for everyone."}`
      : "Delete for me: it leaves your list (it comes back if a new message arrives). Delete for everyone: the chat and all its messages are deleted for both of you.";
    return { title: c.type === "group" ? `Delete "${name}"?` : `Delete chat with ${name}?`, body, choices };
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
  }, [flash]);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-canvas">
      <aside className={cn("relative h-full w-full shrink-0 flex-col border-r border-overlay/10 bg-canvas md:flex md:w-[360px] lg:w-[400px]", activeId ? "hidden" : "flex")}>
        {panel ? (
          <NewChat mode={panel} me={me} onClose={() => setPanel(null)} onMode={setPanel} onPick={(id) => void startDirect(id)} onCreateGroup={createGroup} />
        ) : (
          <Sidebar user={user} convs={convs} loaded={loaded} error={loadError} plain={plain} typing={typing} activeId={activeId} onOpen={open} onStartDirect={(id) => void startDirect(id)}
            onNewChat={() => setPanel("chat")} onNewGroup={() => setPanel("group")} light={light} setLight={setLight} onLock={onLock} onSignOut={onSignOut}
            onDeleteChat={setDeleting} notificationsAllowed={notificationsAllowed} onAskNotifications={() => void askNotifications()} />
        )}
      </aside>

      <section className={cn("relative h-full min-w-0 flex-1 flex-col", activeId ? "flex" : "hidden md:flex")}>
        {active ? (
          <ChatWindow key={active.id} onCall={(video) => callRef.current?.start(active, video)} onReport={() => setReporting(active)} conv={active} me={me} thread={threads[active.id]} plain={plain} typing={typing[active.id] ?? {}} hasKey={!!ring.get(active.id, active.epoch)}
            onBack={() => { setActiveId(null); setInfo(false); }} onInfo={() => setInfo(true)} onSend={send} onRetry={(m) => void retry(m)} onDelete={remove} onDeleteChat={() => setDeleting(active)}
            onOlder={() => loadOlder(active.id)} onTyping={typed} onCopied={() => flash("Message copied.")} />
        ) : (
          <div className="chat-wallpaper flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
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
      {reporting && <ReportDialog conv={reporting} me={me} recentFrom={(u) => recentFrom(reporting.id, u)} onClose={() => setReporting(null)} onDone={flash} onDeleteChat={() => removeChat(reporting, "me")} />}
      <CallLayer ref={callRef} me={me} convs={() => convsRef.current} onError={flash} />
      {toast && (
        <div role="status" className="glass-in fixed bottom-6 left-1/2 z-[150] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-canvas shadow-themed">{toast}</div>
      )}
      <span className="sr-only" aria-live="polite">{active ? `Chat with ${titleOf(active, me)}` : ""}</span>
    </div>
  );
}
