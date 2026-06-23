# GLANCEvault Intents Transport — Implementation Reference

A companion to spec §7 (architecture / *why*). That section says **what** and
**why**; this document gives the concrete **how** — the module shapes, function
signatures, data structures, and decision points — distilled from the working
dayGLANCE implementation, written so another GLANCE app (e.g. lifeGLANCE) can
build a **correct, cross-app-compatible** intents transport without access to
the dayGLANCE repo.

It describes the **end state**, not a build history. Where something is
dayGLANCE-specific (a storage key, an emitter name, the target list) it is
called out; everything else is the general pattern. §8 collects the
app-specific bits in one place.

---

## 1. The three pieces

"Intents" is three cooperating layers. Keep them distinct:

1. **The server endpoints** — the GLANCEvault HTTP API (`/intents/batch`,
   `/intents/list`, `/salt/:accountId`). Shared infrastructure; identical for
   every app. Your transport is a *client* of it.
2. **The codec** — the `@glance-apps/intents` package. A pure
   envelope/row encode-decode + crypto library. **No transport, no storage, no
   network.** Every app uses it identically.
3. **The app-owned transport** — the code in *this* document. It owns the
   outbox, the deliverers, the receive drain, the key setup, and the emit
   wiring. It is **not** shared between apps; each app writes its own, following
   this pattern. It depends on (1) and (2) but nothing app-specific leaks into
   them.

> The codec is a **codec, not a transport**. Do not put HTTP, cursors, or
> persistence in it. Those live in your app-owned transport.

### 1.1 Server contract (what the transport depends on)

All requests carry `Authorization: Bearer <deviceToken>` — the same device
token the vault **sync** transport already uses. Field names are **camelCase**;
the `envelope` crosses the wire as an **opaque base64 string** (the server never
inspects it).

**WRITE** — `POST {vaultUrl}/intents/batch`
```jsonc
// request body
{
  "accountId": "<account>",
  "events": [
    { "eventId": "<id>", "envelope": "<base64>", "expiresAt": "<ISO-8601>" }
  ]
}
// response
{ "written": <int>, "maxSeq": <int> }
```
Insert-only: a re-sent `eventId` is a **server-side no-op** (`written` excludes
it). This idempotency is what makes outbound retry safe.

**LIST** — `GET {vaultUrl}/intents/list?accountId=&since=&limit=`
```jsonc
// response
{
  "rows": [
    { "eventId": "<id>", "envelope": "<base64>", "seq": <int>,
      "expiresAt": "<ISO>", "serverMtime": "<ISO>" }
  ],
  "hasMore": <bool>
}
```
Rows have `seq > since`, ascending. The server returns **only non-expired**
rows (TTL-filtered). Page size is **500**; a backlog larger than that spans
multiple pages (`hasMore: true`).

**SALT** — `GET|PUT {vaultUrl}/salt/:accountId`, body `{ "salt": "<base64>" }`.
`GET` returns the account's root-key salt (404 ⇒ none yet). `PUT` registers one
**first-write-wins** (returns whatever salt the server ended up with). The salt
is **server-owned and created by sync** — the intents transport only *reads* it.

### 1.2 Codec functions (from `@glance-apps/intents`)

Row codec (envelope ⇄ server row + cursor formatting):

```js
buildIntentRow(envelope, { ttlMs })
  // → { eventId: string, envelope: string /* base64 */, expiresAt: string /* ISO */ }

parseIntentRow(serverRow)
  // serverRow: { eventId, envelope /* base64 */, seq, expiresAt, serverMtime }
  // → { eventId, envelope: object /* DECODED */, seq, expiresAt, serverMtime }

parseSince(stringOrNull)   // → number | null   (the stored cursor → a seq)
formatSince(numberOrNull)  // → string          (null → "0"; otherwise String(seq))
```

Envelope codec (build/parse + crypto):

