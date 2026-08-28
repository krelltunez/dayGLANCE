# dayGLANCE Obsidian Build-Out

**Status:** Draft, revision 1
**Date:** 2026-08-10
**Scope:** Extending dayGLANCE's Obsidian integration from direct filesystem access to a full bridge, including a first-party Obsidian community plugin.

---

## 1. Purpose

dayGLANCE's Obsidian integration currently works by reading and writing vault files directly. That approach is fast, private, and requires no plugin or server, and it should remain the default wherever the platform permits it.

It has two limits:

1. **Platform coverage.** Direct filesystem access is unavailable on iOS entirely, and on Safari, Firefox, mobile browsers, and tablet PWA installs.
2. **Sync propagation.** Obsidian Sync only runs while Obsidian is open. Changes dayGLANCE writes to a vault while Obsidian is closed do not propagate to other devices until Obsidian is next launched on the originating machine.

This document specifies a phased build-out addressing both, plus the format and correctness work that should precede any expansion of write surface.

---

## 2. Current state

As established by codebase audit, August 2026.

### 2.1 Transport by platform

| Platform | Mechanism | Notes |
|---|---|---|
| Browser / PWA | Real File System Access API | Feature-detected via `'showDirectoryPicker' in window`. Chromium only (Chrome, Edge, Brave). |
| Electron: dev | Main-process IPC | `dialog.showOpenDialog` + `obsidian:*` handlers in `electron/obsidian.ts`. |
| Electron: Developer ID | Main-process IPC | Same. No security-scoped bookmark; `beginAccess` is a documented no-op. |
| Electron: Mac App Store | Main-process IPC | `securityScopedBookmarks: true`; bookmark persisted to `userData/obsidian-vault.json`; `obsidian:restore` calls `app.startAccessingSecurityScopedResource` each launch. |
| Electron: Windows / Linux | Main-process IPC | Enabled by PR #1357. Plain absolute path persisted, no bookmark. |
| Android | SAF bridge | `window.DayGlanceObsidian`. |
| iOS | **None** | No Obsidian integration exists. |

The gate for the Electron path is simply the presence of `window.electronAPI.obsidian`, which `preload.ts` exposes unconditionally. It is not MAS-gated.

`src/obsidianElectronHandle.js` is a shim mirroring the FSA surface (`getDirectoryHandle`, `createWritable`, `NotFoundError` semantics) so that all of `src/obsidian.js`'s markdown and sync logic runs unchanged across the browser and Electron paths.

### 2.2 What syncs today

- Tasks, as markdown checkboxes with `HH:MM-HH:MM` durations and wikilinks. Moves, reschedules, and title edits are written back.
- Daily notes, bidirectionally.
- Wiki notes, created from `[[...]]` targets found in task titles.

### 2.3 Sync triggers

App open, visibility change, 5-minute poll, and a manual "Sync Now" control.

### 2.4 Recently landed

**PR #1356** (`chore/obsidian-comment-accuracy`). Corrected three stale comments describing superseded behavior: the `isMAS` comment in `preload.ts`, the `files.bookmarks.app-scope` comment in `entitlements.mas.plist`, and the `obsidianElectronHandle.js` header. Also corrected the ARCHITECTURE.md desktop section.

**PR #1357** (`feat/obsidian-vault-win-linux`). Three changes:

- Removed the `process.platform !== 'darwin'` gates in `obsidian:pick` and `obsidian:restore`, giving Windows and Linux Electron real vault access. Previously those platforms advertised vault support via `isFileSystemAccessSupported()` but the picker silently did nothing.
- Added a filename portability validator, plus a reachability check on `obsidian:restore` for non-darwin (where there is no bookmark to fail against).
- Un-gated restore retry. The retry logic in `performObsidianSync` was correct but unreachable, because both automatic triggers checked for an existing handle before calling it. A failed startup restore was terminal for the session.

Verified on Linux under xvfb (pick, write, quit, relaunch, restore, write, plus moved vault) and on Windows hardware.

**Phase 1 (launch-on-write), shipped with 4.7.0.** Four PRs:

- **PR #1435** — the core feature: per-platform launch mechanisms, the desktop 8s debounce in the Electron main process, the single `obsidian:set-launch-on-write` IPC channel, the device-local tri-state toggle, and the Settings surfaces. Verified under xvfb (write → silent debounce fire with no `obsidian://` handler → clean quit with a pending launch flushed).
- **PR #1444** — replaced the Android timer with armed-on-write / delivered-on-exit, after establishing that a timer either interrupts the user in-app or is dropped by the background-activity-launch restriction once they leave.
- **PR #1445** — split Android delivery by exit path after hardware testing: back-exit direct-launches; Home/Recents exits post a tap-to-open notification, because the Home press triggers `stopAppSwitches` and the direct start is silently discarded.
- **PR #1446** — resolves the notification offer on app resume (gone from the shade = tapped/swiped/expired = offer spent, arm consumed), closing the redundant-launch gap left by the tap being unobservable under the Android 12+ trampoline ban.

The Phase 1 section below reflects the delivered design, not a proposal.

### 2.5 Known deferred items

