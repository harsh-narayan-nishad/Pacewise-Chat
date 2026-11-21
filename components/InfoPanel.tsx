"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Ban, Check, Flag, LogOut, Lock, MessageSquare, Pencil, ShieldCheck, ShieldOff, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { PeoplePicker } from "@/components/NewChat";
import { ConfirmDialog } from "@/components/ui";
import { ButtonWheel } from "@/components/WheelSpinner";
import { chatApi, otherOf, presenceLabel, titleOf, type Conversation, type Member, type Person } from "@/lib/chat";
import { fingerprint, securityCode, type Identity } from "@/lib/crypto";
import { cn } from "@/lib/utils";

type View = { kind: "main" } | { kind: "verify"; member: Member } | { kind: "add" };
type Confirm = { title: string; body: string; label: string; run: () => Promise<void> };

/** Contact info / group info: who, encryption (verify security code), members and admins, clear / delete / exit. */
export function InfoPanel({ conv, me, identity, onClose, onMessage, onChanged, onError, onDeleteChat, onReport }: {
  conv: Conversation; me: string; identity: Identity; onClose: () => void; onMessage: (userId: string) => void;
  onChanged: (c: Conversation | null | undefined, reloadMessages?: boolean) => Promise<void>; onError: (m: string) => void; onDeleteChat: () => void;
  /** Report spam (opens the report form). */
  onReport?: () => void;
}) {
  const [view, setView] = useState<View>({ kind: "main" });
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const isGroup = conv.type === "group";
  const admin = conv.myRole === "admin";
  const other = otherOf(conv, me);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !confirm) (view.kind === "main" ? onClose() : setView({ kind: "main" })); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [view, confirm, onClose]);

  const act = async (fn: () => Promise<Conversation | null | undefined>, reload = false) => {
    try { await onChanged(await fn(), reload); } catch (e) { onError(e instanceof Error ? e.message : "Something went wrong."); }
  };

  return (
    <aside className="slide-in-right fixed inset-0 z-50 flex h-full flex-col bg-canvas lg:static lg:z-auto lg:w-[380px] lg:shrink-0 lg:border-l lg:border-overlay/10">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-overlay/10 px-4">
        <button type="button" onClick={() => (view.kind === "main" ? onClose() : setView({ kind: "main" }))} aria-label={view.kind === "main" ? "Close" : "Back"} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-overlay/[0.08]">
          {view.kind === "main" ? <X className="h-5 w-5" /> : <ArrowLeft className="h-5 w-5" />}
        </button>
        <h2 className="text-lg text-ink">{view.kind === "verify" ? "Verify security code" : view.kind === "add" ? "Add members" : isGroup ? "Group info" : "Contact info"}</h2>
      </header>

      {view.kind === "verify" && <Verify member={view.member} identity={identity} me={me} />}
      {view.kind === "add" && <AddMembers conv={conv} onDone={(c) => { setView({ kind: "main" }); void onChanged(c, false); }} onError={onError} />}
      {view.kind === "main" && (
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          <section className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
            <Avatar id={isGroup ? conv.id : other?.id ?? conv.id} name={titleOf(conv, me)} url={other?.avatarUrl} group={isGroup} size={112} />
            {isGroup ? <EditableName conv={conv} canEdit={admin} onSave={(name) => act(() => chatApi.update(conv.id, { name }))} /> : <h3 className="mt-4 text-2xl text-ink">{titleOf(conv, me)}</h3>}
            <p className="mt-1 text-sm text-ink-muted">
              {isGroup ? `Group · ${conv.members.length} members` : other?.id === me ? `@${other.username} · notes to yourself` : other ? `@${other.username}` : ""}
            </p>
            {!isGroup && other && other.id !== me && <p className={cn("mt-1 text-sm", other.online ? "text-brand" : "text-ink-muted")}>{presenceLabel(other)}</p>}
          </section>

          {isGroup && <EditableAbout conv={conv} canEdit={admin} onSave={(description) => act(() => chatApi.update(conv.id, { description }))} />}

          <Row icon={Lock} title="Encryption" sub={isGroup ? "Messages are end-to-end encrypted. Verify a member's code from their name below." : "Messages are end-to-end encrypted. Click to verify."}
            onClick={!isGroup && other && other.id !== me ? () => setView({ kind: "verify", member: other }) : undefined} />

          {isGroup && (
            <section className="mt-2 border-t border-overlay/10 pt-3">
              <p className="px-6 pb-2 text-sm text-ink-muted">{conv.members.length} members</p>
              {admin && <Row icon={UserPlus} title="Add members" accent onClick={() => setView({ kind: "add" })} />}
              <ul>
                {[...conv.members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.role !== b.role ? (a.role === "admin" ? -1 : 1) : a.name.localeCompare(b.name))).map((m) => (
                  <MemberRow key={m.id} m={m} me={me} iAmAdmin={admin} onMessage={() => onMessage(m.id)} onVerify={() => setView({ kind: "verify", member: m })}
                    onAdmin={(on) => act(() => chatApi.setAdmin(conv.id, m.id, on))}
                    onRemove={() => setConfirm({ title: `Remove ${m.name}?`, body: `${m.name} will no longer get this group's messages. A new encryption key is made, so they can't read what is sent from now on.`, label: "Remove",
                      run: () => act(() => chatApi.removeMember(conv.id, m.id), true) })} />
                ))}
              </ul>
            </section>
          )}

          {onReport && !(other && other.id === me && !isGroup) && (
            <section className="mt-2 border-t border-overlay/10 py-2">
              <Row icon={Flag} title={isGroup ? "Report spam" : `Report ${other?.name.split(" ")[0] ?? "spam"}`} danger
                sub={isGroup ? "Report a member to the Pacewise team" : "Spam, harassment or a fake account? Tell the Pacewise team"} onClick={onReport} />
            </section>
          )}

          <section className="mt-2 border-t border-overlay/10 py-2">
            <Row icon={Ban} title="Clear chat" danger onClick={() => setConfirm({ title: "Clear this chat?", body: "Messages are removed from this chat for you only. Others still see them.", label: "Clear chat", run: () => act(() => chatApi.clear(conv.id), true) })} />
            {isGroup && (
              <Row icon={LogOut} title="Exit group" danger onClick={() => setConfirm({ title: `Exit "${conv.name}"?`, body: "You stop getting this group's messages, and it leaves your chat list.", label: "Exit group", run: () => act(async () => { await chatApi.removeMember(conv.id, me); return null; }) })} />
            )}
            <Row icon={Trash2} title={isGroup ? "Delete group" : "Delete chat"} danger onClick={onDeleteChat} />
          </section>
        </div>
      )}

      {confirm && <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.label} danger onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </aside>
  );
}

