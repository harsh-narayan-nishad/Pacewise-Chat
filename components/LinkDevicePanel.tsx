"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { ArrowLeft, CheckCircle2, Laptop, ShieldCheck } from "lucide-react";
import { ButtonWheel } from "@/components/WheelSpinner";
import { linkApi, linkIdFrom } from "@/lib/link";

/**
 * Link a device (as in WhatsApp): scan the QR code shown on another device's Palk sign-in page with this device's
 * camera, check which device it is, and approve. That device then signs in to this account. Its chats unlock with the
 * chat passcode there, as after any sign-in: the encryption key never leaves this device.
 */
export function LinkDevicePanel({ onClose, initialId }: { onClose: () => void; initialId?: string | null }) {
  const [step, setStep] = useState<"scan" | "checking" | "confirm" | "linking" | "done">(initialId ? "checking" : "scan");
  const [id, setId] = useState<string | null>(initialId ?? null);
  const [device, setDevice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const stopCamera = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => stopCamera, []);

  /** A code was read: ask the server which device it is. */
  const check = useCallback(async (linkId: string) => {
    stopCamera();
    setId(linkId); setStep("checking"); setError(null);
    try { const r = await linkApi.scan(linkId); setDevice(r.device); setStep("confirm"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not read that QR code."); setStep("scan"); }
  }, []);
  useEffect(() => { if (initialId) void check(initialId); }, [initialId, check]);

  // the camera, reading frames for a Palk QR code
  useEffect(() => {
    if (step !== "scan") return;
    let live = true;
    let raf = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let last = 0;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError("This browser cannot use the camera."); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!live) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play().catch(() => undefined);
      } catch { setError("Allow the camera to scan the QR code."); return; }
      const tick = (now: number) => {
        if (!live) return;
        const v = video.current;
        if (v && ctx && v.readyState >= 2 && now - last > 180) {
          last = now;
          const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * 480) || 480;
          canvas.width = w; canvas.height = h;
          ctx.drawImage(v, 0, 0, w, h);
          const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          const found = code && linkIdFrom(code.data);
          if (found) { void check(found); return; }
          if (code) setError("That QR code isn't a Palk sign-in code.");
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => { live = false; cancelAnimationFrame(raf); stopCamera(); };
  }, [step, check]);

  const approve = async () => {
    if (!id) return;
    setStep("linking"); setError(null);
    try { await linkApi.approve(id); setStep("done"); try { navigator.vibrate?.(15); } catch { /* not supported */ } }
    catch (e) { setError(e instanceof Error ? e.message : "Could not link the device."); setStep("scan"); }
  };

  return (
    <div className="slide-in-left flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-4 px-4">
        <button type="button" onClick={onClose} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-overlay/[0.08]"><ArrowLeft className="h-5 w-5" /></button>
        <h2 className="text-lg text-ink">Link a device</h2>
      </header>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {step === "scan" && (
          <>
            <div className="relative mx-auto aspect-square w-full max-w-[340px] overflow-hidden rounded-[22px] bg-black">
              <video ref={video} playsInline muted className="h-full w-full object-cover" />
              {/* the frame to aim with */}
              <span className="pointer-events-none absolute inset-[14%] rounded-[18px] border-[3px] border-white/85 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" aria-hidden />
            </div>
            {error && <p className="mx-auto mt-4 max-w-[340px] text-center text-[14px] text-accent-extreme" role="alert">{error}</p>}
            <p className="mx-auto mt-5 max-w-[340px] text-center text-[14px] leading-snug text-ink-muted">
              On the other device, open Palk&apos;s sign-in page and point this camera at the QR code.
            </p>
          </>
        )}
        {(step === "checking" || step === "linking") && <div className="grid place-items-center pt-20 text-ink-muted"><ButtonWheel size={26} /></div>}
        {step === "confirm" && (
          <div className="mx-auto flex max-w-[340px] flex-col items-center pt-8 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-brand/15 text-brand"><Laptop className="h-8 w-8" /></span>
            <h3 className="mt-5 text-[20px] font-semibold text-ink">Link {device}?</h3>
            <p className="mt-2 text-[14px] leading-snug text-ink-muted">It will be signed in to your account. Only link a device you are using right now.</p>
            <p className="mt-3 flex items-start gap-2 text-left text-[13px] leading-snug text-ink-faint"><ShieldCheck className="mt-px h-4 w-4 shrink-0" />Your messages stay end-to-end encrypted: that device unlocks them with your chat passcode.</p>
            <div className="mt-7 grid w-full grid-cols-2 gap-3">
              <button type="button" onClick={() => { setStep("scan"); setId(null); }} className="h-11 rounded-full bg-overlay/[0.08] text-[15px] font-medium text-ink">Cancel</button>
              <button type="button" onClick={() => void approve()} className="h-11 rounded-full bg-brand text-[15px] font-semibold text-white">Link device</button>
            </div>
          </div>
        )}
        {step === "done" && (
          <div className="mx-auto flex max-w-[340px] flex-col items-center pt-10 text-center">
            <CheckCircle2 className="h-14 w-14 text-accent-medium" />
            <h3 className="mt-4 text-[20px] font-semibold text-ink">Device linked</h3>
            <p className="mt-2 text-[14px] text-ink-muted">{device} is now signed in to your account.</p>
            <button type="button" onClick={onClose} className="mt-7 h-11 w-full rounded-full bg-brand text-[15px] font-semibold text-white">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
