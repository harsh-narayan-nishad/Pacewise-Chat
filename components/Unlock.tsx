"use client";
import { useState } from "react";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui";
import { PasswordInput } from "@/components/PasswordInput";
import { ButtonWheel } from "@/components/WheelSpinner";
import { chatApi } from "@/lib/chat";
import { createIdentity, unlockIdentity, type Identity, type StoredKeys } from "@/lib/crypto";
import { ApiError } from "@/lib/api";

const BOX = "block w-full rounded-none border border-overlay/25 bg-transparent px-4 py-4 text-base text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-ink";

/**
 * The encryption gate. First time: choose a chat passcode (it protects the private key that is stored, encrypted,
 * so the same chats open on another device). On a new device: enter it. Forgot it: reset (new keys; each chat's
 * key is re-shared by the other members the next time one of them is online).
 */
export function Unlock({ stored, onUnlocked, onSignOut }: { stored: StoredKeys | null; onUnlocked: (id: Identity) => void; onSignOut: () => void }) {
  const [mode, setMode] = useState<"setup" | "unlock" | "reset">(stored ? "unlock" : "setup");
  const [code, setCode] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const creating = mode !== "unlock";

  async function submit() {
    if (busy) return;
    setError(null);
    if (creating) {
      if (code.length < 6) return setError("Use at least 6 characters.");
      if (code !== again) return setError("The two passcodes are not the same.");
    }
    setBusy(true);
    try {
      if (mode === "unlock") {
        onUnlocked(await unlockIdentity(stored!, code));
      } else {
        const made = await createIdentity(code);
        const { version } = await chatApi.setKeys({ ...made.upload, reset: mode === "reset" });
        onUnlocked({ privateKey: made.privateKey, publicKey: made.publicKey, version });
      }
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const Icon = mode === "unlock" ? Lock : mode === "reset" ? KeyRound : ShieldCheck;
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <Logo size="lg" className="mb-10" />
        <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand/15 text-brand"><Icon className="h-7 w-7" /></span>
        <h1 className="mb-3 font-display text-4xl leading-[1.05] tracking-[-0.03em]">
          {mode === "setup" ? "Protect your chats." : mode === "unlock" ? "Unlock your chats." : "Reset encryption."}
        </h1>
        <p className="mb-8 text-sm text-ink-muted">
          {mode === "setup" && "Messages are end-to-end encrypted: only the people in a chat can read them, not even Pacewise. Choose a chat passcode. You need it to open your chats on another device."}
          {mode === "unlock" && "Enter your chat passcode to open your encrypted chats on this device."}
          {mode === "reset" && "You get new encryption keys. Chats you are in become readable again as soon as someone else in each chat opens Palk."}
        </p>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-4">
          <PasswordInput value={code} onChange={(e) => setCode(e.target.value)} placeholder={creating ? "New chat passcode" : "Chat passcode"} autoComplete={creating ? "new-password" : "current-password"} autoFocus required className={BOX} />
          {creating && <PasswordInput value={again} onChange={(e) => setAgain(e.target.value)} placeholder="Passcode again" autoComplete="new-password" required className={BOX} />}
          {error && <p className="text-sm text-accent-extreme" role="alert">{error}</p>}
          <Button type="submit" size="lg" disabled={busy} className="mt-1 h-14 w-full text-base">{busy && <ButtonWheel />}{busy ? "Please wait…" : mode === "unlock" ? "Unlock" : mode === "reset" ? "Reset and continue" : "Turn on encryption"}</Button>
        </form>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
          {mode === "unlock" && <button type="button" onClick={() => { setMode("reset"); setError(null); setCode(""); }} className="underline underline-offset-4">Forgot passcode?</button>}
          {mode === "reset" && <button type="button" onClick={() => { setMode("unlock"); setError(null); setCode(""); setAgain(""); }} className="underline underline-offset-4">Back</button>}
          <button type="button" onClick={onSignOut} className="ml-auto underline underline-offset-4">Sign out</button>
        </div>
      </div>
    </main>
  );
}
