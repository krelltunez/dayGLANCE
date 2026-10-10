# Direct Access sync

A third file-tier Cloud Sync option alongside WebDAV and iCloud. Direct Access
reads and writes `dayglance-sync.json` in a folder the user picks on each device,
and leaves moving that folder between devices to whatever already does so:
Google Drive for desktop, Dropbox, OneDrive, Syncthing, a Nextcloud client, or
a plain network share.

This document is the design and the phased plan. Phases 1 and 2 are merged;
3 and 4 are built and awaiting device tests; 5 and 6 are designed below.
Phase 1 is the refactor that
makes the rest possible; each later phase is its own branch and PR.

## Where it fits

The two existing file-tier options are not siblings in the code:

| | WebDAV | iCloud |
|---|---|---|
| Lives in | `@glance-apps/sync` engine, via `src/sync/adapter.js` | a loop in `App.jsx` (`iCloudSync`) |
| Transport | HTTP with server ETags and `If-Match` | a local file the iCloud daemon ferries |
| Concurrency | optimistic (412 → conflict dialog) | none; three-way merge absorbs races |
| Encryption | optional passphrase envelope | plaintext (Apple encrypts the container) |
| Runs alongside the others | one provider slot | yes, with its own mutex |
| Configuration | text fields in the settings form | zero-config; per-device on/off |
| Remote change signal | 60 s poll | 15 s poll + `fs.watch` / `NSMetadataQuery` |

Direct Access follows the **iCloud model**, for three reasons:

1. A third-party synced folder behaves like the iCloud container. It is a local
   file ferried by a daemon, with no ETag, eventual consistency, and files that
   may be cloud-only placeholders (Drive streaming, OneDrive Files On-Demand,
   Dropbox online-only). The iCloud loop already handles the placeholder,
   partial-read and evicted-file cases.
2. It must run alongside WebDAV and GLANCEvault. The engine resolves providers
   from its own table and has one provider slot; making Direct Access an engine
   provider would force a choice between it and WebDAV, and would need a change
   in the upstream package.
3. The settings form cannot express it. Engine providers are text fields;
   Direct Access needs a native folder picker and persisted folder access, which
   the Obsidian vault integration already solved on every platform
   (`electron/obsidian.ts`, `ObsidianRepository.kt`, `ObsidianBridge.swift`).

What it must **not** do is copy the iCloud loop. That loop is ~270 lines with
guards that have each shipped a fix (the seed guard, the first-run prompt, the
stale-mutex release, the write throttle, the HealthKit strip, the reset guard).
A second copy would drift. So the iCloud loop is first extracted into a hook
parameterised by a *transport*, and Direct Access becomes the second transport.

## Design decisions

**One diagnostics panel, on every platform.** Settings → Cloud Sync → Sync
diagnostics reports GLANCEvault and WebDAV everywhere, the iCloud container on
Apple platforms, and the Direct Access folder wherever the bridge exists, each
block only where its transport is. The report's first line names the device
(`ios`, `android`, `macos`, `windows`, `linux`, `web`), not the iCloud bridge.
The web and PWA, which have neither file transport, still get the vault and
WebDAV rows.

**Made here, or relayed.** A change reaches a device by two roads at
different speeds: GLANCEvault in seconds, the folder's syncing tool in tens of
seconds. The second Mac learned of an iPhone's edit from the vault, found its
folder copy stale, wrote the same data with a fresh stamp, and Nextcloud
reported a conflict on every change (2026-10-08; the conflict copies were
byte-identical in content to the live file). Deferring every write by one poll
did not help: it held the originating device's write back too, which only
lengthened the window in which the others relayed it. So the cycle tells the
two apart. A change made on this device (its own last-edit stamp,
`day-planner-local-edit-at`, set by the persist pass for an edit and not for an
apply, newer than this device's last write to the file, or before any write
its previous read) is written at once. Anything else is relayed only after the
file has sat unchanged, still lacking it, for `RELAY_CONFIRM_MS` (90 s): long
enough for the folder's tool to deliver the originating device's own write, so
the relay only happens when nobody else carried it. Seeding an absent file is
never deferred.

Two more rules on the relay, from the Macs' conflict copies of 2026-10-10
(every one the snapshot; the diffs named the phone's Health Connect habit
stamps and the midnight routine rollover):

- **Relays are staggered across devices.** A change that arrives by another
  road (the vault's push nudge, an edit from a phone whose folder tool
  round-trips slowly) reaches every device on the folder within the same
  second, so with one relay clock they all wrote the same file together 90 s
  later, a conflict copy per pair. Every write now stamps `writtenBy` (the
  device id) in the file header, each device ranks itself among the writers
  it has seen there (`${lastSyncedKey}:writers`), and waits `RELAY_STAGGER_MS`
  (a minute) more per rank (`relayWaitMs`). The first-ranked device writes at
  90 s; the next sees the file catch up and drops its relay. A device that has
  not seen the others ranks first, collides at most once, and learns them from
  the file. The event-set cycle uses the same header, the same writers set
  and the same wait, so retention drops, which every device computes at the
  same moment, relay from one device too.
