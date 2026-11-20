"use client";
import { useCallback, useEffect, useState } from "react";
import { WheelSpinner } from "@/components/WheelSpinner";
import { LoginCard } from "@/components/LoginCard";
import { Unlock } from "@/components/Unlock";
import { Messenger } from "@/components/Messenger";
import { api, ApiError, logout, session, type User } from "@/lib/api";
import { chatApi } from "@/lib/chat";
import type { Identity, StoredKeys } from "@/lib/crypto";
import { vault } from "@/lib/vault";

const THEME_KEY = "pacewise-chat-theme";

/** Sign in (same Pacewise account) → unlock encryption → the messenger. */
export function ChatApp() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [light, setLight] = useState(false);
  const [stored, setStored] = useState<StoredKeys | null | undefined>(undefined);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (session.get()) {
        try {
          setUser((await api<{ user: User }>("/auth/me")).user);
        } catch (e) {
          if (e instanceof ApiError && e.status !== 0) session.clear();
        }
      }
      try { setLight(localStorage.getItem(THEME_KEY) === "light"); } catch { /* storage blocked */ }
      setChecking(false);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
    try { localStorage.setItem(THEME_KEY, light ? "light" : "dark"); } catch { /* storage blocked */ }
  }, [light]);

  // After sign-in: the account's stored keys, and this device's unlocked copy if it still matches them.
  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      try {
        const { keys } = await chatApi.myKeys();
        const local = await vault.get(user.id);
        if (!live) return;
        setStored(keys);
        if (keys && local && local.publicKey === keys.publicKey) setIdentity(local);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load your chats.");
      }
    })();
    return () => { live = false; };
  }, [user]);

  const unlocked = useCallback(async (id: Identity) => {
    if (user) await vault.set(user.id, id);
    setIdentity(id);
  }, [user]);

  const signOut = useCallback(async () => {
    if (user) await vault.remove(user.id);
    await logout();
    setUser(null);
    setIdentity(null);
    setStored(undefined);
  }, [user]);

  const lock = useCallback(async () => {
    if (user) await vault.remove(user.id);
    setIdentity(null);
    setStored((await chatApi.myKeys().catch(() => ({ keys: null }))).keys);
  }, [user]);

  if (checking) return <div className="relative min-h-screen"><WheelSpinner label="Signing you in" /></div>;
  if (!user) return <LoginCard onSignedIn={setUser} />;
  if (error) return <p className="p-10 text-sm text-accent-extreme" role="alert">{error}</p>;
  if (stored === undefined) return <div className="relative min-h-screen"><WheelSpinner label="Opening your chats" /></div>;
  if (!identity) return <Unlock stored={stored} onUnlocked={(id) => void unlocked(id)} onSignOut={() => void signOut()} />;
  return <Messenger user={user} identity={identity} light={light} setLight={setLight} onLock={() => void lock()} onSignOut={() => void signOut()} />;
}
