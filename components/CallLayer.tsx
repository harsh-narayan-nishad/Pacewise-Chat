"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { chatApi, type CallSignal, type ChatEvent, type Conversation, type Member } from "@/lib/chat";

/**
 * Audio calls in one-to-one chats. The two browsers talk directly (WebRTC): the audio never passes through Pacewise
 * and is encrypted end to end by WebRTC (DTLS-SRTP). Pacewise only relays the short setup messages (offer, answer,
 * network candidates) and the call's course (end, decline, busy) over the live event stream; nothing is stored.
 * A public STUN server lets each browser find its own network address.
 */
const ICE: RTCConfiguration = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
const RING_MS = 45_000;

type Phase = "outgoing" | "incoming" | "connecting" | "active" | "ended";
interface Call { phase: Phase; callId: string; convId: string; peer: Member; muted: boolean; startedAt?: number; note?: string }
export interface CallHandle { start: (c: Conversation) => void; signal: (e: ChatEvent) => void; busy: () => boolean }

/** A soft two-tone ring (incoming) or ring-back (outgoing), made in the browser. */
function useTone() {
  const ctx = useRef<AudioContext | null>(null);
  const timer = useRef<number | null>(null);
  const stop = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; };
  const beep = (f: number, at: number, len: number) => {
    const a = ctx.current;
    if (!a) return;
    const o = a.createOscillator(); const g = a.createGain();
    o.frequency.value = f; o.type = "sine";
    g.gain.setValueAtTime(0, a.currentTime + at); g.gain.linearRampToValueAtTime(0.08, a.currentTime + at + 0.03); g.gain.linearRampToValueAtTime(0, a.currentTime + at + len);
    o.connect(g).connect(a.destination); o.start(a.currentTime + at); o.stop(a.currentTime + at + len + 0.05);
  };
  const play = (kind: "ring" | "back") => {
    stop();
    try { ctx.current ??= new AudioContext(); void ctx.current.resume(); } catch { return; }
    const once = () => (kind === "ring" ? (beep(880, 0, 0.35), beep(660, 0.45, 0.35)) : beep(440, 0, 0.9));
    once();
    timer.current = window.setInterval(once, kind === "ring" ? 2000 : 3000);
  };
  return { play, stop };
}

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export const CallLayer = forwardRef<CallHandle, { me: string; convs: () => Conversation[]; onError: (m: string) => void }>(function CallLayer({ me, convs, onError }, ref) {
  const [call, setCall] = useState<Call | null>(null);
  const [now, setNow] = useState(Date.now());
  const callRef = useRef<Call | null>(null); callRef.current = call;
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const offer = useRef<string | null>(null);
  const queued = useRef<RTCIceCandidateInit[]>([]);
  const ringTimer = useRef<number | null>(null);
  const tone = useTone();

  const send = (convId: string, body: CallSignal) => chatApi.call(convId, body).catch(() => undefined);

  /** Hang everything up (media, connection, sounds, timers). */
  const cleanup = () => {
    tone.stop();
    if (ringTimer.current) window.clearTimeout(ringTimer.current);
    ringTimer.current = null;
    pc.current?.close(); pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop()); local.current = null;
    offer.current = null; queued.current = [];
    if (audio.current) audio.current.srcObject = null;
  };
  /** Show how the call ended for a moment, then close the screen. */
  const finish = (note: string) => {
    cleanup();
    setCall((c) => (c ? { ...c, phase: "ended", note } : c));
    window.setTimeout(() => setCall((c) => (c?.phase === "ended" ? null : c)), 1800);
  };
  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // the call timer
  useEffect(() => {
    if (call?.phase !== "active") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [call?.phase]);

  /** A peer connection with my microphone on it; candidates and the other side's audio are wired up. */
  async function connect(convId: string, callId: string): Promise<RTCPeerConnection> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    local.current = stream;
    const p = new RTCPeerConnection(ICE);
    pc.current = p;
    stream.getTracks().forEach((t) => p.addTrack(t, stream));
    p.onicecandidate = (e) => { if (e.candidate) void send(convId, { callId, kind: "ice", candidate: e.candidate.toJSON() }); };
    p.ontrack = (e) => { if (audio.current) { audio.current.srcObject = e.streams[0]; void audio.current.play().catch(() => undefined); } };
    p.onconnectionstatechange = () => {
      if (pc.current !== p) return;
      if (p.connectionState === "connected") { tone.stop(); setCall((c) => (c && c.phase !== "active" ? { ...c, phase: "active", startedAt: Date.now() } : c)); }
      if (p.connectionState === "failed") { void send(convId, { callId, kind: "end" }); finish("Call could not connect"); }
    };
    return p;
  }
  const flush = async () => {
    const p = pc.current;
    if (!p?.remoteDescription) return;
    for (const c of queued.current.splice(0)) await p.addIceCandidate(c).catch(() => undefined);
  };

  async function start(conv: Conversation) {
    if (callRef.current) return;
    const peer = conv.members.find((m) => m.id !== me);
    if (!peer || conv.type !== "direct") return;
    const callId = crypto.randomUUID();
    setCall({ phase: "outgoing", callId, convId: conv.id, peer, muted: false });
    try {
      const p = await connect(conv.id, callId);
      const o = await p.createOffer();
      await p.setLocalDescription(o);
      await chatApi.call(conv.id, { callId, kind: "offer", sdp: o.sdp });
      tone.play("back");
      ringTimer.current = window.setTimeout(() => {
        if (callRef.current?.callId === callId && callRef.current.phase === "outgoing") { void send(conv.id, { callId, kind: "end" }); finish("No answer"); }
      }, RING_MS);
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      finish(denied ? "Microphone not allowed" : "Could not start the call");
      if (!denied) onError(e instanceof Error ? e.message : "Could not start the call.");
    }
  }

  async function accept() {
    const c = callRef.current;
    if (!c || c.phase !== "incoming" || !offer.current) return;
    tone.stop();
    setCall({ ...c, phase: "connecting" });
    try {
      const p = await connect(c.convId, c.callId);
      await p.setRemoteDescription({ type: "offer", sdp: offer.current });
      await flush();
      const a = await p.createAnswer();
      await p.setLocalDescription(a);
      await chatApi.call(c.convId, { callId: c.callId, kind: "answer", sdp: a.sdp });
    } catch (e) {
      void send(c.convId, { callId: c.callId, kind: "end" });
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      finish(denied ? "Microphone not allowed" : "Could not connect");
    }
  }
  const decline = () => { const c = callRef.current; if (!c) return; void send(c.convId, { callId: c.callId, kind: "decline" }); cleanup(); setCall(null); };
  const hangup = () => { const c = callRef.current; if (!c) return; void send(c.convId, { callId: c.callId, kind: "end" }); finish("Call ended"); };
  const mute = () => {
    const c = callRef.current;
    if (!c) return;
    const muted = !c.muted;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    setCall({ ...c, muted });
  };

  /** A call message from the other side. */
  async function signal(e: ChatEvent) {
    const s = e.data as CallSignal | undefined;
    if (!s || !e.conversationId || e.from === me) return;
    const c = callRef.current;
    if (s.kind === "offer") {
      if (c && c.callId !== s.callId) { void send(e.conversationId, { callId: s.callId, kind: "busy" }); return; }
      const conv = convs().find((x) => x.id === e.conversationId);
      const peer = conv?.members.find((m) => m.id === e.from);
      if (!peer) return;
      offer.current = s.sdp ?? null;
      setCall({ phase: "incoming", callId: s.callId, convId: e.conversationId, peer, muted: false });
      tone.play("ring");
      try { navigator.vibrate?.([300, 200, 300]); } catch { /* not supported */ }
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
        try { new Notification(`${peer.name} is calling`, { body: "Pacewise Chat · audio call", tag: `call-${s.callId}` }); } catch { /* not supported */ }
      }
      ringTimer.current = window.setTimeout(() => { if (callRef.current?.callId === s.callId && callRef.current.phase === "incoming") finish("Missed call"); }, RING_MS + 5000);
      return;
    }
    if (!c || c.callId !== s.callId) return;
    if (s.kind === "answer" && pc.current && s.sdp) {
      tone.stop();
      if (ringTimer.current) window.clearTimeout(ringTimer.current);
      setCall({ ...c, phase: "connecting" });
      await pc.current.setRemoteDescription({ type: "answer", sdp: s.sdp }).catch(() => finish("Could not connect"));
      await flush();
    } else if (s.kind === "ice" && s.candidate) {
      if (pc.current?.remoteDescription) await pc.current.addIceCandidate(s.candidate).catch(() => undefined);
      else queued.current.push(s.candidate);
    } else if (s.kind === "decline") finish("Declined");
    else if (s.kind === "busy") finish("On another call");
    else if (s.kind === "end") finish(c.phase === "incoming" ? "Missed call" : "Call ended");
  }

  useImperativeHandle(ref, () => ({ start: (c) => void start(c), signal: (e) => void signal(e), busy: () => !!callRef.current }));

  const status = !call ? "" : call.phase === "outgoing" ? "Calling…" : call.phase === "incoming" ? "Incoming audio call" : call.phase === "connecting" ? "Connecting…"
    : call.phase === "active" ? clock(Math.max(0, Math.floor((now - (call.startedAt ?? now)) / 1000))) : call.note ?? "Call ended";
  const ringing = call?.phase === "outgoing" || call?.phase === "incoming";

  return (
    <>
      <audio ref={audio} autoPlay playsInline className="hidden" />
      {call && createPortal(
        <div role="dialog" aria-modal="true" aria-label={`Audio call with ${call.peer.name}`} className="pw-call fade-in fixed inset-0 z-[200] flex flex-col items-center justify-between px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))] text-white">
          <p className="flex items-center gap-1.5 text-[13px] text-white/70"><Lock className="h-3.5 w-3.5" aria-hidden /> End-to-end encrypted</p>

          <div className="flex flex-col items-center text-center">
            <span className="relative">
              {ringing && <><span className="pw-call-ring absolute inset-0 rounded-full" /><span className="pw-call-ring absolute inset-0 rounded-full [animation-delay:0.9s]" /></>}
              <Avatar id={call.peer.id} name={call.peer.name} url={call.peer.avatarUrl} size={128} className="relative" />
            </span>
            <h2 className="mt-7 text-[30px] font-semibold tracking-[-0.02em]">{call.peer.name}</h2>
            <p className="mt-1.5 text-[17px] tabular-nums text-white/75" aria-live="polite">{status}{call.muted && call.phase === "active" ? " · muted" : ""}</p>
          </div>

          <div className="flex w-full max-w-xs items-start justify-around">
            {call.phase === "incoming" ? (
              <>
                <CallButton label="Decline" tone="red" onClick={decline}><PhoneOff className="h-7 w-7" /></CallButton>
                <CallButton label="Accept" tone="green" onClick={() => void accept()}><Phone className="h-7 w-7" /></CallButton>
              </>
            ) : call.phase === "ended" ? (
              <CallButton label="Close" tone="glass" onClick={() => setCall(null)}><PhoneOff className="h-7 w-7" /></CallButton>
            ) : (
              <>
                <CallButton label={call.muted ? "Unmute" : "Mute"} tone={call.muted ? "white" : "glass"} onClick={mute}>{call.muted ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}</CallButton>
                <CallButton label="End" tone="red" onClick={hangup}><PhoneOff className="h-7 w-7" /></CallButton>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
});

function CallButton({ label, tone, onClick, children }: { label: string; tone: "red" | "green" | "glass" | "white"; onClick: () => void; children: React.ReactNode }) {
  const bg = tone === "red" ? "bg-[#FF3B30] text-white" : tone === "green" ? "bg-[#34C759] text-white" : tone === "white" ? "bg-white text-[#1C1C1E]" : "bg-white/15 text-white backdrop-blur";
  return (
    <span className="flex flex-col items-center gap-2">
      <button type="button" onClick={onClick} aria-label={label} className={`flex h-[72px] w-[72px] items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 ${bg}`}>{children}</button>
      <span className="text-[13px] text-white/80">{label}</span>
    </span>
  );
}
