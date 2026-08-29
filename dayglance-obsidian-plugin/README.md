# dayGLANCE Bridge (Obsidian plugin)

Phase 5 of the dayGLANCE Obsidian build-out (`docs/obsidian-buildout-spec.md`
in the dayGLANCE repo): the plugin exists, runs, and does the smallest useful
thing. **Unlisted** — installed manually or via BRAT, not submitted to the
community directory.

## What it does (all of it)

- Writes `.dayglance/heartbeat` every 30 seconds while Obsidian has the vault
  open — `{"paired": false, "accountId": null, "deviceId": "…", "ts": "…"}`.
  dayGLANCE reads this to skip launching Obsidian when it's already running,
  and (from Phase 6) to decide vault-write arbitration. The file lives in a
  dot-directory, so Obsidian's indexer, search, graph view, and Obsidian Sync
  all ignore it.
- Adds one command: **Sync now** (`dayglance-bridge:sync-now`). With no
  transport yet, it refreshes the heartbeat immediately.

No settings tab, no network, no other vault writes.

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
any community-directory submission without surgery.
