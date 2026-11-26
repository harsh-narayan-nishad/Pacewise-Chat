import { api, session, type User } from "@/lib/api";

/**
 * Link a device with a QR code (backend: modules/auth/auth.link.ts). The QR code holds a Palk address with the
 * request's public id, so a phone's own camera app can open it too; only the new device knows the secret that
 * collects the session.
 */
export const linkApi = {
  start: (device: string) => api<{ id: string; secret: string; expiresInSeconds: number }>("/auth/link/start", { method: "POST", body: { device }, noAuth: true }),
  poll: (id: string, secret: string) =>
    api<{ status: "pending" | "scanned" | "expired" } | { status: "approved"; user: User; accessToken: string; refreshToken: string }>("/auth/link/poll", { method: "POST", body: { id, secret }, noAuth: true }),
  scan: (id: string) => api<{ device: string; expiresAt: string }>("/auth/link/scan", { method: "POST", body: { id } }),
  approve: (id: string) => api<{ linked: boolean }>("/auth/link/approve", { method: "POST", body: { id } }),
};

/** What goes in the QR code: this site's address with ?link=<id>. */
export const linkUrl = (id: string) => `${window.location.origin}/?link=${encodeURIComponent(id)}`;

/** The link id from a scanned QR code (a Palk address with ?link=…), or null when it is something else. */
export function linkIdFrom(text: string): string | null {
  try {
    const u = new URL(text.trim());
    const id = u.searchParams.get("link");
    return id && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
  } catch { return null; }
}

/** "Chrome on macOS", "Safari on iPhone" …: shown on the phone before it approves. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Keeps the session the phone approved, like a normal sign-in. */
export function keepLinkedSession(r: { accessToken: string; refreshToken: string }) {
  session.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
}
