# Pacewise Chat — Complete Engineering Docs (0 → 100)

> An end-to-end encrypted, real-time messenger (1:1 + groups) built on the existing Pacewise accounts and backend.
> This document covers the whole thing: product, architecture, data model, API, real-time, cryptography,
> consistency, scaling, security, known gaps, and an interview question bank. Read it top to bottom once, then
> use the **Interview Kit** (§22–§25) for revision.

---

## Table of Contents

**Part A — Basics (0 → 30)**
1. [Elevator pitch (30 s / 2 min)](#1-elevator-pitch)
2. [Run it locally](#2-run-it-locally)
3. [Features](#3-features)
4. [Tech stack and why](#4-tech-stack-and-why)
5. [Repository map](#5-repository-map)

**Part B — Design (30 → 70)**

6. [High-level architecture](#6-high-level-architecture)
7. [Data model (MongoDB)](#7-data-model-mongodb)
8. [REST API reference](#8-rest-api-reference)
9. [Authentication and session](#9-authentication-and-session)
10. [Real-time: SSE + Redis pub/sub](#10-real-time-sse--redis-pubsub)
11. [End-to-end encryption (deep dive)](#11-end-to-end-encryption-deep-dive)
12. [Message lifecycle: send and receive](#12-message-lifecycle-send-and-receive)
13. [Receipts, typing, presence](#13-receipts-typing-presence)
14. [Groups: roles, membership, key epochs](#14-groups-roles-membership-key-epochs)
15. [Delete / clear semantics](#15-delete--clear-semantics)
16. [Pagination](#16-pagination)
17. [Frontend architecture](#17-frontend-architecture)

**Part C — Senior / Staff depth (70 → 100)**

18. [Concurrency, races, idempotency](#18-concurrency-races-idempotency)
19. [Security hardening and threat model](#19-security-hardening-and-threat-model)
20. [Scaling: 1K → 1M → 100M users](#20-scaling-1k--1m--100m-users)
21. [Known gaps, bugs and what I would fix next](#21-known-gaps-bugs-and-what-i-would-fix-next)

**Part D — Interview Kit**

22. [Numbers cheat sheet](#22-numbers-cheat-sheet)
23. [Trade-off table (decision → why → alternative)](#23-trade-off-table)
24. [Interview Q&A bank](#24-interview-qa-bank)
25. ["Design WhatsApp" — mapping this project to the classic question](#25-design-whatsapp--mapping-this-project)
26. [Glossary](#26-glossary)

---

# Part A — Basics

## 1. Elevator pitch

**30 seconds**
> "Pacewise Chat is a WhatsApp-style messenger I built as a separate Next.js app on top of our existing Express +
> MongoDB backend. It does 1:1 and group chats with typing indicators, presence, delivered/read ticks, replies and
> delete-for-everyone. Messages are end-to-end encrypted in the browser with Web Crypto — ECDH P-256 identities,
> a per-chat AES-256-GCM key that rotates whenever someone leaves — so the server only stores ciphertext. Live
> updates go over Server-Sent Events, fanned out across API instances with Redis pub/sub."

**2 minutes** (add these points)
- **Same accounts**: reuses the platform's JWT auth (access + refresh tokens), no separate user system.
- **Key management without a key server**: each user's private key is stored on the server *encrypted under a
  passcode* (PBKDF2 → AES-GCM) so chats open on any device. Conversation keys are wrapped per member with
  ECDH + HKDF. Any online member's browser can "share" a key with a member who is waiting for it — the server just
  enforces *who may write which slot*.
- **Forward exclusion**: removing/leaving a member bumps the chat's **epoch** → new key → the ex-member can't read
  new messages. New members only get the current epoch → they can't read history.
- **Correctness**: client-generated UUIDs make sends idempotent; a unique partial index prevents duplicate 1:1
  chats; conditional updates resolve "two browsers seed a key at once" races; `$max` makes read receipts monotonic.
- **Ops**: works on one instance with no Redis (in-process EventEmitter), scales horizontally with Redis.

---

## 2. Run it locally

```bash
cp .env.local.example .env.local   # then npm install
npm run dev                        # http://localhost:3003
```

| Env var | Meaning |
|---|---|
| `NEXT_PUBLIC_API_URL` | Local backend incl. `/api/v1` (default `http://localhost:4000/api/v1`) |
| `NEXT_PUBLIC_API_URL_ONLINE` | Online backend, used when the local one isn't running |
| `NEXT_PUBLIC_PACEWISE_URL` | Main Pacewise app (for "Create an account") |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Optional, "Continue with Google" |

Production: add this app's origin to the backend's `CORS_ORIGINS`. Backend: `cd ../backend && npm run dev`
(Mongo required; `REDIS_URL` optional).

**Backend auto-selection** ([lib/backend.ts](lib/backend.ts)): on `localhost`, the app probes
`GET {LOCAL}/health` once (1.5 s timeout). Up → local; down → online. If the local backend dies mid-session, the
first network failure flips to online (`fallBackToOnline()`) and retries the request once. When deployed on any
other host it always uses the online backend (unless a non-localhost URL is configured).

---

## 3. Features

| Area | What exists |
|---|---|
| Chats | 1:1, groups (≤ 256), "message yourself" (direct chat with yourself) |
| Discovery | Search every active Pacewise user by name / `@username` (paginated) |
| Messaging | Text (≈4,000 chars), replies, links auto-linked, copy, retry failed sends |
| Status | Sending (clock) → sent (✓) → delivered (✓✓ grey) → read (✓✓ blue) |
| Live | Typing…, online / last seen, new messages without refresh, browser notifications (background tab) |
| Groups | Name, description, admins, add/remove members, exit, auto-promote when last admin leaves |
| Deletes | Message: for me / for everyone. Chat: clear, delete for me, delete for everyone |
| Security | E2EE, per-device unlock with passcode, "Lock chats", forgot-passcode reset, 60-digit security code + fingerprints |
| UX | Dark/light, mobile single-pane layout, unread count in tab title, day separators, per-sender name colours |

---

## 4. Tech stack and why

| Layer | Choice | Why (say this in the interview) |
|---|---|---|
| Frontend | Next.js 14 (App Router), React 18, Tailwind | Same stack as the other Pacewise apps; a fully client-rendered app (`"use client"`), Next used for build/routing/headers |
| Crypto | **Web Crypto API** (`crypto.subtle`) | Native, audited, constant-time, supports **non-extractable keys**; zero crypto dependencies to supply-chain-attack |
| Local key store | **IndexedDB** | Only browser store that can persist a `CryptoKey` object (structured clone) — localStorage can only hold strings, which would force an extractable key |
| Transport (live) | **Server-Sent Events** | One-way server→client push is all we need; plain HTTP (works through proxies/CDNs, auto-reconnect semantics); writes stay normal REST with auth, validation and rate limiting |
| Backend | Express + TypeScript | Existing platform |
| Validation | Zod | Runtime validation + inferred types, discriminated unions for `direct`/`group` |
| DB | MongoDB (Mongoose) | Existing platform; document model fits "conversation with embedded members + their key slots" well |
| Fan-out | Redis pub/sub (optional) + Node `EventEmitter` | Redis gets events between instances; EventEmitter gets them to the SSE connections on *this* instance |
| Rate limit | Fixed window, Redis `INCR`+`EXPIRE` or in-memory map | Shared across instances when Redis is present |

---

## 5. Repository map

```
chat/                              ← this app (Next.js, port 3003)
  app/layout.tsx, app/page.tsx     ← shell; page renders <ChatApp/>
  components/
    ChatApp.tsx                    ← state machine: signed-out → keys loading → locked → Messenger
    LoginCard.tsx, SocialButtons   ← sign-in with Pacewise account / Google
    Unlock.tsx                     ← passcode gate: setup / unlock / reset
    Messenger.tsx                  ← THE orchestrator: list, threads, decryption, SSE, polling, sending
    Sidebar.tsx                    ← chat list, search, menu (lock, sign out, theme, notifications)
    ChatWindow.tsx                 ← open chat: bubbles, ticks, replies, composer, infinite scroll up
    InfoPanel.tsx                  ← contact / group info, members, admin actions, security code
    NewChat.tsx                    ← new direct chat / new group picker
    DeleteDialog.tsx, bits.tsx     ← delete choices; tickState() + <Ticks/>
  lib/
    api.ts                         ← fetch wrapper, session in localStorage, single-flight token refresh
    backend.ts                     ← local vs online backend selection
    chat.ts                        ← typed REST client (chatApi), stream URL, labels/formatting helpers
    crypto.ts                      ← ALL cryptography (identity, wrap/unwrap, encrypt/decrypt, security code)
    keyring.ts                     ← in-memory conversation keys; seed + share protocol
    vault.ts                       ← IndexedDB persistence of the unlocked (non-extractable) identity

backend/src/modules/chat/
  chat.models.ts                   ← ChatKey, Conversation (embedded members + key wraps), ChatMessage
  chat.schema.ts                   ← Zod request schemas
  chat.routes.ts                   ← Express router incl. SSE /stream, rate limiters
  chat.service.ts                  ← business logic
  chat.events.ts                   ← emitChat(): Redis pub/sub → localEventBus
backend/src/middleware/auth.ts     ← Bearer or ?token= → JWT verify → guardAccount (ban check + lastSeenAt)
backend/src/middleware/rateLimit.ts
backend/src/modules/admin/accountGuard.ts
```

---

# Part B — Design

## 6. High-level architecture

```
 Browser A (Next.js client)                          Browser B
 ┌──────────────────────────────┐                   ┌──────────────────────┐
 │ Messenger (React state)      │                   │                      │
 │  Keyring (conv keys, memory) │                   │                      │
 │  crypto.ts (Web Crypto)      │                   │                      │
 │  vault (IndexedDB identity)  │                   │                      │
 └───┬──────────────▲───────────┘                   └──────▲───────────────┘
     │ REST (JSON,  │ SSE  GET /chat/stream?token=          │ SSE
     │ Bearer JWT)  │ event: chat                           │
 ┌───▼──────────────┴───────────┐   publish  ┌─────────┐   ┌┴─────────────────────┐
 │ API instance 1 (Express)     │──────────▶│  Redis   │──▶│ API instance 2       │
 │  requireAuth → rateLimit →   │ chat:events│ pub/sub │   │ redisSub.on(message) │
 │  validate(zod) → service     │◀──────────│          │   │ → localEventBus      │
 │  localEventBus → SSE writers │            └─────────┘   │ → SSE writers        │
 └───┬──────────────────────────┘                          └──────────────────────┘
     │ Mongoose
 ┌───▼──────────────────────────┐
 │ MongoDB: users, chatkeys,    │   ← only ciphertext, IVs, public keys,
 │ conversations, chatmessages  │     wrapped keys and metadata
 └──────────────────────────────┘
```

Key principles:
1. **Writes are REST, reads-live are SSE.** Every mutation goes through auth → rate-limit → Zod → service, then the
   service calls `emitChat()`.
2. **Events are hints, not the source of truth.** Most events just make the client re-fetch (`soon()` debounce).
   Only `message`, `message-deleted` and `typing` carry data. A 20 s poll backs everything up. So a lost event
   can only delay, never corrupt state.
3. **The server is a dumb, authorising relay for crypto material.** It never sees plaintext or symmetric keys; it
   only checks *who can write which key slot*.

---

## 7. Data model (MongoDB)

Source: [chat.models.ts](../backend/src/modules/chat/chat.models.ts). All `_id`s are UUID strings
(`randomUUID()`), `toJSON` maps `_id → id`.

### 7.1 `ChatKey` — one per user (`_id = userId`)

| Field | Meaning |
|---|---|
| `publicKey` | ECDH P-256 public key, raw (65 bytes), base64 |
| `encPrivateKey` | PKCS#8 private key encrypted with AES-256-GCM under `PBKDF2(passcode, salt, iterations)` |
| `salt` (16 B), `iv` (12 B), `iterations` (310,000) | KDF + cipher params, so clients can re-derive |
| `version` | +1 on every reset; lets clients detect stale wraps |

### 7.2 `Conversation`

| Field | Meaning |
|---|---|
| `type` | `direct` \| `group` |
| `pairKey` | Direct only: `sort([a,b]).join(":")` — **unique partial index** ⇒ exactly one chat per pair |
| `name`, `description`, `createdBy` | Group metadata (plaintext; the server needs it anyway for search/list) |
| `epoch` | Current key generation; +1 whenever a member leaves/is removed |
| `lastMessageAt` | Sort key for the chat list |
| `members[]` (embedded) | see below |

`members[]` element:

| Field | Meaning |
|---|---|
| `userId`, `role` (`admin`/`member`), `joinedAt` | Membership |
| `lastReadAt` | Read watermark (blue ticks) |
| `lastDeliveredAt` | Delivery watermark (grey double tick) |
| `clearedAt` | "Clear chat" watermark — messages before it are hidden for this member only |
| `hidden` | Chat removed from my list (direct chats re-appear on next message) |
| `keys[]` | **Wraps**: `{epoch, by, byPub, iv, data}` — my copy of each epoch key since I joined. `data == ""` ⇒ **pending** |

Indexes:
- `{ "members.userId": 1, lastMessageAt: -1 }` — "my chats, newest first" (multikey index).
- `{ pairKey: 1 } unique, partialFilterExpression: { pairKey: { $type: "string" } }` — groups have no pairKey,
  so the partial filter keeps them out of the uniqueness constraint.

**Why embed members?** Bounded (≤ 256), always read together with the conversation, and membership + watermarks +
key slots can be updated atomically in one document with `arrayFilters`. Trade-off: every read receipt rewrites
the conversation doc (write amplification on hot groups) — see §20.

### 7.3 `ChatMessage`

| Field | Meaning |
|---|---|
| `_id` | **Client-generated UUID** (idempotency key) |
| `conversationId`, `senderId`, `kind` (`text`/`system`) | |
| `epoch`, `iv`, `ct` | Which key; 96-bit IV; AES-GCM ciphertext+tag (base64) |
| `replyTo` | Message id being replied to (quoted text is resolved and decrypted client-side) |
| `event` | System messages only: `{action, targets, name}` — plaintext metadata the server already knows (created/added/removed/left/renamed/described/admin) |
| `deletedAt` | Delete-for-everyone tombstone (ct/iv are wiped) |
| `hiddenFor[]` | Delete-for-me list of userIds |

Index: `{ conversationId: 1, createdAt: -1 }` — thread pagination.

---

## 8. REST API reference

Base: `/api/v1/chat`. All routes require auth ([chat.routes.ts](../backend/src/modules/chat/chat.routes.ts)).

| Method | Path | Rate limit | Purpose |
|---|---|---|---|
| GET | `/stream?token=` | — | SSE event stream |
| GET | `/users?q&limit&skip` | — | Search people (limit ≤ 50) |
| GET | `/users/:id` | — | Profile + presence + public key |
| GET | `/presence?ids=a,b` | — | Online / last seen (≤ 300 ids) |
| GET | `/keys` | — | My stored (encrypted) key bundle or `null` |
| POST | `/keys` | writes | First setup, or `reset: true` |
| GET | `/conversations` | — | My chats (also marks them delivered) |
| POST | `/conversations` | writes | `{type:"direct",userId}` or `{type:"group",name,description?,memberIds}` |
| GET | `/conversations/:id` | — | One chat |
| PATCH | `/conversations/:id` | writes | Rename / describe (group admin) |
| DELETE | `/conversations/:id?scope=me\|everyone` | writes | Delete chat (default `me`) |
| POST | `/conversations/:id/clear` | writes | Clear for me |
| POST | `/conversations/:id/members` | writes | Add members (admin) |
| DELETE | `/conversations/:id/members/:userId` | writes | Remove (admin) or leave (self) |
| POST | `/conversations/:id/members/:userId/admin` | writes | `{admin: bool}` |
| POST | `/conversations/:id/keys` | writes | Seed / share wrapped keys |
| GET | `/conversations/:id/messages?before&after&limit` | — | Page of messages (≤ 100) |
| POST | `/conversations/:id/messages` | sends | `{id(uuid), epoch, iv, ct, replyTo?}` |
| DELETE | `/conversations/:id/messages/:mid?scope=me\|everyone` | writes | Delete message (default `everyone`) |
| POST | `/conversations/:id/read` | — | `{at?}` read watermark |
| POST | `/conversations/:id/typing` | typing | Ephemeral "typing…" |

Limits: `writes` 240/min, `sends` 120/min, `typing` 60/min — per user, fixed window.

Errors (`AppError` → `{error:{message,code}}`): `KEY_ROTATED` (409), `BAD_EPOCH`, `NO_SELF_COPY`, `NOT_A_GROUP`,
`GROUP_FULL`, `NO_MEMBERS`, `LAST_ADMIN` (422), `RATE_LIMITED` (429), Conflict (409) on races, Forbidden (403)
for non-admin actions, NotFound (404) for chats you are not in.

SSE event payload: `{ type, conversationId?, from?, data? }` where
`type ∈ message | message-deleted | conversation | read | typing | keys`.

---

## 9. Authentication and session

- **Same Pacewise account**: login via `/auth/login` or `/auth/google` with `device: "chat"`. Pending/unverified
  accounts get no tokens → friendly error.
- **Tokens**: short-lived access JWT (15 min) + refresh token, stored in `localStorage`
  (`pacewise-chat-session`). The API is header-based (no cookies) → no CSRF surface, works for any client.
- **Stateless verify**: `requireAuth` verifies the JWT signature without a DB hit, then `guardAccount()`:
  - status cache (15 s TTL per process) → banned/pending users are blocked within ~15 s even with a valid token;
  - writes `lastSeenAt` at most once per 30 s per user (`timestamps:false` so `updatedAt` isn't bumped).
- **Single-flight refresh** ([lib/api.ts](lib/api.ts)): on a 401, all concurrent failing requests await **one
  shared** `refreshing` promise. Why: refresh tokens rotate — if 5 requests each refreshed, 4 would use an
  already-rotated (invalid) token and log the user out. Each request retries at most once.
- **SSE auth**: `EventSource` cannot set headers, so the token goes in `?token=`. Before opening the stream, the
  client makes a normal request (`myKeys()`) so an expired access token is refreshed first.
- **Two "unlock" layers**: *signed in* (JWT) ≠ *unlocked* (private key available). `ChatApp` state machine:
  `checking → LoginCard → (load stored keys) → Unlock → Messenger`.

---

## 10. Real-time: SSE + Redis pub/sub

### 10.1 Server side
```
service ──emitChat(evt)──▶ redis.publish("chat:events", json)      (if Redis)
                          └▶ localEventBus.emit("chat", evt)         (no Redis, or publish failed)
every instance: redisSub.on("message") ─▶ localEventBus.emit("chat", evt)
GET /stream handler:  localEventBus.on("chat", e => if e.userIds.includes(me) res.write(...))
```
- Headers: `text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`,
  **`X-Accel-Buffering: no`** (stops nginx buffering the stream).
- `event: connected` on open (client uses it to resync), `: heartbeat` comment every **25 s** (keeps idle
  proxies/load balancers from closing the connection; most kill idle at 30–60 s).
- `userIds` (the recipient list) is stripped before writing — clients don't learn who else got the event.
- On `close`: clear heartbeat interval + remove listener (no leak). `setMaxListeners(0)` because thousands of
  listeners is expected.
- **Events never carry plaintext**: a `message` event carries the same ciphertext the DB has.

### 10.2 Client side ([Messenger.tsx](components/Messenger.tsx))
- Connect → on `error` close and reconnect after **4 s** (manual, because we need a fresh token URL each time).
- `typing` → set "typing until now+5 s"; a 1 s interval prunes expired entries.
- `message` → append/replace in the open thread, decrypt, mark read if this chat is open and visible, else
  browser notification; then debounce a list refresh.
- `message-deleted` → tombstone locally.
- `conversation` / `read` / `keys` → debounced `refresh()` (250 ms; 600 ms for keys to let a burst settle).
- **Fallback poll every 20 s** (only while the tab is visible). Also doubles as the presence heartbeat.
- On `visibilitychange → visible`: refresh + mark the open chat read.

### 10.3 Why SSE and not WebSockets? (classic question)
| | SSE | WebSocket |
|---|---|---|
| Direction | server → client only | bidirectional |
| Protocol | plain HTTP; works with HTTP/2 multiplexing, proxies, CDNs | upgrade handshake; some proxies/corporate networks break it |
| Reconnect | built into the spec | write it yourself |
| Auth/validation/rate-limit of writes | reuse REST middleware as-is | re-implement per message type |
| Binary | no (text only) | yes |
| Limits | 6 connections per origin on HTTP/1.1 (fine with HTTP/2) | — |

Our writes are low-frequency and benefit from the REST pipeline, so SSE is the simpler correct choice. At
WhatsApp-scale with typing/presence chatter, a persistent bidirectional socket (WebSocket/MQTT) wins on
per-message overhead — I'd switch then.

---

## 11. End-to-end encryption (deep dive)

All code: [lib/crypto.ts](lib/crypto.ts), [lib/keyring.ts](lib/keyring.ts), [lib/vault.ts](lib/vault.ts).

### 11.1 Primitives
| Purpose | Algorithm |
|---|---|
| Identity key pair | **ECDH P-256** (one per user) |
| Passcode → key | **PBKDF2-SHA-256, 310,000 iterations**, 16-byte salt (OWASP 2023 recommendation for PBKDF2-SHA256), passcode NFKC-normalised |
| Private key at rest on server | **AES-256-GCM**, 12-byte IV |
| Pairwise wrapping key | **ECDH(mine, theirs) → HKDF-SHA-256** (info = `pacewise-chat/wrap/v1|sorted(pubA,pubB)`) → AES-256-GCM key |
| Conversation key | 32 random bytes (`crypto.getRandomValues`) per (conversation, epoch) |
| Message encryption | **AES-256-GCM**, fresh 96-bit random IV, **AAD** = `pacewise-chat/msg/v1|convId|msgId|senderId|epoch` |
| Security code | SHA-512 over sorted public keys → 12 groups × 5 digits (60 digits) |
| Fingerprint | First 16 bytes of SHA-256(publicKey), hex |

### 11.2 Three layers of keys
```
passcode ──PBKDF2──▶ KEK ──AES-GCM──▶ encPrivateKey (stored on server)
                                   │
                         identity private key (ECDH P-256)
                                   │ ECDH with member's public key → HKDF
                                   ▼
                          pairwise wrap key ──AES-GCM──▶ wrap{epoch,by,byPub,iv,data} (stored per member)
                                                          │
                                         conversation key (epoch N, 256-bit)
                                                          │ AES-GCM + AAD
                                                          ▼
                                                   message ciphertext
```

### 11.3 Identity lifecycle
1. **Setup** (`createIdentity`): generate pair → export PKCS#8 → encrypt under PBKDF2(passcode) → upload
   `{publicKey, encPrivateKey, salt, iv, iterations}` → **re-import the private key as non-extractable**
   (`extractable=false`): page JS can use it for ECDH but can never read the bytes out (limits XSS key theft to
   "use while the page is open", not "exfiltrate forever").
2. **Persist on device**: the non-extractable `CryptoKey` is put in **IndexedDB** (structured clone keeps it
   non-extractable). Next visit: no passcode needed, as long as the stored public key still matches the server's.
3. **New device**: download bundle → passcode → PBKDF2 → AES-GCM decrypt. GCM's tag check doubles as a
   "wrong passcode" check.
4. **Lock chats / sign out**: delete the IndexedDB entry.
5. **Forgot passcode → reset**: new identity, `POST /keys {reset:true}` → server bumps `version`, **blanks every
   wrap the user holds in every conversation** (`$set` via `arrayFilters` + `$[]`) and emits `keys` to everyone they
   chat with → other members' browsers re-share current keys. Old history from epochs that nobody re-shares to them
   becomes unreadable — that's inherent to E2EE.

### 11.4 Conversation keys: **seed** and **share** protocol (the clever part)
Each member slot has `keys[]`. A slot with empty `data` = *pending*. The Keyring (`sync()`) runs on every list
refresh for every conversation:

**Seed** — when *nobody* holds the current epoch key (`every member pending for epoch`), the first browser to notice:
1. Generates 32 random bytes.
2. Wraps it for every member with a public key (including itself — `NO_SELF_COPY` is enforced).
3. `POST /keys {seed:true, epoch, byPub, wraps}`.
4. Server applies the `$set` **only if no member holds any non-empty wrap for that epoch** (filter:
   `members: {$not: {$elemMatch: {keys: {$elemMatch: {epoch, data: {$ne:""}}}}}}`). The loser gets 409 →
   refetches and loads the winner's key. **Compare-and-set on the document = distributed lock without a lock.**

**Share** — for every epoch I hold and some member is pending on:
1. Wrap for each waiting member with a public key.
2. `POST /keys {epoch, byPub, wraps}`.
3. Server filter: *I* must hold a non-empty wrap for that epoch (`$elemMatch userId: me, keys.$elemMatch data≠""`)
   **and** each target slot must still be empty (`arrayFilters k.data == ""`) — never overwrites an existing copy.
4. Server also checks `byPub === my current publicKey` (else 409 "Your encryption key changed").

Why store `by`/`byPub` in the wrap? To unwrap, the recipient computes ECDH(recipientPriv, **sharerPub**). If the
sharer later resets their identity, their *current* public key changes, but `byPub` preserves the one used.

Client-side guards: `busy` set of `"{conv}:{epoch}:seed|share"` locks so the same browser never runs the same job
twice concurrently. Members without a public key (never set up chat) are skipped and stay pending until they do —
`setMyKeys` emits `keys` to all their contacts, which triggers sharing.

### 11.5 Why AAD matters
AAD binds `conversationId | messageId | senderId | epoch` into the GCM tag. The server stores those fields in
plaintext and could otherwise **move a ciphertext to another chat, change the sender, or replay it under another
id**. Any such tampering makes `decrypt` fail → UI shows "couldn't decrypt". Note: the AAD comes from the
*server's* row, so the guarantee is "the row metadata is consistent with what the encrypter declared".

### 11.6 Epochs = membership-change rekey
- **Leave/remove** → `epoch+1`, every remaining member gets a pending slot for the new epoch → next online member
  seeds a fresh key → the departed member never receives it. (*Post-removal secrecy*.)
- **Add** → new member gets a pending slot for the **current** epoch only → sees messages from join time on, not
  history (WhatsApp behaviour).
- Messages carry their epoch; the server rejects a send whose epoch ≠ current (`409 KEY_ROTATED`) → client
  refreshes, gets the new key, re-encrypts, retries (max 2).

### 11.7 Verifying a contact (MITM defence)
The server distributes public keys, so a malicious server could substitute its own (classic MITM). The **security
code** = SHA-512 of the sorted two public keys, rendered as 60 digits; both users see the same digits iff they
have each other's real keys. Compare in person / on a call (same idea as Signal "safety numbers").

### 11.8 What the server can and cannot see
| Can see (metadata) | Cannot see |
|---|---|
| Who talks to whom, when, how often, message sizes | Message text |
| Group names, descriptions, membership, admin changes | Conversation keys |
| Online / last seen, typing events, read/delivered times | Private keys (only encrypted blob) |
| Reply-to relationships, deletions | — |

### 11.9 Honest limitations vs Signal/WhatsApp (bring these up yourself — it signals seniority)
1. **No per-message forward secrecy.** One key per epoch; if a conversation key leaks, the whole epoch is readable.
   Signal uses the **Double Ratchet** (new key per message, DH ratchet per round-trip) and **Sender Keys** for groups.
2. **No sender authentication inside a group.** All members share a symmetric key; a malicious member *colluding
   with the server* could forge a message "from" someone else (the server enforces `senderId = me` on honest
   sends). Fix: sign each message with an Ed25519/ECDSA identity signing key.
3. **Server-trusted key directory.** Members wrap keys for whatever public key the server returns. A malicious
   server could add a **ghost member** or swap a key. Mitigations: security codes (direct only today), **key
   transparency** logs (WhatsApp's Auditable Key Directory), signed membership changes by admins.
4. **Passcode backup is offline-brute-forceable by the server.** Minimum 6 characters + PBKDF2 310k is weak against
   GPUs. Fixes: Argon2id (memory-hard), longer passcodes, or **HSM-backed rate-limited recovery** (Signal SVR /
   WhatsApp HSM backup vault) / OPAQUE.
5. **One identity for all devices** (shared via passcode), not per-device keys. Can't revoke one lost device.
6. **No key rotation on add**, by design (new member can't read old messages anyway because they never get old
   epochs) — but a time-based rotation would bound exposure.

---

## 12. Message lifecycle: send and receive

### 12.1 Send (optimistic, idempotent)
```
User hits Enter
 1. id = crypto.randomUUID()                          ← idempotency key, chosen by the client
 2. Draft {status:"sending"} inserted into thread; plaintext cached in `plain[id]`   (optimistic UI, clock icon)
 3. key = ring.get(conv, conv.epoch)  (if missing → ring.sync(conv) once; still missing → fail)
 4. {iv, ct} = AES-GCM(key, JSON{t:text}, AAD=conv|id|me|epoch)
 5. POST /conversations/:id/messages {id, epoch, iv, ct, replyTo}
     server: loadMine (membership) → epoch == current? else 409 KEY_ROTATED
             findById(id): exists & mine → return it (retry of a send that already succeeded)
             create → update conv: lastMessageAt, unhide for all, my read/delivered watermarks = createdAt
             emitChat("message", all members, data = ciphertext view)
 6. 201 → replace draft with server row (single tick)
    409 KEY_ROTATED → refresh() → re-encrypt with new epoch key → retry (≤ 2)
    other error → status "failed", toast; "Retry" re-runs deliver() with the SAME id (safe due to idempotency)
```

### 12.2 Receive
```
SSE "message" → if thread loaded: upsert by id (dedupes my own echo) → decrypt with ring key for (conv, epoch)
   no key yet → Plain = {locked:true}  ("waiting for this message"); re-decrypted after next keys refresh
   GCM failure → Plain = {error:true}
 → chat open & tab visible: markRead after 300 ms   else: browser Notification (background only)
 → debounced list refresh (unread counts, ordering)
```

---

## 13. Receipts, typing, presence

### 13.1 Ticks — **watermarks, not per-message rows**
Each member has two timestamps: `lastDeliveredAt` and `lastReadAt`. Tick state for my message `m`
([bits.tsx](components/bits.tsx) `tickState`), among members who had joined by `m.createdAt`:
- **read** (blue ✓✓) if *every* other has `lastReadAt ≥ m.createdAt`
- **delivered** (grey ✓✓) if every other has `lastDeliveredAt ≥ m.createdAt`
- else **sent** (✓); client-only `sending`/`failed`.

Why watermarks: O(members) storage per conversation instead of O(messages × members) receipt rows; one update
marks everything up to a point read. Works because chat is append-only and ordered by time.

- **Delivered** is set when the recipient's app lists conversations (`listConversations` bumps `lastDeliveredAt`
  for chats with newer `lastMessageAt` and emits `read` so the sender's ticks update).
- **Read**: `POST /read {at?}`; server clamps `at` to now, ignores if not newer, and writes with **`$max`** (monotonic —
  out-of-order/concurrent requests can never move the watermark backwards). Read also implies delivered.
- Sending a message sets my own watermarks to its `createdAt` (my own messages don't count as unread).

### 13.2 Unread count
`countDocuments` of text messages from others, not deleted, not hidden for me, newer than
`max(lastReadAt, clearedAt)`, **capped with `.limit(999)`** (bounded cost; UI shows "999+" style).

### 13.3 Typing
- Client throttles: at most one `POST /typing` per **3 s** while typing; reset after sending.
- Server: not stored — just `emitChat("typing")` to the others. Rate limit 60/min.
- Receiver: shows "typing…" for **5 s** after the last event; cleared immediately when that person's message arrives.

### 13.4 Presence
- Every authenticated request updates `lastSeenAt` (throttled to once per 30 s per user, in `guardAccount`).
- The open app polls every 20 s → a user with the tab open is refreshed at least every ~30 s.
- **Online = `now − lastSeenAt < 70 s`** (covers poll interval + throttle + jitter).
- Computed on read (`person()`), never pushed — cheap, eventually consistent. Trade-off: up to ~70 s stale.

---

## 14. Groups: roles, membership, key epochs

| Rule | Where enforced |
|---|---|
| Creator is admin; ≤ 256 members (`MAX_GROUP`) | `createConversation`, `addMembers` |
| Only admins: rename, describe, add, remove others, promote/demote, delete-for-everyone | `requireGroupAdmin` |
| Anyone can leave (groups only; direct chats are deleted, not left) | `removeMember` |
| Can't demote the last admin (`LAST_ADMIN`) | `setAdmin` |
| Last admin leaves → **longest-standing member** (earliest `joinedAt`) auto-promoted | `removeMember` |
| Last member leaves → conversation + messages deleted | `removeMember` |
| Only active users can be added (not pending/rejected/banned) | `activeUsers()` |
| Every change writes a **system message** (plaintext `event`) + emits `conversation` | `system()` |
| Remove/leave ⇒ `epoch+1` and pending slot for everyone | `removeMember` |
| Add ⇒ new member gets pending slot for current epoch only | `addMembers` / `freshMember` |

---

## 15. Delete / clear semantics

| Action | Scope | Mechanism | Who |
|---|---|---|---|
| Delete message for me | me | `$addToSet hiddenFor: me` | anyone, any message |
| Delete message for everyone | all | `deletedAt=now`, `iv=ct=""` (ciphertext gone) + `message-deleted` event | sender, own text messages |
| Clear chat | me | `member.clearedAt = now` — queries filter `createdAt > clearedAt` | any member |
| Delete chat for me — direct | me | `clearedAt = now`, `hidden = true`; unhidden by the next send | either person |
| Delete chat for me — group | me | leave the group (→ rekey) | any member |
| Delete chat for everyone | all | delete conversation + all messages | direct: either person; group: admins |

Note: there's no time limit on delete-for-everyone (WhatsApp has ~2 days), and a recipient who already decrypted
the message has seen it — deletion is best-effort by nature in E2EE.

---

## 16. Pagination

- **Cursor = `createdAt`**, not offset: `before=<iso>` for older (scroll up), `after=<iso>` for newer (catch-up).
- Fetch **`limit + 1`** rows; `hasMore = rows.length > limit` — no extra count query.
- Sorted desc for `before`, then reversed so the client always gets chronological order; asc for `after`.
- Floor: always `createdAt > clearedAt` and `hiddenFor ≠ me`.
- Backed by `{conversationId:1, createdAt:-1}`.
- People search uses `skip/limit` (bounded at 10,000) — acceptable for a directory, not for feeds.

Gap: timestamp cursors can skip/duplicate messages that share the same millisecond. Fix: compound cursor
`(createdAt, _id)` or time-ordered ids (ULID / UUIDv7 / Snowflake) — see §21.

---

## 17. Frontend architecture

- **State machine** in [ChatApp.tsx](components/ChatApp.tsx): `checking` → `LoginCard` → (`stored` undefined =
  loading) → `Unlock` (setup/unlock/reset) → `Messenger`.
- **Messenger state**: `convs[]`, `threads{convId → {items, hasMore, loaded}}`, `plain{msgId → text|locked|error}`,
  `typing{conv → user → until}`, active chat, panels, toast. Decrypted text lives **only in memory**.
- **Refs mirror state** (`convsRef`, `threadsRef`, `plainRef`, `activeRef`) so long-lived callbacks (SSE handler,
  intervals) read fresh values without being re-created / re-subscribed — avoids stale closures.
- **Refresh coalescing**: `refresh()` uses `running` + `again` flags — if a refresh is requested while one is
  running, exactly one more run happens afterwards (no pile-up, no lost update). `soon(ms)` debounces bursts of
  events into one refresh.
- **Optimistic UI** with `status: "sending" | "failed"` on client-only fields.
- **Layout**: responsive — list and chat side by side on desktop, single pane with back button on mobile
  (`100dvh` for mobile browser chrome).
- **Accessibility**: `aria-live` region, `role=status/alert`, labelled tick icons.
- **Security headers** (next.config.js): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
  (clickjacking), `Referrer-Policy: no-referrer` (keeps URLs out of referrers), `poweredByHeader: false`.
- Links in messages: `target=_blank rel="noopener noreferrer"`; text rendered as React text nodes (auto-escaped,
  no `dangerouslySetInnerHTML`) → decrypted content can't inject HTML.

---

# Part C — Senior / Staff depth

## 18. Concurrency, races, idempotency

| Race | Resolution |
|---|---|
| Two people open a direct chat with each other at the same instant | Unique partial index on `pairKey`; loser catches **E11000** and reads the winner's doc |
| Two browsers seed the same epoch key | Conditional update (filter "no non-empty wrap for epoch") → exactly one wins; loser 409 → reloads |
| Two browsers share a key to the same pending member | `arrayFilters` only match slots with `data == ""` → second write is a no-op/409; existing copies never overwritten |
| Client retries a send after a timeout (did it land?) | **Client UUID as `_id`** → server returns the existing row (idempotent POST) |
| Someone leaves while I'm sending | Epoch check → `409 KEY_ROTATED` → refresh → re-encrypt → retry |
| Out-of-order read receipts | `$max` on `lastReadAt` + "ignore if not newer" |
| 5 requests get 401 at once | Single-flight refresh promise |
| SSE events arrive in a burst | Debounced, coalesced `refresh()` |
| My own message comes back over SSE | Upsert by id (no duplicates) |
| Key-share job re-entered on the same tab | `busy` lock set in Keyring |
| Ban while token still valid | `guardAccount` status cache, 15 s TTL |

**Not atomic today** (talk about it): `removeMember` does `$pull + $set epoch` and then a separate `$push` of
pending slots, then an optional admin promotion and a system message — 3–4 writes with no transaction. A crash in
between could leave members without a pending slot for the new epoch. Fix: one update with an aggregation pipeline,
or a Mongo multi-document transaction (needs a replica set), or make `sync()` self-heal missing slots.

---

## 19. Security hardening and threat model

**Input & API**
- Zod on every body/query/param; base64 fields checked with a regex and **size caps** (ciphertext ≤ 24,000 chars ≈
  4,000 characters of text; public key ≤ 200; wraps ≤ 256 per call).
- Search input is **regex-escaped** before `new RegExp` → no regex injection / ReDoS; max 80 chars.
- **Authorization by membership**: `loadMine()` queries `{_id, "members.userId": me}` → non-members get **404, not
  403** (doesn't leak that the chat exists).
- Users with status pending/rejected/banned are invisible in search and can't be added.
- Rate limits per user on writes, sends, typing.
- Server never trusts client `senderId` — it's always `req.user.id`.

**Threat model**
| Attacker | Outcome |
|---|---|
| DB dump / curious admin / backup leak | Sees metadata and ciphertext only. Can offline-brute-force passcodes (weakest point) |
| Network MITM | TLS; and even with TLS broken, content is E2EE |
| Malicious server (active) | Could swap public keys / add ghost members → mitigated only by security-code verification; could withhold/drop/reorder messages (AAD detects moving/re-attributing) |
| Removed group member | Can't read anything after removal (new epoch) |
| XSS on the chat origin | Can **use** keys while the page is open (decrypt, send), cannot **export** the private key (non-extractable). Defence-in-depth: strict CSP (not yet added) |
| Stolen laptop with unlocked app | IndexedDB holds a usable identity → "Lock chats" / sign out removes it |
| Token in SSE URL | May appear in proxy/access logs → short-lived token; better: one-time stream ticket |

---

## 20. Scaling: 1K → 1M → 100M users

### 20.1 Today's bottlenecks (be specific)
1. **N+1 in `listConversations`**: for each of up to 500 chats, `view()` runs `findOne` (last message) +
   `countDocuments` (unread) → up to **1,000 queries per list call**, and the client calls it every 20 s per open
   tab. Fix: denormalise `lastMessage` (id, epoch, iv, ct, sender, createdAt) onto the conversation, and keep a
   per-member `unread` counter incremented with `$inc` on send / reset on read; or one `$lookup` aggregation.
2. **Polling load**: 20 s list poll × active users. With reliable SSE, poll less (60–120 s) or only on reconnect.
3. **Redis pub/sub broadcast**: every instance receives **every** event and filters locally — O(events × instances).
   Fix: per-user channels (`chat:u:{id}`) subscribed only by the instance holding that user's socket, or a
   connection registry (user → instance) + direct routing, or Redis Streams / NATS / Kafka.
4. **Write amplification on hot groups**: every read receipt rewrites the conversation doc with 256 embedded
   members; Mongo document-level locking serialises them. Fix: move watermarks to a separate `memberships`
   collection (`{conversationId, userId}` unique) — also lets a user be in thousands of chats cheaply.
5. **Presence writes**: `lastSeenAt` update per user per 30 s → at 1M concurrent ≈ 33K writes/s into the users
   collection. Fix: presence in **Redis with TTL** (`SET presence:{id} 1 EX 70`), never in Mongo.
6. **Unread `countDocuments`** grows with backlog → counters (above).
7. **SSE connections**: each is an open socket + listener; Node handles ~10–50K/instance with tuned `ulimit`. Need
   LB idle timeout > 25 s heartbeat; no sticky sessions required (any instance can serve any user thanks to pub/sub).

### 20.2 Target architecture at large scale
```
Clients ──WebSocket/MQTT──▶ Gateway tier (stateless conn holders, 100K+ conns each, Go/Erlang/Node)
                             │  conn registry: userId → gatewayId (Redis)
                             ▼
                        Chat service (stateless) ──▶ Message store: Cassandra/ScyllaDB
                             │                        partition = conversationId (+ time bucket),
                             │                        clustering = message id (Snowflake/ULID)
                             ├──▶ Kafka (per-conversation ordering by partition key) ──▶ fan-out workers
                             │        └─▶ online? route to gateway  : offline? → push (APNs/FCM/Web Push)
                             ├──▶ Presence: Redis with TTL, pub/sub only to subscribed watchers
                             └──▶ Metadata (users, groups, memberships): sharded SQL/Mongo
```
- **Ordering**: per-conversation sequence number (server-assigned, monotonic) instead of wall-clock `createdAt`;
  clients ask "give me everything after seq N" → gap detection and exact catch-up.
- **Offline delivery**: per-device inbox/queue; Web Push with an encrypted payload or a "you have messages" ping.
- **Fan-out**: fan-out-on-write to per-recipient inboxes for small groups; fan-out-on-read for huge groups/channels.
- **Media**: encrypt client-side with a random key, upload ciphertext to S3 via presigned URL, send key+hash inside
  the E2EE message (WhatsApp design). The backend already has the S3 presigner dependency.
- **Multi-device**: per-device identity keys; sender encrypts to every device (Signal "Sesame"), or a sender-key per
  device.
- **Back-of-envelope (WhatsApp-ish)**: 100M DAU × 40 msgs/day = 4B msgs/day ≈ **46K msgs/s avg, ~150K peak**;
  ~1 KB each with metadata ≈ 4 TB/day raw → TTL/cold-tier policies; connections: 30M concurrent / 100K per
  gateway ≈ 300 gateways.

---

## 21. Known gaps, bugs and what I would fix next

Ranked by impact. Owning these in an interview is a strength.

1. **Idempotent send has a check-then-insert race**: `findById` then `create`. Two concurrent retries with the same
   id both miss the `findById`, one `create` throws **E11000** → surfaced as a 500 instead of returning the
   existing row. Fix: catch `11000` and re-read (same pattern already used for `pairKey`), or `insertOne` with
   upsert semantics.
2. **N+1 queries in the chat list** (§20.1). Biggest perf issue.
3. **Timestamp cursor** can drop/duplicate same-millisecond messages → `(createdAt, _id)` cursor or UUIDv7 ids.
4. **Non-atomic multi-step membership changes** (§18).
5. **Long-lived SSE ignores token expiry/bans**: auth is checked only at connect; a banned user's open stream keeps
   receiving events. Fix: close streams on ban (event), or re-validate on a timer.
6. **Redis publish failure** falls back to local emit only → other instances miss the event (poll covers it, ≤ 20 s).
7. **`GET /conversations` has a side effect** (marks delivered, emits events). Pragmatic, but violates GET safety;
   cleaner as an explicit `POST /delivered` ack, ideally per-device.
8. **"Delivered" is coarse** — means "some device of the user listed chats", not "this message reached a device".
9. **Crypto gaps** (§11.9): no forward secrecy ratchet, no message signatures, server-trusted directory, weak
   passcode KDF/minimum, single shared identity across devices.
10. **No tests for the chat module** (the backend has tests for other modules). Highest-value additions: service
    tests for authorization (non-member gets 404, non-admin 403), seed/share CAS races (run two in parallel, assert
    one wins), idempotent send, `$max` read receipts; and crypto round-trip tests (wrap/unwrap both directions, AAD
    tamper → fail, wrong passcode → fail).
11. **No CSP**, no SRI on Google Fonts — add `Content-Security-Policy` (`script-src 'self'`, `connect-src` API
    origins) to shrink XSS blast radius on a page that holds keys.
12. Fixed-window rate limiter allows 2× bursts at window edges → sliding window / token bucket.
13. Observability: no chat-specific metrics. Add: active SSE connections, events/s, send latency p50/p99, 409
    KEY_ROTATED rate, decrypt-failure rate reported by clients (no content), key-pending age.

---

# Part D — Interview Kit

## 22. Numbers cheat sheet

| Thing | Value |
|---|---|
| Max group size | 256 |
| Message ciphertext cap | 24,000 base64 chars (~4,000 chars text) |
| Messages per page | default 50, max 100 |
| Chats listed | 500 most recent |
| Unread count cap | 999 |
| PBKDF2 iterations | 310,000 (accepted 100K–5M) |
| Passcode min length | 6 |
| IV size | 96 bits (12 B); salt 16 B; keys 256-bit |
| Security code | 60 digits (12 × 5) from SHA-512 |
| SSE heartbeat | 25 s; client reconnect 4 s |
| Poll interval | 20 s (visible tab only) |
| Online threshold | 70 s since last seen |
| lastSeen write throttle | 30 s; account-status cache 15 s |
| Typing | send ≤ 1 / 3 s, show for 5 s, server limit 60/min |
| Rate limits | writes 240/min, sends 120/min |
| Access token | 15 min (+ rotating refresh token) |
| Backend probe | 1.5 s timeout |

## 23. Trade-off table

| Decision | Why | Alternative & when it wins |
|---|---|---|
| SSE for push, REST for writes | Reuse auth/validation/rate-limit; HTTP-friendly; auto-reconnect | WebSocket when chatty bidirectional traffic dominates |
| Events as hints + 20 s poll | Lost events can't corrupt state; simple | Sequence numbers + gap fill for exactness at scale |
| Embedded members in conversation | Atomic updates, one read | Separate memberships collection for huge groups / many chats per user |
| Watermark receipts | O(members) not O(messages×members) | Per-message receipts if you need "read by" lists per message (WhatsApp group "Info") — derivable from watermarks anyway |
| Client-generated message ids | Idempotent retries, optimistic UI keyed by final id | Server ids + separate idempotency-key header |
| One symmetric key per epoch | Simple, cheap for groups | Double Ratchet (1:1) + Sender Keys (groups) for forward secrecy |
| Passcode-wrapped key on server | Multi-device without a key server | HSM-backed rate-limited recovery (SVR); per-device keys + device linking via QR |
| Rekey on leave, not on join | Joiners never get old epochs anyway | Also rotate periodically to bound exposure |
| Presence derived from lastSeenAt | Zero extra infra | Redis TTL keys + pub/sub to watchers |
| Redis optional | Dev & single instance need nothing | Required beyond one instance |
| Mongo for messages | Existing stack, fine at this scale | Cassandra/Scylla (write-heavy, partition by conversation) at Discord/WhatsApp scale |

## 24. Interview Q&A bank

### Basics
1. **Walk me through the architecture.** → §6 diagram: Next.js client does all crypto; Express REST for writes;
   SSE for push; Mongo for storage; Redis pub/sub for cross-instance fan-out.
2. **How does a message get from A to B?** → §12: encrypt in A's browser → POST with client UUID → server
   validates membership + epoch, stores ciphertext, publishes event → every instance gets it from Redis → the one
   holding B's SSE stream writes it → B decrypts with the conversation key.
3. **Why SSE over WebSocket?** → §10.3.
4. **How does the server know who is online?** → §13.4: `lastSeenAt` on every request (throttled), online if < 70 s.
5. **How do ticks work?** → §13.1 watermarks; all others' watermark ≥ message time.
6. **How is the chat list sorted and kept fresh?** → `lastMessageAt` desc with compound multikey index; refreshed
   on events (debounced) + 20 s poll.

### E2EE
7. **Explain your E2EE end to end.** → §11.2 three layers.
8. **Where is the private key stored?** → On the server encrypted under PBKDF2(passcode); on the device as a
   non-extractable `CryptoKey` in IndexedDB.
9. **Why non-extractable? Why IndexedDB not localStorage?** → XSS can use but not steal; only IndexedDB can store
   `CryptoKey` objects.
10. **How do new members get the key?** → Pending slot → any online member holding the key wraps it for the
    newcomer's public key (share protocol).
11. **What if nobody has the key yet?** → Seed protocol with compare-and-set; one browser wins.
12. **What happens when someone leaves?** → Epoch+1, new key seeded by a remaining member, never shared to the
    leaver. In-flight sends get `KEY_ROTATED` and retry.
13. **Why AAD?** → §11.5 binds ciphertext to chat/message/sender/epoch.
14. **Why a random 96-bit IV and what if it repeats?** → GCM nonce reuse with the same key is catastrophic (leaks
    XOR of plaintexts and enables tag forgery). Random 96-bit is safe up to ~2³² messages per key (birthday bound,
    NIST limit); epochs keep per-key counts far below that.
15. **Why HKDF after ECDH?** → Raw ECDH output isn't uniformly random; HKDF extracts/expands into a proper key and
    the `info` string gives domain separation (wrap keys can't be confused with other uses). Sorting the public keys
    in `info` makes both sides derive the same key.
16. **Can the server read messages?** → No content. It can see metadata (§11.8) and could MITM keys if users don't
    verify security codes.
17. **What if the user forgets the passcode?** → Reset: new identity, wraps blanked, others re-share current
    keys; history only for epochs someone re-shares.
18. **How does this compare to Signal?** → §11.9: no Double Ratchet/forward secrecy, no signatures, no key
    transparency, shared identity across devices.
19. **How would you add forward secrecy?** → X3DH for session setup + Double Ratchet for 1:1; Sender Keys (with a
    chain key ratchet) for groups; prekeys uploaded to the server; per-device sessions.
20. **How would you encrypt attachments?** → §20.2 Media.
21. **How would you implement search over encrypted messages?** → Server can't. Client-side index in IndexedDB
    (of decrypted messages on this device), or encrypted search index; accept device-local search (WhatsApp does).

### Correctness / concurrency
22. **How do you prevent duplicate messages on retry?** → Client UUID as primary key; server returns existing.
    (Mention the E11000 race and fix — §21.1.)
23. **Two users create the same 1:1 chat simultaneously?** → Unique partial index on `pairKey` + catch 11000.
24. **Why `$max` for read receipts?** → Monotonic watermark under concurrency and out-of-order requests.
25. **Why does the client coalesce refreshes?** → Event storms would otherwise trigger N overlapping list fetches;
    `running/again` guarantees at most one in flight plus one follow-up.
26. **Single-flight token refresh — why?** → Rotating refresh tokens; parallel refreshes would invalidate each other.
27. **What's not atomic?** → `removeMember` multi-write (§18); fix with pipeline update / transaction / self-heal.
28. **How do you guarantee message ordering?** → Today: server `createdAt` + index. Weakness: same-ms ties and
    clock skew across instances. Better: per-conversation monotonic sequence (counter `$inc` on the conversation,
    or Kafka partition by conversation) and `(seq)` cursors.

### Scale / ops
29. **What breaks first at 10× load?** → N+1 list queries + 20 s polling (§20.1 #1–2).
30. **How do you scale SSE horizontally?** → Stateless instances, Redis pub/sub fan-out, LB idle timeout > heartbeat,
    no stickiness needed; then per-user channels/connection registry to avoid broadcast.
31. **How would you store billions of messages?** → Cassandra/Scylla, partition `(conversationId, time-bucket)`,
    clustering by Snowflake id desc; hot partition mitigation via bucketing.
32. **How do you handle offline users?** → Today: they fetch on next open (messages persisted). At scale: per-device
    inbox + push notifications (APNs/FCM/Web Push), delivery ack per device.
33. **Presence at scale?** → Redis TTL keys, publish changes only to users who have that person's chat open
    (subscription), batch, and degrade gracefully (hide "online" for huge groups).
34. **Hot group (100K members)?** → Not E2EE-group-key-per-member friendly; use channels model: fan-out-on-read,
    no per-member receipts, sender keys, rate limits per channel.
35. **How would you monitor this?** → §21 #13; plus SLOs: send p99 < 300 ms, event delivery p99 < 1 s.
36. **Rate limiting across instances?** → Redis `INCR`+`EXPIRE` fixed window; improve with sliding window log /
    token bucket via Lua for atomicity.

### Security
37. **How do you prevent IDOR?** → Every query scoped by `members.userId: me`; 404 for non-members.
38. **XSS impact?** → Can use keys while open, not exfiltrate private key; content rendered as text nodes; add CSP.
39. **Why is the token in the SSE URL a risk and how to fix?** → Logs/history; use a short-lived single-use stream
    ticket from a POST, or cookie auth for the stream, or `fetch()` streaming with headers.
40. **Brute-force of the passcode?** → Server holds salt+ciphertext → offline attack; mitigations §11.9 #4.
41. **Ghost member attack?** → §11.9 #3; mitigation: clients show membership changes as system messages (we do),
    signed membership by admins, key transparency.

### Behavioural / ownership
42. **Hardest bug / design decision?** → Key distribution without a trusted key server: designing seed/share as
    compare-and-set on slots so any member's browser can heal the group, with races resolved by Mongo filters.
43. **What would you do differently?** → Sequence numbers from day 1; memberships as a separate collection; Redis
    presence; tests for the race paths; message signatures.
44. **How did you decide scope?** → Matched WhatsApp's core (1:1, groups, ticks, delete, E2EE) and skipped
    media/calls/multi-device-keys; designed the data model so each can be added without migration of existing chats.

## 25. "Design WhatsApp" — mapping this project

| Classic requirement | In this project | At real scale |
|---|---|---|
| 1:1 + group messaging | ✅ | ✅ |
| Sent/delivered/read | ✅ watermarks | per-device acks |
| Online/last seen | ✅ derived from requests | Redis TTL + targeted pub/sub |
| Typing | ✅ ephemeral events | same, over socket |
| Persistent history | ✅ Mongo | Cassandra/Scylla |
| Real-time transport | SSE + REST | WebSocket/MQTT gateways |
| Cross-server routing | Redis broadcast | connection registry + Kafka |
| Offline delivery | fetch on open | per-device queue + push |
| E2EE | ✅ ECDH + AES-GCM, epochs | Signal protocol (X3DH, Double Ratchet, Sender Keys) |
| Media | ❌ | client-encrypted blobs on S3/CDN |
| Multi-device | shared identity via passcode | per-device keys, linked devices |
| Ordering | createdAt | per-conversation sequence |

Interview structure to follow: **requirements → numbers → API → data model → high-level diagram → deep dives
(delivery, ordering, receipts, presence, E2EE) → scaling & failure modes → trade-offs.** Use this project as the
concrete "I built it" example at every step.

## 26. Glossary

- **ECDH** — Elliptic-Curve Diffie-Hellman: two parties derive the same secret from (my private, your public).
- **P-256** — NIST elliptic curve (secp256r1), natively supported by Web Crypto.
- **HKDF** — HMAC-based key derivation: turns a shared secret into one or more uniform keys, with `info` for domain separation.
- **PBKDF2** — Password-based KDF; slow by iteration count to resist brute force (not memory-hard, unlike Argon2/scrypt).
- **AES-GCM** — Authenticated encryption (confidentiality + integrity tag); needs a unique nonce per key.
- **AAD** — Additional authenticated data: not encrypted, but tampering is detected.
- **KEK** — Key-encryption key (here: the passcode-derived key that encrypts the private key).
- **Wrap / unwrap** — Encrypting a key with another key.
- **Epoch** — Generation of a conversation key; increments on member removal/leave.
- **Seed / share** — Creating the first copies of a new epoch key / giving a copy to a pending member.
- **Forward secrecy** — Compromise of current keys doesn't reveal past messages (needs ratcheting).
- **Post-compromise / post-removal security** — Future messages are safe after a compromise / removal (we have the removal case via epochs).
- **Watermark** — A per-member timestamp meaning "everything up to here is delivered/read".
- **SSE** — Server-Sent Events: `text/event-stream` over long-lived HTTP.
- **Single-flight** — Many concurrent callers share one in-flight operation.
- **Idempotency key** — Client-chosen id that makes a retried write safe.
- **E11000** — MongoDB duplicate-key error code (11000).
- **arrayFilters / `$[]` / `$[x]`** — Mongo positional operators to update all / matching elements of nested arrays.
