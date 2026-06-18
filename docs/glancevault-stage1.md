# dayGLANCE → GLANCEvault DB-tier cutover — STAGE 1 of 2

**Scope:** build the entity-to-row adapter and prove losslessness.
**Non-destructive:** no live transport switch, no file-tier changes, no writes to a
real server, no App.jsx wiring. Stage 2 will add transport selection,
push-on-write, the deferred buffer, and the live cutover.

Artifacts added this stage:

| File | Role |
|---|---|
| `src/sync/dbAdapter.js` | Entity↔row shred/reassemble, `_kind` discriminator, `isInsertOnly`, `getEntityLastModified` |
| `src/sync/dbAdapter.losslessness.test.js` | Roundtrip gate + discrimination proof (9 tests) |
| `package.json` / `package-lock.json` | Pin `@glance-apps/sync@1.3.2` exact |

The mapping is read directly from the canonical merge in
`node_modules/@glance-apps/sync/src/merge.js` (`mergeSyncData`, the authoritative
list of every synced field and its grain) and the payload builder
`buildSyncPayload` (`src/App.jsx:5379-5439`).

---

## 1. Dependency-version report

- **dayGLANCE before:** `@glance-apps/sync": "^1.3.2"` (caret) — `package.json:21`.
- **Installed / locked:** `1.3.2` — `package-lock.json:2270-2271`
  (`node_modules/@glance-apps/sync/package.json` version `1.3.2`).
- **Action:** pinned to **`1.3.2` exact** (no caret) in `package.json:21` and the
  lockfile root spec mirror `package-lock.json:12`. Matches lastGLANCE's pin.
- No other version change was made. dayGLANCE already ships the same
  `createDbSyncEngine` / `dbCrypto` / `vaultClient` modules the reference uses;
  nothing in `@glance-apps/sync` was modified.

> The DB engine surface dayGLANCE will consume in stage 2 is identical to the
> reference: `createDbSyncEngine({ getLocalEntity, applyRemoteEntity,
> applyRemoteDelete, isInsertOnly, getEntityLastModified, … })` with a single
> combined `dbSyncCycle()` (`dbEngine.js:63,311`), an engine-owned high-water mark
> (`getHighWaterMark`, `dbEngine.js:126`), and per-entity AES-GCM where the entity
> is `JSON.stringify`-ed before encryption (`dbCrypto.js:274`) — so an in-envelope
> `_kind` stays sealed in the ciphertext.

---

## 2. Entity-to-row mapping table

Two row classes:

- **Collection** — each array element (or date-map entry) is one row, keyed by a
  stable id, entity-grain last-writer-wins. These are the entities the file-tier
  merge already resolves per-item.
- **Singleton / bundle** — one row carrying a whole structure in its current
  shape. These are the bundles and scalar/config values that have no per-item id;
  splitting them into finer rows is explicitly out of scope (rule 4).

### 2a. Collections (per-item rows)

| Entity | `entityId` source | LWW tiebreaker | Mutability | id evidence | timestamp evidence |
|---|---|---|---|---|---|
| `tasks` | `id` | `lastModified` | mutable-upsert | `merge.js:449-450` (`idField:'id'`) | `merge.js:449` (`timestampField:'lastModified'`); stamped `useDataPersistence.js:44` |
| `unscheduledTasks` | `id` | `lastModified` | mutable-upsert | `merge.js:451` | `merge.js:449`; `useDataPersistence.js:178` |
| `recurringTasks` | `id` | `lastModified` | mutable-upsert | `merge.js:453` | `merge.js:449`; `useDataPersistence.js:180` |
| `recycleBin` | `id` | `lastModified` | mutable-upsert | `merge.js:452` | `merge.js:449`; `useDataPersistence.js:179` |
| `todayRoutines` | `id` | `lastModified` | mutable-upsert | `merge.js:493` | `useDataPersistence.js:181` |
| `habits` | `id` | `lastModified` → `createdAt` | mutable-upsert | `merge.js:282` (`h.id`) | `merge.js:299` (`lastModified \|\| createdAt`) |
| `goals` | `id` | `updatedAt` | mutable-upsert | `merge.js:722` (`g.id`) | `merge.js:733` (`updatedAt`) |
| `projects` | `id` | `updatedAt` | mutable-upsert | `merge.js:760` (`p.id`) | `merge.js:771` (`updatedAt`) |
| `gtdFrames` | `id` | `lastModified` | mutable-upsert | `merge.js:641` (`f.id`) | `merge.js:657` (`lastModified`) |
| `users` | `syncId` → `id` | `updatedAt` | mutable-upsert | `merge.js:843` (`u.syncId ?? u.id`) | `merge.js:847` (`updatedAt`) |
| `dailyNotes` (per date key) | date string `YYYY-MM-DD` | `lastModified` | mutable-upsert | `merge.js:218` (date key) | `merge.js:237` (`lastModified`); tombstone via `{deleted:true}` `merge.js:209-211` |