- **Issue #1358.** Surface unportable existing vault filenames in Settings, read-only, phrased as a portability note rather than an error.
- **Path length.** No total-path-length check. Decided to let it fail honestly, since the real limit depends on vault depth plus folder plus filename plus whether long-path support is enabled, so any validator constant is wrong in one direction. If the raw `ENAMETOOLONG` proves cryptic in practice, a targeted catch-and-rephrase is a small follow-up.
- **Windows edge cases not tested.** Mapped drive letters, UNC paths, OneDrive Files-On-Demand vaults, non-ASCII vault paths, and 260-character paths. Path resolution logic was verified against `path.win32` semantics across 13 cases including UNC, but not exercised on hardware. Deferred deliberately: these are real failure modes, but they are better fixed in response to a bug report from someone who has that setup than by building a test environment speculatively.

---

## 3. Decisions of record

These were arrived at rather than being obvious, and are recorded so they are not relitigated by accident.

### 3.1 GLANCEvault only, no WebDAV path for advanced features

The basic direct-filesystem integration continues to work for everyone regardless of sync backend. Everything specified from Phase 5 onward assumes GLANCEvault.

**Rationale.** Supporting both transports in the plugin roughly doubles its configuration surface and support burden for a solo maintainer. GLANCEvault is expected to become the default for all self-hosters running GLANCE apps.

**Consequence.** The plugin becomes another device in a GLANCEvault account and inherits per-device credential binding, account-scoped route enforcement, quota accounting, and individual credential revocation with no new server work.

### 3.2 The plugin is authoritative where installed and paired

If the bridge plugin is present and paired to GLANCEvault on a device, the plugin owns the vault on that device and dayGLANCE does not write directly.

**Rationale.** Installing a plugin is a deliberate act, so a behavior change is not a surprise. A single ownership rule is far easier to document and debug than a capability-negotiated split.

**Critical qualifier: paired, not merely installed.** Obsidian Sync propagates installed community plugins across devices when that option is enabled, which most users leave on. A single deliberate install on one device therefore lands the plugin on others without a second deliberate act. An unpaired plugin must be inert: direct access continues, plugin does nothing. Authority transfers on successful pairing.

### 3.3 Pairing state is carried in the heartbeat payload

The plugin writes `.dayglance/heartbeat` on an interval while Obsidian is open. Payload: `{paired, accountId, deviceId, ts}`.

**Rationale.** Arbitration only matters on devices where dayGLANCE could write directly, and on precisely those devices dayGLANCE has vault access and can read the file. On iOS there is nothing to arbitrate and correspondingly no way to read it. The mechanism degrades exactly where it is irrelevant, and no separate signalling channel is needed.

**Revert path.** A stale or missing heartbeat resumes direct writes, treated identically. Staleness threshold should be comfortably longer than an Obsidian restart, so minutes rather than seconds.

### 3.4 HKDF bridge-scoped subkey, never the root E2E key

The plugin is provisioned with a bridge-scoped subkey derived via HKDF from the root sync key, and the Obsidian intent stream is encrypted under that subkey.

**Rationale.** The plugin's settings live at `.obsidian/plugins/dayglance-bridge/data.json`, in plaintext, inside the vault, which Obsidian Sync propagates to every device. Obsidian's mobile plugin runtime has no keychain equivalent. Storing the root key there would put the entire dayGLANCE dataset at risk from a single leaked vault file. A scoped subkey limits the blast radius to the Obsidian bridge stream.

Combined with per-device credentials on the transport side, a compromised vault costs one revocable device credential and one scoped stream, not the account.

**Additional mitigations.** Recommend excluding the plugin data file from Obsidian Sync in documentation. State plainly in the plugin settings tab what is stored where. The plugin source is public under community directory rules, so this design will be read by people who care.

### 3.5 Block IDs are a hard prerequisite for Phase 6

Phase 2 must be complete and running long enough that most vault content carries IDs before Phase 6 begins.

**Rationale.** The transport handoff is the risky moment. At cutover the vault may contain tasks dayGLANCE wrote via direct access that GLANCEvault holds under different identity. With `^dg-` IDs that reconciliation is a scan-and-match. Without them it is text matching across two sources of truth, which is the shape of the duplication bugs addressed in PRs #1146 through #1148.

### 3.6 Semantic intent stream, not reuse of the FSA handle shim

Phase 6 does not add a third implementation behind `obsidianElectronHandle.js`. dayGLANCE and the plugin exchange semantic task and note changes over a bidirectional GLANCEvault intent stream.

**Rationale.** A GLANCEvault-backed handle would satisfy the write path cleanly but has nothing to read unless the plugin maintains a mirror of vault content in GLANCEvault, which is real storage and real staleness for little benefit. dayGLANCE already knows its own task state from GLANCEvault; the only thing it needs from the vault is Obsidian-side edits, which arrive as inbound intents. This is a fork of the reconcile path rather than a reuse of it, but a smaller one than maintaining a mirror, and the boundary matches the ownership rule in 3.2.

**Reversibility note.** This is the most reversible decision in the plan. If Phase 6 work repeatedly wants to change shared logic in `src/obsidian.js`, that is the signal to reconsider, and it is much cheaper to unwind early.

### 3.7 Filename portability: refuse creation, permit writes to existing files