- **Clock-driven bookkeeping is not an edit made here.** The midnight routine
  rollover runs on every device at the same moment; each counted it as its
  own edit and wrote at once (copies at 00:00:04 and 00:00:33). The rollover
  marks `utils/localEditStamp.js`, and the persist pass that follows inside
  the window does not stamp `day-planner-local-edit-at`, so the rollover
  reaches the file by relay, from one device.

**Device-local keys are not a write.** Each device keeps its own
`use24HourClock`, `minimizedSections` and `obsidianConfig` (and, with multi-user
on, the feature toggles and calendar URLs). The file holds whichever device
wrote last, and no device adopts those values from it, so a difference in them
is left out of the write question. The merge wrapper names them
(`result.deviceLocalKeys`) and the cycle and the diagnostics dry run read that
list, so an iPhone no longer reports "would write: YES" over its clock format.
`habits` joined the equal-stamp tie-break the same day: two copies of a row
with one stamp and different content now converge instead of reading
"1 changed" forever.

**Health-store counts ride in the file.** The iCloud transport strips
HealthKit-derived habit counts from what it writes (`utils/healthLogFilter.js`),
because Apple guideline 5.1.3 forbids HealthKit data in iCloud. That rule is
about Apple's container. A Direct Access folder is the user's own cloud, so the
transport declares `stripsHealthLogs: false` and the cycle writes the counts
whole, exactly as GLANCEvault and WebDAV carry them; a Mac, which has no health
store, adopts an Android phone's Health Connect steps from the file. The first
build stripped on every transport, and the steps never reached the Macs
(2026-10-07). The diagnostics dry run asks the write question the same way the
cycle does, per transport.

- **Same file, same envelope.** The folder holds `dayglance-sync.json` in the
  existing `{ version, lastModified, data }` shape. A user who points Direct
  Access at a locally mirrored copy of their WebDAV folder interoperates.
- **Plaintext first, like iCloud, but never downgrade.** The iCloud loop
  rewrites an encrypted envelope it cannot decrypt as plaintext. That is
  acceptable inside Apple's container and wrong on a Google Drive folder.
  Direct Access refuses to write over an encrypted file it cannot read (it
  surfaces an error instead). Passphrase encryption of the Direct Access file
  is Phase 6 and reuses `src/utils/crypto.js`: the same envelope and the same
  session key as WebDAV, so a folder mirrored from a WebDAV setup
  interoperates.
- **Off by default, explicitly configured.** iCloud's tri-state preference
  exists because iOS re-grants the entitlement on reinstall. Direct Access has
  no such problem: absence means off, and "configured" means a folder was
  picked on this device.
- **Folder path and bookmark live in the native layer.** Exactly as the Obsidian
  vault does: Electron's main process (security-scoped bookmark under the Mac
  App Store sandbox), Android's SAF persistable tree URI, iOS's security-scoped
  bookmark in UserDefaults. The renderer only ever sees a folder *name*.
- **Atomic writes.** `electron/icloud.ts` writes in place to preserve the iCloud
  daemon's extended attributes. Drive, Dropbox, OneDrive and Syncthing all cope
  with temp-plus-rename, and `writeFileAtomicSync` protects against a torn file.
- **Longer write throttle, cheap change check.** Third-party daemons round-trip
  slower than iCloud, so the write throttle is longer to limit conflict copies.
  The transport stats the file before each poll read and skips an unchanged
  size and mtime.
- **Reset "everywhere" deletes it**, as it does the iCloud snapshot
  (`src/utils/resetAppData.js`).
- **Multi-user counts it as configured sync.** The roster travels inside the
  snapshot and is merged by `mergeSyncData`, so `multiUserGate.js` treats a
  Direct Access device like a WebDAV one. The separate `glance-users.json`
  roster sync over WebDAV/iCloud is out of scope.

## Shared snapshot-file sync (Phase 1 output)

```
src/sync/snapshotFileSync.js      pure: one cycle over an injected transport + io
src/hooks/useSnapshotFileSync.js  React wiring: poll, mutex, foreground kicks,
                                  change events, first-run prompt state
src/sync/icloudSnapshotTransport.js   iCloud as the first transport
```

A **transport** is a plain object:

```js
{
  id: 'icloud',                     // namespaces storage keys and log lines
  isAvailable(): boolean,           // platform supports it AND it is reachable now
  read(): Promise<string|null>,     // JSON text, 'null'/null when absent,
                                    // '{"downloading":true}' or '{"error":"…"}'
  write(text): Promise<boolean>,
  onChanged(cb): () => void,        // optional push signal from the native side
  lastSyncedKey, prefKey,           // localStorage keys this transport owns
  isEnabled(): boolean,             // per-device switch (iCloud: tri-state, absent = on)
  writeThrottleMs,                  // iCloud 5 s; Direct Access longer
  allowsPlaintextReseed: boolean,   // iCloud true (legacy envelope cleanup); Direct Access false
  stripsHealthLogs: boolean,        // iCloud true (Apple guideline 5.1.3); Direct Access false
}
```