`dailyNotes` is map-shaped, not an array, but is a collection: the merge resolves
it per date, so each date is its own row (`entityId = dailyNotes:<date>`).

### 2b. Singletons / bundles (one row each, current shape preserved)

Carried whole, keyed `singleton:<key>`. Routed back on reassemble by `_key`.

| Bundle / scalar | Shape | Merge grain (kept as-is) | Evidence |
|---|---|---|---|
| `routineDefinitions` | bucket → chip[] | per-chip by `id`, claim-aware | `merge.js:132,466` |
| `habitLogs` | `{date: {habitId: count}}` | per-(date,habitId) | `merge.js:351,522` |
| `habitLogTimestamps` | `{date:habitId → ISO}` | per-key newer-wins | `merge.js:354-363` |
| `routineCompletions` | `{routineId → date}` | date-gated union | `merge.js:505-513` |
| `completedTaskUids` | `string[]` | union, retention-pruned | `merge.js:607-614` |
| `deletedTaskIds` | `{id → ISO}` | tombstone union | `merge.js:432-439` |
| `deletedRoutineChipIds` | `{id → ISO}` | tombstone union | `merge.js:456-463` |
| `deletedFrameIds` | `{id → ISO}` | tombstone union | `merge.js:619-626` |
| `removedTodayRoutineIds` | `{id → ISO}` | tombstone union | `merge.js:472-479` |
| `deletedHabitIds` | `{id → ISO}` | tombstone union | `merge.js:519,835` |
| `deletedGoalIds` | `{id → ISO}` | tombstone union | `merge.js:702-709` |
| `deletedProjectIds` | `{id → ISO}` | tombstone union | `merge.js:710-717` |
| `obsidianConfig` (+`…UpdatedAt`) | object | per-field-ts LWW | `merge.js:804,898` |
| `habitsEnabled` (+`…UpdatedAt`) | bool | per-field-ts LWW | `merge.js:684-688` |
| `routinesEnabled` (+`…UpdatedAt`) | bool | per-field-ts LWW | `merge.js:694-699` |
| `goalsProjectsEnabled` (+`…UpdatedAt`) | bool | per-field-ts LWW | `merge.js:796-801` |
| `multiUserEnabled` (+`…UpdatedAt`) | bool | per-device, not merged | `merge.js:840` (kept local); emitted `App.jsx:5431-5432` |
| `unscheduledOrderTimestamp` | ISO | newer-wins | `merge.js:569-571` |
| `syncUrl`, `taskCalendarUrl` | string | prefer-non-empty | `merge.js:810-815` |
| `routinesDate` | `YYYY-MM-DD` | date compare | `merge.js:488-501` |
| `minimizedSections` | object | kept local (device pref) | `merge.js:900` |
| `use24HourClock` | bool | kept local (device pref) | `merge.js:901` |
| `weatherZip`, `weatherTempUnit` | string | not merged; emitted in payload | `App.jsx:5405-5406` |
| `tombstonePrunedBefore` | ISO | max of both fences | `merge.js:824-829` |

### 2c. Entities I added beyond the brief's list

The brief named: tasks, unscheduledTasks, recurringTasks, recycleBin,
todayRoutines, routineDefinitions, habits, habitLogs, goals, projects, gtdFrames,
dailyNotes, users, scalar/config. Sweeping `buildSyncPayload` and `mergeSyncData`
surfaced these **additional** synced members that must also round-trip and are
covered above:

- `habitLogTimestamps`, `routineCompletions`, `completedTaskUids`
- `routinesDate`, `unscheduledOrderTimestamp`
- Seven tombstone maps: `deletedTaskIds`, `deletedRoutineChipIds`,
  `deletedFrameIds`, `removedTodayRoutineIds`, `deletedHabitIds`,
  `deletedGoalIds`, `deletedProjectIds`
- The four `*Enabled` flags + their `*UpdatedAt` siblings; `obsidianConfig` +
  `obsidianConfigUpdatedAt`; `multiUserEnabled` + `multiUserEnabledUpdatedAt`