The validator rejects the union of characters illegal on any platform an Obsidian vault may sync to: `[ ] # ^ | * " \ / : ? < >`, control characters `0x00-0x1F`, leading dot, trailing dot or space, and Windows reserved device names (case-insensitive, including with extensions).

Existence is checked **before** the validator gate. An invalid name that already exists is written to normally; an invalid name that does not exist is refused.

**Rationale.** The portability harm is entirely in creating a new unportable name. A file already in the vault is already breaking sync on other platforms whether or not dayGLANCE writes to it again. Refusing that write buys zero portability and leaves the user with a permanent error on a task whose linked note visibly exists.

**Honest framing requirement.** Obsidian's own restrictions are OS-specific and narrower than this union. As of v1.8.10 Obsidian forbids `[ ] # ^ |` on all platforms plus `\ / :` on macOS/iOS/Linux, `* " \ / : | ?` on Windows, and `\ / : * ? "` on Android. Characters like `?` and `*` are perfectly creatable Obsidian note names on macOS. dayGLANCE is deliberately stricter, on portability grounds, and the error copy must say so rather than implying Obsidian would have refused.

**Rejected alternatives.** Sanitizing illegal characters breaks round-trip, because `readWikiNote` resolves links by exact-name search and would never find the sanitized file again; rescuing it with frontmatter aliases adds alias-aware resolution and collision handling for little gain. Renaming the offending file and rewriting the wikilink is worse still, since renaming breaks every other link to that note across the vault, and backlink maintenance is Obsidian's job.

### 3.8 Community directory submission comes after dogfooding, not before

The plugin runs unlisted (BRAT or manual install) through Phases 5 and 6. Submission to the Obsidian community directory happens once the codebase is stable.

**Rationale.** Nothing about running the plugin on your own devices requires the directory. Obsidian's automated review scans every version, not just the initial submission, and a failed release is removed from search within 24 hours. Submitting a thin plugin and then substantially rewriting it means putting each intermediate state through that gate for no benefit.

---

### 3.9 Staged vault-format rollout: read-support first, containment as the safety net

**Standing rule, not a one-time decision.** Any change to what dayGLANCE WRITES into the vault ships in two releases: first a release whose parser fully understands the new format but never emits it, then a release that enables emission. The gate is a build-time constant (`src/utils/obsidianWritePolicy.js`), never a user-facing setting: a setting pushes correctness onto the user, and someone always has a device they forgot about.

**Ordering discipline, not a guarantee.** Read-support-first is the right default for every vault-format change because it maximizes the share of the fleet that understands a new format before anything emits it. But release ordering **cannot be enforced** — a Docker user pulls `latest` after six months and skips every intermediate release, so "the reader has propagated" is a state nobody can observe and no release sequencing can produce. Read-first must not be relied on as a gate; it narrows the exposure window, nothing more.

**Rationale for the exposure being worth narrowing.** The fleet spans five platforms on three release channels (dev, Developer ID, MAS, Play, App Store/TestFlight) whose store approvals never align, plus always-on appliances with vault access that lag behind updates. A client that does not understand a format token reads it as **title text**, hashes it into a brand-new content-derived id, and imports a duplicate that syncs fleet-wide — stable duplicates for the whole mixed window, surviving the update in the heavy-stamp case (analyzed for `^dg-` block ids, then observed live 2026-08-26).

