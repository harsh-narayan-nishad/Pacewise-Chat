import { chatApi, type CallLogEntry } from "@/lib/chat";

/**
 * Call history for the chat timeline, held once for the whole app so every chat shows its call cards instantly and
 * identically.
 *  - Loaded at start-up (Messenger) and refreshed when a chat opens or a call ends.
 *  - A call that just ended is added at once from the call screen's own record (`addLocalCall`); when the server's
 *    record arrives it replaces it under the same call id, keeping the start time this device first showed, so the
 *    card never jumps to another place in the chat.
 *  - Subscribers (open chats) are told about every change.
 */
let cache: CallLogEntry[] | null = null;
let inflight: Promise<CallLogEntry[]> | null = null;
const pinnedStart = new Map<string, string>();
const subs = new Set<() => void>();
const publish = () => subs.forEach((f) => f());
const LOCAL_TTL_MS = 60_000;

export const isLocalCall = (c: CallLogEntry) => c.id.startsWith("local-");
export const getCalls = () => cache;
export function subscribeCalls(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

export function loadCalls(force = false): Promise<CallLogEntry[]> {
  if (!inflight || force) {
    const f = chatApi.calls().then((server) => {
      const fixed = server.map((s) => (pinnedStart.has(s.callId) ? { ...s, startedAt: pinnedStart.get(s.callId)! } : s));
      const pending = (cache ?? []).filter((p) => isLocalCall(p) && !server.some((s) => s.callId === p.callId) && Date.now() - Date.parse(p.endedAt ?? p.startedAt) < LOCAL_TTL_MS);
      cache = [...pending, ...fixed];
      publish();
      return cache;
    });
    f.catch(() => { if (inflight === f) inflight = null; });
    inflight = f;
  }
  return inflight;
}

/** A call just ended on this device: show it now, then pick up the server's record. */
export function addLocalCall(entry: CallLogEntry) {
  pinnedStart.set(entry.callId, entry.startedAt);
  if (!(cache ?? []).some((c) => c.callId === entry.callId)) cache = [entry, ...(cache ?? [])];
  publish();
  for (const ms of [1500, 5000]) window.setTimeout(() => void loadCalls(true).catch(() => undefined), ms);
}

/** Calls deleted (some, or all with `null`): gone from every chat at once. */
export function dropCalls(ids: string[] | null) {
  cache = ids === null ? [] : (cache ?? []).filter((c) => !ids.includes(c.id));
  publish();
}