```js
// derive a per-account root key (HKDF base key, non-extractable, cacheable)
deriveIntentsRootKey(passphrase, salt /* Uint8Array(16) */) // → Promise<CryptoKey>

// derive a per-envelope AES-256-GCM key from the root key + the envelope's salt
deriveEnvelopeKey(rootKey, envelopeSalt) // → Promise<CryptoKey>

// build envelopes from { action, payload, emittedBy, eventId? }
buildEnvelope(params)                       // → plaintext envelope object
buildEncryptedEnvelope(params, deriveKey)   // → Promise<encrypted envelope object>
//   deriveKey: (salt) => deriveEnvelopeKey(rootKey, salt)

// parse envelopes (raw = the decoded object from parseIntentRow().envelope)
parseEnvelope(raw)                          // → validated plaintext envelope
parseEncryptedEnvelope(raw, deriveKey)      // → Promise<decrypted+validated envelope>

// error types thrown by the parsers
NoKeyError, WrongKeyError, NotEncryptedError, MalformedEnvelopeError
```

Envelope shapes (top level is **never** encrypted — routing fields stay
readable; only the payload is sealed):

```jsonc
// plaintext
{ "schema_version": 1, "event_id", "emitted_at", "emitted_by", "action", "payload" }

// encrypted
{ "schema_version": 1, "event_id", "emitted_at", "emitted_by",
  "encrypted": true, "salt", "iv", "payload_ciphertext" }
```

> **Cross-app crypto contract:** `deriveIntentsRootKey` and `deriveEnvelopeKey`
> are **app-agnostic** — no app id, no per-app info string. Two apps that feed
> the **same passphrase and the same salt** derive the **identical** key and can
> decrypt each other's envelopes. See §4.

---

## 2. The outbox (durable outbound queue)

The outbox is a self-contained module that persists outbound intents and drives
their delivery. It imports **nothing** from the emit sites, the live
transports, or `@glance-apps/*` — it depends only on a persistent store and a
set of injected deliverer functions.

### 2.1 Hard rule

> The outbox stores the **RAW intent** (`action` + `payload` + emit metadata),
> **never a built envelope**. Envelope construction and encryption happen inside
> the deliverer at flush time. Therefore **a plaintext envelope is never written
> to disk** — this is structural, not a convention.

### 2.2 Entry shape

```jsonc
{
  "id": "<event_id>",          // the intent's event_id — idempotency key
  "intent": { /* RAW intent: action, payload, emit metadata, event_id */ },
  "createdAt": 1700000000000,  // ms epoch
  "targets":  { "webdav": "pending", "vault": "pending" },   // name → status
  "attempts": { "webdav": 0, "vault": 0 }                    // name → count
}
```
- `targets[name]` is one of `'pending' | 'delivered' | 'given-up'`.
- `attempts[name]` is **per-target** (the give-up bound applies independently to
  each target — giving up one target keeps retrying the others).

### 2.3 Storage

IndexedDB, one DB + one object store keyed on `id` (dayGLANCE:
`dayglance-intents-outbox` / store `entries`). The store is abstracted behind a
tiny interface so it is injectable for tests:

```js
{ getAll(): Promise<Entry[]>,
  get(id): Promise<Entry|undefined>,
  put(entry): Promise<void>,
  delete(id): Promise<void> }
```
IndexedDB structured-clones on read, so callers own/mutate what `getAll` returns.

### 2.4 API

```js
enqueue(intent, targets, opts?) → Promise<Entry>
//   Persist a new entry with every target 'pending'. DURABLE before it resolves
//   (the store write has completed). IDEMPOTENT on intent.event_id: if an entry
//   with that id exists, it's a NO-OP that returns the existing entry unchanged
//   — re-emitting never resets in-flight delivery progress.
//   targets: ['webdav','vault'] (array of enabled transport names).
//   Throws if intent.event_id is missing or targets is empty.

flush(deliverers, opts?) → Promise<{attempted, delivered, gaveUp, removed, skipped}>
//   For each entry, for each STILL-'pending' target, call
//   deliverers[target](intent) and apply the result (§2.5). Remove an entry once
//   no target is 'pending'. Guarded by an in-flight lock: a flush already running
//   makes a concurrent call a no-op ({skipped:true}).
//   deliverers: { webdav: fn, icloud: fn, vault: fn } (transportName → deliverer)

pendingCount(opts?) → Promise<number>   // entries with ≥1 pending target
list(opts?)         → Promise<Entry[]>  // all entries (diagnostics/tests)
```