**Containment is the actual safety net.** Before any format's emitting release ships, evaluate whether a naive old parser's misread of that format is **self-identifying** — the way a `^dg-` token swallowed into a mangled title still names the very task it duplicates. Where it is, build containment: recognize the misread at every sync ingress AND at boot (PR #1457's fourth wiring point — a device that never syncs never repairs itself), derive the correct identity from the corruption, and retire the duplicate so it stops propagating and the minting device self-repairs on update. Where a misread would NOT be self-identifying, that is a design signal against the format as proposed — prefer a shape whose corruption carries its own antidote.

**Read support means the FULL read semantics, not "strip and ignore."** A device that strips a token but still derives the old identity (e.g. hashing the clean title into a legacy id) keeps re-producing retired identities after a write-release device retires them — a milder seed of the same divergence. The read release carries everything except emission: recognition, identity adoption, bridging, dedup rules.

**Fleet-readiness gating: investigated and declined.** A per-account readiness gate (capability bundle in the sync payload, a GLANCEvault devices endpoint, cursor cross-referencing to detect stale clients) would make the ordering enforceable — and was deliberately not built: substantial permanent server-and-client surface for a solo maintainer, to close a gap that containment reduces to a bounded, temporary, self-healing inconvenience confined to the un-updated device's own screen. Recorded here so it is not rediscovered as a novel idea later.

**Applies next to Phase 4** (Tasks emoji metadata, Dataview inline fields, frontmatter) — a strictly larger write surface than block ids: each of those formats gets a read release before any device emits it, and each gets the containment question asked, format by format, before its emitting release.

---

## 4. Obsidian community directory constraints

Relevant from Phase 5 onward. Current as of the May 2026 policy overhaul.

- **Review is automated and fast.** Submission runs through a developer dashboard, results typically within minutes, searchable in-app within 24 hours. This is nothing like App Store review timelines.
- **Every version is scanned,** not just the first. A release that fails is removed from search within 24 hours. Wire the official eslint plugin and the dashboard preview scan into CI before the first submission.
- **Labeling.** Plugins must be labeled Free, Optional payments, or Paid. A plugin connecting to a paid service or API must be labeled Optional payments even if the service has a free tier. The dayGLANCE bridge will carry this label once it talks to GLANCEvault.
- **New closed-source plugins are not accepted.** The bridge source will be public.
- **Ads.** Prohibited outside the plugin's own interface. Static ads inside it are permitted if disclosed in the README. An upgrade prompt in the plugin settings tab is acceptable; writing promotional content into the user's vault is not.
- **Maintenance.** Developers agree to continue maintaining their projects. Plugins that stop working with newer Obsidian versions are eventually removed.

---

## 5. Mobile plugin runtime constraints

Relevant to Phases 6 and 7.

- **No keychain.** Plugin settings live in `data.json` inside the vault. This is why 3.4 exists.
- **Background execution is limited.** An SSE connection will not survive backgrounding on iOS.
- **Consequence.** Phase 7 live sync is effectively desktop-only. Mobile gets drain-on-open. Design for this rather than discovering it in testing.

---

## 6. Phases

Phases 0 through 2 are complete. Phases 2 through 4 are independent of the plugin and deliver value on their own.

### Phase 0. Platform truth and write safety foundations — COMPLETE

Delivered by PRs #1356 and #1357. See section 2.4.

---

### Phase 1. Launch-on-write — COMPLETE

Delivered by PRs #1435, #1444, #1445, and #1446; shipped with 4.7.0. See section 2.4. The scope and notes below are the as-built record.

**Goal.** When dayGLANCE writes to a vault while Obsidian is closed, launch Obsidian so Obsidian Sync pushes the change.

**Key insight.** No "sync now" command is needed. Obsidian Sync connects and reconciles as soon as the vault opens, so launching the app is the entire mechanism.

**Scope.**

- Fire `obsidian://open` after a debounced quiet window following vault writes. The URI form differs by platform:
  - **Desktop.** `?path=<absolute path>`. The `path` parameter overrides both `vault` and `file`, so no vault-name configuration is required. The absolute path is resolved in the Electron main process by `resolveInVault` and never reaches the renderer.
  - **Android.** `?vault=<name>&file=<relpath>`. Under SAF there is no absolute filesystem path — the bridge holds a content-tree URI — so `path=` cannot work. The vault name is derived programmatically from the tree URI, exactly as the existing `ObsidianBridge.openNote` does, so the outcome of no user-facing vault-name configuration still holds.
- **Debounce: 8 seconds, trailing edge, reset on every write — desktop only.** Any value in the 5-10 range is defensible. 8 is chosen because a leisurely triage session can have 5-plus second gaps between actions, which a 5-second window would split into multiple launches, while past 8 seconds nothing further coalesces in practice and the only effect is added latency. The cost asymmetry favors the upper-middle: an extra launch is nearly free (it focuses or no-ops), while added delay is invisible because the user is not waiting on it.
- **Android has no timer: writes arm the launcher, leaving the app delivers it.** Two forcing reasons, recorded so this is not relitigated. UX: an intent fired while the user is inside dayGLANCE brings Obsidian to the foreground and interrupts their flow — there is no Android equivalent of macOS's background `activate: false`. Correctness: since Android 10 the OS blocks activity starts from apps no longer in the foreground (the background-activity-launch restriction), so a timer expiring after the user left would be silently discarded — a timer-based Android launch only works when it interrupts, and fails exactly when the user edits and puts the phone away. The exit is the debounce: one delivery per session-with-writes, for the last-written note. Screen-off and incoming calls deliberately do not deliver (`onUserLeaveHint` excludes them); the armed state survives until a real exit and dies with the process.
- **Android delivery is split by exit path, and this too is platform-forced.** A back-button/gesture exit direct-launches: the app is the foreground actor performing a legitimate app switch, so the start is permitted. A Home or Recents press is different — it triggers the platform's `stopAppSwitches` suppression (built precisely so apps cannot hijack the Home button), and the deferred start is then dropped by the background-activity-launch check; verified on hardware, the `startActivity` is silently discarded. Automation apps clear this with the "Display over other apps" permission, which is too heavy an ask for this feature. The sanctioned channel is a quiet tap-to-open notification (LOW importance, constant id so re-posts update rather than stack, 15-minute timeout, retired on app resume and on a confirmed back-exit launch). Its tap `PendingIntent` targets Obsidian directly — Android 12+ forbids notification trampolines — so the tap cannot be observed, and the armed state is therefore only peeked, never consumed, by the notification path: an ignored notification does not lose the wake, and a later back-exit still direct-launches. **The offer is resolved on app resume**, which closes the one remaining gap: a tapped offer would otherwise leave the arm set and make the next back-exit open Obsidian redundantly. The tap is unobservable but its effect on the notification is not — gone from the shade means tapped, swiped, or timed out, all of which spend the offer, so the arm is consumed; still showing means merely ignored, so the arm survives and only the notification is retired. Because a back-exit is unreachable without first returning to the app, resolving on resume closes this completely rather than probabilistically. A resume is gated on an offer actually having been posted, so screen-off/screen-on — which fires `onStart` without any notification — cannot discard a valid arm, and the check degrades conservatively (treat as still showing, keep the arm) if the platform query fails.
- **Settings toggle must be device-local, not part of `obsidianConfig`.** `obsidianConfig` participates in cloud sync, and between non-native devices the incoming config wholesale replaces the local one. A `launchOnWrite` field inside it would leak from a Mac to a Windows machine and defeat the per-platform defaults. Use a device-local key (for example `day-planner-obsidian-launch-on-write`), which the `day-planner-` prefix rule captures in local device backups while excluding it from the cloud payload — the same posture as `darkMode` and `reminderSettings`. Store as tri-state, where unset means platform default, so changing a default stays a one-line edit.
- **Suppression when Obsidian is already running is deferred to Phase 5.** It depends on the heartbeat. Firing while Obsidian is open is harmless: on macOS `activate: false` makes it a no-op, and elsewhere it focuses the window.
- **Browser and PWA are out of scope,** and not merely by choice. A `window.open` fired from a debounce timer has no user gesture attached and is popup-blocked.

**Per-platform.**

| Platform | Mechanism | Default |
|---|---|---|
| macOS, all Electron builds | `shell.openExternal(uri, { activate: false })` from the **main process**, alongside the existing `obsidian:*` handlers | On |
| Windows Electron | `shell.openExternal`. Obsidian takes focus; no background equivalent | Off |
| Linux Electron | `shell.openExternal`. Handler registration is unreliable, especially for AppImage installs | Off, fail silently |
| Android | Armed by vault writes, delivered on app exit, split by exit path: **back-button/gesture exit direct-launches** (`ACTION_VIEW` via the existing `ObsidianBridge.openNote` path, from the back callback), while **Home/Recents exits post a tap-to-open notification** instead — a direct start there is impossible (see notes). **Not Capacitor** — `dayglance-android` is a native Kotlin WebView app with `@JavascriptInterface` bridges. No Tasker needed | Off |
| iOS | Not applicable until Phase 6 | n/a |
| Browser / PWA | None. Popup-blocked without a user gesture | n/a |

**Notes.**

- `activate: false` is macOS-only and works under the App Store sandbox, since it goes through LaunchServices rather than spawning a process. There was a historical period where it misbehaved when called from a renderer but worked correctly from the main process; the vault code is already main-process. Verify once on a real MAS build.
- Linux deep-link delivery and Linux vault access are independent capabilities and must not be gated on each other. Vault access works; URI handler registration may not.
- Optional polish: Advanced URI's `openmode=silent` avoids opening a tab. Detect its presence by checking `<vault>/.obsidian/plugins/obsidian-advanced-uri/` and the enabled list in `community-plugins.json`, and fall back to the base scheme when absent. A dependency to detect, never to require.
- **Write chokepoint: one per platform, on the native side of each bridge.** There is no single cross-platform chokepoint, and creating one in the renderer would be worse. On desktop, every write path funnels through `obsidian:write-file` in `electron/obsidian.ts`, which already holds the resolved absolute path and knows whether the write succeeded. On Android, the analog is `ObsidianRepository.writeText`, which `writeDailyNote` and `writeNote` share. A renderer-side debounce would require extracting a shared write helper across four inline `createWritable` sites plus the native wrappers, add a launch IPC back to main, and still not have the absolute path. Two small debounce policies, each at a real funnel with its own tests, is the smaller honest shape.
- **IPC surface is one channel:** `obsidian:set-launch-on-write` (renderer to main, boolean), pushed at startup and on toggle change. There is no renderer-invocable launch channel — main initiates the launch itself from the write handler, so the renderer never controls a URI. This preserves the security posture of the existing `obsidian:open-note` handler, where `setWindowOpenHandler` permits only http and https.
- **Lifecycle edges (covered, with tests):** a pending launch is cleared on toggle-off, on `obsidian:disconnect`, and on `obsidian:pick`, while the enabled flag survives a vault swap — so a launch never fires against a vault the user just swapped away from, and a write into the new vault schedules normally. On desktop app quit, a pending launch inside the quiet window fires immediately via a `will-quit` flush (fire-and-forget, so quit is never delayed); on Android the armed state dies with the process — the accepted-miss equivalent, since there is no exit hook left to fire from.

**Non-goals.** This does not solve propagation to other devices. It fixes the push side only. The pull side is Phases 5 through 7.

**Exit criteria (met).** Writing to a vault with Obsidian closed results in the change appearing on a second device without manual intervention on the originating machine — immediately on desktop and Android back-exits; after one notification tap on Android Home/Recents exits, where the platform forbids anything more automatic.

---

### Phase 2. Block-ID identity — COMPLETE

**Goal.** Give every dayGLANCE-managed task a stable identity in the vault that survives edits, reordering, and reformatting.

**Status.** Complete. Part A delivered by PR #1439; shipped in TWO releases per the staged-rollout rule (3.9): the **read release** (PR #1456) carried the full Part A read path — token recognition, `obsidian-dg-` adoption, the legacy bridge, first-occurrence-wins — with emission gated OFF; the **write release** flipped `OBSIDIAN_BLOCK_ID_WRITES` to `true` in `src/utils/obsidianWritePolicy.js`, backed not by an unenforceable propagation guarantee but by ghost-row containment (PR #1457) as the safety net for straggler clients, per the amended 3.9. Tokens already present in lines are preserved, never stripped. Phase 3 depends on this phase and is now unblocked. The scope below records the split and the semantics decided during implementation.

**Rationale.** Task identity is currently implicit, positional or text-matched. Every bug class fought in GLANCEvault (resurrection, phantom deletes, duplication) has a latent analog here and will surface as write surface grows. This is the highest-value single change in the plan.

**Scope — Part A (the whole deliverable).**

- Assign `^dg-<id>` block references on write: `- [ ] Review proposal ^dg-a1b2c3d4`. Format: 8 chars of lowercase base36, generated at write time, persisted on the task as `obsidianBlockId`, and embedded in the line itself — the vault carries the identity, so every device derives the same task id from the same line.
- **Ids are DERIVED, not random** (amended post-ship — the echo-stamp decision). The token is a pure function of the line's stable identity: 8 base36 chars of a frozen hash over (daily-note date, raw title as written) — the same inputs the legacy content id hashes, NFC-normalized and trimmed, computed only in the shared JS mint path (`deriveBlockId` in `src/obsidian.js`; the native layers never mint). **Why:** with random minting, an edit that reaches the fleet under the legacy id (it originated on a device without vault access, or a write failed before its rename committed) made every vault-capable device mint its own token for the same line — an N-way identity race that converged only through retirement records, detector reaping, and Obsidian Sync settling the file, with one no-heal corner: a mint whose device closed before ever scanning it lingered as a permanent duplicate row that ghost containment cannot catch (it is a well-formed tagged row). Derivation makes the race **semantically empty**: every device mints the same token, so an N-way mint is N devices writing an identical line — nothing to reconcile, nothing to reap, no coordination, no provenance tracking. **One logical edit produces one token by unanimity rather than election.** The alternatives — read-before-mint (already implicit in the tagged-line skip + write-success gating, and a no-op against the real timing) and origin-based mint suppression (real provenance machinery for a partial fix, with a trap variant that starves the vault of cloud edits) — are recorded in the decision discussion so they are not rediscovered. Derivation runs once, at mint time; the embedded token owns identity thereafter, exactly as before — this is not a return to content-derived identity. Existing randomly-minted tokens are untouched, the on-disk token shape is unchanged (no 3.9 read-release window), and the algorithm is frozen with golden-value tests: tokens derived by different app versions must agree forever.
- Match on read by ID first, falling back to existing text matching when a line carries no ID. The app-level id for a tagged line is the content-independent `obsidian-dg-<id>`; content-derived ids diverge across devices whenever two devices first import before/after an edit, so deriving from the block id is what makes cross-device matching converge. A one-time legacy-id bridge carries app-only fields across the switch.
- Migrate opportunistically: a task acquires an ID the first time a WRITE rewrites its line, committed to app state only when the write reports success. No flag day.
- IDs are assigned at write time in dayGLANCE and persisted, not derived at read time.

**Part B — deliberately not shipped.** A proactive sweep stamping IDs onto every existing line is a mass rewrite of the user's files; a bug in emission would corrupt everything at once, where Part A bounds any bug to one task. Part A converges on its own as tasks get edited, and untagged tasks keep working through the fallback indefinitely — there is no correctness cliff forcing a sweep.

**Decided semantics** (details and rationale in PR #1439):

- Duplicate `^dg-` ids (a line copy-pasted in Obsidian): first occurrence wins, vault-wide; later occurrences parse as untagged tasks.
- A tagged line retitled in Obsidian keeps its task, and the vault title wins when the line's raw title differs from what dayGLANCE last wrote; an unchanged line still preserves DG-side renames.
- A line ending in the user's own block ref (`^quote1`) is never stamped — Obsidian allows one block reference per line — but a line already carrying our id keeps it unconditionally.
- `obsidian-dg-` keys carry no date, and the deletion detector conservatively never tombstones undatable keys; a persisted sidecar (`day-planner-obsidian-last-scanned-dates`) supplies each key's last-seen daily-note date so deletion propagation stays alive for tagged tasks.

**Why block references specifically.** Native Obsidian syntax, invisible in reading view, survives edits and reordering, and linkable from anywhere in the vault.

**Note.** `^` is in the portability validator's rejected set for filenames. That is unrelated and correct; block IDs live in file content, not filenames.

**Exit criteria.** A task edited in Obsidian (retitled, moved between sections, reordered) is matched correctly on the next sync without duplication.

---

### Phase 3. Write-safety hardening

**Goal.** Make vault writes safe against concurrent edits and partial failures before expanding what gets written.

**Dependencies.** Phase 2.

**Scope.**

- Content-hash change detection, so a sync cycle with no delta writes nothing. *(Delivered: a no-delta scan cycle was measured to already write nothing by construction; the remaining redundancy — the cross-device echo write — is closed by a byte-identity skip in both task write paths: when the would-be output equals what was just read, the disk write is skipped while the confirmed-write semantics are kept. The first echo after an Obsidian-side edit still writes, deliberately — the section sort normalizes the file once and steady-state echoes then skip; avoiding that first write would mean loosening byte-equality into semantic equality, i.e. changing what gets written, which this deliberately is not.)*
- Modified-since-last-read guard before overwrite, so an edit made in Obsidian between sync cycles is not clobbered.
- Verify write atomicity per transport. FSA's `createWritable()` provides atomicity by default via a swap file and rename. The Electron main-process path and the Android SAF path need explicit verification. *(Delivered: Electron temp+fsync+rename; Android temp/delete/rename with deterministic recovery; iOS was atomic all along; the write/read failure contracts and their surfacing shipped alongside.)*

**The two-sided retitle policy** (decided; `src/utils/obsidianTitleConflict.js`). A tagged task retitled in dayGLANCE **and** in Obsidian between syncs is detected by a three-string comparison — base = `obsidianRawTitle` (the vault line at our last successful observation, honest since the write-success contract), theirs = the parsed line now, ours = the app title stripped of the display tag; a conflict is both sides off the base, to different texts. Resolution: **the vault wins the title; the dayGLANCE rename is preserved as a durable record appended to `task.notes`** (idempotently — the record text is deterministic, so N devices' scans collapse to one line), plus a fire-and-forget neutral toast. A **write-time guard** funnels the write-first interleaving into the same single policy point: `updateTaskLines` compares the matched line's current bare title against the base and, on divergence, writes the state change while keeping the *line's* title (a state write must never revert an Obsidian retitle — that clobber destroyed its own evidence); if a retitle was also in flight it signals the conflict and the writeback skips the `titleUpdate` commit, so the base stays truthful and the next scan (≤5 min) resolves it — a delay, never a loss. The notes field is app-only and outside the writeback's change detection, so preservation can never itself trigger a vault write.

**The guard also protects one-sided vault retitles** — a behavior in its own right, not just a conflict funnel. Before the policy, *any* state write onto a tagged line rebuilt it from app state: completing a task in dayGLANCE within the scan gap after retitling its line in Obsidian silently reverted the retitle — a one-sided clobber needing no dayGLANCE rename at all, and the more common interleaving. Under the guard, a plain state write (completion, reschedule, time change) onto a line whose title has moved off the base keeps the **line's own title**, writes only the state, and stays silent — no conflict signal, no notes record, nothing two-sided happened; the next scan adopts the vault title through the ordinary one-sided `vaultTitleWins` path. This follows directly from the mismatch rule ("on divergence, keep the line's title") and is pinned by its own tests: the pre-policy test that asserted the clobber (`obsidian.blockIds.test.js`, "matches by id even when the title was edited in Obsidian") now asserts the line's title survives, with a comment recording the flip.

**Why this shape (recorded so it is not relitigated).** A conflict is a one-shot event, not a persisting condition — nothing broke, nothing retries, no recovery to await — so the failure-surfacing latch is the wrong channel: latched, a notice either evaporates before the user looks or squats on the error state blocking real failures, and it should not be red at all. The durable record belongs on the task, where the user will be looking when they notice the title is not what they typed. Rejected alternatives: **vault-wins-made-visible alone** (its honest version still wants somewhere durable for the old title, at which point it is this policy); **dayGLANCE wins** (reverts the user's edit in their own vault — hostile); **timestamp LWW** (built on sand: there is no per-line vault edit time, **file mtime on a synced vault reflects Obsidian Sync delivery, not edit time**, and clock skew applies — it would resolve confidently and sometimes wrongly, which is worse than not resolving); **conflict UI** (wrong cost/benefit for an event this rare). Untagged lines need no policy: they match by title equality, so a diverged untagged line simply re-imports under a new identity — the pre-existing benign behavior.

**Exit criteria.** An edit made in Obsidian while dayGLANCE is running is never silently lost.

---

### Phase 4. Format expansion

**Goal.** Speak the formats Obsidian power users already use, so dayGLANCE content is queryable with their existing tooling.

**Dependencies.** Phases 2 and 3.

**Scope.**

- Tasks plugin emoji metadata: due, scheduled, priority, recurrence.
- Dataview inline fields.
- Tags.
- Frontmatter on generated notes, so they are queryable from Dataview and Bases.

**Rationale.** This is the cheapest real user-facing win in the plan and the thing that makes a directory listing compelling to someone already living in their vault.

**Rollout.** Subject to the staged-rollout rule as amended (3.9), format by format: a release that parses Tasks emoji / Dataview fields / frontmatter without emitting them, then the emitting release — with read-first understood as an exposure-narrowing discipline, not a gate. This surface is strictly larger than block ids — an emoji date or an inline field misread as title text corrupts identity hashing exactly the way a `^dg-` token did — so **each format gets the 3.9 containment question asked before its emitting release ships**: is an old parser's misread of THIS format self-identifying, and if so, where is the containment built (all sync ingresses plus boot)? A format whose misread is not self-identifying needs a redesign or an explicit accepted-risk record before it emits.

---

### Phase 5. Bridge plugin, minimal, unlisted

**Goal.** Establish the plugin as an artifact, running on your own devices, doing the smallest useful thing.

**Dependencies.** None strictly, but sequencing after Phase 4 is sensible.

**Scope.**

- Heartbeat: write `.dayglance/heartbeat` every 30 seconds while Obsidian is open, payload per 3.3.
- A `dayglance-bridge:sync-now` command.
- Nothing else. No transport, no GLANCEvault client.
- dayGLANCE reads the heartbeat to suppress Phase 1 launch-on-write delivery when Obsidian is already running — the desktop debounced launch, and on Android the arming itself (so neither a direct launch nor a tap-to-open notification is produced) — and to determine arbitration state.

**Distribution.** BRAT or manual install. Not submitted to the community directory.

**Exit criteria.** Heartbeat visible and correctly interpreted by dayGLANCE on macOS, Android, and Windows. Phase 1 no longer launches Obsidian or posts a tap-to-open notification when Obsidian is already open.

---

### Phase 6. Plugin as transport

**Goal.** Unlock Obsidian integration on platforms where dayGLANCE has no filesystem access, principally iOS.

**Dependencies.** Phase 2 complete and in production long enough that most vault content carries IDs. Phase 5.

**Scope.**

- Plugin pairs to GLANCEvault as a device, obtaining per-device credentials and an HKDF bridge-scoped subkey per 3.4.
- Bidirectional semantic intent stream per 3.6. dayGLANCE emits task and note changes; the plugin applies them to the vault through Obsidian's own API and emits Obsidian-side edits back.
- Arbitration per 3.2 and 3.3: on pairing, the plugin becomes authoritative and dayGLANCE stops writing directly on that device.
- Idempotency: intent IDs assigned at write time in dayGLANCE and persisted. Plugin maintains a per-vault applied-ID set plus a high-water mark, so replay is a no-op.
- Convergence: applied output must be a pure function of the intent. Any non-determinism (timestamps, ordering within a section) manufactures Obsidian Sync conflicts across devices.
- Settings UI in dayGLANCE showing the active mode **for this device** with the reason, for example: "Bridge plugin active (paired 3 days ago). Direct vault access disabled." Without this, the first symptom a user notices is the vault folder picker apparently no longer mattering.

**Scope honesty.** What this delivers per platform is lopsided. iOS gains everything, since it currently has nothing. Android and desktop gain path consolidation rather than new capability, since SAF and filesystem access already work there. The risk concentration is on the Obsidian mobile runtime, not on GLANCEvault.

**Idempotency lesson to apply.** The GLANCEintents `transitionId` failure was an ID that was undefined at emit time and did not survive the transport. Assign at write time, persist, verify it survives the round trip.

**Exit criteria.** A task created in dayGLANCE on iOS appears correctly in the vault on macOS, and an edit made in Obsidian on macOS appears in dayGLANCE on iOS, with no duplication across repeated syncs.

---

### Phase 7. Live sync

**Goal.** Near-real-time propagation while Obsidian is open.

**Dependencies.** Phase 6.

**Scope.**

- Plugin holds an SSE connection to GLANCEvault while Obsidian is open, applying changes as they arrive.
- Desktop only in practice. Mobile gets drain-on-open per section 5.
- Self-nudge loop prevention: the plugin applying an inbound change must not emit that change back outbound. This is structurally the same failure identified in the lastGLANCE SSE audit; use lifeGLANCE's persisted-flag pattern.

**Exit criteria.** A change made in dayGLANCE on one desktop appears in Obsidian on another within seconds, with no echo.

---

### Phase 8. Deeper integrations

**Goal.** The integrations that motivated the whole exercise, now on a safe substrate.

**Dependencies.** Phases 2, 3, and 6.

**Candidate scope.**

- Project and goal notes with backlinks from tasks.
- Habit and routine completion written to frontmatter.
- Daily-note section templates.

Deliberately underspecified. Scope this once the substrate is proven.

---

## 7. Directory submission milestone

Not a phase. Submit the plugin to the Obsidian community directory once Phases 6 and 7 are stable and the codebase is not expected to change substantially.

**Before submitting.**

- Wire the official eslint plugin and dashboard preview scan into CI.
- Confirm the Optional payments label is correct and expected.
- Write the listing description around the Obsidian-side capability, not around dayGLANCE. The README does the explaining.

**Expectation setting.** The bridge plugin is installed only by people who already have dayGLANCE, so as an acquisition funnel it runs backwards. Its value is a permanent sanctioned listing describing what dayGLANCE does, plus standing to discuss the integration in Obsidian community spaces. That is a credibility artifact more than a growth channel.

**Announcement channels.** The `#updates` channel on the Obsidian Discord (requires the developer role) and the forum's showcase category are both explicitly sanctioned.

---

## 8. Open questions

- **Phase 3 atomicity.** Is the Android SAF write path atomic? Is the Electron main-process write path atomic?
- **Phase 6 pairing UX.** How does the plugin obtain GLANCEvault credentials? A pairing code shown in dayGLANCE settings is the obvious shape but is unspecified.
- **Phase 6 conflict policy.** What happens when the same task is edited in Obsidian and in dayGLANCE between syncs? Last-write-wins is the default assumption but should be deliberate.
- **Phase 8 scope.** Deliberately deferred.
