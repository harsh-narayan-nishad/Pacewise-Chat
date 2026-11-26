"use client";
import { useState } from "react";
import { ArrowLeft, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { QrSignIn } from "@/components/QrSignIn";
import { Logo } from "@/components/Logo";
import { ApiError, googleLogin, login, logout, PACEWISE_URL, type User } from "@/lib/api";
import { Button } from "@/components/ui";
import { SocialButtons } from "@/components/SocialButtons";
import { PasswordInput } from "@/components/PasswordInput";
import { ButtonWheel } from "@/components/WheelSpinner";

const BOX = "block w-full rounded-none border border-overlay/25 bg-transparent px-4 py-4 text-base text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-ink";

/** Same sign-in as Pacewise: the same e-mail/username and password (or Google) work here. */
export function LoginCard({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Phones: the QR code opens under the form when asked for (computers always show it on the right). */
  const [qrOpen, setQrOpen] = useState(false);

  async function run(signIn: () => Promise<User>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signIn());
    } catch (err) {
      await logout();
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid h-screen w-full grid-rows-[minmax(0,1fr)] overflow-hidden lg:grid-cols-2">
      <div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 py-10 sm:px-12 lg:px-[8vw]">
        {/* Phones: "Sign in with a QR code" opens the code as a page of its own, in place of the form. */}
        {qrOpen && (
          <div className="my-auto flex flex-col items-center lg:hidden">
            <button type="button" onClick={() => setQrOpen(false)} className="mb-8 inline-flex items-center gap-1.5 self-start text-sm font-medium text-ink-muted hover:text-ink">
              <ArrowLeft className="h-4 w-4" /> Sign in with password
            </button>
            <Logo size="lg" className="mb-10 self-start" />
            <QrSignIn onSignedIn={onSignedIn} />
          </div>
        )}
        <div className={cn("my-auto", qrOpen && "hidden lg:block")}>
          <Logo size="lg" className="mb-8" />
          <h1 className="mb-3 font-display text-5xl leading-[1.04] tracking-[-0.04em] text-ink sm:text-6xl xl:text-7xl">Say it. Safely.</h1>
          <p className="mb-10 max-w-sm text-ink-muted">Sign in with your Pacewise account to message anyone on Pacewise. Every chat is end-to-end encrypted.</p>
          <div className="w-full max-w-sm">
            <SocialButtons disabled={busy} onGoogleToken={(t) => void run(() => googleLogin(t))} onUnavailable={setError} />
            <form onSubmit={(e) => { e.preventDefault(); void run(() => login(identifier.trim(), password)); }} className="flex flex-col gap-4">
              <label className="block">
                <span className="sr-only">Email or username</span>
                <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Email or username" autoComplete="username" required className={BOX} />
              </label>
              <label className="block">
                <span className="sr-only">Password</span>
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" required className={BOX} />
              </label>
              {error && <p className="text-sm text-accent-extreme" role="alert">{error}</p>}
              <Button type="submit" size="lg" disabled={busy} className="mt-1 h-14 w-full text-base">{busy && <ButtonWheel />}{busy ? "Please wait…" : "Sign in"}</Button>
            </form>
            <button type="button" onClick={() => setQrOpen(true)}
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-ink underline-offset-4 hover:underline lg:hidden">
              <QrCode className="h-4 w-4" /> Sign in with a QR code
            </button>
            <p className="mt-6 text-sm text-ink-muted">
              No account yet? <a href={PACEWISE_URL} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-4 hover:text-accent-medium">Create one in Pacewise</a>.
            </p>
          </div>
        </div>
      </div>
      {/* Computers: sign in by scanning this code with a phone where Palk is signed in (as WhatsApp Web). */}
      <div className="hidden h-full items-center justify-center overflow-y-auto border-l border-overlay/10 px-8 lg:flex">
        <QrSignIn onSignedIn={onSignedIn} />
      </div>
    </main>
  );
}
