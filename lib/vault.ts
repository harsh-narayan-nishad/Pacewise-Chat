import type { Identity } from "@/lib/crypto";

/**
 * Keeps the unlocked identity on this device (IndexedDB), so the passcode is asked once per device, not on every
 * visit. The private key is stored as a non-extractable CryptoKey: it can be used here but never read back out.
 * Signing out or "Lock chats" removes it.
 */
const DB = "pacewise-chat";
const STORE = "identity";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined; // private window or storage blocked: the passcode is asked each time instead
  }
}

export const vault = {
  get: (userId: string) => run<Identity>("readonly", (s) => s.get(userId)),
  set: (userId: string, id: Identity) => run("readwrite", (s) => s.put(id, userId)),
  remove: (userId: string) => run("readwrite", (s) => s.delete(userId)),
};
