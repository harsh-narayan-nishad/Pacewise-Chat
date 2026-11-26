"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ButtonWheel } from "@/components/WheelSpinner";
import { api, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

/** A picked photo, squared from its centre and shrunk to 256 px, as a JPEG data URL (small enough to store with the profile). */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("That file is not a picture we can read.")); };
    img.src = src;
  });
}

/** My profile: photo, name, @username, interests (and the e-mail, which is shown but not changed here). */
export function ProfilePanel({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (u: User) => void }) {
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [avatar, setAvatar] = useState<string | null>(user.avatarUrl ?? null);
  const [interests, setInterests] = useState<string[]>(user.interests ?? []);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, busy]);

  const cleanUser = username.trim();
  const userOk = /^[a-zA-Z0-9_]{3,24}$/.test(cleanUser);
  const changed = name.trim() !== user.name || cleanUser !== user.username || avatar !== (user.avatarUrl ?? null)
    || interests.join("\n") !== (user.interests ?? []).join("\n");
  const canSave = changed && !!name.trim() && userOk && !busy;

  const addTag = () => {
    const t = tag.trim().slice(0, 40);
    if (t && interests.length < 20 && !interests.some((x) => x.toLowerCase() === t.toLowerCase())) setInterests([...interests, t]);
    setTag("");
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try { setAvatar(await shrink(f)); } catch (e) { setError(e instanceof Error ? e.message : "Could not use that picture."); }
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (name.trim() !== user.name) body.name = name.trim();
      if (cleanUser !== user.username) body.username = cleanUser;
      if (avatar !== (user.avatarUrl ?? null)) body.avatarUrl = avatar;
      if (interests.join("\n") !== (user.interests ?? []).join("\n")) body.interests = interests;
      const u = await api<User>("/users/me", { method: "PATCH", body });
      onSaved({ ...user, ...u });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const label = "px-4 pb-1.5 text-[13px] font-medium uppercase tracking-[0.06em] text-ink-muted";
  const input = "pw-field h-11 w-full rounded-[11px] px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-brand/40";
  return (
    <div className="slide-in-left flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-4 px-4">
        <button type="button" onClick={onClose} disabled={busy} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-overlay/[0.08]"><ArrowLeft className="h-5 w-5" /></button>
        <h2 className="flex-1 text-lg text-ink">Profile</h2>
        <button type="button" onClick={() => void save()} disabled={!canSave} aria-busy={busy}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-brand px-4 text-[15px] font-semibold text-white transition-opacity disabled:opacity-40">
          {busy && <ButtonWheel size={14} />}{busy ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </header>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-8">
        <div className="flex flex-col items-center gap-3 px-4 pb-6 pt-2">
          <button type="button" onClick={() => file.current?.click()} className="group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label="Change photo">
            <Avatar id={user.id} name={name.trim() || user.name} url={avatar} size={112} />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Camera className="h-7 w-7" /></span>
          </button>
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="flex gap-4 text-[15px]">
            <button type="button" onClick={() => file.current?.click()} className="text-brand">{avatar ? "Change photo" : "Add photo"}</button>
            {avatar && <button type="button" onClick={() => setAvatar(null)} className="text-accent-extreme">Remove</button>}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <label className="block">
            <span className={cn(label, "block")}>Name</span>
            <span className="block px-4"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Your name" className={input} /></span>
          </label>

          <label className="block">
            <span className={cn(label, "block")}>Username</span>
            <span className="block px-4">
              <span className={cn(input, "flex items-center gap-0.5 focus-within:ring-2 focus-within:ring-brand/40")}>
                <span className="text-ink-faint">@</span>
                <input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))} maxLength={24} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="min-w-0 flex-1 bg-transparent outline-none" />
              </span>
            </span>
            {!userOk && <span className="block px-4 pt-1.5 text-[13px] text-accent-extreme">3–24 letters, numbers or underscores.</span>}
          </label>

          <div>
            <p className={label}>E-mail</p>
            <p className="px-4"><span className={cn(input, "flex items-center text-ink-muted")}>{user.email}</span></p>
          </div>

          <div>
            <p className={label}>Interests</p>
            <div className="px-4">
              {interests.length > 0 && (
                <ul className="mb-2.5 flex flex-wrap gap-2">
                  {interests.map((t) => (
                    <li key={t} className="inline-flex items-center gap-1 rounded-full bg-brand/15 py-1 pl-3 pr-1.5 text-[14px] text-brand">
                      {t}
                      <button type="button" onClick={() => setInterests(interests.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-brand/20"><X className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} onBlur={addTag}
                maxLength={40} disabled={interests.length >= 20} placeholder={interests.length >= 20 ? "Up to 20 interests" : "Add an interest and press Enter"} className={input} />
            </div>
          </div>
        </div>

        {error && <p className="px-4 pt-4 text-[14px] text-accent-extreme" role="alert">{error}</p>}
      </div>
    </div>
  );
}