The pure cycle (`runSnapshotFileCycle`) takes the transport plus an `io` object
(`buildSyncPayload`, `applyEngineData`, `mergeSyncData`, `stripHealthSourcedLogs`,
`decryptData`, `isEncryptedEnvelope`, `now`, `storage`) and the per-transport
cycle state (`missingSince`, `lastWriteAt`, `firstRunPending`), and returns the
next state plus what it did (`seeded`, `applied`, `wrote`, `prompted`,
`skipped: reason`). Every guard the App.jsx loop carries today is preserved and
is tested in `snapshotFileSync.test.js` with a mutation check per guard.

The hook owns what needs React: the 15 s poll, the shared `cloudSyncInProgressRef`
mutex with WebDAV, the stale-lock timestamp used on foreground resume, the
pending flag for a cycle skipped under the lock, the `onChanged` subscription,
and the first-run prompt state and handlers. Phase 1 changes no behaviour:
iCloud users see the same cycles, the same prompt, the same keys.

## Phased plan

### Phase 1: extract the iCloud loop (no behaviour change)

- Add the pure cycle module and the hook; wire iCloud through them.
- `icloudSyncPref.js` and `icloudSeedGuard.js` keep their exports; the hook
  reads keys off the transport so a second transport brings its own.
- `ICloudFirstRunModal` is unchanged in Phase 1; it gains string props when
  Direct Access needs its own copy.
- Tests: the cycle planner with each guard mutation-checked, and a scenario that
  walks save → state → write → read → apply through a fake transport.

### Phase 2: Direct Access on desktop (macOS, Windows, Linux) — done

- `electron/directAccess.ts` modelled on `icloud.ts` and `obsidian.ts`: native
  picker with security-scoped bookmarks, config in the user-data folder, restore
  on launch with a reachability check, read/write/delete, a re-attaching watcher
  with own-write suppression. An unreadable or zero-length file reads as
  `downloading`.
- Preload exposes a `directAccess` namespace; `src/sync/directAccessTransport.js`
  implements the transport shape above.
- Settings: a Direct Access card beside the iCloud toggle in `SettingsModal.jsx`
  and `MobileSettingsPanel.jsx`: choose folder, folder name, on/off, disconnect,
  last synced, status. Strings in all ten locale bundles.
- Reset-app-data gains the Direct Access snapshot for scope `everywhere`.
- Docs: this file gains the user-facing behaviour; README feature row;
  ARCHITECTURE.md describes both file-tier models.

#### What Phase 2 shipped, and two decisions it settled

- No first-run restore prompt for Direct Access. iCloud asks because its sync
  can come back on without the user; here, picking the folder is the decision,
  and the snapshot in it is applied.
- An unreachable folder (the streaming tool not running, a share not mounted)
  is reported once, then waited out quietly: the transport marks itself
  unreachable, the hook stops cycling, and each poll tick re-probes so sync
  resumes on its own when the folder is back. A fresh pick clears the
  last-synced stamp, so an empty new folder is seeded at once rather than
  treated as an eviction of the old one.
- The main process classifies reads (`electron/directAccessStore.ts`): a
  zero-length file is a cloud-only placeholder or a tool mid-write and is never
  reported as absent; a vanished folder is an error, never an absent file; an
  unchanged file is served from a size-and-mtime cache. Writes go through
  `writeFileAtomicSync`.
- The folder path and the macOS bookmark are persisted by the main process in
  `direct-access.json` under the user-data folder; the renderer stores only the
  per-device switch (`dayglance-direct-access-enabled`) and the last-synced
  stamp (`dayglance-direct-access-last-synced`).

### Phase 3: Android — done

- A `DirectAccessBridge` on the Storage Access Framework, reusing the
  persistable tree permission flow and `SafeReplace` from the Obsidian
  repository. Thin wrappers in `src/native.js`.
- No reliable change watcher exists on SAF content URIs; Android relies on the
  poll plus the existing foreground kick.
- Caveat to document: the Google Drive and Dropbox Android apps do not expose a
  folder tree to the picker. Android users need a tool that mirrors to a real
  local folder (Syncthing, FolderSync, Autosync).

#### What Phase 3 shipped

- `DirectAccessRead.kt` classifies a read exactly as the desktop store does
  (zero-length is a placeholder, a revoked grant or vanished tree is an error,
  a thrown read is retried, a refused open is an error), pure over a `Source`
  seam and JVM-tested in `DirectAccessReadTest.kt`.
- `DirectAccessRepository.kt` binds it to DocumentFile: the tree URI lives in
  `SharedDataStore.directAccessPath`, writes go through `SafeReplace`, every
  read heals a crashed write first, and an unchanged file is served from a
  lastModified-and-length cache.
- `DirectAccessBridge.kt` is `window.DayGlanceDirectAccess`; MainActivity owns
  the SAF tree picker and takes the persistable grant, and the result reaches
  the page through `window.__dgDirectAccessPicked`.
- `src/sync/directAccessNativeBridge.js` (named for Android in this phase, shared
  with iOS from Phase 4) adapts those synchronous calls to the
  promise shape the Electron preload offers, so the transport, hook, cycle and
  settings card are unchanged. There is no folder watcher on SAF, so the poll
  and the foreground kick carry remote changes.
