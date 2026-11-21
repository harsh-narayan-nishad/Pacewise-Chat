"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Search, Users, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ButtonWheel } from "@/components/WheelSpinner";
import { chatApi, presenceLabel, type Person } from "@/lib/chat";
import { cn } from "@/lib/utils";

/**
 * Everyone on Pacewise, searchable by name or @username, with their online / last seen. One tap opens a chat;
 * in "pick" mode people are ticked instead (new group, add members).
 */
export function PeoplePicker({ exclude = [], selected, onToggle, onPick, top, autoFocus = true }: {
  exclude?: string[]; selected?: Map<string, Person>; onToggle?: (p: Person) => void; onPick?: (p: Person) => void; top?: React.ReactNode; autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Person[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = async (term: string, skip: number) => {
    const n = ++seq.current;
    setBusy(true);
    try {
      const r = await chatApi.users(term, skip, 40);
      if (n !== seq.current) return;
      setItems((prev) => (skip ? [...prev, ...r.items] : r.items));
      setHasMore(r.hasMore);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : "Could not load people.");
    } finally {
      if (n === seq.current) setBusy(false);
    }
  };
  useEffect(() => {
    const t = window.setTimeout(() => void load(q.trim(), 0), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = new Set(exclude);
  const list = items.filter((p) => !skip.has(p.id));
  const picking = !!onToggle;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-2">
        <label className="flex h-10 items-center gap-3 rounded-full bg-overlay/[0.07] px-4 text-ink-muted focus-within:ring-1 focus-within:ring-brand/60">
          <Search className="h-4 w-4 shrink-0" />
          <span className="sr-only">Search people</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} placeholder="Search name or @username" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </label>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {top}
        <p className="px-4 pb-1 pt-3 text-xs uppercase tracking-wide text-brand">{q.trim() ? "Search results" : "Everyone on Pacewise"}</p>
        {error && <p className="px-4 py-4 text-sm text-accent-extreme" role="alert">{error}</p>}
        <ul>
          {list.map((p) => {
            const on = selected?.has(p.id) ?? false;
            return (
              <li key={p.id}>
                <button type="button" onClick={() => (picking ? onToggle!(p) : onPick?.(p))} aria-pressed={picking ? on : undefined}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-overlay/[0.05]">
                  <span className="relative">
                    <Avatar id={p.id} name={p.name} url={p.avatarUrl} online={p.online} size={44} />
                    {picking && on && <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-canvas bg-brand text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>}
                  </span>
                  <span className="min-w-0 flex-1 border-b border-overlay/[0.06] pb-2.5 pt-0.5">
                    <span className="block truncate text-[15px] text-ink">{p.name}</span>
                    <span className={cn("block truncate text-xs", p.online ? "text-brand" : "text-ink-muted")}>@{p.username} · {presenceLabel(p)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {!busy && list.length === 0 && !error && <p className="px-6 py-8 text-center text-sm text-ink-muted">{q.trim() ? `No one on Pacewise matches “${q.trim()}”.` : "No one else is on Pacewise yet."}</p>}
        {busy && <p className="flex justify-center py-4 text-ink-muted"><ButtonWheel size={18} /></p>}
        {hasMore && !busy && <button type="button" onClick={() => void load(q.trim(), items.length)} className="block w-full py-4 text-center text-sm text-brand">Show more people</button>}
      </div>
    </div>
  );
}

/** "New chat" (pick one person), or "New group": pick people, then name it. */
export function NewChat({ mode, me, onClose, onMode, onPick, onCreateGroup }: {
  mode: "chat" | "group"; me: string; onClose: () => void; onMode: (m: "chat" | "group") => void; onPick: (userId: string) => void;
  onCreateGroup: (name: string, ids: string[], description: string) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Map<string, Person>>(new Map());
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const toggle = (p: Person) => setPicked((m) => { const n = new Map(m); if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p); return n; });
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try { await onCreateGroup(name.trim(), [...picked.keys()], about.trim()); } catch (e) { setError(e instanceof Error ? e.message : "Could not create the group."); setBusy(false); }
  };

  const title = mode === "chat" ? "New chat" : step === 1 ? "Add group members" : "New group";
  return (
    <div className="slide-in-left flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-4 px-4">
        <button type="button" onClick={() => (mode === "group" && step === 2 ? setStep(1) : onClose())} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-overlay/[0.08]"><ArrowLeft className="h-5 w-5" /></button>
        <h2 className="text-lg text-ink">{title}</h2>
      </header>

      {mode === "chat" && (
        <PeoplePicker exclude={[me]} onPick={(p) => onPick(p.id)} top={
          <>
            <button type="button" onClick={() => onMode("group")} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-overlay/[0.05]">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-white"><Users className="h-5 w-5" /></span>
              <span className="text-[15px] text-ink">New group</span>
            </button>
            <button type="button" onClick={() => onPick(me)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-overlay/[0.05]">
              <Avatar id={me} name="You" size={44} />
              <span className="min-w-0"><span className="block text-[15px] text-ink">Message yourself</span><span className="block text-xs text-ink-muted">Notes, links and reminders, encrypted</span></span>
            </button>
          </>
        } />
      )}

      {mode === "group" && step === 1 && (
        <>
          {picked.size > 0 && (
            <div className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-3">
              {[...picked.values()].map((p) => (
                <button key={p.id} type="button" onClick={() => toggle(p)} className="flex items-center gap-1.5 rounded-full bg-overlay/[0.08] py-1 pl-1 pr-2.5 text-sm text-ink">
                  <Avatar id={p.id} name={p.name} url={p.avatarUrl} size={22} /> {p.name.split(" ")[0]} <X className="h-3.5 w-3.5 text-ink-muted" />
                </button>
              ))}
            </div>
          )}
          <PeoplePicker exclude={[me]} selected={picked} onToggle={toggle} />
          <div className="flex shrink-0 justify-center py-4">
            <button type="button" disabled={picked.size === 0} onClick={() => setStep(2)} aria-label="Next"
              className="glass-fab flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-themed disabled:opacity-30"><ArrowRight className="h-6 w-6" /></button>
          </div>
        </>
      )}

      {mode === "group" && step === 2 && (
        <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-4">
          <div className="flex justify-center"><Avatar id={name || "group"} name={name || "Group"} group size={96} /></div>
          <label className="block">
            <span className="text-sm text-ink-muted">Group name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required placeholder="e.g. NEET 2027 study group"
              className="mt-1 block w-full border-0 border-b-2 border-brand/70 bg-transparent pb-2 pt-1 text-base text-ink outline-none placeholder:text-ink-faint" />
          </label>
          <label className="block">
            <span className="text-sm text-ink-muted">Description (optional)</span>
            <textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={300} rows={2}
              className="mt-1 block w-full resize-none border-0 border-b border-overlay/25 bg-transparent pb-2 pt-1 text-base text-ink outline-none" />
          </label>
          <p className="text-sm text-ink-muted">{picked.size + 1} members: you, {[...picked.values()].map((p) => p.name).join(", ")}</p>
          {error && <p className="text-sm text-accent-extreme" role="alert">{error}</p>}
          <div className="mt-auto flex justify-center pb-2">
            <button type="submit" disabled={!name.trim() || busy} aria-label="Create group"
              className="glass-fab flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-themed disabled:opacity-30">{busy ? <ButtonWheel /> : <Check className="h-6 w-6" />}</button>
          </div>
        </form>
      )}
    </div>
  );
}
