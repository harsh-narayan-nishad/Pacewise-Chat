# Pacewise Chat

A separate app, like Pacewise To-do: the same Pacewise accounts and backend (`/api/v1/chat`), deployed on its own.

- Chat one-to-one or in groups with anyone on Pacewise (everyone is searchable by name or @username).
- Online / last seen, typing…, delivered and read ticks, replies, delete for everyone, clear / delete chat.
- Groups: name, description, admins, add / remove members, exit.
- **End-to-end encrypted** in the browser (Web Crypto): ECDH P-256 identity per person, an AES-256-GCM key per chat
  shared with each member over ECDH + HKDF, and a new key whenever someone leaves. The server stores only
  ciphertext and public keys. Your private key is kept on the server encrypted with your **chat passcode**
  (PBKDF2), so you can open your chats on another device. Compare the security code in Contact info to verify a chat.

## Run

```bash
cp .env.local.example .env.local   # then npm install
npm run dev                        # http://localhost:3003
```

Production: add this app's address to the backend's `CORS_ORIGINS`.