- The settings card shows an Android-only hint: the Google Drive and Dropbox
  apps do not offer a folder tree to the picker, so the folder has to come from
  an app that mirrors to local storage (Syncthing, FolderSync, Autosync).

### Phase 4: iOS — done

- Folder picker plus security-scoped bookmark, the pattern `ObsidianBridge.swift`
  already uses. Drive and Dropbox file providers support folder selection and
  hydrate on coordinated reads.
- Lowest value because iCloud already covers Apple-only users.

#### What Phase 4 shipped

- A folder in a third-party File Provider's storage (Nextcloud, Drive, Dropbox)
  cannot be held at all on iOS: see "On iPhone and iPad the bookmark is of the
  sync FILE" under Phase 4. An earlier attempt to materialise the folder by
  listing it through coordination did nothing, because with the older File
  Provider API a folder has no directory on disk to materialise.

### Parity: what "shipped" means

Phase 4 closed on 2026-10-09 with the iPhone, two Macs and an Android phone
converging through a Nextcloud folder. The tier does not ship on that alone.
It ships when a fleet with no WebDAV server and no vault can do everything the
WebDAV tier does: share a household roster (Phase 5), encrypt the file with a
passphrase (Phase 6), and carry intents between the GLANCE apps (Phase 7).
Encryption was "optional" in earlier drafts; it is required, and it comes
before intents so the intent files follow the same envelope decision rather
than getting a second one later. Phase 8 holds what is still optional.

One fact from Phase 4 shapes all three: **on iPhone and iPad there is no
folder.** Nextcloud, Google Drive, Dropbox, Box and OneDrive ship Apple's older
non-replicated File Provider API, under which a picked folder has no directory
on disk and cannot be bookmarked, listed, or written into (see "On iPhone and
iPad the bookmark is of the sync FILE" below). An iPhone holds bookmarks to
files, one per file, each picked or created through the Files picker. So on
iOS, every file the tier needs is its own bookmark, and nothing in this tier
may depend on listing a directory or creating a file by name: the roster is
one file (Phase 5) and the intents transport is one file (Phase 7), on every
platform, so the iPhone has exactly what the Macs have.

### Phase 5: multi-user over Direct Access

Phase 2 made a connected folder count as configured sync, so the multi-user
toggle unlocks and the roster that rides inside the snapshot (`users`, merged
last-writer-wins per `syncId` by `mergeSyncData`) travels with everything
else. What it left out is the household roster file, `glance-users.json`,
which is how two people on two *different* apps or accounts agree on who is in
the household: today it syncs over WebDAV (`syncSharedUsers`) or iCloud Drive
(`syncSharedUsersViaICloud`), and the "Sync household roster" button and the
automatic roster sync in `App.jsx` know only those two. A device whose only
tier is Direct Access unlocks multi-user and then has no roster sync. A shared
Nextcloud, Drive or Syncthing folder is exactly the shared destination iCloud
cannot be (`multiUserICloudOnly`), so this tier has to carry the roster.

- **One file, same wire format, same place.** `glance-users.json` in
  lastGLANCE's wire schema (`id` = sync id), at `usersPath` relative to the
  picked folder, default `GLANCE/users/`, exactly where the WebDAV tier puts
  it relative to its root. A sibling app pointed at the same folder reads the
  same roster with no translation. Plaintext, as on WebDAV and iCloud: names
  and ids only.
- **The transport gains a roster slot, and the renderer never branches on
  platform.** `directAccessTransport` gains `readUsers()` and
  `writeUsers(text)` (and `usersStatus()` for the card and diagnostics), with
  the same read classification as the snapshot. Behind them:
  - *Electron and Android* gain the five path-taking operations the iCloud
    intents transport has (`listFiles`, `readFile`, `writeFile`,
    `deleteFile`, `makeDir`), confined to the picked folder: a path that
    escapes it (`..`, an absolute path) is refused in the bridge, not in the
    renderer. Electron is `path.resolve` plus a prefix check; Android walks
    `DocumentFile` children under the tree. The roster slot is
    `readFile`/`writeFile` at `usersPath + glance-users.json`, with `makeDir`
    on a failed write. The single-file snapshot calls stay as they are.
  - *iOS* has no folder, so the roster is a second bookmarked file. The
    Direct Access card gains "Choose household roster…" and "Create household
    roster…", the same two flows the snapshot uses (`pickFile`/`createFile`
    with a slot argument: `snapshot` or `users`; the open picker refuses a
    file not named `glance-users.json`, the export picker moves a seeded
    `{"version":1,"users":[]}` into the folder the user chooses, which should
    be `GLANCE/users/`). `usersPath` has no meaning on iOS and the setting is
    hidden there.
  - A fake bridge in `src/sync/` exercises both shapes once.
- **`syncSharedUsersViaDirectAccess(localUsers)`** in `src/intents/sharedUsers.js`,
  the iCloud one over the roster slot: read, `mergeUsers`, write. Null when no
  folder is connected, the transport is unreachable, or (iOS) no roster file
  is bookmarked. Unlike the WebDAV and iCloud roster syncs, which rewrite the
  file on every run, it follows the snapshot cycle's two rules, because two
  devices rewriting one file in a syncing folder is a conflict copy per run
  (two Macs, 2026-10-09): it writes only when the roster the file holds would
  change, at once for a change made on this device (a member added, renamed or
  removed in Settings stamps `dayglance-users-local-edit-at`), and for one that
  arrived by another road only once the file has sat unchanged, still lacking
  it, for `RELAY_CONFIRM_MS`.
