"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Lock,
  Mic,
  MicOff,
  Phone,
  SwitchCamera,
  UserPlus,
  Video,
  VideoOff,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { API_BASE, ApiError, session } from "@/lib/api";
import {
  chatApi,
  type CallPerson,
  type CallSignal,
  type ChatEvent,
  type Conversation,
  type Member,
  type PeerSignal,
} from "@/lib/chat";
import { cn } from "@/lib/utils";

/**
 * Audio and video calls. A call starts in a one-to-one chat, and more people can be added to it while it runs (each
 * is rung from the adder's one-to-one chat with them). Every pair of people talks directly (WebRTC): sound and picture
 * never pass through Pacewise and are encrypted end to end by WebRTC (DTLS-SRTP). Pacewise only relays the short setup
 * messages (offer, answer, network candidates) and the call's course (end, decline, busy) over the live event stream,
 * and keeps a short-lived list of who is in each call; nothing else is stored. A public STUN server lets each browser
 * find its own network address.
 */
const ICE: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};
const RING_MS = 45_000;
/** A connected call that loses the network (Wi-Fi ↔ mobile data, a weak signal) reconnects for this long before it ends. */
const RECONNECT_MS = 30_000;
/** While reconnecting: a new network path is asked for this often (by the person with the smaller id, so only one side offers). */
const RESTART_EVERY_MS = 5_000;
const AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
const camera = (facing: "user" | "environment"): MediaTrackConstraints => ({
  facingMode: facing,
  width: { ideal: 1280 },
  height: { ideal: 720 },
});

type Phase = "outgoing" | "incoming" | "connecting" | "active" | "ended";
interface Call {
  phase: Phase;
  callId: string;
  convId: string;
  peer: Member;
  muted: boolean;
  startedAt?: number;
  note?: string;
  /** A video call (the other side may still join with audio only). */
  video: boolean;
  camOff: boolean;
  facing: "user" | "environment";
  /** Being added to a call: who else is in it. */
  with?: string[];
}
/** Someone else in the call: my direct connection to them ("ringing": I am adding them and they have not answered yet). */
interface Peer {
  who: CallPerson;
  pc: RTCPeerConnection | null;
  stream: MediaStream | null;
  hasVideo: boolean;
  state: "ringing" | "connecting" | "connected";
  /** Their device got the call and is ringing (until then the call is only "Calling…"). */
  rung?: boolean;
  convId?: string;
  /** A small control channel straight to them: "bye" when either side hangs up, so the other ends at once. */
  dc?: RTCDataChannel;
}
/** Everyone connects to everyone, so calls stay small (the server holds the same limit). */
const MAX_PEOPLE = 6;
export interface CallHandle {
  start: (c: Conversation, video?: boolean) => void;
  signal: (e: ChatEvent) => void;
  busy: () => boolean;
  /** Answer this call if it is the one ringing here (Answer on the incoming-call notification). */
  pickUp: (callId: string) => void;
}

/** A soft two-tone ring (incoming) or ring-back (outgoing), made in the browser. */
function useTone() {
  const ctx = useRef<AudioContext | null>(null);
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };
  const beep = (f: number, at: number, len: number) => {
    const a = ctx.current;
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.value = f;
    o.type = "sine";
    g.gain.setValueAtTime(0, a.currentTime + at);
    g.gain.linearRampToValueAtTime(0.08, a.currentTime + at + 0.03);
    g.gain.linearRampToValueAtTime(0, a.currentTime + at + len);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + at);
    o.stop(a.currentTime + at + len + 0.05);
  };
  const play = (kind: "ring" | "back") => {
    stop();
    try {
      ctx.current ??= new AudioContext();
      void ctx.current.resume();
    } catch {
      return;
    }
    const once = () =>
      kind === "ring"
        ? (beep(880, 0, 0.35), beep(660, 0.45, 0.35))
        : beep(440, 0, 0.9);
    once();
    timer.current = window.setInterval(once, kind === "ring" ? 2000 : 3000);
  };
  return { play, stop };
}

const clock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export const CallLayer = forwardRef<
  CallHandle,
  { me: string; convs: () => Conversation[]; onError: (m: string) => void }