### 2.5 Flush state machine (per pending target)

| deliverer result | action |
|---|---|
| `'delivered'` | mark target `delivered` |
| `'transient'` | leave `pending`, `attempts[t]++`; if `attempts[t] >= MAX_OUTBOX_ATTEMPTS` → `given-up` (log loudly) |
| `'permanent'` | mark target `given-up` immediately (log loudly) |
| *(throws)* | treated as `'transient'` (never drop) |
| *(no deliverer supplied this flush)* | untouched — not attempted, not counted |

An entry is **removed** when `isEntryDone` — no target is still `pending` (all
`delivered` or `given-up`). An already-`delivered` target is **never
re-delivered**.

### 2.6 `MAX_OUTBOX_ATTEMPTS`

dayGLANCE uses **50** — deliberately far above the receive-side bound (5).
Losing outbound data is worse than re-attempting, and the server is
insert-only/idempotent on `eventId` so a re-POST of an already-delivered row is
cheap (a no-op). The bound exists only so a genuinely-dead target can't grow the
outbox unbounded.

---

## 3. The deliverers

A deliverer is the per-transport function the outbox calls at flush time.

```js
async (intent) => 'delivered' | 'transient' | 'permanent'
```

**Contract:** never throw to signal an *expected* failure — return
`'transient'` (retry) or `'permanent'` (give up). An unexpected throw is caught
by the outbox and treated as `'transient'`, so a thrown POST never drops the
intent. The deliverer is the **only** place an envelope is built and encrypted.

Raw-intent → envelope-params mapping is uniform across deliverers:
```js
toEnvelopeParams(intent) = {
  action:    intent.action,
  payload:   intent.payload,
  emittedBy: intent.emitted_by,
  eventId:   intent.event_id,   // carried through so the row id is stable across retries
}
```

HTTP outcome mapping (shared helper):
```js
mapHttpStatus(status):
  2xx                      → 'delivered'
  5xx | 429 | 408          → 'transient'
  other 4xx                → 'permanent'
  (network error / throw)  → 'transient'
```

### 3.1 Vault deliverer — ALWAYS ENCRYPTED

No plaintext branch exists, ever. Steps:

1. Resolve the connection (`{ vaultUrl, vaultToken, accountId }`). Absent →
   `'transient'` (it may appear; never drop).
2. **Load the vault intents key from its OWN cache slot** (distinct from the
   WebDAV/file-tier key slot — see §4). **Absent → return `'transient'`, build
   nothing, send nothing.** The outbox holds the intent until key setup runs.
3. Build the **encrypted** envelope:
   `buildEncryptedEnvelope(toEnvelopeParams(intent), salt => deriveEnvelopeKey(rootKey, salt))`.
4. Encode + POST one batch:
   ```js
   const row = buildIntentRow(envelope, { ttlMs });
   const body = { accountId, events: [{ eventId: row.eventId, envelope: row.envelope, expiresAt: row.expiresAt }] };
   POST `${vaultUrl}/intents/batch`  // Bearer vaultToken
   ```
5. Map the response with `mapHttpStatus`. Network error → `'transient'`.

### 3.2 WebDAV / iCloud deliverers (file tiers)