- **Gates and wiring.** `canSyncUserRoster` and `multiUserUnavailableReason`
  take `directAccessConnected`; the button prefers WebDAV, then Direct Access,
  then iCloud, and the automatic roster sync effect runs the Direct Access one
  whenever a folder is connected, keyed on its last-synced stamp the way the
  WebDAV one is keyed on `cloudSyncLastSynced`.
- **Tests.** `sharedUsers.test.js` over the fake bridge: first writer seeds,
  second merges, a tombstoned user stays gone, an unreachable folder is null
  and writes nothing, an iPhone with no roster bookmark is null; the gate
  tests gain the Direct Access rows; a scenario with two devices on one folder
  converging their rosters; the path confinement mutation-checked on the
  Electron store (the only bridge that runs here) and in
  `DirectAccessReadTest` for Android.
- **Acceptance on devices.** Two Macs on the Nextcloud folder with WebDAV off:
  add a household member on one, press the button on the other, see the
  member. Then the same without the button. Then the iPhone: choose the
  roster file the Macs made, see the member.

### Phase 6: passphrase encryption of the Direct Access file — done

The WebDAV posture, with the same envelope, the same passphrase and the same
session key (`src/utils/crypto.js`), so a folder that mirrors a WebDAV setup
interoperates and a device prompts for one passphrase, not two.

Shipped as designed below, with two refinements found in the build. The key
gate is in two places rather than one: `useCloudSync.js` gates launch on the
switch alone (`directAccessEncryptsWrites()`, read from storage before any
folder is restored), and the cycle itself raises `onKeyNeeded` when it reads
an envelope with no key and no passphrase in memory (`decryptData` throws
`PASSPHRASE_REQUIRED`), or wants to write one. App.jsx answers both with the
existing `SyncPassphraseModal`; a key that is present but wrong (a decrypt
that fails for any other reason) stays the `encrypted-unreadable` error on the
card, since a prompt would not help. Before either prompt, the hook loads the
key this device cached (`initSessionKey`), once per session: the launch gate
restores the file-tier key only for the transports it knows need it, and a
device whose folder holds an envelope another device sealed has the key from
its first unlock and nothing at launch to say so. Three devices were asked
again on every launch until this (2026-10-10). The passphrase is asked for
once per device, and again only if the cached key is gone (a storage purge, a
reset) or the file was sealed with a different passphrase. On Android the
file-tier key and the GLANCEvault root key are different records in the
Keystore, each under its own slot (`NativeBridge.kt` forwards
`getSyncKeyForSlot` / `storeSyncKeyForSlot`); the shell used to forward only
the legacy shared slot, so the Direct Access unlock on the phone wrote the
file key over the vault's root key, which then failed its account check as
"passphrase doesn't match" (2026-10-10). Both readers now also refuse a
record of the other tier's shape, reading it as no key, so an older shell
re-derives instead of failing. And a plaintext file read with the switch
on and no key ready IS applied (there is nothing to protect in what was read);
only the write is held, never written plaintext. The switch is forgotten with
the folder on disconnect, and disabling WebDAV encryption leaves the key in
place while the switch is on. Tests: `snapshotFileSync.test.js` ("Phase 6"),
`useSnapshotFileSync.test.js`, `directAccessTransport.test.js`,
`icloudDiagnostics.test.js`, `DirectAccessSyncCard.test.jsx`.

- **The file decides; the switch decides the first write.** A Direct Access
  file is either a plaintext snapshot or an encrypted envelope, and every
  writer follows what it read: a device that read an envelope writes an
  envelope, whatever its own switch says, because downgrading someone else's
  cloud folder to plaintext is the one thing this tier promised never to do.
  The per-device "Encrypt the Direct Access file" switch governs seeding an
  absent file and upgrading a plaintext one: the first write after the switch
  goes on is an envelope, and from then on the file decides for everyone.
  Turning the switch off changes nothing until the file is replaced (Phase 8
  has the explicit "remove encryption" action).
- **The key gate.** `useCloudSync.js`'s readiness check gains
  `needDirectAccessKey = directAccessConnected && (switch on || the file is an
  envelope)`, and the cycle treats a key that is not ready like the encrypted-
  unreadable case it already has: nothing is applied, nothing is written, the
  card says a passphrase is needed, and the existing prompt collects it. The
  entered passphrase derives the same file-tier key WebDAV uses.
- **The cycle.** `runSnapshotFileCycle` takes `io.encryptData` and
  `transport.encryptsWrites()`, and the outgoing payload is enveloped after
  the health strip (the strip reads plaintext). The seed guard, the content
  gate and the "made here or relayed" rule are unchanged: they look at
  plaintext data, before the envelope.
- **The roster stays plaintext, as on WebDAV**, and the intents transport of
  Phase 7 takes this decision as given: enveloped when the switch is on.
