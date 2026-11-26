/*
 * Palk's service worker: rings for incoming calls when Palk is closed (Web Push).
 *  - "call": an incoming-call notification that stays until answered, declined or missed, and vibrates like a ring.
 *    If Palk is open and on screen, it rings there itself, so nothing is shown here.
 *  - "call-end": the caller hung up, or the call was answered / declined on another device: the ringing notification
 *    goes, replaced by "Missed call" when it was missed.
 * Answer opens Palk straight into the call; Decline declines it without opening Palk (with the one-time pass the
 * push carried, since a service worker has no sign-in of its own).
 */
/** The Palk backend (given when Palk registers this worker: /sw.js?api=…). */
const API = new URL(self.location.href).searchParams.get("api");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function visibleClient() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.find((c) => c.visibilityState === "visible") || null;
}

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* not ours */ }
  event.waitUntil((async () => {
    if (d.type === "call") {
      if (await visibleClient()) return; // Palk is on screen: it rings itself
      await self.registration.showNotification(d.group ? `${d.name} is adding you to a call` : `${d.name} is calling`, {
        body: `Palk · incoming ${d.video ? "video" : "voice"} call`,
        tag: `call-${d.callId}`,
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [700, 300, 700, 300, 700, 300, 700, 300, 700],
        icon: "/icon.svg",
        badge: "/icon.svg",
        data: d,
        actions: [{ action: "answer", title: "Answer" }, { action: "decline", title: "Decline" }],
      });
      return;
    }
    if (d.type === "call-end") {
      const open = await self.registration.getNotifications({ tag: `call-${d.callId}` });
      open.forEach((n) => n.close());
      if (d.missed && d.name && !(await visibleClient())) {
        await self.registration.showNotification(`Missed ${d.video ? "video" : "voice"} call`, {
          body: `${d.name} · Palk`, tag: `missed-${d.callId}`, icon: "/icon.svg", badge: "/icon.svg", data: { type: "missed" },
        });
      }
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const d = n.data || {};
  n.close();
  event.waitUntil((async () => {
    if (d.type === "call" && event.action === "decline") {
      // decline without opening Palk
      const api = API;
      if (api) await fetch(`${api}/chat-push/decline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callId: d.callId, userId: d.userId, conversationId: d.conversationId, pass: d.pass }) }).catch(() => undefined);
      return;
    }
    const url = d.type === "call" ? `/?call=${encodeURIComponent(d.callId)}${event.action === "answer" ? "&answer=1" : ""}` : "/";
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) { await open.focus(); await open.navigate(url).catch(() => undefined); return; }
    await self.clients.openWindow(url);
  })());
});
