"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { RefreshCw, Smartphone } from "lucide-react";
import { PalkMark } from "@/components/Logo";
import { ButtonWheel } from "@/components/WheelSpinner";
import type { User } from "@/lib/api";
import { deviceName, keepLinkedSession, linkApi, linkUrl } from "@/lib/link";
import { cn } from "@/lib/utils";

/**
 * Sign in by scanning a QR code with a phone where Palk is already signed in (as WhatsApp Web does). The code is
 * renewed every 2 minutes while the page is open; once the phone approves, this browser signs in.
 */
export function QrSignIn({ onSignedIn, className }: { onSignedIn: (u: User) => void; className?: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "scanned" | "signing" | "expired" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const req = useRef<{ id: string; secret: string; until: number } | null>(null);
  const [round, setRound] = useState(0);
  const tries = useRef(0);

  // a new request (and code) each round
  useEffect(() => {
    let live = true;
    setState("loading");
    linkApi.start(deviceName()).then(async (r) => {
      if (!live) return;
      req.current = { id: r.id, secret: r.secret, until: Date.now() + r.expiresInSeconds * 1000 };
      tries.current = 0;
      setQr(await QRCode.toDataURL(linkUrl(r.id), { margin: 1, width: 560, errorCorrectionLevel: "M", color: { dark: "#0B0C0F", light: "#FFFFFF" } }));
      setState("ready");
    }, (e) => { if (live) { setError(e instanceof Error ? e.message : "Could not make a QR code."); setState("error"); } });
    return () => { live = false; };
  }, [round]);

  // ask every 2 s whether the phone has approved; a fresh code when this one runs out (only while the page is seen)
  useEffect(() => {
    if (state !== "ready" && state !== "scanned") return;
    const t = window.setInterval(async () => {
      const r = req.current;
      if (!r || document.visibilityState !== "visible") return;
      if (Date.now() > r.until) { if (tries.current++ < 5) setRound((n) => n + 1); else setState("expired"); return; }
      try {
        const res = await linkApi.poll(r.id, r.secret);
        if (res.status === "approved") {
          window.clearInterval(t);
          setState("signing");
          keepLinkedSession(res);
          onSignedIn(res.user);
        } else if (res.status === "scanned") setState("scanned");
        else if (res.status === "expired") setRound((n) => n + 1);
      } catch { /* offline for a moment: try again next tick */ }
    }, 2000);
    return () => window.clearInterval(t);
  }, [state, onSignedIn]);

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div className="relative grid h-[264px] w-[264px] place-items-center rounded-[22px] bg-white p-3 shadow-[0_10px_40px_rgba(0,0,0,0.18)]">
        {qr && state !== "error" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR code to sign in to Palk" className={cn("h-full w-full transition-[filter,opacity]", (state === "loading" || state === "expired" || state === "scanned" || state === "signing") && "opacity-20 blur-[2px]")} />
        )}
        {qr && state === "ready" && <span className="absolute grid h-12 w-12 place-items-center rounded-[12px] bg-white p-1"><PalkMark size={40} /></span>}
        {(state === "loading" || state === "signing") && <span className="absolute text-[#0B0C0F]"><ButtonWheel size={28} /></span>}
        {state === "scanned" && (
          <span className="absolute flex flex-col items-center gap-2 px-6 text-[15px] font-medium text-[#0B0C0F]"><Smartphone className="h-7 w-7" />Approve on your phone</span>
        )}
        {(state === "expired" || state === "error") && (
          <button type="button" onClick={() => { setError(null); setRound((n) => n + 1); }} className="absolute flex flex-col items-center gap-2 rounded-2xl px-5 py-4 text-[15px] font-medium text-[#0B0C0F]">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#0B7F79] text-white"><RefreshCw className="h-5 w-5" /></span>
            {state === "expired" ? "Click to reload the QR code" : "Try again"}
          </button>
        )}
      </div>
      {error && <p className="mt-3 max-w-[280px] text-sm text-accent-extreme" role="alert">{error}</p>}
      <h2 className="mt-7 text-[19px] font-semibold text-ink">Sign in with a QR code</h2>
      <ol className="mt-3 max-w-[300px] space-y-1.5 text-left text-[14px] leading-snug text-ink-muted">
        <li>1. Open Palk on your phone.</li>
        <li>2. Tap <span className="text-ink">⋯</span> and choose <span className="text-ink">Link a device</span>.</li>
        <li>3. Point your phone at this code.</li>
      </ol>
    </div>
  );
}