>(function CallLayer({ me, convs, onError }, ref) {
  const [call, setCall] = useState<Call | null>(null);
  const [now, setNow] = useState(Date.now());
  /** My camera preview. */
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  /** The people in the call with me, one direct connection each (re-render with bump() when they change). */
  const peers = useRef(new Map<string, Peer>());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const callRef = useRef<Call | null>(null);
  callRef.current = call;
  const local = useRef<MediaStream | null>(null);
  /** The ring I am answering: the first offer (a call to me) or who is already in the call (I was added). */
  const ring = useRef<{ sdp?: string; people: CallPerson[] } | null>(null);
  /** Network candidates that arrive before their connection exists ("callId|from" → candidates). */
  const early = useRef(new Map<string, RTCIceCandidateInit[]>());
  const ringTimer = useRef<number | null>(null);
  const ringing = useRef(new Map<string, number>());
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number | null>(null);
  const tone = useTone();

  const send = (convId: string, body: CallSignal) =>
    chatApi.call(convId, body).catch(() => undefined);
  /**
   * A setup message to someone in the call. A server that does not have calls with more people yet (404) gets it the
   * old way instead: through my one-to-one chat with them, so one-to-one calls keep working with it.
   */
  const sendPeer = async (callId: string, body: PeerSignal) => {
    const ids = body.to ? [body.to] : [...peers.current.keys()]; // read now: hanging up clears the list
    try {
      await chatApi.peerCall(callId, body);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) return;
      for (const id of ids) {
        const conv = convs().find(
          (v) => v.type === "direct" && v.members.some((m) => m.id === id),
        );
        if (conv)
          await chatApi
            .call(conv.id, {
              callId,
              kind: body.kind,
              video: body.video,
              sdp: body.sdp,
              candidate: body.candidate,
            })
            .catch(() => undefined);
      }
    }
  };
  /** A short line on the call screen ("Neha declined"). */
  const say = (text: string) => {
    setNote(text);
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 3500);
  };
  const stopRinging = (id: string) => {
    const t = ringing.current.get(id);
    if (t) window.clearTimeout(t);
    ringing.current.delete(id);
  };

  /** Hang everything up (media, connections, sounds, timers). */
  const cleanup = () => {
    tone.stop();
    if (ringTimer.current) window.clearTimeout(ringTimer.current);
    ringTimer.current = null;
    ringing.current.forEach((t) => window.clearTimeout(t));
    ringing.current.clear();
    // "bye" straight to everyone (they end at once, even if the server's message is late), then close a moment later
    // so it is delivered.
    const closing = [...peers.current.values()];
    for (const x of closing) { try { if (x.dc?.readyState === "open") x.dc.send("bye"); } catch { /* channel gone */ } }
    window.setTimeout(() => closing.forEach((x) => x.pc?.close()), 250);
    peers.current.clear();
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    ring.current = null;
    early.current.clear();
    setLocalStream(null);
    setAdding(false);
    bump();
  };
  /** Show how the call ended for a moment, then close the screen. */
  const finish = (text: string) => {
    cleanup();
    // A call that was talking shows how long it lasted: "Call ended · 05:23".
    setCall((c) => (c ? { ...c, phase: "ended", note: c.startedAt ? `${text} · ${clock(Math.max(0, Math.floor((Date.now() - c.startedAt) / 1000)))}` : text } : c));
    window.setTimeout(
      () => setCall((c) => (c?.phase === "ended" ? null : c)),
      1800,
    );
  };
  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * While a call is on: keep the screen awake (a locked phone pauses the browser and its sound), asked again when the
   * tab comes back to the front, and warn before the tab is closed or reloaded, which would end the call.
   */
  const onCall = !!call && call.phase !== "incoming" && call.phase !== "ended";
  useEffect(() => {
    if (!onCall) return;
    type Lock = { release: () => Promise<void> };
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Lock> } }).wakeLock;
    let lock: Lock | null = null;
    let on = true;
    const keepAwake = () => {
      if (!wl || document.visibilityState !== "visible") return;
      wl.request("screen").then((l) => { if (on) lock = l; else void l.release().catch(() => undefined); }, () => undefined);
    };
    const leaving = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    // The page really goes (closed, reloaded, the app killed): "bye" to everyone, and "end" to the server with a request
    // the browser still delivers after the page is gone.
    const gone = () => {
      for (const x of peers.current.values()) { try { if (x.dc?.readyState === "open") x.dc.send("bye"); } catch { /* channel gone */ } }
      const c = callRef.current;
      const s = session.get();
      if (!c || !s || !API_BASE) return;
      const body = c.phase === "outgoing" ? { callId: c.callId, kind: "end" } : { kind: "end" };
      const path = c.phase === "outgoing" ? `/chat/conversations/${encodeURIComponent(c.convId)}/call` : `/chat/calls/${encodeURIComponent(c.callId)}/signal`;
      try {
        void fetch(API_BASE + path, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.accessToken}` }, body: JSON.stringify(body) }).catch(() => undefined);
      } catch { /* the page is closing */ }
    };
    window.addEventListener("pagehide", gone);
    keepAwake();
    document.addEventListener("visibilitychange", keepAwake);
    window.addEventListener("beforeunload", leaving);
    return () => {
      on = false;
      document.removeEventListener("visibilitychange", keepAwake);
      window.removeEventListener("beforeunload", leaving);
      window.removeEventListener("pagehide", gone);
      void lock?.release().catch(() => undefined);
    };
  }, [onCall]);

  // the call timer
  useEffect(() => {
    if (call?.phase !== "active") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [call?.phase]);

  /** My camera view moves (full screen while calling, small once connected, a tile in a group): attach it wherever it appears. */
  const attachLocal = (el: HTMLVideoElement | null) => {
    if (el && el.srcObject !== localStream) el.srcObject = localStream;
  };
  /** Someone's stream on a <video> (muted: their sound plays through their own <audio>) or <audio>. */
  const attach =
    (stream: MediaStream | null) => (el: HTMLMediaElement | null) => {
      if (!el || el.srcObject === stream) return;
      el.srcObject = stream;
      if (stream) void el.play().catch(() => undefined);
    };

  /** My microphone (and camera, for a video call); falls back to audio only when there is no camera or it is refused. */
  async function media(
    video: boolean,
    facing: "user" | "environment",
  ): Promise<{ stream: MediaStream; video: boolean }> {
    if (video) {
      try {
        return {
          stream: await navigator.mediaDevices.getUserMedia({
            audio: AUDIO,
            video: camera(facing),
          }),
          video: true,
        };
      } catch {
        /* no camera: join with audio */
      }
    }
    return {
      stream: await navigator.mediaDevices.getUserMedia({
        audio: AUDIO,
        video: false,
      }),
      video: false,
    };
  }
  async function openMedia(video: boolean, facing: "user" | "environment") {
    const m = await media(video, facing);
    local.current = m.stream;
    setLocalStream(m.stream);
    if (video && !m.video) setCall((c) => (c ? { ...c, camOff: true } : c));
  }

  /** "Neha declined", "Neha didn't answer", "Neha is on another call", "Couldn't connect to Neha", "Neha left". */
  const leftLine = (name: string, why?: string) =>
    why === "Declined" ? `${name} declined`
      : why === "No answer" ? `${name} didn't answer`
        : why === "On another call" ? `${name} is on another call`
          : why === "Couldn't connect" ? `Couldn't connect to ${name}`
            : why ? `${name}: ${why}` : `${name} left`;

  /** Someone left (or never joined): close their connection; the call ends when nobody is left in it. */
  function drop(id: string, why?: string) {
    const x = peers.current.get(id);
    if (!x) return;
    try { if (x.dc?.readyState === "open") x.dc.send("bye"); } catch { /* channel gone */ }
    const pc = x.pc;
    window.setTimeout(() => pc?.close(), 250);
    peers.current.delete(id);
    stopRinging(id);
    bump();
    const c = callRef.current;
    if (!c || c.phase === "incoming" || c.phase === "ended") return;
    const rest = [...peers.current.values()];
    if (
      rest.length === 0 ||
      (c.phase !== "outgoing" && rest.every((p) => p.state === "ringing"))
    ) {
      if (rest.length) void sendPeer(c.callId, { kind: "end" }); // nobody left but people still being rung: stop ringing them
      finish(why ?? "Call ended");
    } else say(leftLine(x.who.name, why));
  }

  /** A direct connection to one person in the call, with my microphone (and camera) on it. */
  function connection(
    callId: string,
    who: CallPerson,
    video: boolean,
    state: Peer["state"],
  ): RTCPeerConnection {
    const p = new RTCPeerConnection(ICE);
    const s = local.current;
    s?.getTracks().forEach((t) => p.addTrack(t, s));
    // A video call I joined without a camera can still receive theirs.
    if (video && !s?.getVideoTracks().length)
      p.addTransceiver("video", { direction: "recvonly" });
    const peer: Peer = { who, pc: p, stream: null, hasVideo: false, state };
    // The control channel: both sides open it with the same id, so it needs no extra setup. "bye" (or the channel closing
    // while the connection is still up) means they hung up: end at once, with no "Reconnecting…".
    try {
      const dc = p.createDataChannel("control", { negotiated: true, id: 0 });
      dc.onmessage = (ev) => { if (ev.data === "bye" && peers.current.get(who.id) === peer) drop(who.id); };
      dc.onclose = () => { if (peers.current.get(who.id) === peer && p.connectionState === "connected") drop(who.id); };
      peer.dc = dc;
    } catch { /* no data channels here: the server's "end" still ends the call */ }
    peers.current.set(who.id, peer);
    p.onicecandidate = (e) => {
      if (e.candidate)
        void sendPeer(callId, {
          kind: "ice",
          to: who.id,
          candidate: e.candidate.toJSON(),
        });
    };
    p.ontrack = (e) => {
      if (peers.current.get(who.id) !== peer) return;
      peer.stream = e.streams[0] ?? new MediaStream([e.track]);
      if (e.track.kind === "video") {
        peer.hasVideo = true;
        e.track.onmute = () => {
          peer.hasVideo = false;
          bump();
        };
        e.track.onunmute = () => {
          peer.hasVideo = true;
          bump();
        };
      }
      bump();
    };
    /**
     * Keeping a call alive: once connected, a lost network is not the end. The person with the smaller id asks for a new
     * network path (ICE restart) every few seconds; the other side answers it. Only if nothing works for RECONNECT_MS
     * does this person leave the call.
     */
    let lost: number | null = null;
    let retry: number | null = null;
    const stopRecovery = () => {
      if (lost) window.clearTimeout(lost);
      if (retry) window.clearTimeout(retry);
      lost = retry = null;
    };
    const restart = async () => {
      retry = null;
      if (peers.current.get(who.id) !== peer || p.connectionState === "connected" || p.connectionState === "closed") return;
      try {
        if (p.signalingState === "have-local-offer") await p.setLocalDescription({ type: "rollback" });
        if (p.signalingState === "stable") {
          const o = await p.createOffer({ iceRestart: true });
          await p.setLocalDescription(o);
          await sendPeer(callId, { kind: "offer", to: who.id, video, sdp: o.sdp });
        }
      } catch {
        /* tried again below */
      }
      if (lost) retry = window.setTimeout(() => void restart(), RESTART_EVERY_MS);
    };
    p.onconnectionstatechange = () => {
      if (peers.current.get(who.id) !== peer) return;
      if (p.connectionState === "closed") { stopRecovery(); return; }
      if ((p.connectionState === "disconnected" || p.connectionState === "failed") && peer.state === "connected") {
        if (!lost) {
          say(`Reconnecting to ${who.name}…`);
          lost = window.setTimeout(() => {
            stopRecovery();
            if (peers.current.get(who.id) !== peer || p.connectionState === "connected") return;
            void sendPeer(callId, { kind: "end", to: who.id });
            drop(who.id, "Couldn't connect");
          }, RECONNECT_MS);
        }
        // "disconnected" often heals by itself: wait a moment first; "failed" needs a new path now.
        if (me < who.id && !retry) retry = window.setTimeout(() => void restart(), p.connectionState === "failed" ? 0 : 2500);
        return;
      }
      if (p.connectionState === "connected") {
        if (lost) say(`Reconnected to ${who.name}`);
        stopRecovery();
        peer.state = "connected";
        tone.stop();
        setCall((c) =>
          c && c.phase !== "active" && c.phase !== "ended"
            ? { ...c, phase: "active", startedAt: Date.now() }
            : c,
        );
        bump();
      }
      if (p.connectionState === "failed") {
        void sendPeer(callId, { kind: "end", to: who.id });
        drop(who.id, "Couldn't connect");
      }
    };
    bump();
    return p;
  }
  /** Candidates that came early for this person. */
  const flush = async (callId: string, id: string) => {
    const p = peers.current.get(id)?.pc;
    if (!p?.remoteDescription) return;
    const key = `${callId}|${id}`;
    for (const c of early.current.get(key) ?? [])
      await p.addIceCandidate(c).catch(() => undefined);
    early.current.delete(key);
  };
  /** Answer an offer from someone in the call (the first caller, or someone who just joined). */
  async function answer(
    callId: string,
    who: CallPerson,
    sdp: string,
    video: boolean,
  ) {
    peers.current.get(who.id)?.pc?.close();
    const p = connection(callId, who, video, "connecting");
    await p.setRemoteDescription({ type: "offer", sdp });
    await flush(callId, who.id);
    const a = await p.createAnswer();
    await p.setLocalDescription(a);
    await sendPeer(callId, { kind: "answer", to: who.id, sdp: a.sdp });
  }
  /** Offer a connection to someone already in the call (I just joined it). */
  async function offerTo(callId: string, who: CallPerson, video: boolean) {
    const p = connection(callId, who, video, "connecting");
    const o = await p.createOffer();
    await p.setLocalDescription(o);
    await sendPeer(callId, { kind: "offer", to: who.id, video, sdp: o.sdp });
  }

  async function start(conv: Conversation, video = false) {
    if (callRef.current) return;
    const peer = conv.members.find((m) => m.id !== me);
    if (!peer || conv.type !== "direct") return;
    const callId = crypto.randomUUID();
    setCall({
      phase: "outgoing",
      callId,
      convId: conv.id,
      peer,
      muted: false,
      video,
      camOff: false,
      facing: "user",
    });
    try {
      await openMedia(video, "user");
      const p = connection(callId, peer, video, "ringing");
      const o = await p.createOffer();
      await p.setLocalDescription(o);
      await chatApi.call(conv.id, { callId, kind: "offer", video, sdp: o.sdp });
      // "Calling…" until their device reports that it is ringing; the ring-back tone starts then.
      ringTimer.current = window.setTimeout(() => {
        if (
          callRef.current?.callId === callId &&
          callRef.current.phase === "outgoing"
        ) {
          void send(conv.id, { callId, kind: "end" });
          finish("No answer");
        }
      }, RING_MS);
    } catch (e) {
      const denied =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "SecurityError");
      finish(denied ? (video ? "Camera or microphone access was denied" : "Microphone access was denied") : "Couldn't start the call");
      if (!denied)
        onError(e instanceof Error ? e.message : "Couldn't start the call.");
    }
  }

  async function accept() {
    const c = callRef.current;
    const r = ring.current;
    if (!c || c.phase !== "incoming" || !r) return;
    tone.stop();
    if (ringTimer.current) window.clearTimeout(ringTimer.current);
    setCall({ ...c, phase: "connecting" });
    try {
      await openMedia(c.video, c.facing);
      if (r.sdp) {
        // a call to me: answer the caller
        await answer(c.callId, c.peer, r.sdp, c.video);
      } else {
        // I was added to a call: connect to everyone in it now (the list is fresh from the server)
        const { people } = await chatApi.joinCall(c.callId);
        const others = people.filter((p) => p.id !== me);
        if (others.length === 0) {
          finish("Call ended");
          return;
        }
        await Promise.all(others.map((p) => offerTo(c.callId, p, c.video)));
      }
      ring.current = null;
    } catch (e) {
      if (r.sdp) void send(c.convId, { callId: c.callId, kind: "end" });
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      finish(
        denied
          ? "Microphone access was denied"
          : e instanceof Error && /ended/.test(e.message)
            ? "Call ended"
            : "Couldn't connect",
      );
    }
  }
  const decline = () => {
    const c = callRef.current;
    if (!c) return;
    void send(c.convId, { callId: c.callId, kind: "decline" });
    cleanup();
    setCall(null);
  };
  const hangup = () => {
    const c = callRef.current;
    if (!c) return;
    // still ringing the first person: stop their ring; otherwise tell everyone in the call I left
    if (c.phase === "outgoing")
      void send(c.convId, { callId: c.callId, kind: "end" });
    else void sendPeer(c.callId, { kind: "end" });
    finish("Call ended");
  };

  /** Add someone to the call: they are rung from my one-to-one chat with them. */
  async function invite(conv: Conversation) {
    const c = callRef.current;
    const who = conv.members.find((m) => m.id !== me);
    if (!c || !who || peers.current.has(who.id)) return;
    setAdding(false);
    peers.current.set(who.id, {
      who,
      pc: null,
      stream: null,
      hasVideo: false,
      state: "ringing",
      convId: conv.id,
    });
    bump();
    try {
      await chatApi.call(conv.id, {
        callId: c.callId,
        kind: "invite",
        video: c.video,
      });
      ringing.current.set(
        who.id,
        window.setTimeout(() => {
          if (peers.current.get(who.id)?.state !== "ringing") return;
          void send(conv.id, { callId: c.callId, kind: "end" });
          drop(who.id, "No answer");
        }, RING_MS),
      );
    } catch (e) {
      peers.current.delete(who.id);
      bump();
      say(
        e instanceof ApiError && (e.status === 400 || e.status === 404)
          ? "Adding people requires the latest Pacewise server."
          : e instanceof Error
            ? e.message
            : `Couldn't add ${who.name}.`,
      );
    }
  }

  const mute = () => {
    const c = callRef.current;
    if (!c) return;
    const muted = !c.muted;
    local.current?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
    setCall({ ...c, muted });
  };
  /** Camera off / on (the others then see my avatar). */
  const toggleCam = () => {
    const c = callRef.current;
    const tracks = local.current?.getVideoTracks() ?? [];
    if (!c || !tracks.length) return;
    const camOff = !c.camOff;
    tracks.forEach((t) => {
      t.enabled = !camOff;
    });
    setCall({ ...c, camOff });
  };
  /**
   * Switch camera: front ↔ rear on phones (or to the next camera on a computer with several). The camera in use is
   * stopped first (most phones cannot open two at once), the new one goes to everyone with replaceTrack (no
   * renegotiation), and if the new one cannot be opened the old one is opened again.
   */
  const switching = useRef(false);
  const switchCam = async () => {
    const c = callRef.current;
    const stream = local.current;
    const old = stream?.getVideoTracks()[0];
    if (!c || !stream || !old || switching.current) return;
    switching.current = true;
    const was = old.getSettings();
    const target: "user" | "environment" =
      c.facing === "user" ? "environment" : "user";
    const open = async (v: MediaTrackConstraints) =>
      (
        await navigator.mediaDevices.getUserMedia({ video: v })
      ).getVideoTracks()[0];
    old.stop();
    let track: MediaStreamTrack | undefined;
    try {
      // a phone: ask for the other side's camera by direction
      track = await open({
        facingMode: { exact: target },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      });
    } catch {
      // no direction reported (computers): the next camera in the list
      try {
        const ids = (await navigator.mediaDevices.enumerateDevices())
          .filter((d) => d.kind === "videoinput")
          .map((d) => d.deviceId);
        const next = ids[(ids.indexOf(was.deviceId ?? "") + 1) % ids.length];
        if (next && next !== was.deviceId)
          track = await open({
            deviceId: { exact: next },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          });
      } catch {
        /* falls through to reopening the old camera */
      }
    }
    if (!track) {
      onError("Couldn't switch the camera.");
      try {
        track = await open(
          was.deviceId
            ? {
                deviceId: { exact: was.deviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : camera(c.facing),
        );
      } catch {
        /* no camera now */
      }
    }
    try {
      stream.removeTrack(old);
      if (track) {
        for (const x of peers.current.values()) {
          const sender = x.pc
            ?.getSenders()
            .find((s) => s.track === old || s.track?.kind === "video");
          await sender?.replaceTrack(track).catch(() => undefined);
        }
        stream.addTrack(track);
        track.enabled = !c.camOff;
      }
      const got = track?.getSettings().facingMode;
      const facing: "user" | "environment" =
        got === "environment" || got === "user"
          ? got
          : track && track.getSettings().deviceId !== was.deviceId
            ? target
            : c.facing;
      setLocalStream(new MediaStream(stream.getTracks()));
      setCall({ ...(callRef.current ?? c), facing });
    } finally {
      switching.current = false;
    }
  };

  /** A call message: a ring through a chat, or a setup message from someone in the call. */
  async function signal(e: ChatEvent) {
    const s = e.data as CallSignal | undefined;
    const from = e.from;
    if (!s || !from || from === me) return;
    const c = callRef.current;

    if (s.kind === "ice") {
      if (!s.candidate) return;
      const p = c?.callId === s.callId ? peers.current.get(from)?.pc : null;
      if (p?.remoteDescription) {
        await p.addIceCandidate(s.candidate).catch(() => undefined);
        return;
      }
      const key = `${s.callId}|${from}`;
      const list = early.current.get(key) ?? [];
      if (list.length < 60) early.current.set(key, [...list, s.candidate]);
      return;
    }

    // An offer inside my call: someone who just joined connects to me (both offering at once: the larger id gives way)
    if (s.kind === "offer" && c && c.callId === s.callId && !e.conversationId) {
      if (c.phase === "incoming" || c.phase === "ended" || !s.sdp) return;
      const mine = peers.current.get(from);
      if (mine?.pc?.signalingState === "have-local-offer" && me < from) return;
      // Reconnecting (a new network path for a connection we already have): answer it on the same connection.
      if (mine?.pc && mine.state === "connected" && mine.pc.signalingState === "stable") {
        try {
          await mine.pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
          await flush(c.callId, from);
          const a = await mine.pc.createAnswer();
          await mine.pc.setLocalDescription(a);
          await sendPeer(c.callId, { kind: "answer", to: from, sdp: a.sdp });
          return;
        } catch {
          /* not a reconnect after all: a fresh connection below */
        }
      }
      const who = s.who ??
        mine?.who ?? { id: from, name: "Someone", avatarUrl: null };
      try {
        await answer(c.callId, who, s.sdp, c.video);
        if (!mine) say(`${who.name} joined`);
      } catch {
        drop(from);
      }
      return;
    }

    // A ring: a call to me ("offer") or being added to a call ("invite")
    if ((s.kind === "offer" || s.kind === "invite") && e.conversationId) {
      if (c && c.callId === s.callId) return;
      if (c) {
        void send(e.conversationId, { callId: s.callId, kind: "busy" });
        return;
      }
      const conv = convs().find((x) => x.id === e.conversationId);
      const peer = conv?.members.find((m) => m.id === from);
      if (!peer) return;
      const video = !!s.video;
      const others = (s.people ?? []).filter(
        (p) => p.id !== me && p.id !== from,
      );
      ring.current =
        s.kind === "offer"
          ? { sdp: s.sdp ?? "", people: [] }
          : { people: others };
      setCall({
        phase: "incoming",
        callId: s.callId,
        convId: e.conversationId,
        peer,
        muted: false,
        video,
        camOff: false,
        facing: "user",
        with: others.map((p) => p.name),
      });
      tone.play("ring");
      // Tell the caller this device is ringing (their screen goes from "Calling…" to "Ringing…").
      void send(e.conversationId, { callId: s.callId, kind: "ringing" });
      try {
        navigator.vibrate?.([300, 200, 300]);
      } catch {
        /* not supported */
      }
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        const title =
          s.kind === "invite"
            ? `${peer.name} is adding you to a call`
            : `${peer.name} is calling`;
        try {
          new Notification(title, {
            body: `Palk · ${video ? "video" : "audio"} call`,
            tag: `call-${s.callId}`,
          });
        } catch {
          /* not supported */
        }
      }
      ringTimer.current = window.setTimeout(() => {
        if (
          callRef.current?.callId === s.callId &&
          callRef.current.phase === "incoming"
        )
          finish("Missed call");
      }, RING_MS + 5000);
      return;
    }

    if (!c || c.callId !== s.callId) return;
    if (s.kind === "ringing") {
      const x = peers.current.get(from);
      if (x && x.state === "ringing" && !x.rung) {
        x.rung = true;
        bump();
        if (c.phase === "outgoing") tone.play("back");
      }
      return;
    }
    if (s.kind === "answer" && s.sdp) {
      const x = peers.current.get(from);
      if (!x?.pc) return;
      // Reconnecting: an answer to an attempt that was already replaced is ignored (the newer one is still on its way).
      if (x.state === "connected") {
        if (x.pc.signalingState !== "have-local-offer") return;
        await x.pc.setRemoteDescription({ type: "answer", sdp: s.sdp }).catch(() => undefined);
        await flush(c.callId, from);
        return;
      }
      stopRinging(from);
      if (c.phase === "outgoing") {
        tone.stop();
        if (ringTimer.current) window.clearTimeout(ringTimer.current);
        setCall({ ...c, phase: "connecting" });
      }
      if (x.state === "ringing") {
        x.state = "connecting";
        bump();
      }
      await x.pc
        .setRemoteDescription({ type: "answer", sdp: s.sdp })
        .catch(() => drop(from, "Couldn't connect"));
      await flush(c.callId, from);
    } else if (s.kind === "decline") drop(from, "Declined");
    else if (s.kind === "busy") drop(from, "On another call");
    else if (s.kind === "end") {
      if (c.phase === "incoming") {
        // the one ringing me hung up before I answered
        if (from === c.peer.id) finish("Missed call");
        return;
      }
      drop(from);
    }
  }

  useImperativeHandle(ref, () => ({
    start: (c, video) => void start(c, video),
    signal: (e) => void signal(e),
    busy: () => !!callRef.current,
    pickUp: (callId) => { if (callRef.current?.callId === callId && callRef.current.phase === "incoming") void accept(); },
  }));

  const kind = call?.video ? "video" : "audio";
  const list = [...peers.current.values()];
  const group = list.length >= 2;
  const single = list[0];
  const status = !call
    ? ""
    : call.phase === "outgoing"
      ? single?.rung
        ? "Ringing…"
        : "Calling…"
      : call.phase === "incoming"
        ? call.with?.length
          ? `Adding you to a ${kind} call`
          : `Incoming ${kind} call`
        : call.phase === "connecting"
          ? "Connecting…"
          : call.phase === "active"
            ? clock(
                Math.max(0, Math.floor((now - (call.startedAt ?? now)) / 1000)),
              )
            : (call.note ?? "Call ended");
  const ringingNow = call?.phase === "outgoing" || call?.phase === "incoming";
  const live = call && call.phase !== "incoming" && call.phase !== "ended";
  const hasCam = (localStream?.getVideoTracks().length ?? 0) > 0;
  /** How many cameras this device has (known once the camera is allowed): the switch shows only with two or more. */
  const [cams, setCams] = useState(0);
  useEffect(() => {
    if (!hasCam) return;
    let on = true;
    navigator.mediaDevices.enumerateDevices().then(
      (d) => {
        if (on) setCams(d.filter((x) => x.kind === "videoinput").length);
      },
      () => undefined,
    );
    return () => {
      on = false;
    };
  }, [hasCam]);
  /** One other person: their video fills the screen once it arrives; until then (calling) my own camera does. */
  const showRemote =
    !!call?.video && !!live && !group && !!single?.stream && single.hasVideo;
  const myFull =
    !!call?.video && !!live && !group && !showRemote && hasCam && !call.camOff;
  /** The title: who I am talking to. */
  /** One other person on screen: whoever is left in the call (the person I called, until they answer). */
  const face: CallPerson | null = !call
    ? null
    : live && single
      ? single.who
      : call.peer;
  const title = !call
    ? ""
    : group
      ? list.map((p) => p.who.name.split(" ")[0]).join(", ")
      : (face?.name ?? "");
  /** People I can add: my one-to-one chats, minus whoever is already in the call. */
  const [q, setQ] = useState("");
  const addable = adding
    ? convs()
        .filter((v) => v.type === "direct")
        .map((v) => ({ conv: v, who: v.members.find((m) => m.id !== me) }))
        .filter(
          (
            x,
          ): x is {
            conv: Conversation;
            who: Conversation["members"][number];
          } =>
            !!x.who &&
            !peers.current.has(x.who.id) &&
            x.who.name.toLowerCase().includes(q.trim().toLowerCase()),
        )
    : [];
  const canAdd = call?.phase === "active" && list.length + 1 < MAX_PEOPLE;

  return (
    <>
      {/* everyone's sound (video elements stay muted) */}
      {list.map(
        (p) =>
          p.stream && (
            <audio
              key={p.who.id}
              ref={attach(p.stream)}
              autoPlay
              playsInline
              className="hidden"
            />
          ),
      )}
      {call &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${call.video ? "Video" : "Audio"} call with ${title}`}
            className="pw-call fade-in fixed inset-0 z-[200] flex flex-col items-center justify-between overflow-hidden px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))] text-white"
          >
            {/* video, one other person: theirs (or mine while calling) fills the screen; mine sits small in a corner once theirs is on */}
            {call.video && !group && (
              <>
                {showRemote && (
                  <video
                    ref={attach(single.stream)}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 h-full w-full bg-black object-cover"
                  />
                )}
                {myFull && (
                  <video
                    ref={attachLocal}
                    autoPlay
                    playsInline
                    muted
                    className={cn(
                      "absolute inset-0 h-full w-full object-cover",
                      call.facing === "user" && "-scale-x-100",
                    )}
                  />
                )}
                {showRemote && hasCam && !call.camOff && (
                  <video
                    ref={attachLocal}
                    autoPlay
                    playsInline
                    muted
                    className={cn(
                      "absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 h-44 w-28 rounded-2xl border border-white/20 bg-black object-cover shadow-2xl sm:h-52 sm:w-36",
                      call.facing === "user" && "-scale-x-100",
                    )}
                  />
                )}
                {(showRemote || myFull) && (
                  <span
                    className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/60"
                    aria-hidden
                  />
                )}
              </>
            )}

            <p
              className={cn(
                "relative flex items-center gap-1.5 text-[13px] text-white/75 drop-shadow",
                (showRemote || group) && "self-start",
              )}
            >
              <Lock className="h-3.5 w-3.5" aria-hidden /> End-to-end encrypted
            </p>

            {group ? (
              // more people: everyone in a grid (me too, in a video call)
              <div className="relative mt-3 flex min-h-0 w-full max-w-3xl flex-1 flex-col">
                <h2 className="truncate text-[20px] font-semibold tracking-[-0.02em] drop-shadow">
                  {title}
                </h2>
                <p
                  className="mt-0.5 text-[15px] tabular-nums text-white/80"
                  aria-live="polite"
                >
                  {status}
                  {call.muted && call.phase === "active" ? " · Muted" : ""}
                  {call.video && call.camOff && live ? " · Camera off" : ""}
                </p>
                <div
                  className={cn(
                    "mt-4 grid min-h-0 flex-1 auto-rows-fr gap-2",
                    list.length + (call.video ? 1 : 0) > 2
                      ? "grid-cols-2"
                      : "grid-cols-1 sm:grid-cols-2",
                  )}
                >
                  {list.map((p) => (
                    <div
                      key={p.who.id}
                      className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-white/10"
                    >
                      {call.video &&
                      p.stream &&
                      p.hasVideo &&
                      p.state === "connected" ? (
                        <video
                          ref={attach(p.stream)}
                          autoPlay
                          playsInline
                          muted
                          className="absolute inset-0 h-full w-full bg-black object-cover"
                        />
                      ) : (
                        <span className="relative">
                          {p.state === "ringing" && (
                            <span className="pw-call-ring absolute inset-0 rounded-full" />
                          )}
                          <Avatar
                            id={p.who.id}
                            name={p.who.name}
                            url={p.who.avatarUrl}
                            size={64}
                            className="relative"
                          />
                        </span>
                      )}
                      <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-black/45 px-2.5 py-1 text-[12px] backdrop-blur">
                        {p.who.name.split(" ")[0]}
                        {p.state === "ringing"
                          ? p.rung
                            ? " · Ringing…"
                            : " · Calling…"
                          : p.state === "connecting"
                            ? " · Connecting…"
                            : ""}
                      </span>
                    </div>
                  ))}
                  {call.video && (
                    <div className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-white/10">
                      {hasCam && !call.camOff ? (
                        <video
                          ref={attachLocal}
                          autoPlay
                          playsInline
                          muted
                          className={cn(
                            "absolute inset-0 h-full w-full bg-black object-cover",
                            call.facing === "user" && "-scale-x-100",
                          )}
                        />
                      ) : (
                        <VideoOff
                          className="h-7 w-7 text-white/60"
                          aria-hidden
                        />
                      )}
                      <span className="absolute bottom-2 left-2 rounded-full bg-black/45 px-2.5 py-1 text-[12px] backdrop-blur">
                        You
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  "relative flex flex-col items-center text-center",
                  showRemote && "items-start self-start text-left",
                )}
              >
                {!showRemote && (
                  <span className="relative">
                    {ringingNow && (
                      <>
                        <span className="pw-call-ring absolute inset-0 rounded-full" />
                        <span className="pw-call-ring absolute inset-0 rounded-full [animation-delay:0.9s]" />
                      </>
                    )}
                    <Avatar
                      id={face!.id}
                      name={face!.name}
                      url={face!.avatarUrl}
                      size={myFull ? 88 : 128}
                      className="relative"
                    />
                  </span>
                )}
                <h2
                  className={cn(
                    "font-semibold tracking-[-0.02em] drop-shadow",
                    showRemote ? "text-[22px]" : "mt-7 text-[30px]",
                  )}
                >
                  {face!.name}
                </h2>
                <p
                  className="mt-1.5 text-[17px] tabular-nums text-white/80 drop-shadow"
                  aria-live="polite"
                >
                  {status}
                  {call.muted && call.phase === "active" ? " · Muted" : ""}
                  {call.video && call.camOff && live ? " · Camera off" : ""}
                </p>
                {call.phase === "incoming" && !!call.with?.length && (
                  <p className="mt-1 text-[15px] text-white/70">
                    With {call.with.join(", ")}
                  </p>
                )}
              </div>
            )}

            {note && (
              <p
                className="relative mt-3 rounded-full bg-black/40 px-3.5 py-1.5 text-[14px] backdrop-blur"
                role="status"
              >
                {note}
              </p>
            )}

            <div
              className={cn(
                "relative flex w-full max-w-md items-start justify-around",
                group && "mt-4",
              )}
            >
              {call.phase === "incoming" ? (
                <>
                  <CallButton label="Decline" tone="red" onClick={decline}>
                    <EndCallIcon />
                  </CallButton>
                  <CallButton
                    label="Accept"
                    tone="green"
                    onClick={() => void accept()}
                  >
                    {call.video ? (
                      <Video className="h-7 w-7" />
                    ) : (
                      <Phone className="h-7 w-7" />
                    )}
                  </CallButton>
                </>
              ) : call.phase === "ended" ? (
                <CallButton
                  label="Close"
                  tone="glass"
                  onClick={() => setCall(null)}
                >
                  <EndCallIcon />
                </CallButton>
              ) : (
                <>
                  <CallButton
                    label={call.muted ? "Unmute" : "Mute"}
                    tone={call.muted ? "white" : "glass"}
                    onClick={mute}
                  >
                    {call.muted ? (
                      <MicOff className="h-7 w-7" />
                    ) : (
                      <Mic className="h-7 w-7" />
                    )}
                  </CallButton>
                  {call.video && hasCam && (
                    <CallButton
                      label={call.camOff ? "Camera on" : "Camera off"}
                      tone={call.camOff ? "white" : "glass"}
                      onClick={toggleCam}
                    >
                      {call.camOff ? (
                        <VideoOff className="h-7 w-7" />
                      ) : (
                        <Video className="h-7 w-7" />
                      )}
                    </CallButton>
                  )}
                  {call.video && hasCam && cams > 1 && (
                    <CallButton
                      label="Switch camera"
                      tone="glass"
                      onClick={() => void switchCam()}
                    >
                      <SwitchCamera className="h-7 w-7" />
                    </CallButton>
                  )}
                  {canAdd && (
                    <CallButton
                      label="Add"
                      tone="glass"
                      onClick={() => {
                        setQ("");
                        setAdding(true);
                      }}
                    >
                      <UserPlus className="h-7 w-7" />
                    </CallButton>
                  )}
                  <CallButton label="End" tone="red" onClick={hangup}>
                    <EndCallIcon />
                  </CallButton>
                </>
              )}
            </div>

            {/* Add someone: a sheet over the call */}
            {adding && live && (
              <>
                <div
                  className="fixed inset-0 z-20 bg-black/40"
                  aria-hidden
                  onClick={() => setAdding(false)}
                />
                <div
                  role="dialog"
                  aria-label="Add to call"
                  className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-h-[70vh] w-full max-w-md flex-col rounded-t-[28px] bg-[#16171C]/95 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-white shadow-2xl backdrop-blur-xl"
                >
                  <span
                    className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/25"
                    aria-hidden
                  />
                  <div className="flex items-center justify-between">
                    <h3 className="text-[17px] font-semibold">Add to call</h3>
                    <button
                      type="button"
                      onClick={() => setAdding(false)}
                      className="rounded-full px-3 py-1.5 text-[15px] text-[#0A84FF]"
                    >
                      Done
                    </button>
                  </div>
                  <p className="mt-0.5 text-[13px] text-white/60">
                    Up to {MAX_PEOPLE} people. Each person is called from your
                    one-to-one chat with them.
                  </p>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search"
                    aria-label="Search people"
                    className="mt-3 h-10 rounded-xl bg-white/10 px-3.5 text-[15px] text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/60"
                  />
                  <ul className="mt-2 min-h-0 flex-1 overflow-y-auto">
                    {addable.length === 0 && (
                      <li className="py-6 text-center text-[14px] text-white/55">
                        {q
                          ? "No one found."
                          : "Everyone you chat with one-to-one is already here."}
                      </li>
                    )}
                    {addable.map(({ conv, who }) => (
                      <li key={conv.id}>
                        <button
                          type="button"
                          onClick={() => void invite(conv)}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-white/10"
                        >
                          <Avatar
                            id={who.id}
                            name={who.name}
                            url={who.avatarUrl}
                            size={40}
                          />
                          <span className="min-w-0 flex-1 truncate text-[16px]">
                            {who.name}
                          </span>
                          <UserPlus
                            className="h-5 w-5 text-[#0A84FF]"
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
});

/** The end-call mark phones use: a filled handset turned face down (no slash). */
/**
 * The hang-up mark, drawn for this app: a phone handset lying flat (the call put down), with rounded earpieces and a
 * gently curved grip. Original artwork, not taken from any icon set.
 */
function EndCallIcon() {
  return (
    <svg viewBox="0 0 32 32" width="42" height="42" fill="currentColor" aria-hidden>
      <path d="M4.2 18.9c-.6-.6-.9-1.4-.8-2.2.3-1.6 1.4-3 3.3-4C8.9 11.6 12.3 11 16 11s7.1.6 9.3 1.7c1.9 1 3 2.4 3.3 4 .1.8-.2 1.6-.8 2.2l-.9.9c-.6.6-1.5.8-2.3.5l-2.9-1.1c-.8-.3-1.3-1.1-1.2-2l.1-1.2c-1.4-.5-3-.7-4.6-.7s-3.2.2-4.6.7l.1 1.2c.1.9-.4 1.7-1.2 2l-2.9 1.1c-.8.3-1.7.1-2.3-.5z" />
    </svg>
  );
}

function CallButton({
  label,
  tone,
  onClick,
  children,
}: {
  label: string;
  tone: "red" | "green" | "glass" | "white";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const bg =
    tone === "red"
      // End / Decline: a deep red with a soft top-to-bottom shade, a fine light rim and a red glow; it sinks a little and
      // darkens when pressed.
      ? "bg-gradient-to-b from-[#FF5147] to-[#E2342A] text-white shadow-[0_8px_24px_rgba(226,52,42,0.45),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(0,0,0,0.12)] active:from-[#E0392F] active:to-[#C72A21]"
      : tone === "green"
        ? "bg-[#30D158] text-white"
        : tone === "white"
          ? "bg-white text-[#16171C]"
          : "bg-white/15 text-white backdrop-blur";
  return (
    <span className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`flex items-center justify-center rounded-full transition-[transform,background-color] duration-150 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 ${tone === "red" ? "h-[72px] w-[72px]" : "h-[68px] w-[68px] shadow-lg"} ${bg}`}
      >
        {children}
      </button>
      <span className="text-[13px] text-white/85 drop-shadow">{label}</span>
    </span>
  );
}
