import { api, API_BASE, authedFetch, session } from "@/lib/api";
import { whenBackendChosen } from "@/lib/backend";
import type { StoredKeys } from "@/lib/crypto";

export interface Person {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  online: boolean;
  lastSeenAt: string | null;
  publicKey: string | null;
  keyVersion: number;
}
export interface Member extends Person {
  role: "admin" | "member";
  joinedAt: string | null;
  lastReadAt: string | null;
  lastDeliveredAt: string | null;
  pending: number[];
}
export interface Wrap { epoch: number; by: string; byPub: string; iv: string; data: string }
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  kind: "text" | "system";
  epoch: number;
  iv: string;
  ct: string;
  replyTo: string | null;
  event: { action: string; targets: string[]; name: string } | null;
  deleted: boolean;
  createdAt: string;
  /** Client only: still on its way, or failed to send. */
  status?: "sending" | "failed";
}
export interface Conversation {
  id: string;
  type: "direct" | "group";
  name: string;
  description: string;
  createdBy: string;
  epoch: number;
  createdAt: string;
  lastMessageAt: string;
  myRole: "admin" | "member";
  clearedAt: string | null;
  myKeys: Wrap[];
  members: Member[];
  unread: number;
  lastMessage: Message | null;
  /** A one-to-one chat with someone I blocked. */
  blockedByMe?: boolean;
}
/** One entry in my call history. */
export interface CallLogEntry {
  id: string; callId: string; conversationId: string; direction: "out" | "in"; video: boolean;
  outcome: "ringing" | "answered" | "missed" | "declined" | "busy" | "unanswered" | "cancelled";
  startedAt: string; answeredAt: string | null; endedAt: string | null; seconds: number; peers: CallPerson[];
}
export interface ChatEvent { type: "message" | "message-deleted" | "conversation" | "read" | "typing" | "keys" | "call"; conversationId?: string; from?: string; data?: unknown }
/** One audio-call message between the two browsers (relayed by the server, never stored). */
export interface CallPerson { id: string; name: string; username?: string; avatarUrl: string | null }
export interface CallSignal {
  callId: string; kind: "offer" | "answer" | "ice" | "end" | "decline" | "busy" | "invite" | "ringing"; video?: boolean; sdp?: string; candidate?: RTCIceCandidateInit;
  /** Between two people in a call: who it is for (none on "end": I left). */
  to?: string;
  /** On "invite": who is in the call. On an "offer" inside a call: who is offering. */
  people?: CallPerson[]; who?: CallPerson | null;
}
export type PeerSignal = Pick<CallSignal, "kind" | "to" | "video" | "sdp" | "candidate">;
export type ReportReason = "spam" | "harassment" | "inappropriate" | "impersonation" | "other";

const c = (id: string) => `/chat/conversations/${encodeURIComponent(id)}`;

