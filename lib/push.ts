import { api, API_BASE } from "@/lib/api";

/**
 * Incoming calls ring this device even when Palk is closed: Palk's service worker (public/sw.js) and Web Push.
 * Needs notifications allowed; on phones, browsers only deliver these to a page served over https (or localhost),
 * and iPhones only to Palk added to the Home Screen (iOS 16.4+).
 */
const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function worker() {
  return navigator.serviceWorker.register(`/sw.js?api=${encodeURIComponent(API_BASE)}`);
}

/** Turns call pushes on for this device (quietly does nothing where they are not possible). */
export async function enablePush(): Promise<void> {
  if (!supported() || Notification.permission !== "granted") return;
  try {
    const reg = await worker();
    await navigator.serviceWorker.ready;
    const { key } = await api<{ key: string }>("/chat/push/key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource });
    const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (j.endpoint && j.keys?.p256dh && j.keys.auth) await api("/chat/push/subscribe", { method: "POST", body: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } } });
  } catch { /* push not available here (no https, blocked, or not set up on the server) */ }
}

/** Signing out: this device stops getting pushes for this account. */
export async function disablePush(): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api("/chat/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  } catch { /* nothing to undo */ }
}