Thin durable wrappers over the app's **existing** file-tier writes. They keep
that tier's **existing encryption policy** unchanged (in dayGLANCE: encrypt iff
the WebDAV-intents config has `encryptionEnabled`, else plaintext — the file
tiers may legitimately carry plaintext; the **vault** may not). Same outcome
mapping:
- encryption on but file-tier key not cached yet → `'transient'` (never silent
  plaintext fallback);
- write success → `'delivered'`; network/5xx → `'transient'`; not-configured /
  won't-self-heal → `'permanent'`.
- iCloud has no HTTP status: write ok → `'delivered'`, unavailable or write
  failed → `'transient'`.

---

## 4. The vault key: derivation and setup

### 4.1 Derivation (the cross-app contract)

```js
vaultSalt = await getSalt(accountId)            // server-owned, from /salt/:accountId
rootKey   = await deriveIntentsRootKey(syncPassphrase, vaultSalt)
await storeVaultIntentsRootKey(rootKey)         // cache in the VAULT key slot
```

> **This derivation MUST be replicated exactly.** It is app-agnostic: any GLANCE
> app that feeds the **same sync passphrase** and the **same vault salt**
> (`/salt/:accountId`) derives the **byte-identical** root key, and per-envelope
> keys follow from it. Diverge on either input — a different salt, a different
> passphrase, an app-specific info string — and cross-app intents become
> **undecryptable**. The salt is **read** from the vault, never invented: if
> `getSalt` returns null, sync has not established it yet → surface an error,
> do **not** fabricate one.

### 4.2 Key slots (do not collide)

Keep the vault intents key in **its own cache slot**, separate from any file-tier
(WebDAV) intents key — they are different keys derived from different salts. In
dayGLANCE both live in one IndexedDB store under distinct record keys
(`vault-root-key` vs `root-key`), each with its own in-memory cache. The vault
deliverer and the vault receive path use **only** the vault slot.

### 4.3 Setup timing (at enable, before reload)

`ensureVaultIntentsKey()` runs in the "enable vault intents" toggle's **save
handler, before the app reloads** (the passphrase is in memory then and gone
after reload):

```
1. Key already cached? → done (no-op).
2. Is the sync passphrase available?  ← checked SEPARATELY from the connection.
   - The connection (URL/token/accountId) can be present while the passphrase
     is null (e.g. after a reload). Connection-present is necessary but NOT
     sufficient — derivation needs the passphrase.
   - passphrase present → derive + cache now.
   - passphrase null → PROMPT once (reuse the app's existing sync-passphrase
     modal — do not build a new one). On confirm, derive. On CANCEL, do NOT
     enable vault intents (revert the toggle) and surface that setup is required.
3. getSalt(accountId) === null → error (e.g. NO_VAULT_SALT); do not enable.
```

After setup, the cached key **survives reloads with no passphrase** (a stored
`CryptoKey`), exactly like the file-tier intents key and the sync key. Once
cached, the vault deliverer's "key absent → transient" branch (and the receive
path's, §5) stops firing and held intents flush/decrypt.

### 4.4 Fetch adapter note

`getSalt` is typically called via the sync package's vault client, whose
`fetchImpl` expects the `(url, init) => Response`-like shape, whereas the
batch/list calls use a positional `(method, url, headers, body) => {status, ok,
body}` fetch (so it can route through native/Electron bridges). If you reuse one
underlying fetch for both, **adapt** the positional one into the `(url, init)`
shape for the client. Use whatever platform-correct fetch your app already uses
for vault sync.

---

## 5. The receive path

A polled drain that lists from a cursor, decodes + routes each row, and advances
the cursor per consumed row.

### 5.1 The receive cursor

App-owned, its own storage key (dayGLANCE: `dayglance-db-intent-cursor`), a
`seq` number. Stored via `formatSince`, read via `parseSince`.

> The receive cursor advances **only** from rows actually received/consumed
> (their `seq`). **Sending never touches it.** (It can legitimately *jump* past
> the seq of a TTL-expired row the server no longer returns — that gap is
> correct, not a skip bug.)

