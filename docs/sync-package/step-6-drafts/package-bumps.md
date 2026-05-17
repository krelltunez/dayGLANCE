# package.json bumps for Step 6

## `glance-sync/package.json`

Change `"version"` from `"0.5.0"` to `"1.0.0"`.

```diff
 {
   "name": "@glance-apps/sync",
-  "version": "0.5.0",
+  "version": "1.0.0",
   "license": "MIT",
   ...
 }
```

## `dayGLANCE/package.json`

After the package is published, bump the dependency:

```diff
   "dependencies": {
-    "@glance-apps/sync": "^0.5.0",
+    "@glance-apps/sync": "^1.0.0",
     ...
   }
```

Run `npm install` to update `package-lock.json` and refresh `node_modules/@glance-apps/sync`.

## Commit message templates

For `glance-sync`:

```
1.0.0 — extract createSyncEngine, add TypeScript declarations

Full orchestration (download → validate → merge → apply → upload) moves
out of dayGLANCE App.jsx and into the package's createSyncEngine factory.
Envelopes now carry schemaVersion + appId for forward-compat; legacy
envelopes (missing both fields) are accepted unchanged.
```

For `dayGLANCE` (step-6-engine-adapter branch):

```
Step 6: replace cloudSync orchestration with @glance-apps/sync engine

App.jsx no longer owns the upload/download/merge cycle. The new
src/sync/adapter.js wires dayGLANCE's data callbacks into the engine
factory and the existing App.jsx wrappers (cloudSyncUpload, cloudSync
Download, cloudSyncTest, buildSyncPayload) become thin pass-throughs.

Bumps @glance-apps/sync to ^1.0.0.
```
