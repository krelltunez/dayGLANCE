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
  `.dayglance/pairing`, the plugin shows a notice; the code is entered in
  the plugin's **settings tab** (Settings → dayGLANCE Bridge — status,
  code entry, unpair) or via the **Enter pairing code** command's modal,
  both driving the same flow. The code opens the offer, the carried device
  token is verified against GLANCEvault with one authenticated call, and
  the credentials (token + bridge-scoped subkey) are stored in
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
- **Agenda sidebar** (companion spec 4.2): a right-sidebar view — mini
  month calendar over the selected day's agenda (scheduled tasks, recurring
  instances, imported calendar events; ±35 days around today; no inbox),
  with the day's placed routines as a pill strip underneath (name and start
  time). Read-only calendar events never sync, so each running dayGLANCE
  publishes a projection of the ones it holds (`proj:calendar:<deviceId>`
  rows on the bridge stream, built from a per-day cache of the fetches the
  app already makes) and the sidebar merges them with per-day authority (the
  device that fetched a day most recently supplies that day's events); the
  footer notes when the selected day's events are over an hour old. On a
  multi-user account the agenda shows one person's view: tasks unassigned or
  assigned to them, routines they own, and their devices' calendars. The
  viewer defaults to the user of the dayGLANCE device that paired the vault
  and can be changed (or set to Everyone) under "Show tasks for" in the
  settings tab. Tags in
  titles render faded; `[[wikilinks]]` render as their display text and
  click through to the note.
  It reads the account's task rows directly from GLANCEvault: enter your
  dayGLANCE **sync passphrase** once per device in the settings tab's
  "dayGLANCE account" section. The derived root key is kept in the plugin's
  own IndexedDB store on that device only; neither the passphrase nor the
  key is ever written to `data.json` (which Obsidian Sync would carry to
  every copy of the vault). The plugin never writes a data-plane row:
  checking a task's box emits a completion **action** on the bridge stream
  that a running dayGLANCE applies (so its completion log, vault writeback
  and sync all fire), and the box shows as pending until the mirror
  reflects it. Ribbon icon and **Open agenda** command.
- Four commands: **Sync now** (drains pending intents + refreshes the
  heartbeat), **Enter pairing code**, **Unpair from GLANCEvault**
  (forgets the local credentials and the account key; revoke the token
  server-side too), and **Open agenda**.

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