### 5.2 The drain (paginated — mandatory loop)

```
since = getReceiveCursor()           // seq | null
hasMore = true
while hasMore:
  { rows, hasMore } = GET /intents/list?accountId=&since=formatSince(since)&limit=500
  for row in rows:                   // rows already filtered to seq>since, non-expired
    parsed = parseIntentRow(row)     // throws → malformed server row: advance past it
    outcome = route(parsed.envelope) // 'ok' | 'permanent' | (throws → transient)
    apply outcome (§5.3) → maybe advance `since`/cursor, or HOLD (return)
```
Never read `.rows` once — a >500 backlog spans pages.

### 5.3 Uniform bounded-retry failure model

A persisted **per-seq consecutive-failure counter** (dayGLANCE:
`dayglance-db-intent-retries`, a `{ [seq]: count }` map) backs the bound;
`MAX_INTENT_RETRIES = 5`. Per row:

| cause | classification | drain action |
|---|---|---|
| routed & handled OK | **success** | advance cursor, **clear** the seq's counter |
| handler **threw** | **transient** | do NOT advance; `bumpFailure(seq)`; **HOLD** (stop the whole drain so the next poll retries from here). At `>= MAX_INTENT_RETRIES` → **give up**: log loudly with eventId, clear counter, advance past |
| **vault key absent** | **transient** | same as handler-threw (see below) |
| decrypt fails **with key present** (wrong key / bad ciphertext) | **permanent** | advance + log |
| **plaintext** row over the vault | **permanent (rejected)** | advance + log — never parse/route it |
| malformed envelope / protocol mismatch | **permanent** | advance + log |
| handler **soft-fail** (`result.success === false`) | **permanent** | advance + log |

> **Decrypt-cause distinction (critical):** *key absent* is **transient** — the
> key will arrive once setup/restore completes, so **hold + bounded-retry**,
> never advance past (that would lose the intent). *Key present but the row
> won't decrypt* is **permanent** — retrying can't help, advance past.

Implementation mechanism: the router **throws** on key-absent (a typed
`KeyUnavailableError`, and it re-throws a parser `NoKeyError` as the same), so it
flows into the exact same "handler threw → transient → hold + bounded retry"
branch the drain already has. No second retry mechanism. The give-up bound means
a permanently-keyless or permanently-throwing row can't wedge the channel
forever.

> **Zero-knowledge enforcement:** a non-encrypted row arriving over the vault is
> a contract violation — **reject** it (permanent: log with eventId, advance,
> never route). The vault carries ciphertext only, send **and** receive.

### 5.4 Loopback

Skip the app's own emitted rows (e.g. `emitted_by === '<this app's id>'`) so a
device doesn't process what it sent.

---

## 6. The emit wiring

At each emit site:

```
1. Build the RAW intent: { event_id, action, payload, emitted_by }.
   - Stamp a STABLE event_id NOW. It becomes the outbox entry id AND the server
     idempotency key, and must flow unchanged through every retry. (Notify-style
     intents: a stable per-change id; create-style: a deterministic id derived
     from the entity so a repeat emit reuses it.)
2. Compute the ENABLED targets for this intent (§8): e.g. 'webdav' if the file
   tier is configured, 'icloud' if available, 'vault' if vault intents enabled.
   None enabled → nothing to send.
