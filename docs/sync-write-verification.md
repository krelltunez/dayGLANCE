# Verified writes for the file sync tier

A write to the shared sync file may only go out on knowledge this device actually
has. The rules below are load-bearing: each one is the fix for a shipped data-loss
path, and each is covered by a test that fails when the rule is removed.

## What went wrong

The file engine's cycle is download → merge → upload, and the upload is
conditional (it echoes the ETag it just read in `If-Match`). But two writers never
read anything first:

- `App.jsx`'s 5-second debounced "upload on data changes", and
- the header/desktop cloud button, which called `engine.upload()` — an
  unconditional `PUT` with no `If-Match` (`providers.js`, `if (etag)`).

Both therefore replace the whole remote snapshot with this device's local copy.
After a misconfiguration (a wrong server address, a proxy pointed at the wrong
host) the device has never read the remote, so that write lands on top of whatever
the other devices had written and nothing on either side can notice. The absent
remote seed guard (`absentRemoteSeedGuard.js`) closed one of these doors — the
404 branch — and explicitly not the other two.

Both writers now run the full cycle instead (rule 5), so the app no longer uploads
unread. The gate stays anyway: "no caller does that today" is not a guarantee, and
the conflict dialog's `engine.upload()` (with the ETag the user was shown) still
has to be checked.

## The rules

1. **A write must be backed by a read.** `src/sync/verifiedWriteGuard.js` records
   what every provider `download` resolved to, and `validateUploadPayload`
   refuses any upload that has neither a read in this cycle nor a verified read of
   the *current* target. Refusal is not silent: the hold/refusal is reported with
   a code the UI can localize.
   "In this cycle" is timed, in both directions: a read older than
   `CYCLE_READ_TTL_MS` no longer authorizes the cycle's write, and a *stale
   absence* — a cycle that read nothing and then never reached its upload, so
   nothing consumed the observation — cannot authorize a later, unrelated write
   as if it were a seed.
2. **A write that no read backed carries a validator — and only that write does.**
   The guard injects the ETag of the last verified read of the same target when,
   and only when, the write has no read in this cycle behind it (`mode
   'conditional'`). It never overrides a validator the engine supplies, and it
   never supplies one to a cycle write: the engine passes none on purpose when the
   read carried no ETag (a server that sends none — refusing those would stop
   syncing) and, critically, in the last-resort fallback after two 412s
   (`skipIfMatch`, the fix for servers whose ETag cannot round-trip through
   `If-Match`). Re-injecting the read's ETag there re-arms the validator the
   server just rejected, and the sync wedges exactly where the fallback exists to
   un-wedge it. Cover: `adapterWriteVerification.test.js` ("the cycle the gate must
   not wedge" — the third PUT must carry no `If-Match`).
3. **The target is part of the knowledge.** A target is
   `provider + server + account + folder` (`src/sync/syncTarget.js`). A verified
   read of one target never authorizes a write to another: change the server or
   the folder and the next write is refused until a read of the new target
   succeeds. `App.jsx` also cancels any armed debounce and clears a hard stop left
   by the old target, then reads the new target once.
4. **The absent-remote hold is scoped to the target.** `hasSyncedBefore` is
   "this device synced *this* target", persisted with the verified record
   (`day-planner-cloud-sync-verified-remote`), falling back to the engine's global
   `-cloud-sync-last-synced` stamp only while no target record exists (upgrade
   path). Without this, pointing at a new empty folder produced a false ten-minute
   hold, and switching servers carried a stale absence streak to the new one.
5. **Every ambient trigger runs the full cycle.** The header/desktop button and
   the 5-second post-edit debounce both call `download()`, never `upload()`: a
   trigger must read, merge and then write, not push local state over the remote.
   `src/utils/syncNowAction.js` owns both decisions (`runSyncNow`,
   `runSyncAfterEdit`) so the headers and `App.jsx` share them, and neither
   signature has an upload parameter to regress into.
   The debounce is not merely a safety change, it is also the faster path: the
   verified ETag comes from a read and never from a write (a provider's `upload()`
   returns no ETag), so a bare upload after any cycle that wrote carries a
   validator the server has already moved past — a 412 the engine swallows under
   its in-flight lock, which turns a 5-second propagation into a 60-second one.
   Cover: `adapterWriteVerification.test.js` ("an edit made after a cycle that
   wrote").
6. **Reported means visible.** The refusal/hold message renders whenever
   `cloudSyncError` is non-null. Gating it on `status === 'error'` hid it, because
   the engine settles the status back to `idle` on the next line.

## An unreadable remote file (#2409)

A remote file can be there and still not be readable: an upload that was cut
off leaves half a JSON document, some servers answer 200 with a page for a path
that does not exist, and a proxy's error page is a 200 too. The engine reported
all of these as `NETWORK_ERROR` on every cycle, and nothing ended it: the file is
there, so nothing seeds, and it cannot be read, so nothing merges.

- **Unreadable is not absent, and authorizes nothing.** The automatic cycle
  writes nothing, as before. A captive portal looks exactly like this, and a
  snapshot written over the real file on that evidence is the loss the rules
  above exist to prevent. JSON that is not a sync file is no longer recorded as
  a verified read of the target either (`sync/unreadableRemote.js` sits inside
  the read wrapper).
- **It has its own code.** `REMOTE_UNREADABLE`: what was seen, that nothing was
  written, that the local copy is safe. The app says it once per outage in a red
  toast and keeps the text in the sync settings.
- **The user can end it.** "Replace the server copy", shown in the sync settings
  while the file stays unreadable, reads the file once more and uploads this
  device's data only if that read is unreadable too (`replaceUnreadableRemote`
  in `sync/adapter.js`; mode `replace` in the write guard). The request and the
  unreadable read are both required, both fresh, and both one-shot. A file that
  reads normally, or is missing, is never replaced by it: that runs an ordinary
  cycle. The empty-payload refusal still applies.
- **The desktop read is not served from the HTTP cache.** `proxy-fetch` sends
  `cache: 'no-store'` and a `Cache-Control: no-cache` request header
  (`electron/proxyFetchInit.ts`). A truncated file was served from Chromium's
  cache after the server copy had been repaired.

Not done: the upload is still a single PUT to the final path, so an interrupted
one can still truncate the file. Writing to a temporary name and renaming would
prevent it, and needs a seam in `@glance-apps/sync`.

## Not covered here

- **The Test Connection button is a reachability probe, by design.** The providers
  count 200 *and* 404 as success (`providers.js`: a 404 means the server answered),
  so a green test is not evidence that the sync file exists, nor that the path or
  the folder is the right one. It gates nothing — a write is authorized by the read
  this guard records, never by the test. Working out whether a particular 404 is
  "the server has no such file" or "the configured address/path is wrong" is a
  manual procedure against the target server itself (list the parent folder with
  PROPFIND, read the target's own access log); the app deliberately does not try to
  infer it.
- **`If-None-Match: *` on the seed write.** The right primitive for "create only
  if absent" — the server refuses atomically, with no time window. It needs a seam
  in `@glance-apps/sync` (`provider.upload(config, data, etag)` has no place for
  it); the hosted proxy already forwards the header (`api/webdav-proxy.js`), so
  the change is small but upstream. Until then the seed write stays guarded by the
  timed hold in `absentRemoteSeedGuard.js`.
- **The absence streak is in memory.** It resets on reload, so a genuinely deleted
  remote file only re-seeds inside a session that stays open past the grace
  window. Persisting `missingSince` next to the verified record is the next step.