- Device prefs `minimizedSections`, `use24HourClock`, `weatherZip`,
  `weatherTempUnit`; `syncUrl`, `taskCalendarUrl`; `tombstonePrunedBefore`

The shred iterates **every** remaining `.data` key as a singleton, so any key
added later is carried automatically rather than silently dropped.

> Not synced (correctly excluded from rows): `taskCalendarAuth` (credentials,
> `App.jsx:5395`), `_native` / CalDAV-imported tasks (ephemeral, filtered at
> `App.jsx:5377-5378`), and device-only `darkMode`/`reminderSettings`/`soundEnabled`
> (`App.jsx:5608`).

---

## 3. Entity discrimination decision — **explicit in-envelope `_kind`**

**Chosen approach: explicit `_kind`, not structural sniffing.**

The reference derives kind by structural field-name sniffing (`entityKind`,
`dbEngine.ts:29-56`) because lastGLANCE had four well-separated types. That does
**not** survive in dayGLANCE:

- `tasks`, `unscheduledTasks`, `recurringTasks`, `recycleBin`, and `todayRoutines`
  are the **same task shape**. App.jsx stamps all five through the *one*
  `stampTaskTimestamps` function (`useDataPersistence.js:177-181`); they share
  `{ id, title, duration, color, completed, lastModified, notes, subtasks }`.
- `recurringTasks` (carries `completedDates`) and `recycleBin` (carries
  `deletedAt`) are *sometimes* separable by a marker field, but **scheduled
  `tasks` vs inbox `unscheduledTasks` vs `todayRoutines` have no distinguishing
  field at all.** A `date`/`startTime` presence test is exactly the fragile sniff
  the brief warns against (an inbox task can be promoted, a routine can carry a
  time).

A structural sniff would therefore misroute on apply. The test
`structural sniff CANNOT separate tasks / unscheduledTasks / todayRoutines`
proves all three collapse to one ambiguous bucket.

**Decision:** carry a `_kind` field inside the entity object. Because
`encryptEntity` does `JSON.stringify(entity)` before AES-GCM
(`dbCrypto.js:274`), `_kind` is sealed in the per-entity ciphertext — the vault
row is still `{ entityId, seq, ciphertext, deleted? }` and the server sees only
opaque bytes. **Zero-knowledge is preserved.**

The wire entity also **wraps** the original under `value` (`{ _kind, _key?, value
}`) so the user payload is never polluted and round-trips byte-for-byte. The
`entityId` is composite `${kind}:${id}`, so two different kinds sharing a numeric
id never collide on one row.

**Proof of zero collisions (all types):** the gate shreds a full payload with
every type present and asserts `new Set(entityIds).size === entityIds.length`,
that `reassembleState` routes 100% of rows (it throws on any unroutable `_kind`),
and that the five task-shaped kinds are each distinctly represented. All pass.

---

## 4. FK / out-of-order delivery — **no deferred buffer needed**

The reference parks FK-dependent rows (`deferredChores`) because lastGLANCE's
Dexie tier is **relational**: a chore needs a resolved numeric `category_id` to
*insert*, so a chore arriving before its category cannot be stored and must be
parked (`dbEngine.ts:164-214`).

dayGLANCE has **no hard local FK dependency**, because its data model is a flat
document, not a normalized relational DB. Every synced structure is a plain
array/map in localStorage / React state. Cross-entity references are
**denormalized opaque id fields carried on the same object**:

- `task.projectId → project.id` (`App.jsx:3263,3899`)
- `project.goalId → goal.id` (`App.jsx:3902`)
- `goal.frameId → gtdFrame.id`

A task whose `projectId` points at a not-yet-arrived project still inserts fine —
it sits in the `tasks` array and simply renders ungrouped until the project lands,
**exactly the transient state the app already tolerates mid-sync today**. There is
no insert-time resolution step that could drop the row, so nothing needs parking.

**FK-dependent entities requiring a deferred buffer in stage 2: NONE.**

The losslessness gate does not mask this: there is no FK-resolution path in shred
or reassemble that could silently drop a child, and the same-id cross-list case
(the one place row identity is subtle) is explicitly tested and preserved.

> Stage-2 note (not an FK buffer): the file-tier merge reconciles a task that
> exists in both `tasks` and `unscheduledTasks` by `lastModified`
> (`merge.js:556-601`). Row-grain keeps both copies as distinct rows; stage 2's
> pull path must re-apply that cross-list reconciliation. Flagged here so it is
> not forgotten — it is a merge-semantics concern, not a foreign-key one.