- **Diagnostics.** The Direct Access block reports `encryption: envelope |
  plaintext` for the file and `key: ready | needed` for the device.
- **Tests.** The cycle writes an envelope when the switch is on and a
  plaintext file is read (upgrade); writes an envelope when an envelope is
  read and the switch is off (never downgrade); seeds an envelope when the
  switch is on; holds both apply and write when an envelope is read and the
  key is not ready; the gate rows; a scenario with two fake devices where one
  turns the switch on, the file becomes an envelope, the other prompts, and
  they converge. Each guard mutation-checked.
- **Acceptance on devices.** Two Macs on the folder, encryption on one. The
  file becomes an envelope within a poll, the other Mac prompts for the
  passphrase once, and an edit on each side reaches the other. Turn the
  switch off on the first Mac: the file stays an envelope.

### Phase 7: intents over Direct Access, and the sibling apps — 7a done

7a shipped as designed below, with one structural refinement. The design
said the file cycle would be generalised over `{ merge, apply, slot }` so
`snapshotFileSync.js` grows a parameter rather than a sibling. In the build
the snapshot cycle's guards (the eviction clock, the empty-state guard, the
first-run prompt, the device-local keys, the health strip, the envelope)
turned out to be snapshot-specific all the way down, and a cycle
parameterised over merge and apply would still carry every one of them past
the event set. What the two cycles actually share is the read classification
(`classifySnapshotText`), the write throttle and the relay rule, so the relay
rule became the shared helper `relayDecision` (the snapshot cycle now calls
it, and its relay tests pass unchanged), and `intents/folderIntents.js` holds
`runEventSetCycle` over the same transport slot contract. Everything else is
as written: the union merge, the sender ledger, the cursor, GC as the merge
under the relay rule, the deliverer that reports delivered once the file has
been read back, the opt-in beside the iCloud and GLANCEvault ones, the
iPhone's third bookmarked file (**Choose events file… / Create events
file…**, seeded with an empty set). Encryption: an envelope is sealed with
the WebDAV intents root key when the Direct Access encrypt switch is on, and
held in the outbox (`intents_key_not_ready`) while that key is absent; a
device receiving a sealed envelope without the key logs `no_root_key` and
moves on, as the WebDAV loop does. Tests: `folderIntents.test.js`,
`useDirectAccessIntents.test.js`, `directAccessIntentsConfig.test.js`, the
Direct Access rows in `deliverers.test.js` and `emitTargets.test.js`, the
events slot in `directAccessTransport.test.js` and
`directAccessNativeBridge.test.js`; the receiver-never-seeds, expiry, own-
skip, cursor and raw-own guards mutation-checked.

Intents (`docs/tasker-intents-architecture.md`) are how the GLANCE apps talk
to each other: an envelope per event, an idempotent `event_id` that is also a
sortable timestamp, a cursor so nothing is handled twice, and a retention
window after which events are garbage-collected. There are four transports
today: Android broadcasts, WebDAV, the vault, and iCloud Drive. The two file
transports, WebDAV and iCloud, are built on a **directory**: one file per
event under `GLANCE/events/`, found by listing the directory, read one at a
time, deleted when expired. Direct Access becomes the fifth transport, and
lastGLANCE and lifeGLANCE gain the tier too, because a transport nobody else
can read is pointless.

**The directory model does not reach the iPhone, so this transport does not
use it.** An iPhone on Nextcloud, Drive, Dropbox, Box or OneDrive holds
bookmarks to files it was handed and cannot list a directory or create a file
by name (see "Parity"). iCloud can do intents on iOS only because the iCloud
container is a real directory the app owns. So the Direct Access transport is
built on the one primitive every platform has, **a single file**, and it is
the same on desktop, Android and iPhone: one implementation, one format, full
parity. Nothing about the directory transports changes.

**The event set.** `GLANCE/events/glance-events.json` is a JSON document
`{ version: 1, events: [envelope, …] }` holding every live envelope, plaintext
or encrypted exactly as the WebDAV transport builds them. An encrypted
envelope keeps `event_id`, `emitted_at` and `emitted_by` in its plaintext
header (`@glance-apps/intents`), which is all the set logic reads. The file is
a set keyed by `event_id`:

- **Merge is a union** that drops envelopes past retention, order-independent
  and idempotent, so any two copies of the file converge whichever order they
  are merged in. The syncing tool's last-writer-wins on a collision loses an
  append, and a conflicted copy is inert; both are repaired by the next merge.
- **A sender writes its own events, and keeps them until they stick.** The
  outbox holds an intent until the device's own cycle has read the file back
  with the event in it (the same confirmation the snapshot cycle gives its own
  writes), and a device keeps a ledger of the events it emitted within
  retention so a copy that lost them re-adds them. Nobody re-adds another
  device's events: the sender is the one responsible for them.
- **A receiver reads, never writes for what it read.** The receive loop reads
  the file, handles the envelopes with `event_id` above its cursor that it did
  not emit, and advances the cursor, exactly as the directory loops do over a
  listing. The cursor key is per transport.
- **Garbage collection is the merge.** Expired envelopes fall out of the union;
  the device that drops them writes the file only under the relay rule
  (RELAY_CONFIRM_MS), the way the snapshot cycle treats a change it did not
  make, so an idle fleet does not take turns rewriting the file. A sender's
  own write carries any pending drops with it.