export const chatApi = {
  myKeys: () => api<{ keys: StoredKeys | null }>("/chat/keys"),
  setKeys: (body: Omit<StoredKeys, "version"> & { reset?: boolean }) => api<{ version: number }>("/chat/keys", { method: "POST", body }),
  users: (q: string, skip = 0, limit = 30) => api<{ items: Person[]; hasMore: boolean }>("/chat/users", { query: { q, skip, limit } }),
  conversations: () => api<Conversation[]>("/chat/conversations"),
  blocks: () => api<(Person & { blockedAt: string | null })[]>("/chat/blocks"),
  block: (userId: string) => api<{ blocked: boolean }>(`/chat/blocks/${encodeURIComponent(userId)}`, { method: "PUT" }),
  unblock: (userId: string) => api<{ blocked: boolean }>(`/chat/blocks/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  conversation: (id: string) => api<Conversation>(c(id)),
  direct: (userId: string) => api<Conversation>("/chat/conversations", { method: "POST", body: { type: "direct", userId } }),
  group: (name: string, memberIds: string[], description?: string) => api<Conversation>("/chat/conversations", { method: "POST", body: { type: "group", name, memberIds, description } }),
  update: (id: string, body: { name?: string; description?: string }) => api<Conversation>(c(id), { method: "PATCH", body }),
  /** Delete a chat for me (groups: exit too) or for everyone in it. */
  deleteChat: (id: string, scope: "me" | "everyone") => api<void>(c(id), { method: "DELETE", query: { scope } }),
  clear: (id: string) => api<Conversation>(`${c(id)}/clear`, { method: "POST" }),
  addMembers: (id: string, userIds: string[]) => api<Conversation>(`${c(id)}/members`, { method: "POST", body: { userIds } }),
  removeMember: (id: string, userId: string) => api<Conversation | undefined>(`${c(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  setAdmin: (id: string, userId: string, admin: boolean) => api<Conversation>(`${c(id)}/members/${encodeURIComponent(userId)}/admin`, { method: "POST", body: { admin } }),
  shareKeys: (id: string, body: { epoch: number; seed?: boolean; byPub: string; wraps: { userId: string; iv: string; data: string }[] }) => api<Conversation>(`${c(id)}/keys`, { method: "POST", body }),
  messages: (id: string, q: { before?: string; after?: string; limit?: number } = {}) => api<{ items: Message[]; hasMore: boolean }>(`${c(id)}/messages`, { query: q }),
  send: (id: string, body: { id: string; epoch: number; iv: string; ct: string; replyTo?: string | null; fileId?: string | null }) => api<Message>(`${c(id)}/messages`, { method: "POST", body }),
  deleteMessage: (id: string, messageId: string, scope: "me" | "everyone" = "everyone") => api<void>(`${c(id)}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE", query: { scope } }),
  read: (id: string, at?: string) => api<void>(`${c(id)}/read`, { method: "POST", body: at ? { at } : {} }),
  typing: (id: string) => api<void>(`${c(id)}/typing`, { method: "POST" }),
  /** Attachments: upload the encrypted bytes, or download them again (decrypted in lib/files.ts). */
  uploadFile: async (id: string, data: ArrayBuffer) =>
    (await (await authedFetch(`${c(id)}/files`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: data })).json()) as { fileId: string; size: number },
  downloadFile: async (id: string, fileId: string) => (await authedFetch(`${c(id)}/files/${encodeURIComponent(fileId)}`)).arrayBuffer(),
  /** Audio calls: send a call message to the other person in a one-to-one chat. */
  call: (id: string, body: CallSignal) => api<void>(`${c(id)}/call`, { method: "POST", body }),
  /** Calls with more people: setup messages to one person in the call, and joining a call I was added to. */
  peerCall: (callId: string, body: PeerSignal) => api<void>(`/chat/calls/${encodeURIComponent(callId)}/signal`, { method: "POST", body }),
  joinCall: (callId: string) => api<{ people: CallPerson[] }>(`/chat/calls/${encodeURIComponent(callId)}/join`, { method: "POST" }),
  /** My call history (Calls), newest first; and clearing it (mine only). */
  calls: () => api<CallLogEntry[]>("/chat/calls"),
  clearCalls: () => api<void>("/chat/calls", { method: "DELETE" }),
  /** Report a person (spam, harassment …): it goes to the Pacewise admins' Reports. */
  report: (userId: string, reason: ReportReason, details: string) => api<{ id: string; status: string }>("/reports", { method: "POST", body: { targetType: "user", targetId: userId, reason, details } }),
};

/** The live event stream's address (EventSource cannot send headers, so the token goes in the query). */
export async function streamUrl(): Promise<string | null> {
  const base = await whenBackendChosen().catch(() => API_BASE);
  const s = session.get();
  return s ? `${base}/chat/stream?token=${encodeURIComponent(s.accessToken)}` : null;
}

// ---- labels ----
const pad = (n: number) => String(n).padStart(2, "0");
export const clockOf = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (iso: string) => Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);

/** The chat list's time column: "14:02", "Yesterday", "Tuesday", "12/11/2026". */
export function listTime(iso: string): string {
  const n = daysAgo(iso);
  if (n <= 0) return clockOf(iso);
  if (n === 1) return "Yesterday";
  if (n < 7) return new Date(iso).toLocaleDateString("en-GB", { weekday: "long" });
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** The chip between days in a chat: "Today", "Yesterday", "Tuesday", "12 November 2026". */
export function dayChip(iso: string): string {
  const n = daysAgo(iso);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n < 7) return new Date(iso).toLocaleDateString("en-GB", { weekday: "long" });
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
export const sameDay = (a: string, b: string) => startOfDay(new Date(a)) === startOfDay(new Date(b));

/** "online", "last seen today at 14:02", "last seen yesterday at 09:15", "last seen 12 Nov at 18:40". */
export function presenceLabel(p: { online: boolean; lastSeenAt: string | null }): string {
  if (p.online) return "online";
  if (!p.lastSeenAt) return "last seen a long time ago";
  const n = daysAgo(p.lastSeenAt);
  const at = clockOf(p.lastSeenAt);
  if (n <= 0) return `last seen today at ${at}`;
  if (n === 1) return `last seen yesterday at ${at}`;
  const d = new Date(p.lastSeenAt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `last seen ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })} at ${at}`;
}

/** "You" for me, otherwise the name (first name only with full = false). */
export const nameOf = (members: { id: string; name: string }[], id: string, me: string, full = true) => {
  if (id === me) return "You";
  const n = members.find((m) => m.id === id)?.name ?? "Someone";
  return full ? n : n.split(" ")[0];
};

/** What a system message says: "Harsh created group "NEET 2027"", "You added Akash and Ankit". */
export function systemText(m: Message, members: { id: string; name: string }[], me: string): string {
  const who = nameOf(members, m.senderId, me);
  const list = (ids: string[]) => {
    const names = ids.map((id) => (id === me ? "you" : nameOf(members, id, me)));
    return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  };
  const e = m.event;
  switch (e?.action) {
    case "created": return `${who} created group "${e.name}"`;
    case "added": return `${who} added ${list(e.targets)}`;
    case "removed": return `${who} removed ${list(e.targets)}`;
    case "left": return `${who} left`;
    case "renamed": return `${who} changed the group name to "${e.name}"`;
    case "described": return `${who} changed the group description`;
    case "admin": return `${who} made ${list(e.targets)} an admin`;
    default: return `${who} updated the group`;
  }
}

/** Each sender in a group gets their own name colour. */
/** Avatars and group names: nine hues spaced round the colour wheel at matched lightness and saturation, so none
 * shouts louder than another and white initials stay readable on every one. */
const NAME_COLORS = ["#E5484D", "#E54666", "#AB4ABA", "#6E56CF", "#3E63DD", "#0D74CE", "#12A594", "#30A46C", "#EF5F00"];
export function nameColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

/** The name a chat shows: the group's name, the other person's, or "You" for notes to self. */
export function titleOf(c: Conversation, me: string): string {
  if (c.type === "group") return c.name;
  const other = c.members.find((m) => m.id !== me);
  return other ? other.name : "You (message yourself)";
}
export const otherOf = (c: Conversation, me: string) => (c.type === "direct" ? c.members.find((m) => m.id !== me) ?? c.members[0] : undefined);