---

## 5. stampTaskTimestamps / dirtiness

`stampTaskTimestamps` (`useDataPersistence.js:22-46`) stamps `lastModified` on
**task-shaped collections only** — `tasks`, `unscheduledTasks`, `recycleBin`,
`recurringTasks`, `todayRoutines` (`useDataPersistence.js:177-181`,
`App.jsx:5383-5400`). It diffs each item against its localStorage copy (ignoring
`lastModified`) and re-stamps `now` only when the rest changed; it is a no-op when
`suppressTimestampRef` is set (during remote apply).

**The adapter does not read or alter `stampTaskTimestamps`.** It reads each
entity's **own** timestamp via `getEntityLastModified`, using the per-kind
`tsField` from the mapping table (`lastModified` for task-shaped + habits +
frames, `updatedAt` for goals/projects/users, `createdAt` fallback for habits).
For those five task-shaped kinds, `stampTaskTimestamps` is precisely what *sets*
the `lastModified` the adapter then reads — so the dirtiness signal is consistent
with today's behavior, unchanged.

**Entities with a clear dirtiness signal (own timestamp):** all collections in
§2a.

**Entities whose dirtiness signal is unclear (flagged):** several bundles have
**no intrinsic timestamp**, so at the singleton-row grain there is no per-entity
`lastModified` for the engine's LWW:

- `habitLogs`, `habitLogTimestamps`, `routineCompletions`, `completedTaskUids`,
  and all seven tombstone maps — no top-level timestamp.
- The `*Enabled` flags and `obsidianConfig` *do* travel with a sibling
  `*UpdatedAt` singleton, but as **separate rows** the engine cannot pair them for
  LWW without help.

This is a **known stage-2 concern, not a losslessness blocker** (losslessness
needs no timestamp — only faithful shred/reassemble, which passes). Stage 2 must
decide how these bundles signal dirtiness and resolve LWW — e.g. fold each
`*Enabled`+`*UpdatedAt` into one row, and stamp bundle rows on write. The brief's
own rule 4 keeps the finer remodel that would give completions real per-item
timestamps out of scope here. `getEntityLastModified` currently returns the
bundle's value when it is itself an ISO string (e.g. `tombstonePrunedBefore`) and
`undefined` otherwise; `dbAdapter.js` documents this inline.

---

## 6. Losslessness roundtrip — **PASS**

`src/sync/dbAdapter.losslessness.test.js` builds a representative full `.data`
payload covering **every** entity type and edge case (nested subtasks, a
`recurringTasks.completedDates` array, a deleted `dailyNotes` tombstone entry, a
same-id task in both `tasks` and `unscheduledTasks`, claimed routine chips, keyed
`habitLogs`/`habitLogTimestamps` maps, a habit with no `lastModified`, all
tombstone maps, all scalar config), then:

1. `shredState(data)` → rows
2. runs each row's entity through `JSON.parse(JSON.stringify(...))` — the exact
   serialization `encryptEntity`/`decryptEntity` perform on the wire
3. `reassembleState(rows)` → rebuilt `.data`
4. deep-diffs original vs rebuilt, key-order independent, treating
   `undefined ≡ absent`

**Result: PASS — 9/9 tests, full suite 275/275.**

```
✓ round-trips a full payload value-identically (modulo key order)
✓ produces a unique entityId for every row (zero collisions)
✓ keeps a cross-list same-id task as two distinct rows
✓ keeps recurringTasks.completedDates as an array inside the row (rule 4)
✓ keeps habitLogs as a single keyed-map row (rule 4)
✓ routes every row by explicit _kind, and marks no kind insert-only in stage 1
✓ surfaces the per-kind LWW tiebreaker for collection rows
✓ structural sniff CANNOT separate tasks / unscheduledTasks / todayRoutines
✓ explicit _kind resolves ALL kinds with zero collisions
```

No field, entity, or nested structure failed to round-trip.

> The fixture is a faithful, hand-built representative derived from the real
> shapes in `mergeSync.test.js` and `buildSyncPayload`. If you want the gate run
> against a **real exported dev-state payload**, drop its `.data` into the test in
> place of `buildFixture()` and re-run `npx vitest run
> src/sync/dbAdapter.losslessness.test.js` — the adapter is payload-shape-driven,
> so no code change is needed.

---

## 7. Verdict

**Is dayGLANCE's data model losslessly representable as rows under current
semantics? — YES.**