- **One cycle shape.** Read, merge, apply (handle received events), write when
  the merged set differs from the file and the write is this device's to make.
  This is `runSnapshotFileCycle` with a different merge, a different apply and
  no seed prompt, so the file cycle is generalised over `{ merge, apply, slot }`
  rather than copied, and `snapshotFileSync.js` grows one parameter instead of
  a sibling module.

**How each platform reaches the file.** Desktop and Android: by path through
the Phase 5 operations. iPhone: a third bookmarked file, picked or created the
way the snapshot and the roster are (**Choose events file… / Create events
file…**, seeded with an empty set). The transport exposes an `events` slot
beside `users` with the same read and write contract, so nothing above the
transport knows which.

**Encryption** follows Phase 6: enveloped when the Direct Access switch is on,
with the WebDAV intents key, held in the outbox while the key is not ready.

**What this costs.** The file grows with the fleet's events over the retention
window and is rewritten whole on every change; at a few hundred events of a
kilobyte each that is a snapshot-sized write, which the fleet already makes
every edit. A collision between two senders costs one extra cycle. On an
iPhone intents arrive when the app is in the foreground, as iCloud intents do.

**7a. dayGLANCE.**

- `src/intents/folderIntents.js`: the event-set merge, the sender ledger, the
  receive loop over a set, and the deliverer, all over the transport's `events`
  slot. The iCloud directory code stays as it is.
- The generalised file cycle: `runSnapshotFileCycle` takes the merge and the
  apply as parameters with the snapshot's as defaults; the Direct Access
  intents cycle runs on the same poll and mutex as the snapshot cycle.
- **A fifth outbox target.** `emitTargets` adds `directAccess` when a folder
  is connected and the new "Direct Access intents" switch is on; the outbox
  deliverer map gains the deliverer, which appends to the device's ledger and
  reports delivered once the event has been read back. The switch sits beside
  "iCloud intents" and "GLANCEvault intents" in Settings, independent of the
  sync switch, and saving reloads the app so the poller restarts, as the vault
  one does.
- **Tests.** `folderIntents.test.js` runs emit → ledger → write → read → handle
  → cursor → expiry over a fake transport; the union merge is checked for
  order-independence and idempotence and for repairing a lost append; the
  deliverer tests gain the Direct Access rows (transient when the folder is
  unreachable, held when encryption is on and the key is not ready); a
  scenario with two fake devices on one file where an intent emitted on one is
  handled once on the other, survives a conflicted copy, and falls out after
  retention; and the cycle generalisation is mutation-checked against the
  existing snapshot tests.
- **Acceptance.** A `create` intent from a Mac reaches dayGLANCE on Android
  through the Nextcloud folder and FolderSync, and on the iPhone through the
  events file it picked, and the envelope is gone from the file after
  retention.

**7b. lastGLANCE, then 7c. lifeGLANCE.** Each needs the tier before the
transport, in this order:

1. **The folder bridge.** The five operations plus `pickFolder`, `status`,
   `disconnect`, with the same read classification (`absent` only when the
   folder is there and the file is not; a zero-length file is a placeholder,
   never absent; a vanished folder or revoked grant is an error). lastGLANCE
   is Capacitor, so this is a small custom plugin wrapping the same Kotlin
   (SAF tree, `SafeReplace`) and Swift (security-scoped bookmark, coordinated
   I/O) that dayGLANCE's shells carry; the porting notes in the Tasker doc's
   section 8 apply unchanged. Electron is `electron/directAccessStore.ts` as
   is.
2. **Snapshot sync through the folder**, using `snapshotFileSync.js` and the
   transport pattern, so the sibling's own data syncs there too and the
   first-run and seed guards come with it. The cycle is pure and has no
   dayGLANCE in it; it belongs in `@glance-apps/sync` beside the merge the
   siblings already share, and this is the point to move it.