3. await enqueue(intent, targets)   // DURABLE before return
4. Trigger flush(deliverers).
```

> **Snapshot/marker timing:** if the emitter detects changes by diffing against
> a previous snapshot/marker, advance that marker **only AFTER the enqueue has
> durably succeeded** — never before the async enqueue resolves. A failed
> enqueue must **not** advance the marker (so the change is re-detected). Guard
> against a re-render/re-entry re-enqueuing mid-flight.

**Flush triggers (all of):**
- immediately after an emit enqueues;
- on app start / mount (drains anything persisted from a previous session);
- on the intents poll cadence (same interval/focus cadence as the receive
  poller);
- right after vault key setup completes (so a freshly-enabled device flushes
  intents held while the key was absent).

`flush`'s in-flight lock collapses overlapping triggers into one drain.

---

## 7. Invariants (reviewer checklist)

A correct implementation satisfies **all** of these:

- [ ] **Never plaintext on the vault** — the vault deliverer always encrypts (no
      plaintext branch); the receive path **rejects** any non-encrypted vault row.
- [ ] **Never lose an intent** — persisted to the outbox *before* any transmit;
      transient failures (incl. key-not-ready, no connection, network/5xx) are
      held and retried; only a bounded give-up (logged) ever drops one.
- [ ] **Outbox stores RAW intents, never envelopes** — no plaintext envelope is
      ever persisted; encryption happens at flush in the deliverer.
- [ ] **Cross-app key derivation is byte-identical** —
      `deriveIntentsRootKey(syncPassphrase, vaultSalt)` with the server-owned
      `/salt/:accountId` salt; no app-specific inputs.
- [ ] **Receive cursor advances only on consumed rows** — sending never touches
      it; the per-seq retry counter is cleared on success and on give-up.
- [ ] **Decrypt-cause distinction** — key-absent ⇒ transient (hold + retry);
      key-present-but-bad ⇒ permanent (advance).
- [ ] **Idempotent enqueue preserves progress** — re-enqueue of an existing
      `event_id` is a no-op; the stable `event_id` makes server re-POST a no-op.
- [ ] **WebDAV (file tier) stays available** — the vault transport runs
      *alongside* it; it is not deprecated or required.

---

## 8. dayGLANCE-specific vs. general

**General pattern (replicate as-is):** the three layers and server contract
(§1); the outbox model, API, idempotency, and give-up bound (§2); the deliverer
signature/contract, the always-encrypted vault deliverer, and HTTP outcome
mapping (§3); the vault key derivation and cross-app contract, key slots, and
setup-before-reload timing (§4); the paginated drain, receive cursor, and
uniform bounded-retry model incl. the decrypt-cause distinction and plaintext
rejection (§5); the emit flow and snapshot-after-durable-enqueue rule (§6); all
invariants (§7).

**dayGLANCE-specific (change for your app):**

- **Target list.** dayGLANCE has three: `webdav`, `icloud`, `vault`. An app
  without iCloud omits `icloud`; an app with only the vault uses `['vault']`.
  The outbox/deliverer machinery is agnostic to the set.
- **Emit sites.** dayGLANCE emits from task-change and goal-change watchers and a
  goal-create call. Your app emits from its own state-change points — only the
  *raw intent* shape and the enqueue/flush wiring are prescribed.
- **Intent `action`/`payload` shapes & `emitted_by`.** Your app's domain
  payloads and its own emitter id (dayGLANCE uses `app.dayglance`). The codec
  validates payloads against the shared schema, but which intents you emit is
  yours.
- **Storage key names / DB names.** dayGLANCE uses
  `dayglance-intents-outbox` (outbox DB), `dayglance-intents-crypto` (key store,
  records `root-key` / `vault-root-key`), `dayglance-db-intent-cursor` (receive
  cursor), `dayglance-db-intent-retries` (per-seq counters),
  `dayglance-db-intents-config` (`{ enabled, ttlMs, pollIntervalMinutes }`),
  `dayglance-vault-config` (the inherited `{ vaultUrl, vaultToken, accountId }`
  connection), and `dayglance-intent-config` (the file-tier config). Use your own
  namespaced keys; the *roles* are what matter.
- **Connection source.** dayGLANCE inherits the vault connection from its
  GLANCEvault **sync** config rather than storing a second copy. Your app may
  obtain `{ vaultUrl, vaultToken, accountId }` however it manages the vault.
- **Config knobs.** TTL default (30 days) and poll cadence (2 min) are defaults,
  not part of the contract.

Everything not in that second list is the general pattern and should match.
