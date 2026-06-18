# dayGLANCE → GLANCEvault DB-tier cutover — STAGE 2 of 2

Stage 1 proved **representability** (shred/reassemble is lossless on one device).
Stage 2 proves **merge correctness** across two devices, then wires the live
transport. Part A is the gate; Part B is the wiring.

Artifacts:

| File | Role |
|---|---|
| `src/sync/dbAdapter.js` | Per-row apply/merge added on top of stage-1 shred/reassemble |
| `src/sync/dbVaultSim.js` | In-memory two-device GLANCEvault simulator (test support) |
| `src/sync/dbMerge.test.js` | A1 bundle-merge + A2 cross-list tests |

---

## Part A — multi-device merge correctness (the gate)

### The harness

`dbVaultSim.js` runs two devices against one in-memory vault. It faithfully
mirrors `createDbSyncEngine`'s push/pull contract (`dbEngine.js`): push encrypts
each dirty entity (here: JSON clone) and upserts by `entityId`; pull lists rows
since the cursor and applies each with entity-grain LWW, insert-only
always-apply, and delete-by-absence — driving the **same** adapter callbacks the
real engine calls (`getLocalEntity` / `applyRemoteEntity` / `applyRemoteDelete` /
`isInsertOnly` / `getEntityLastModified`). Two documented, behavior-preserving
divergences: the pull cursor advances only on pull (a strictly more conservative
cursor — re-applying a seen row is idempotent), and `reconcileCrossList` runs at
end-of-pull (the live engine hooks this to the apply-notify).

### The core hazard Part A exists to surface

GLANCEvault stores **one row per `entityId`**, upserted last-write-wins, and the
engine **pushes before it pulls**. So when two devices edit the *same bundle row*
between syncs, the second push **clobbers** the first at the vault before the
first device's value is ever read. A merge in the apply step alone cannot recover
it — the value is already gone from the vault.