function Row({ icon: Icon, title, sub, onClick, danger, accent }: { icon: typeof Lock; title: string; sub?: string; onClick?: () => void; danger?: boolean; accent?: boolean }) {
  const inner = (
    <>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", accent ? "bg-brand text-white" : "text-ink-muted", danger && "text-accent-extreme")}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[15px]", danger ? "text-accent-extreme" : "text-ink")}>{title}</span>
        {sub && <span className="block text-xs text-ink-muted">{sub}</span>}
      </span>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-overlay/[0.05]">{inner}</button>
    : <div className="flex items-center gap-3 px-4 py-2.5">{inner}</div>;
}

function EditableName({ conv, canEdit, onSave }: { conv: Conversation; canEdit: boolean; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(conv.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(conv.name), [conv.name]);
  if (!editing) {
    return (
      <h3 className="mt-4 flex items-center gap-2 text-2xl text-ink">
        {conv.name}
        {canEdit && <button type="button" onClick={() => setEditing(true)} aria-label="Edit group name" className="text-ink-muted"><Pencil className="h-4 w-4" /></button>}
      </h3>
    );
  }
  return (
    <form className="mt-4 flex w-full items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; setBusy(true); await onSave(name.trim()); setBusy(false); setEditing(false); }}>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus className="min-w-0 flex-1 border-0 border-b-2 border-brand/70 bg-transparent pb-1 text-center text-xl text-ink outline-none" />
      <button type="submit" disabled={busy} aria-label="Save" className="text-brand">{busy ? <ButtonWheel /> : <Check className="h-5 w-5" />}</button>
    </form>
  );
}

function EditableAbout({ conv, canEdit, onSave }: { conv: Conversation; canEdit: boolean; onSave: (d: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(conv.description);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(conv.description), [conv.description]);
  return (
    <section className="border-t border-overlay/10 px-6 py-4">
      {editing ? (
        <form className="flex items-start gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSave(text.trim()); setBusy(false); setEditing(false); }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} rows={3} autoFocus className="min-w-0 flex-1 resize-none border-0 border-b-2 border-brand/70 bg-transparent text-sm text-ink outline-none" />
          <button type="submit" disabled={busy} aria-label="Save" className="text-brand">{busy ? <ButtonWheel /> : <Check className="h-5 w-5" />}</button>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className={cn("whitespace-pre-wrap text-sm", conv.description ? "text-ink" : "text-ink-faint")}>{conv.description || (canEdit ? "Add group description" : "No description")}</p>
          {canEdit && <button type="button" onClick={() => setEditing(true)} aria-label="Edit description" className="shrink-0 text-ink-muted"><Pencil className="h-4 w-4" /></button>}
        </div>
      )}
    </section>
  );
}

function MemberRow({ m, me, iAmAdmin, onMessage, onVerify, onAdmin, onRemove }: {
  m: Member; me: string; iAmAdmin: boolean; onMessage: () => void; onVerify: () => void; onAdmin: (on: boolean) => Promise<void>; onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isMe = m.id === me;
  const action = "flex w-full items-center gap-3 px-6 py-2 text-left text-sm hover:bg-overlay/[0.05]";
  return (
    <li>
      <button type="button" disabled={isMe} onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-overlay/[0.05] disabled:hover:bg-transparent">
        <Avatar id={m.id} name={m.name} url={m.avatarUrl} online={!isMe && m.online} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] text-ink">{isMe ? "You" : m.name}</span>
          <span className={cn("block truncate text-xs", !isMe && m.online ? "text-brand" : "text-ink-muted")}>{isMe ? `@${m.username}` : `@${m.username} · ${presenceLabel(m)}`}</span>
        </span>
        {m.role === "admin" && <span className="shrink-0 rounded-md bg-brand/15 px-1.5 py-0.5 text-[11px] text-brand">Group admin</span>}
      </button>
      {open && !isMe && (
        <div className="glass-in bg-overlay/[0.03] py-1">
          <button type="button" className={action} onClick={onMessage}><MessageSquare className="h-4 w-4 text-ink-muted" /> Message {m.name.split(" ")[0]}</button>
          <button type="button" className={action} onClick={onVerify}><ShieldCheck className="h-4 w-4 text-ink-muted" /> Verify security code</button>
          {iAmAdmin && (m.role === "admin"
            ? <button type="button" className={action} onClick={() => void onAdmin(false)}><ShieldOff className="h-4 w-4 text-ink-muted" /> Dismiss as admin</button>
            : <button type="button" className={action} onClick={() => void onAdmin(true)}><ShieldCheck className="h-4 w-4 text-ink-muted" /> Make group admin</button>)}
          {iAmAdmin && <button type="button" className={cn(action, "text-accent-extreme")} onClick={onRemove}><UserMinus className="h-4 w-4" /> Remove {m.name.split(" ")[0]}</button>}
        </div>
      )}
    </li>
  );
}

/** The 60-digit code both people should see the same, and the two key fingerprints. */
function Verify({ member, identity, me }: { member: Member; identity: Identity; me: string }) {
  const [code, setCode] = useState<string[] | null>(null);
  const [prints, setPrints] = useState<[string, string] | null>(null);
  useEffect(() => {
    if (!member.publicKey) return;
    void Promise.all([securityCode(identity.publicKey, member.publicKey), fingerprint(identity.publicKey), fingerprint(member.publicKey)])
      .then(([c, a, b]) => { setCode(c); setPrints([a, b]); });
  }, [member.publicKey, identity.publicKey]);
  if (member.id === me) return null;
  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-6 py-8">
      <div className="flex flex-col items-center text-center">
        <Avatar id={member.id} name={member.name} url={member.avatarUrl} size={72} />
        <p className="mt-3 text-lg text-ink">You and {member.name}</p>
      </div>
      {!member.publicKey ? (
        <p className="mt-8 text-center text-sm text-ink-muted">{member.name.split(" ")[0]} hasn&apos;t opened Pacewise Chat yet, so there is no code to compare.</p>
      ) : code && prints ? (
        <>
          <div className="mx-auto mt-8 grid max-w-xs grid-cols-4 gap-x-4 gap-y-3 font-mono text-lg tracking-wider text-ink">
            {code.map((g, i) => <span key={i} className="text-center">{g}</span>)}
          </div>
          <p className="mt-8 text-sm leading-relaxed text-ink-muted">
            To check that your chat with {member.name.split(" ")[0]} is end-to-end encrypted, compare these numbers with the ones on their screen (in person or on a call). If they match, nobody in between, not even Pacewise, can read your messages.
          </p>
          <dl className="mt-6 space-y-3 rounded-xl bg-overlay/[0.05] p-4 font-mono text-[11px] text-ink-muted">
            <div><dt className="mb-0.5 font-sans text-xs text-ink">Your key</dt><dd className="break-words">{prints[0]}</dd></div>
            <div><dt className="mb-0.5 font-sans text-xs text-ink">{member.name}&apos;s key</dt><dd className="break-words">{prints[1]}</dd></div>
          </dl>
        </>
      ) : (
        <div className="mt-10 flex justify-center text-ink-muted"><ButtonWheel size={20} /></div>
      )}
    </div>
  );
}

function AddMembers({ conv, onDone, onError }: { conv: Conversation; onDone: (c: Conversation) => void; onError: (m: string) => void }) {
  const [picked, setPicked] = useState<Map<string, Person>>(new Map());
  const [busy, setBusy] = useState(false);
  const toggle = (p: Person) => setPicked((m) => { const n = new Map(m); if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p); return n; });
  const add = async () => {
    setBusy(true);
    try { onDone(await chatApi.addMembers(conv.id, [...picked.keys()])); } catch (e) { onError(e instanceof Error ? e.message : "Could not add them."); setBusy(false); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-3">
      <PeoplePicker exclude={conv.members.map((m) => m.id)} selected={picked} onToggle={toggle} />
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-overlay/10 px-4 py-3">
        <span className="truncate text-sm text-ink-muted">{picked.size ? [...picked.values()].map((p) => p.name.split(" ")[0]).join(", ") : "Pick people to add"}</span>
        <button type="button" disabled={!picked.size || busy} onClick={() => void add()} aria-label="Add" className="glass-fab flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-30">{busy ? <ButtonWheel /> : <Check className="h-5 w-5" />}</button>
      </div>
      <p className="px-4 pb-3 text-xs text-ink-faint">New members see messages from when they join.</p>
    </div>
  );
}
