# dayGLANCE Bridge (Obsidian plugin)

Phases 5–6 of the dayGLANCE Obsidian build-out (`docs/obsidian-buildout-spec.md`
in the dayGLANCE repo): heartbeat plus pairing. **Unlisted** — installed
manually or via BRAT, not submitted to the community directory.

## What it does (all of it)

- Writes `.dayglance/heartbeat` every 30 seconds while Obsidian has the vault
  open — `{"paired": bool, "accountId": string|null, "deviceId": "…", "ts": "…"}`.
  dayGLANCE reads this to skip launching Obsidian when it's already running,
  and (once arbitration lands) to decide vault-write arbitration. The file
  lives in a dot-directory, so Obsidian's indexer, search, graph view, and
  Obsidian Sync all ignore it. `deviceId` is a per-install id that rides
  `data.json` (and therefore Obsidian's settings sync) — it identifies the
  vault copy, not a device; see spec §3.3.
- **Pairing** (spec §3.12): when dayGLANCE drops a sealed pairing offer at
  `.dayglance/pairing`, the plugin shows a notice; the **Enter pairing code**
  command opens a modal, the code typed there opens the offer, the carried
  device token is verified against GLANCEvault with one authenticated call,
  and the credentials (token + bridge-scoped subkey) are stored in
  `data.json`. The offer file is deleted after use.
- **Intent stream** (spec §3.6): while paired, the plugin drains semantic
  intents dayGLANCE emitted (task state changes, retitles, appends, note
  writes) from GLANCEvault and applies them to the vault through a pure,
  idempotent applier shared with dayGLANCE — drain on open plus a 30-second
  interval while foregrounded, with an applied-ID set and high-water mark
  persisted per batch so crash replay is a no-op. In the other direction it
  reports plain **observations** — the latest state of daily notes and
  task-marked files, one upserted row per path — and never interprets an
  edit; that is dayGLANCE's scan pipeline's job.
- Three commands: **Sync now** (drains pending intents + refreshes the
  heartbeat), **Enter pairing code**, and **Unpair from GLANCEvault**
  (forgets the local credentials; revoke the token server-side too).

Network access happens only while paired (plus pairing verification), only
to the vault URL carried in the offer, via Obsidian's `requestUrl`. All
stream rows are AES-256-GCM under the pairing's bridge subkey.

## Build

```
npm install
npm run build      # type-checks, then bundles src/main.ts → main.js
```

## Manual install

Copy `manifest.json` and the built `main.js` into
`<vault>/.obsidian/plugins/dayglance-bridge/` and enable the plugin in
Settings → Community plugins.

## Repo shape

This directory is deliberately self-contained (own package.json, no imports
from dayGLANCE) so it can be extracted to its own public repository before
any community-directory submission without surgery. Its two dependencies —
`@glance-apps/obsidian-format` (the shared vault-format core, `file:`-linked
while the plugin lives here) and `@glance-apps/sync` (only `vaultClient.js`
is imported, so the bundle carries the HTTP client and none of the sync
engine) — are bundled into `main.js`.