**Fix (the enabling mechanism):** when a bundle's per-key/union merge leaves a
device's local copy *richer* than the row it just pulled, the device **re-pushes
the merged superset** (`applyRemoteEntity` returns the entityIds to re-dirty).
Because the originating device never *reduces* its local bundle (union grows;
recency keeps newest), the unique contribution is never lost locally and gets
re-published on the next push. This mirrors the file-tier's `remoteChanged →
"remote needs this"` flag and **terminates**: once the vault holds the full
superset, the merge changes nothing and no re-push is emitted. Convergence
requires the originating device to complete one more sync after a concurrent
clobber — the same liveness property the file tier already has.

A1 includes an explicit demonstration that a **naive whole-bundle LWW loses an
edit**, to prove the per-bundle merge + re-push is necessary, not decorative.

### Bundle-merge strategy table

| Bundle | Shape | Strategy | Concurrent **different-entry** edits safe? |
|---|---|---|---|
| `habitLogs` (+`habitLogTimestamps`) | `{date:{habitId:count}}` | per-(date,habitId) recency via paired timestamps (`mergeHabitLogs`) | ✅ yes |
| `routineDefinitions` | `{bucket:[chip]}` | per-chip, claim-aware (`mergeRoutineDefinitions`); chip tombstones converge separately | ✅ yes |
| `routineCompletions` | `{routineId:date}` | union, keep later date per key | ✅ yes |
| `completedTaskUids` | `string[]` | set-union | ✅ yes |
| `deletedTaskIds` | `{id:ISO}` | set-union, keep newer ISO | ✅ yes |
| `deletedRoutineChipIds` | `{id:ISO}` | set-union, keep newer ISO | ✅ yes |
| `deletedFrameIds` | `{id:ISO}` | set-union, keep newer ISO | ✅ yes |
| `removedTodayRoutineIds` | `{id:ISO}` | set-union, keep newer ISO | ✅ yes |
| `deletedHabitIds` | `{id:ISO}` | set-union, keep newer ISO | ✅ yes |
| `deletedGoalIds` | `{id:ISO}` | set-union, keep newer ISO | ✅ yes |
| `deletedProjectIds` | `{id:ISO}` | set-union, keep newer ISO | ✅ yes |
| `habitsEnabled` (+`…UpdatedAt`) | bool+ISO | paired LWW by `UpdatedAt` | n/a — single value (intended LWW) |
| `routinesEnabled` (+`…UpdatedAt`) | bool+ISO | paired LWW by `UpdatedAt` | n/a — single value |
| `goalsProjectsEnabled` (+`…UpdatedAt`) | bool+ISO | paired LWW by `UpdatedAt` | n/a — single value |
| `obsidianConfig` (+`…UpdatedAt`) | obj+ISO | paired LWW by `UpdatedAt` | n/a — single value |
| `unscheduledOrderTimestamp` | ISO | newer-wins | n/a — single value |
| `tombstonePrunedBefore` | ISO | max (newer-wins) | n/a — single value |
| `routinesDate` | date | later-date-wins | n/a — single value |
| `syncUrl`, `taskCalendarUrl` | string | prefer non-empty (don't let an unconfigured device clear a URL) | n/a — single value |
| `minimizedSections`, `use24HourClock`, `weatherZip`, `weatherTempUnit`, `multiUserEnabled` | scalar | **device-local** — kept local, never overwritten or re-pushed (matches `merge.js:900-901`) | n/a — by design |

The "n/a" rows are single-valued settings: there are no independent entries to
lose, so newest-writer-wins is the intended and correct behavior, not a
multi-entry loss window. The device-local prefs are deliberately not converged,
exactly as the file-tier merge keeps them local today.

### Cross-list move (A2)

A task keeps its `id` while moving between the five task kinds, so it maps to a
different `${kind}:${id}` over its life. Moves are **tombstone-on-old +
insert-on-new** (the move marks both entityIds dirty; `getLocalEntity` returns
null for the vacated one → soft-delete; the new one upserts). The delete
suppresses the stale copy on the other device.

For the nasty interleaving — both devices move the same task to **different**
kinds concurrently — `reconcileCrossList` keeps exactly one copy with a
**deterministic** rule, so every device agrees:

> **Winner = newest `lastModified`. Tie → `CROSS_LIST_PRIORITY`
> (`recycleBin` > `recurringTasks` > `tasks` > `unscheduledTasks` >
> `todayRoutines`).**

recycleBin sorts first so an explicit delete wins a same-instant tie (mirrors
`merge.js:540-543`, where a recycle entry wins on a non-older timestamp). Each
removed copy is soft-deleted on the next push, so the **vault** converges too,
not just local state. Tests cover the simple move, the concurrent
different-kind move (newest wins), and the priority tie-break.

### Gate result

- **A1 (bundle merge): PASS** — concurrent different-entry edits to every bundle
  are preserved; naive-LWW loss demonstrated and avoided.
- **A2 (cross-list move): PASS** — moved tasks end under exactly one kind;
  concurrent different-kind moves resolve to a deterministic winner.
- **A3 (regression): PASS** — full suite **286/286** (275 existing + stage-1
  losslessness 9 + 11 new).
- **Unavoidable loss windows: NONE.** With the re-push mechanism, every
  multi-entry bundle converges; the only LWW is single-valued settings, which is
  intended. **Gate is GREEN — proceed to Part B.**

---

## Part B — live wiring

Mirrors the lastGLANCE reference. Additive and reversible: the DB engine runs
**alongside** the file-tier WebDAV engine, sharing only the local data and sync
passphrase, and is **fully inert when the vault is disabled** (`createDbEngine`
returns null, the cadence effect early-returns, `schedulePush` is a no-op). The
file-tier payload is retained untouched — nothing is deleted, and the default
transport is unchanged.

| Piece | File | One-line summary |
|---|---|---|
| **B1** vault config + gate | `vaultConfig.js`, `deviceId.js`, `dbEngine.js` | `dayglance-vault-config` key + `isVaultEnabled`; stable `dayglance-device-id`; `createDbEngine` constructs the real `createDbSyncEngine` alongside WebDAV, returns null when off, HWM-0 seeds the full snapshot. |
| **B2** dirty tracking + safe apply | `dbEngine.js` | Dirty set computed by diffing the current shred against a persisted snapshot (dayGLANCE's equivalent of per-write `markDirty`, since it has no data-layer); remote applies mutate a per-cycle mirror committed once via `applyPayload`, which sets the suppress flags so a pulled row never bounces back as a WebDAV upload or a re-push. |
| **B3** push-on-write | `dirtyTracker.js`, `useSaveOnChange.js` | Debounced **3 s, vault-only** push after each local write; never fans out to WebDAV (the file tier keeps its cadence model, spec 6.5); off-safe. |
| **B4** transport UI | `CloudSyncSettingsForm.jsx` | Independent GLANCEvault toggle (URL/token/account), saved to its own key, **reload on change**; orthogonal to the WebDAV provider. |
| **B5** WebDAV retained | — | File-tier engine, payload, and merge are completely unchanged; the DB engine never touches the WebDAV file. |

### Cycle ordering note (updated for @glance-apps/sync 1.4.0)

dayGLANCE composes its cycle from the engine's exposed `pullRemoteChanges` /
`pushDirtyRows` / `updateDeviceCursor` (rather than the built-in `dbSyncCycle`)
because it needs to seed the dirty set into the mirror **before** the steps and
commit the merged mirror back to React/localStorage **only on success** — the
engine's own `dbSyncCycle` swallows errors, which would let a failed cycle commit
a partial mirror. This wrapper is the React-state bridge and is required
regardless of the package version.

The wrapper runs **pull-then-push**. Originally (on 1.3.2) this was a
**correctness mitigation**: the engine advanced a single shared high-water mark
on push, so a device that pushed before pulling could skip a remote row whose seq
sat below its freshly-pushed rows and never see it.

**1.4.0 closes that race in the package** (split cursor: `getHighWaterMark` is
pull-only, `getPushAck` tracks push idempotency — a push never moves the pull
cursor). So pull-then-push is **no longer a data-loss mitigation** and the order
is no longer load-bearing for correctness.

**Decision: keep pull-then-push.** Rationale — we compose the cycle anyway (for
the seed/commit-on-success bridge above), so the order is a free choice, and
pulling first gives a marginal freshness win: a bundle superset and any
cross-list reconcile flush in the **same** cycle instead of the next one.
Reverting to the engine's `dbSyncCycle` would also reintroduce its
commit-on-failure hazard. The `getHighWaterMark`-unchanged-after-push behavior is
proven directly by the interleave test in `dbEngineWiring.test.js`.

### Backgrounded-write-reaches-vault check (the lastGLANCE bug)

`dbEngineWiring.test.js` proves the B3 behavior with fake timers: a burst of
writes collapses into **one** debounced `dbSyncCycle` ~3 s after the last write,
it is **vault-only** (the file engine is never called), and it is a no-op once
the engine is detached (vault disabled). So a write on a backgrounded device
reaches the vault without waiting for an app reopen — the bug the lastGLANCE
push-on-write fix addressed. **Confirmed.**

### Part B validation

- End-to-end through the **real** `createDbSyncEngine` + real AES-GCM (in-memory
  vault + native key store, no network/indexedDB): a task syncs A→B; concurrent
  bundle edits converge by set-union; a cross-list move lands under exactly one
  kind. Gate returns null when disabled; deviceId stable; push-on-write debounce
  vault-only + off-safe.
- **Interleave test (1.4.0 cursor fix):** with A's pull cursor at N, B writes a
  row at seq N+1, then A pushes rows at seqs > N+1; A's pull cursor stays at N
  (only the push-ack advances) and A's next pull still lists B's row at N+1. The
  residual race is closed.
- Full suite **294/294**; production `vite build` passes on `@glance-apps/sync@1.4.0`.

---

## Verdict

dayGLANCE's data model is **losslessly representable AND correctly mergeable** as
rows under current semantics. No unavoidable loss window. The GLANCEvault DB
transport is wired opt-in alongside WebDAV, non-destructive and reversible.
