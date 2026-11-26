"use client";
import { useEffect, useState } from "react";

/**
 * Full screen, exactly as in To do (todo/components/HamburgerMenu.tsx): the whole app, where the browser allows it
 * (not iPhone Safari, so the menu row is hidden there).
 *
 * Phones: full screen is sticky. Once turned on it stays wanted (remembered across reloads) until turned off in the
 * menu; if the browser leaves it (back gesture, Esc), the next tap anywhere goes back in. Browsers only allow entering
 * on a tap, so it cannot be forced sooner, and the tap still does what it normally does.
 */
const FULL_KEY = "pacewise-chat-fullscreen";
type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
const isPhone = () => window.matchMedia("(max-width: 767px)").matches;

function enterFull() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try { void (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.())?.catch(() => {}); } catch { /* the browser said no */ }
}
function exitFull() {
  const d = document as FsDoc;
  try { if (d.fullscreenElement || d.webkitFullscreenElement) void (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.())?.catch(() => {}); } catch { /* already out */ }
}

export function useFullScreen() {
  const [canFull, setCanFull] = useState(false);
  const [full, setFull] = useState(false);
  const [keepFull, setKeepFull] = useState(false);

  useEffect(() => {
    const d = document as FsDoc;
    setCanFull(!!(d.fullscreenEnabled || d.webkitFullscreenEnabled));
    const sync = () => setFull(!!(d.fullscreenElement || d.webkitFullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => { document.removeEventListener("fullscreenchange", sync); document.removeEventListener("webkitfullscreenchange", sync); };
  }, []);
  useEffect(() => { try { setKeepFull(localStorage.getItem(FULL_KEY) === "1" && isPhone()); } catch { /* no storage */ } }, []);
  useEffect(() => {
    if (!keepFull || full) return;
    // Not from inside the menu, so turning it off there is not undone by the same tap.
    const back = (e: Event) => { if (isPhone() && !(e.target instanceof Element && e.target.closest('[role="menu"][aria-label="Menu"]'))) enterFull(); };
    // Any touch, tap, key or scroll (a browser allows full screen only right after the person's own touch or key,
    // so a scroll gets it from the swipe's touch).
    const events = ["pointerdown", "pointerup", "touchstart", "touchend", "click", "keydown", "scroll", "wheel"] as const;
    events.forEach((t) => document.addEventListener(t, back, { capture: true, passive: true }));
    return () => events.forEach((t) => document.removeEventListener(t, back, { capture: true }));
  }, [keepFull, full]);

  const toggleFull = () => {
    if (isPhone()) {
      const on = !keepFull;
      setKeepFull(on);
      try { if (on) localStorage.setItem(FULL_KEY, "1"); else localStorage.removeItem(FULL_KEY); } catch { /* no storage */ }
      if (on) enterFull(); else exitFull();
      return;
    }
    if (full) exitFull(); else enterFull();
  };
  return { canFull, on: full || keepFull, toggleFull };
}
