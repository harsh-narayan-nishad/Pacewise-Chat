import { chatApi, type Conversation } from "@/lib/chat";
import { newConversationKey, unwrap, wrapFor, type Bytes, type Identity } from "@/lib/crypto";

/**
 * Every chat key this browser holds, opened with my identity, and the two jobs that keep a chat readable:
 *  - seed: a chat (or a new epoch, after someone left) whose key nobody holds yet gets a fresh random key;
 *  - share: any member waiting for a key I hold gets their own copy, encrypted for their public key.
 * The server only checks who may write which slot; it never sees a key in the clear.
 */
export class Keyring {
  private keys = new Map<string, Bytes>();
  private busy = new Set<string>();
  constructor(public readonly me: Identity, public readonly userId: string) {}

  get(conversationId: string, epoch: number): Bytes | undefined {
    return this.keys.get(`${conversationId}:${epoch}`);
  }

  /** Opens my copies of this chat's keys (the ones not opened yet). */
  async load(c: Conversation): Promise<void> {
    await Promise.all(c.myKeys.filter((k) => k.data && !this.keys.has(`${c.id}:${k.epoch}`)).map(async (k) => {
      try {
        this.keys.set(`${c.id}:${k.epoch}`, await unwrap(this.me, k.byPub, k.iv, k.data));
      } catch {
        /* made for an older key of mine: the others re-share it */
      }
    }));
  }

  /** Seeds and shares what this chat needs. Returns the updated chat when something was written. */
  async sync(c: Conversation): Promise<Conversation | null> {
    await this.load(c);
    let latest: Conversation | null = null;
    const lock = (k: string) => { if (this.busy.has(k)) return false; this.busy.add(k); return true; };

    // Nobody holds the current key yet: make one.
    const nobodyHasIt = c.members.every((m) => m.pending.includes(c.epoch));
    const seedLock = `${c.id}:${c.epoch}:seed`;
    if (nobodyHasIt && !this.get(c.id, c.epoch) && lock(seedLock)) {
      try {
        const raw = newConversationKey();
        const targets = c.members.filter((m) => m.publicKey && (m.id !== this.userId || m.publicKey === this.me.publicKey));
        const wraps = await Promise.all(targets.map(async (m) => ({ userId: m.id, ...(await wrapFor(this.me, m.publicKey!, raw)) })));
        latest = await chatApi.shareKeys(c.id, { epoch: c.epoch, seed: true, byPub: this.me.publicKey, wraps });
        this.keys.set(`${c.id}:${c.epoch}`, raw);
      } catch {
        latest = await chatApi.conversation(c.id).catch(() => null); // someone else seeded it first
        if (latest) await this.load(latest);
      } finally {
        this.busy.delete(seedLock);
      }
      c = latest ?? c;
    }

    // Share every key I hold with the members still waiting for it.
    const epochs = [...new Set(c.members.flatMap((m) => m.pending))].filter((e) => this.get(c.id, e));
    for (const epoch of epochs) {
      const raw = this.get(c.id, epoch)!;
      const waiting = c.members.filter((m) => m.id !== this.userId && m.publicKey && m.pending.includes(epoch));
      const shareLock = `${c.id}:${epoch}:share`;
      if (!waiting.length || !lock(shareLock)) continue;
      try {
        const wraps = await Promise.all(waiting.map(async (m) => ({ userId: m.id, ...(await wrapFor(this.me, m.publicKey!, raw)) })));
        latest = await chatApi.shareKeys(c.id, { epoch, byPub: this.me.publicKey, wraps });
      } catch {
        /* someone else shared it a moment earlier */
      } finally {
        this.busy.delete(shareLock);
      }
    }
    return latest;
  }
}
