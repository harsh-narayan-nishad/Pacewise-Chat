"use client";

import { useEffect, useRef } from "react";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const BTN = "flex h-12 w-full items-center justify-center gap-3 rounded-none border border-overlay/15 bg-white text-base font-medium text-[#1f1f1f] transition-colors  disabled:opacity-60";

interface GoogleId {
  initialize: (o: { client_id: string; callback: (r: { credential?: string }) => void }) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
}
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-16.6z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** "Continue with Google" (works once NEXT_PUBLIC_GOOGLE_CLIENT_ID is set; any Pacewise account), "Continue with Apple" (not connected), then an "or" divider. */
export function SocialButtons({ onGoogleToken, onUnavailable, disabled }: { onGoogleToken: (idToken: string) => void; onUnavailable: (message: string) => void; disabled?: boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  const handler = useRef(onGoogleToken);
  handler.current = onGoogleToken;

  useEffect(() => {
    if (!CLIENT_ID || !slot.current) return;
    const el = slot.current;
    const draw = () => {
      const id = window.google?.accounts.id;
      if (!id) return;
      id.initialize({ client_id: CLIENT_ID, callback: (r) => { if (r.credential) handler.current(r.credential); } });
      el.innerHTML = "";
      id.renderButton(el, { type: "standard", theme: "outline", size: "large", shape: "rectangular", text: "continue_with", logo_alignment: "center", width: Math.min(400, el.clientWidth || 384) });
    };
    if (window.google?.accounts) { draw(); return; }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", draw);
    return () => script?.removeEventListener("load", draw);
  }, []);

  return (
    <div className="mb-2 flex w-full flex-col gap-3">
      {CLIENT_ID ? (
        <div className={`flex h-12 w-full justify-center ${disabled ? "pointer-events-none opacity-60" : ""}`} ref={slot} aria-label="Continue with Google" />
      ) : (
        <button type="button" disabled={disabled} onClick={() => onUnavailable("Google sign-in is not set up yet.")} className={BTN}>
          <GoogleMark /> Continue with Google
        </button>
      )}
      <button type="button" disabled={disabled} onClick={() => onUnavailable("Apple sign-in is not available yet.")} className={BTN}>
        <AppleLogo /> Continue with Apple
      </button>
      <div className="my-2 flex items-center gap-3 text-sm text-ink-muted" role="separator">
        <span className="h-px flex-1 bg-overlay/20" />
        or
        <span className="h-px flex-1 bg-overlay/20" />
      </div>
    </div>
  );
}

/** Apple's logo, as Apple's Sign in with Apple guidelines ask for on this button (in the text colour). */
function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden className="-mt-0.5 shrink-0">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}