3. **The roster** (Phase 5's file, same path) and **the intents transport**
   (7a's event set, same slot contract: by path on desktop and Android, a
   bookmarked file on iOS). Both are app-independent by construction; a
   sibling adds its own switch, its own cursor key and its own sender ledger.

**Acceptance for the phase:** three apps on one folder. A task created in
dayGLANCE on Android appears as an intent in lastGLANCE on a Mac, the
household roster edited in lifeGLANCE shows in both others, and an idle hour
leaves every file's modified time where it was.

### Phase 8 (optional, any order)

- **Done:** an explicit "remove encryption from the Direct Access file"
  action, the only sanctioned downgrade (`sync/directAccessEncryption.js`,
  "Remove encryption from the file…" under the card's encryption switch, on a
  device that holds the key, behind a confirmation). It reads the envelope,
  opens it, writes the SAME payload back as plaintext once (same stamp, so no
  device sees a new version to merge) and turns this device's switch off;
  from then on the file decides again, in plaintext. The confirmation says
  to turn the switch off on the other devices first: one whose switch is
  still on seals the file again on its next write, since a plaintext file
  with the switch on is exactly the upgrade case. A plaintext file is left as
  it is; without the key, or on a failed write, nothing changes.
- Merge sibling "conflicted copy" files that Dropbox or Drive leave beside the
  snapshot, then delete them.
- A web/PWA transport via the File System Access API that `folderBackup.js`
  already demonstrates. (The diagnostics card exists since Phase 3 and runs on
  every platform since #1998.)

## Using it (desktop, Android, iPhone and iPad)

Settings → Cloud Sync → **Direct Access** → *Choose folder…* on each machine,
picking the same folder inside whatever the syncing tool mirrors (for example
`Google Drive/GLANCE`). The card shows the folder name, the last time a snapshot
was read, and a switch that pauses syncing on that device without touching the
folder copy. *Change folder* re-picks; *Disconnect* forgets the folder on that
device and leaves the file where it is. Reset App Data → *This device and the
Direct Access folder* deletes the file too.

On Android the card is the same, under Settings → Cloud Sync. Pick a folder
that an app mirrors to the phone's storage (Syncthing, FolderSync, Autosync);
the Google Drive and Dropbox apps do not offer their folders to Android's
folder picker. Remote changes land on the 15 second poll or when the app comes
to the foreground.

On iPhone and iPad the bookmark is of the sync FILE, not of its folder.
Nextcloud, Google Drive, Dropbox, Box and OneDrive ship Apple's older
non-replicated File Provider extension, which keeps every item in its own
directory keyed by the item's id: a picked folder has no real directory on disk
and never will, so a bookmark of it fails ("The file couldn't be opened because
it doesn't exist", iPhone, 2026-10-08) and a path built by appending a file name
to it points nowhere. Folder selection from those providers is a known-open
Apple bug (FB9703910). A picked file works with all of them: the system calls
the provider's `startProvidingItem` on a coordinated read and `itemChanged`
after a coordinated `.forReplacing` write, which is how any app edits a
provider's document in place. So the card offers **Choose sync file…** (the
`dayglance-sync.json` another device already seeded) and **Create sync file…**
(the export picker moves a file holding `null` into a folder of the user's
choice; `null` classifies as absent, so the first cycle seeds it from this
device exactly as it seeds an empty folder). A wrong file name is refused, and
a create that the picker renamed on a clash (`dayglance-sync 2.json`) is
removed with a message to choose the existing file. A bookmarked file that is
gone reads as `error`, never `absent`: there is no folder to seed into, and
the user re-picks or re-creates. `deleteSnapshot` forgets the bookmark with
the file. With multi-user on, the card offers the household roster the same
way (Phase 5): **Choose roster…** for the `glance-users.json` the other devices
keep in the folder's `GLANCE/users`, or **Create roster…** there; the bridge
holds it as a second bookmark and the roster slot reads and writes it without
a path. iCloud sync keeps running alongside; the two share one mutex and
never merge into state at once.

**Direct Access intents** (Phase 7) is the opt-in under Settings → Intents,
beside the iCloud and GLANCEvault ones, and needs a connected folder. On, the
other GLANCE apps on the folder exchange intents through one file,
`GLANCE/events/glance-events.json`: this device writes its own events into it
at once and keeps them in a ledger until retention, so a copy of the file that
a syncing tool's conflict stripped them from gets them back; it handles the
events others wrote once each, above its cursor; expired events fall out of
the file under the relay rule. On an iPhone the file is a third bookmarked
file, **Choose events file…** or **Create events file…** on the card, like
the roster. Envelopes are sealed when the Direct Access file is encrypted.

**Encrypt the file in the folder** (Phase 6) is a checkbox under the connected
card. A device that already holds the file-tier key (WebDAV encryption, or
the passphrase entered this session) just flips it; one without is asked to
choose the sync passphrase, which every device opening the folder then asks
for once. The next write seals the file in the same envelope WebDAV uses, and
from then on the file decides: every device writes an envelope whatever its
own switch says, and turning the switch off never makes the file plaintext
again. A device that opens an encrypted file without the key is prompted for
the passphrase before anything is applied or written.

Settings → Cloud Sync → Sync diagnostics → *Run check* reads the Direct
Access file too, on any platform with the bridge: folder status, the file's
size, modified time and counts, and the dry run of this device's merge against
it (*would write*, *would apply*, and the slices that differ). That is the tool
for "why does the file keep changing": the slice it names is the one two
devices disagree on. Three more rows say whether the file is an *envelope* or
*plaintext*, whether this device's encrypt switch is on, and whether its key
is *ready* or *needed* (an envelope is decrypted for the dry run when it is).

The file is plain JSON, the same `dayglance-sync.json` the WebDAV tier writes.
If the folder already holds an encrypted copy from a WebDAV setup, Direct
Access reports it and writes nothing until the file is replaced or decrypted;
it never downgrades an encrypted file to plaintext.

## Risks

- The daemon can write while we read. Parse-fail-and-skip covers this; the stat
  check makes it rarer.
- Two devices editing inside the daemon's propagation window produce conflict
  copies rather than a 412. The union merge means churn, not loss; the throttle
  keeps it rare.
- Phase 1 touches the iCloud path that has had several field incidents. The
  scenario test lands with it, before any Direct Access code is built on top.
