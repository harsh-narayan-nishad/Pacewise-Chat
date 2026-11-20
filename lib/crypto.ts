/**
 * End-to-end encryption for Pacewise Chat, all in the browser with the Web Crypto API. The server only ever sees
 * public keys and ciphertext.
 *
 *  - Identity: an ECDH P-256 key pair per person. The private key never leaves the browser in the clear: it is
 *    stored on the server encrypted with AES-256-GCM under a key derived from the person's chat passcode
 *    (PBKDF2-SHA-256, 310 000 rounds), so they can unlock it on another device.
 *  - Conversation key: a random 256-bit AES-GCM key per chat (and per "epoch": a new one when someone leaves).
 *    Each member gets their own copy, encrypted with a key both sides can derive: ECDH(sender, member) → HKDF.
 *  - Messages: AES-256-GCM with a fresh 96-bit IV, the chat / message / sender / epoch bound in as associated
 *    data, so the server cannot move a message to another chat or pass it off as someone else's.
 */
const subtle = () => globalThis.crypto.subtle;
/** Bytes backed by a plain ArrayBuffer (what Web Crypto accepts). */
export type Bytes = Uint8Array<ArrayBuffer>;
const te = new TextEncoder();
const td = new TextDecoder();
export const PBKDF2_ROUNDS = 310_000;

export const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
export const fromB64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number): Bytes => crypto.getRandomValues(new Uint8Array(n));

export interface Identity { privateKey: CryptoKey; publicKey: string; version: number }
export interface StoredKeys { publicKey: string; encPrivateKey: string; salt: string; iv: string; iterations: number; version: number }

async function passcodeKey(passcode: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", te.encode(passcode.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** A new identity, plus what the server stores (the private key encrypted under the passcode). */
export async function createIdentity(passcode: string): Promise<{ upload: Omit<StoredKeys, "version">; privateKey: CryptoKey; publicKey: string }> {
  const pair = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = toB64(await subtle().exportKey("raw", pair.publicKey));
  const pkcs8 = await subtle().exportKey("pkcs8", pair.privateKey);
  const salt = random(16);
  const iv = random(12);
  const wrap = await passcodeKey(passcode, salt, PBKDF2_ROUNDS);
  const encPrivateKey = toB64(await subtle().encrypt({ name: "AES-GCM", iv }, wrap, pkcs8));
  // From here on the private key is not extractable: scripts on the page can use it but never read it out.
  const privateKey = await subtle().importKey("pkcs8", pkcs8, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { upload: { publicKey, encPrivateKey, salt: toB64(salt), iv: toB64(iv), iterations: PBKDF2_ROUNDS }, privateKey, publicKey };
}

/** Opens the stored private key with the passcode. Throws on a wrong passcode. */
export async function unlockIdentity(stored: StoredKeys, passcode: string): Promise<Identity> {
  const wrap = await passcodeKey(passcode, fromB64(stored.salt), stored.iterations);
  let pkcs8: ArrayBuffer;
  try {
    pkcs8 = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(stored.iv) }, wrap, fromB64(stored.encPrivateKey));
  } catch {
    throw new Error("That passcode is not right.");
  }
  const privateKey = await subtle().importKey("pkcs8", pkcs8, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { privateKey, publicKey: stored.publicKey, version: stored.version };
}

// ---- pairwise keys (to share a conversation key with one member) ----
const pairCache = new Map<string, Promise<CryptoKey>>();
function pairKey(mine: CryptoKey, myPub: string, theirPub: string): Promise<CryptoKey> {
  const id = `${myPub}|${theirPub}`;
  let k = pairCache.get(id);
  if (!k) {
    k = (async () => {
      const pub = await subtle().importKey("raw", fromB64(theirPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
      const secret = await subtle().deriveBits({ name: "ECDH", public: pub }, mine, 256);
      const hk = await subtle().importKey("raw", secret, "HKDF", false, ["deriveKey"]);
      // Sorted, so both sides derive the same key.
      const info = te.encode(`pacewise-chat/wrap/v1|${[myPub, theirPub].sort().join("|")}`);
      return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    })();
    k.catch(() => pairCache.delete(id));
    pairCache.set(id, k);
  }
  return k;
}

export const newConversationKey = () => random(32);

/** A conversation key encrypted for one member. */
export async function wrapFor(me: Identity, theirPub: string, raw: Bytes): Promise<{ iv: string; data: string }> {
  const iv = random(12);
  const data = await subtle().encrypt({ name: "AES-GCM", iv }, await pairKey(me.privateKey, me.publicKey, theirPub), raw);
  return { iv: toB64(iv), data: toB64(data) };
}

/** My copy of a conversation key, opened. `byPub` is the public key of whoever made the copy (it may be mine). */
export async function unwrap(me: Identity, byPub: string, iv: string, data: string): Promise<Bytes> {
  const raw = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await pairKey(me.privateKey, me.publicKey, byPub), fromB64(data));
  return new Uint8Array(raw);
}

// ---- messages ----
const msgKeyCache = new Map<string, Promise<CryptoKey>>();
function messageKey(raw: Bytes): Promise<CryptoKey> {
  const id = toB64(raw);
  let k = msgKeyCache.get(id);
  if (!k) {
    k = subtle().importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    msgKeyCache.set(id, k);
  }
  return k;
}
export interface MessageMeta { conversationId: string; messageId: string; senderId: string; epoch: number }
const aad = (m: MessageMeta) => te.encode(`pacewise-chat/msg/v1|${m.conversationId}|${m.messageId}|${m.senderId}|${m.epoch}`);

export interface Payload { t: string }

export async function encryptMessage(raw: Bytes, meta: MessageMeta, payload: Payload) {
  const iv = random(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad(meta) }, await messageKey(raw), te.encode(JSON.stringify(payload)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptMessage(raw: Bytes, meta: MessageMeta, iv: string, ct: string): Promise<Payload> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(iv), additionalData: aad(meta) }, await messageKey(raw), fromB64(ct));
  const p = JSON.parse(td.decode(pt)) as Partial<Payload>;
  return { t: typeof p.t === "string" ? p.t : "" };
}

/**
 * The security code two people can compare (in person, or over a call) to be sure no one swapped a key in between,
 * like WhatsApp's "Verify security code": 60 digits in 12 groups of 5, the same on both sides.
 */
export async function securityCode(pubA: string, pubB: string): Promise<string[]> {
  const [a, b] = [pubA, pubB].sort();
  const h = new Uint8Array(await subtle().digest("SHA-512", te.encode(`pacewise-chat/code/v1|${a}|${b}`)));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const n = ((h[i * 5] << 24) | (h[i * 5 + 1] << 16) | (h[i * 5 + 2] << 8) | h[i * 5 + 3]) >>> 0;
    groups.push(String((n * 256 + h[i * 5 + 4]) % 100_000).padStart(5, "0"));
  }
  return groups;
}

/** A short, readable fingerprint of one public key ("3F A2 …"). */
export async function fingerprint(pub: string): Promise<string> {
  const h = new Uint8Array(await subtle().digest("SHA-256", fromB64(pub)));
  return Array.from(h.slice(0, 16), (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}
