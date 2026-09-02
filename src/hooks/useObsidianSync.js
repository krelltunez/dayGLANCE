import { useEffect, useCallback, useRef } from 'react';
import {
  tryRestoreVaultAccess, getVaultAccess,
  syncObsidianVault, syncObsidianVaultNative,
  writeTaskStateToFile, writeTaskStateNative,
  simpleHash as obsidianSimpleHash,
  deriveBlockId, appIdForBlockId, dailyNoteFilename,
  readWikiNote, writeWikiNote, scanVaultNotes,
  vaultHasTasksPlugin, detectTasksPluginNative,
  readVaultHeartbeat, readVaultHeartbeatNative,
  OBSIDIAN_IMPORT_WINDOW_DAYS, obsidianWindowCutoffDate,
} from '../obsidian.js';
import {
  isNativeAndroid, isNativeApp,
  nativeGetVaultConfig, nativeGetNote, nativeWriteNote, nativeOpenNote,
  nativeListNotes, nativeSetVaultSettings, nativeSetLaunchOnWrite,
} from '../native.js';
import { effectiveLaunchOnWrite } from '../utils/obsidianLaunchOnWrite.js';
import { validateWikiNoteName } from '../utils/obsidianFilename.js';
import { classifyVaultPaths } from '../utils/vaultPortability.js';
import { mergeObsidianDailyNotes } from '../utils/mergeObsidianDailyNotes.js';
import { mergeObsidianTasks, noteMtimesFromDailyNotes } from '../utils/mergeObsidianTasks.js';
import { detectObsidianDeletions, addObsidianTombstones } from '../utils/obsidianDeletions.js';
import { reattachTasksMetadata } from '../utils/obsidianTasksMetadata.js';
import { obsidianHeartbeatState } from '../utils/obsidianHeartbeat.js';
import {
  readRetiredTaskIds,
  recordRetirements as recordRetirementEntries,
  isTombstonedRemint,
  RETIRED_TASK_IDS_STORAGE_KEY,
  RETIRED_ID_DUAL_WRITE,
} from '../utils/retiredTaskIds.js';
import { blockIdWritesEnabled, completionMarkerWritesEnabled } from '../utils/obsidianWritePolicy.js';
import { titleConflictNoticeText } from '../utils/obsidianTitleConflict.js';
import { withCreationFrontmatter } from '../utils/obsidianFrontmatter.js';
import { writebackSnapshotEntry } from '../utils/obsidianWritebackSnapshot.js';
import { emitBridgeIntent, flushBridgeOutbox, publishBridgeConfig, publishBridgeCalendarProjection, getBridgePairingMeta } from '../utils/obsidianBridgeStream.js';
import { fetchBridgeObservations, applyBridgeObservations, commitBridgeObservationCursor, pendingBridgeObservations } from '../utils/obsidianBridgeInbound.js';
import {
  fetchBridgeActions, planBridgeActions, applyActionsToTasks, applyActionsToRecurring,
  deleteBridgeActions, commitBridgeActionCursor,
} from '../utils/obsidianBridgeActions.js';
import { buildCalendarProjection, calendarProjectionHash } from '../utils/obsidianCalendarProjection.js';
import { getDeviceId } from '../sync/deviceId.js';
import { dateToString } from '../utils/taskUtils.js';
import { recordBridgeMode, reconcileArchivedBaseline } from '../utils/obsidianBridgeMode.js';
import { restoreBinnedVaultTasks, binRestoreNoticeText } from '../utils/obsidianBinRestore.js';
import {
  inferNoteScopedDeletionCandidates, reconcileNoteScopedDeletions,
  readPendingNoteDeletions, writePendingNoteDeletions, applyPendingContinuityGuard,
  PENDING_NOTE_DELETIONS_KEY,
} from '../utils/obsidianNoteScopedDeletions.js';

/**
 * Obsidian vault sync — extracted from App.jsx (see "App.jsx — Ongoing
 * Decomposition" in CLAUDE.md), logic moved verbatim.
 *
 * Owns the full sync lifecycle: vault-handle restore + initial sync on mount,
 * re-sync on visibility change, the 5-minute poll, the task-writeback effect
 * (completion/title/schedule changes written back to daily notes), and the
 * iOS vault-settings persistence. Returns the imperative callbacks App.jsx
 * exposes through the sync context: performObsidianSync, loadWikiNote,
 * saveWikiNote, and openInObsidian (plus notifyNativeReady for completeness).
 *
 * State/refs stay owned by useObsidian (obsidianConfig, status, the vault
 * handle and dedup refs) and are passed in, so existing persistence and
 * settings wiring is untouched.
 */
// The one task-write failure message, latched (see the reporters below). It
// names the CONDITION, never the tasks, and is precise about the actual retry
// semantics: there is no background retry queue — a failed write re-attempts
// when the task next changes.
export const OBSIDIAN_TASK_WRITE_ERROR =
  "Couldn't write to your Obsidian vault. Your changes are saved in dayGLANCE and will be written on the next edit.";

// A note restore failed (Android crash-safe writes, SafeReplace RESTORE_FAILED):
// the note is genuinely MISSING from the vault, so the task-write message's
// reassurance ("your changes are saved in dayGLANCE") would be wrong — the
// content at risk is the note's, and it is preserved in the hidden temp beside
// where the note was.
export const obsidianRestoreFailureMessage = (fileName) =>
  `Vault note "${fileName}" is missing and couldn't be restored automatically. Its content is preserved in a hidden backup (".${fileName}.dgtmp") in the same folder — check the note in Obsidian.`;

// Vault-ACCESS-LOSS scan errors persist instead of auto-dismissing: they are
// the user's only signal (native reads used to fail silently — the #1461
// contract made them throw these) and each names its own fix. Matched against
// the bridge messages: Android's SecurityException "Vault access has been
// revoked — re-select the vault folder in Settings" (ObsidianRepository
// .getAllDailyNotes) and iOS's "vault access failed — the stored folder
// bookmark could not be opened" (ObsidianBridge.getAllDailyNotes).
export const isVaultAccessLossError = (message) =>
  /revoked|bookmark could not be opened/i.test(message || '');

export default function useObsidianSync({
  isTrayMode, dataLoaded,
  tasks, setTasks,
  unscheduledTasks, setUnscheduledTasks,
  setDailyNotes,
  setWikilinkCandidates,
  setUnportableVaultFiles,
  obsidianConfig, setObsidianConfig,
  obsidianLaunchOnWrite,
  obsidianCompletionDates,
  obsidianSyncError,
  setObsidianSyncStatus, setObsidianSyncError, setObsidianLastSynced,
  setObsidianSyncNotice,
  obsidianVaultHandleRef, obsidianSyncInProgressRef, obsidianPrevTaskStateRef,
  obsidianTasksRef, obsidianInboxRef,
  recycleBin, setRecycleBin,
  // The sidebar's completion actions (companion spec 4.2) apply to recurring
  // templates too; optional so existing harnesses need no change.
  recurringTasks = [], setRecurringTasks = null,
  // Multi-user changes which imported rows the sync payload excludes, and
  // therefore which ones the calendar projection carries.
  multiUserEnabled = false,
}) {
  // Fresh bin contents for the async sync cycle (same staleness fix as the
  // task refs above — interval-triggered syncs must not see the closure's
  // render-time copy).
  const recycleBinRef = useRef(recycleBin);
  recycleBinRef.current = recycleBin;
  const recurringTasksRef = useRef(recurringTasks);
  recurringTasksRef.current = recurringTasks;
  // Callbacks for reading/writing linked wiki notes from the vault
  const loadWikiNote = useCallback(async (noteName) => {
    const handle = obsidianVaultHandleRef.current;
    if (!handle) return null;
    // Strip [[Note#Heading]] fragment — we load the whole note file, not just a section
    const notePath = noteName.split('#')[0].trim();
    if (handle === 'native') {
      const res = nativeGetNote(notePath);
      // readFailed = the note exists (or may exist) but could not be read —
      // fail closed: never offer a create editor whose save overwrites it.
      if (res?.readFailed) return null;
      // null = reported absence (both bridges return "" only after looking),
      // so it is creatable. The residual: "" also covers an unconfigured
      // vault, where a create attempt fails VISIBLY through nativeWriteNote's
      // false return — fail-annoying, never data loss.
      return res === null ? { notFound: true } : res;
    }
    try {
      const note = await readWikiNote(handle, notePath);
      // readWikiNote returns null EXACTLY when the note is absent (NotFound
      // on the path walk / whole-vault search) and throws on real failures,
      // so null is proven absence: report it as creatable, not as an error.
      // The linked-note panel turns notFound into an empty editor whose save
      // creates the note (saveWikiNote's creation path, newNotesFolder).
      return note === null ? { notFound: true } : note;
    } catch (err) {
      console.error('Failed to read wiki note:', err);
      return null;
    }
  }, [obsidianVaultHandleRef]);

  const saveWikiNote = useCallback(async (noteName, content) => {
    const handle = obsidianVaultHandleRef.current;
    if (!handle) return;
    // Strip [[Note#Heading]] fragment for write path too
    const notePath = noteName.split('#')[0].trim();
    // Bridge stream (Phase 6): the same write as a semantic intent, applied
    // by the plugin to any paired vault copy. Convergent with the direct
    // write below — applyBridgeIntent enforces the same creation-only
    // portability gate and frontmatter rule, so a name refused here is
    // refused there too.
    const queued = emitBridgeIntent('wiki_note_write', {
      noteName: notePath, content, newNotesFolder: obsidianConfig?.newNotesFolder ?? 'dayGLANCE',
    });
    // Arbitration (§3.2): plugin authoritative → the intent IS the write;
    // a failed enqueue surfaces through the same visible error state the
    // direct branches use (never a silent write loss).
    if (bridgeHeartbeatRef.current.pluginAuthoritative) {
      if (!queued) {
        setObsidianSyncError(`Note "${notePath}" was not written: the bridge queue is unavailable.`);
        setObsidianSyncStatus('error');
      }
      return;
    }
    // Portability gate on CREATION ONLY (see writeWikiNote): the existence
    // check runs before the validator, so a note that already exists is
    // written whatever its name — the harm is in creating NEW unportable
    // names, and refusing writes to existing files would strand the task in a
    // permanent error state. Refusals surface through the same visible
    // sync-error state performObsidianSync uses; the old console.error was a
    // silent write loss the user could never see.
    if (handle === 'native') {
      // Android: same ordering — only validate when the note doesn't exist yet.
      const existing = await Promise.resolve(nativeGetNote(notePath)).catch(() => ({ readFailed: true }));
      // A FAILED existence read refuses the write outright: before the
      // readFailed sentinel this fell into the "existing" arm (no frontmatter,
      // content written as-is) — or worse, with the old collapsed null, into
      // the CREATION arm, decorating and overwriting a note that exists but
      // couldn't be read.
      if (existing?.readFailed) {
        setObsidianSyncError(`Note "${notePath}" was not written: the note could not be read to verify whether it already exists.`);
        setObsidianSyncStatus('error');
        return;
      }
      if (!existing) {
        const reason = validateWikiNoteName(notePath);
        if (reason) {
          setObsidianSyncError(`Note "${notePath}" was not written: ${reason}. Edit the [[wikilink]] in the task title.`);
          setObsidianSyncStatus('error');
          return;
        }
      }
      // Frontmatter on CREATION only — mirrors writeWikiNote's desktop
      // branch (utils/obsidianFrontmatter.js): a note dayGLANCE brings into
      // being gets the minimal queryable block; an existing note is never
      // decorated.
      const finalContent = existing ? content : withCreationFrontmatter(content);
      // Honor the bridge's write result, surfacing failure through the same
      // visible sync-error state the desktop branch below uses — a silently
      // ignored false return here was exactly the "silent write loss the user
      // could never see" this comment block already warns about.
      if (!nativeWriteNote(notePath, finalContent)) {
        setObsidianSyncError(`Note "${notePath}" was not written: the vault write failed.`);
        setObsidianSyncStatus('error');
      }
      return;
    }
    try {
      await writeWikiNote(handle, notePath, content, obsidianConfig?.newNotesFolder ?? 'dayGLANCE');
    } catch (err) {
      console.error('Failed to write wiki note:', err);
      setObsidianSyncError(err.code === 'unportable_name' && err.reason
        ? `Note "${notePath}" was not written: ${err.reason}. Edit the [[wikilink]] in the task title.`
        : err.message);
      setObsidianSyncStatus('error');
    }
  }, [obsidianConfig?.newNotesFolder, obsidianVaultHandleRef, setObsidianSyncError, setObsidianSyncStatus]);

  // ── Task-write / restore failure surfacing ────────────────────────────────
  //
  // Task writes fire on every completion, reschedule and title edit, so the
  // shape is a LATCH over the existing sync-error state, not per-failure
  // alerts: the first failure sets the state once; further failures while
  // latched do nothing (ten failed writes during an outage = one transition);
  // and the error PERSISTS (no auto-dismiss) — the red sync-dot is the
  // signal. Clearing: the next CONFIRMED task write (only when the displayed
  // error is still ours — a concurrent wiki-note error must never be
  // stomped), or the next successful scan (performObsidianSync's success path
  // resets the channel wholesale, as it always has).

  // Mirror of the displayed error, so the exact-match clears below can tell
  // "our message is still showing" from "something else took the channel".
  const syncErrorValueRef = useRef(obsidianSyncError);
  useEffect(() => { syncErrorValueRef.current = obsidianSyncError; }, [obsidianSyncError]);

  const taskWriteErrorRef = useRef(null); // the message we latched, or null
  const restoreErrorRef = useRef(null);   // ditto, for a failed note restore
  // Audit fix M1: set when the writeback effect fires DURING a sync cycle
  // and is skipped by the in-progress guard — a task change landing in that
  // window (cycles last ≥2s and are triggered by the visibility flip that
  // coincides with the user returning to click something) used to wait for
  // the next unrelated task change to be written. The cycle's finally reads
  // this and pokes one writeback pass; a pass with nothing to diff is a
  // no-op, so the poke can never loop.
  const writebackPendingRef = useRef(false);

  // ── Tasks-plugin detection (completion-marker format) ─────────────────────
  // Vault-level: is the Obsidian Tasks plugin enabled? Decides the marker
  // format (✅ date vs [completed:: …] Dataview field) at WRITE TIME only —
  // historical lines are never rewritten for a detection change (they adopt
  // the current format the next time their task changes anyway). Refreshed on
  // every sync cycle; persisted so the first write after an app start uses
  // the last known answer instead of flapping the format. Default false →
  // the Dataview field, the safe direction when nothing is known.
  const tasksPluginRef = useRef((() => {
    try { return localStorage.getItem('day-planner-obsidian-tasks-plugin') === 'true'; }
    catch { return false; }
  })());
  // ── Bridge-plugin heartbeat (Phase 5 arbitration plumbing) ────────────────
  // Refreshed once per sync cycle. In Phase 5 NOTHING acts on it here —
  // `paired` is always false, so pluginAuthoritative never fires; the wiring
  // exists so Phase 6 only changes the decision (gate direct writes on
  // pluginAuthoritative), not the plumbing. Launch-on-write suppression does
  // NOT read this ref: the platform layers that own the launches (Electron
  // main, Android ObsidianRepository) do their own freshness reads at
  // fire/arm time, where the answer is current rather than up to a scan old.
  const bridgeHeartbeatRef = useRef({ obsidianRunning: false, pluginAuthoritative: false });
  const refreshBridgeHeartbeat = async (handle) => {
    try {
      const hb = handle === 'native' ? readVaultHeartbeatNative() : await readVaultHeartbeat(handle);
      bridgeHeartbeatRef.current = obsidianHeartbeatState(hb);
    } catch { /* a liveness probe must never fail a sync */ }
  };

  const refreshTasksPluginDetection = async (handle) => {
    try {
      const detected = handle === 'native'
        ? detectTasksPluginNative()
        : await vaultHasTasksPlugin(handle);
      // null = could not determine (old native shell / failed read): keep the
      // last known value rather than flapping the format.
      if (detected === true || detected === false) {
        tasksPluginRef.current = detected;
        try { localStorage.setItem('day-planner-obsidian-tasks-plugin', String(detected)); } catch { /* ignore */ }
      }
    } catch { /* detection must never fail a sync */ }
  };

  const reportTaskWriteFailure = useCallback(() => {
    if (taskWriteErrorRef.current) return; // latched
    taskWriteErrorRef.current = OBSIDIAN_TASK_WRITE_ERROR;
    setObsidianSyncError(OBSIDIAN_TASK_WRITE_ERROR);
    setObsidianSyncStatus('error');
  }, [setObsidianSyncError, setObsidianSyncStatus]);

  const reportTaskWriteSuccess = useCallback(() => {
    const ours = taskWriteErrorRef.current;
    if (!ours) return;
    taskWriteErrorRef.current = null;
    if (syncErrorValueRef.current === ours) {
      setObsidianSyncError(null);
      setObsidianSyncStatus('idle');
    }
  }, [setObsidianSyncError, setObsidianSyncStatus]);

  // Android's crash-safe writes push restore outcomes up through this window
  // hook (ObsidianBridge wires ObsidianRepository.onRestoreEvent to it).
  // 'failed' = a note is missing from the vault and the restore didn't take —
  // materially different from a failed write, hence its own message; a later
  // 'restored' (every vault touch retries) clears it. Successful SILENT
  // restores never reach here as errors — nothing to tell the user about a
  // note that contains exactly what they last wrote.
  useEffect(() => {
    if (isTrayMode || typeof window === 'undefined') return undefined;
    window.__dgVaultRestoreEvent = (outcome, fileName) => {
      if (outcome === 'failed') {
        if (restoreErrorRef.current) return; // latched — one indicator
        const msg = obsidianRestoreFailureMessage(fileName);
        restoreErrorRef.current = msg;
        setObsidianSyncError(msg);
        setObsidianSyncStatus('error');
      } else if (outcome === 'restored') {
        const ours = restoreErrorRef.current;
        if (!ours) return;
        restoreErrorRef.current = null;
        if (syncErrorValueRef.current === ours) {
          setObsidianSyncError(null);
          setObsidianSyncStatus('idle');
        }
      }
    };
    return () => { delete window.__dgVaultRestoreEvent; };
  }, [isTrayMode, setObsidianSyncError, setObsidianSyncStatus]);

  // Opens a vault note in the Obsidian app (Android) or via obsidian:// URI (web/desktop).
  const openInObsidian = useCallback((noteName) => {
    const handle = obsidianVaultHandleRef.current;
    if (!handle) return;
    if (handle === 'native') {
      nativeOpenNote(noteName);
      return;
    }
    // Electron: hand the note name to the main process, which builds the
    // obsidian:// URL and opens it. The renderer's own window.open() below never
    // works here — setWindowOpenHandler routes it to openExternalSafe, which
    // only permits http/https — and `handle` is the shim from
    // obsidianElectronHandle.js, whose name is the placeholder 'vault' rather
    // than the real folder name. The main process has both capabilities.
    if (window.electronAPI?.obsidian?.openNote) {
      window.electronAPI.obsidian.openNote(noteName);
      return;
    }
    // Web: construct obsidian:// deep link using the vault folder name
    const vaultName = handle.name;
    if (vaultName) {
      window.open(
        `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(noteName)}`,
        '_blank',
      );
    }
  }, [obsidianVaultHandleRef]);

  // Signal the native Android side that the app is interactive and the initial
  // Obsidian sync has completed. This releases the splash screen that was held
  // to hide the blocking sync freeze. Only fires once per session.
  const nativeReadyNotifiedRef = useRef(false);
  const notifyNativeReady = useCallback(() => {
    if (!isNativeAndroid()) return;
    if (nativeReadyNotifiedRef.current) return;
    nativeReadyNotifiedRef.current = true;
    try { window.DayGlanceNative?.notifyAppReady?.(); } catch {}
  }, []);

  // The shared tail of a successful sync cycle — direct scan or bridge
  // inbound, one finish: last-synced stamps, the one-shot title-conflict
  // notice, and the error-channel resets. A successful cycle of EITHER kind
  // proves the pipeline is healthy, so the task-write latch clears here in
  // both modes — which is exactly how a latch set in direct mode carries
  // over a pairing flip and still clears (the channel is shared; only the
  // proof changed from "scan completed" to "bridge cycle completed").
  const finishObsidianCycle = async (syncStart, titleConflicts, binRestores = []) => {
    const elapsed = Date.now() - syncStart;
    if (elapsed < 2000) await new Promise(r => setTimeout(r, 2000 - elapsed));
    const now = new Date().toISOString();
    setObsidianLastSynced(now);
    localStorage.setItem('day-planner-obsidian-last-synced', now);
    // Fire-and-forget notices: neutral, never red, never latched,
    // auto-dismissing. The durable record is already on each task's notes —
    // the toast is only the immediate half (§3.10 ruling 5, #1465 pattern).
    const notices = [];
    if (titleConflicts.length) {
      notices.push(titleConflicts.length === 1
        ? titleConflictNoticeText(titleConflicts[0].vaultTitle)
        : `${titleConflicts.length} title conflicts: Obsidian's edits won. Your dayGLANCE renames are saved in each task's notes.`);
    }
    if (binRestores.length) notices.push(binRestoreNoticeText(binRestores));
    if (notices.length && setObsidianSyncNotice) {
      setObsidianSyncNotice(notices.join(' '));
      setTimeout(() => setObsidianSyncNotice(null), 8000);
    }
    // A successful cycle proves the vault pipeline is healthy again — the
    // channel reset clears any latched task-write error (clearing path 2).
    taskWriteErrorRef.current = null;
    if (restoreErrorRef.current) {
      // …but a MISSING-NOTE condition outlives a successful cycle (it
      // legitimately completes without the missing file). Keep it showing;
      // it clears on the 'restored' event when a retry lands.
      setObsidianSyncError(restoreErrorRef.current);
      setObsidianSyncStatus('error');
    } else {
      setObsidianSyncError(null);
      setObsidianSyncStatus('success');
      setTimeout(() => setObsidianSyncStatus(s => s === 'success' ? 'idle' : s), 3000);
    }
  };

  // Obsidian vault sync — reads daily notes + imports tasks
  const performObsidianSync = async () => {
    if (obsidianSyncInProgressRef.current) return;
    // No vault handle — a failed startup restore (unmounted drive, sleeping
    // network share, stale macOS bookmark) or an expired browser permission.
    // Re-acquire it here: this runs on EVERY sync trigger — the 5-minute poll,
    // the visibility-change handler (neither is gated on a handle anymore),
    // and the manual Sync Now button — so a vault that comes back reachable
    // reconnects on the next tick without user action. On Electron this is one
    // obsidian:restore IPC ending in one fs access check; in the browser, a
    // button click can prompt for permission, while a timer/visibility caller
    // without a user gesture silently gets null. Null → skip, silently: a
    // still-missing vault must not produce an error state once per poll.
    if (!obsidianVaultHandleRef.current) {
      try {
        const handle = await getVaultAccess();
        if (!handle) return;
        obsidianVaultHandleRef.current = handle;
        scanVaultNotes(handle).then(({ names, unportable }) => { setWikilinkCandidates(names); setUnportableVaultFiles?.(unportable); }).catch(() => {});
      } catch {
        return;
      }
    }
    obsidianSyncInProgressRef.current = true;
    // Set by the plugin branch when stampable (untagged) tasks exist after a
    // merge: the writeback effect run that merge triggers is skipped by the
    // in-progress guard above it, so the finally below re-triggers ONE pass
    // once the guard is down. See "STAMP ON SIGHT" in the plugin branch.
    let nudgeWriteback = false;
    const syncStart = Date.now();
    setObsidianSyncStatus('syncing');

    try {
      const isNative = obsidianVaultHandleRef.current === 'native';
      // Use refs so interval-triggered syncs always see the latest task state,
      // not the stale closure from when the interval was set up.
      const currentTasks = obsidianTasksRef.current;
      const currentInbox = obsidianInboxRef.current;
      // The Obsidian scan window is FIXED (OBSIDIAN_IMPORT_WINDOW_DAYS), decoupled
      // from the calendar "Keep past events" retention (syncRetentionDays) — that
      // setting is about imported calendar events, not the vault. See obsidian.js.
      // Two-sided retitle resolutions this scan performed (vault won the
      // title; the DG rename was preserved in task.notes). Collected for ONE
      // fire-and-forget notice below — a conflict is a one-shot event, not a
      // persisting condition, so it never touches the error latch.
      const titleConflicts = [];
      const onTitleConflict = (c) => titleConflicts.push(c);
      // Bin-versus-vault restores this cycle performed (§3.10 ruling 5) —
      // same one-shot toast channel as title conflicts; the durable record
      // is on each task's notes.
      const binRestores = [];
      // Refresh the completion-marker format detection and the bridge
      // heartbeat once per cycle (cheap: two small dotfile reads; never
      // fail the sync).
      await refreshTasksPluginDetection(obsidianVaultHandleRef.current);
      await refreshBridgeHeartbeat(obsidianVaultHandleRef.current);
      // App-only fields that live in dayGLANCE but NOT in the Obsidian markdown,
      // so a re-parse (parseTasksFromMarkdown) can't reproduce them. They must be
      // carried over from the existing in-memory copy or every cold-open re-sync
      // silently wipes them — which for `archived`/`completedAt` on a completed
      // task looked like a phantom change and re-stamped lastModified every load
      // (the DB-sync push churn). Only carry a value that is actually present so we
      // never inject undefined keys. Shared by BOTH inbound sources below —
      // an observed note carries exactly what a scanned one does.
      //
      // completedAt now ALSO arrives from the vault (the parse absorbs a
      // completion marker on tagged lines), and the carry below doubles as the
      // merge rule the completion-timestamp feature settled on — APP WINS WHEN
      // IT HAS A VALUE; THE VAULT MARKER FILLS THE BLANK: a title is
      // user-authored content, so the vault is ground truth for titles — but a
      // completion timestamp is dayGLANCE's own record of an action dayGLANCE
      // performed, and the vault marker is an echo of it. Letting a stale echo
      // overwrite the source would be backwards. The adoption case — vault has
      // a marker, app has none (old.completedAt undefined) — isn't a conflict
      // at all; it's importing data we lack, and the spread leaves the parsed
      // value in place exactly there. An explicit null (the app uncompleted
      // the task) is the app's statement and still wins.
      // `scanned` (the task the scan produced) guards the deadline carry:
      // since Step 2, deadline is line-derived too — the scan merge carries
      // the app value forward itself and the per-field adoption may have
      // deliberately replaced it with the vault's edit, so this layer only
      // fills a deadline the scan produced NOTHING for.
      const preserveObsidianAppFields = (old, scanned = {}) => ({
        ...(old.projectId ? { projectId: old.projectId } : {}),
        ...(old.deadline && scanned.deadline === undefined ? { deadline: old.deadline } : {}),
        ...(old.archived !== undefined ? { archived: old.archived } : {}),
        ...(old.completedAt !== undefined ? { completedAt: old.completedAt } : {}),
        // assignedUserSyncIds is an app-only synced field (user assignment) that
        // the markdown re-parse can't reproduce; without this an assigned Obsidian
        // task drops it on every re-scan → the same per-cycle false-diff/re-push.
        ...(old.assignedUserSyncIds !== undefined ? { assignedUserSyncIds: old.assignedUserSyncIds } : {}),
      });

      // ── ARBITRATION (§3.2, Phase 6 PR 3) ────────────────────────────────
      // A fresh AND paired heartbeat means the plugin owns THIS vault copy:
      // this device stops scanning and writing directly, and its inbound
      // source becomes the observation stream — one inbound source per
      // device, never both, so the stream and the scan can't churn against
      // each other. Authority is re-evaluated every cycle from the
      // heartbeat just refreshed above; a stale heartbeat (Obsidian closed,
      // plugin disabled, unpaired) reverts to direct on the next cycle —
      // §3.3's one revert path.
      const authoritative = bridgeHeartbeatRef.current.pluginAuthoritative;

      // ── SIDEBAR ACTIONS (companion spec 4.2) ────────────────────────────
      // The plugin's agenda view completes a task by emitting an `act:` row;
      // dayGLANCE — the single data-plane writer — applies it here through
      // the ordinary setters, so the completion log, the vault writeback and
      // DB sync all see a completion made in the app. Runs in BOTH
      // arbitration modes: the row was written by a paired plugin, but the
      // Obsidian that wrote it may be a phone that has since gone to sleep,
      // leaving this device's heartbeat stale. Unknown targets are held
      // (the cursor stops below them); consumed rows are deleted.
      try {
        const fetchedActions = await fetchBridgeActions();
        if (fetchedActions) {
          const plan = planBridgeActions(fetchedActions.actions, {
            tasks: currentTasks, unscheduledTasks: currentInbox, recurringTasks: recurringTasksRef.current,
          });
          if (plan.apply.length) {
            setTasks(prev => applyActionsToTasks(prev, plan.apply));
            setUnscheduledTasks(prev => applyActionsToTasks(prev, plan.apply));
            if (setRecurringTasks) setRecurringTasks(prev => applyActionsToRecurring(prev, plan.apply));
            console.info('[Obsidian] sidebar completion action(s) applied:',
              plan.apply.map(a => a.templateId ? `${a.templateId}@${a.instanceDate}` : a.taskId).join(', '));
          }
          if (plan.hold.length) {
            console.info('[Obsidian] sidebar action(s) held (target not on this device yet):', plan.hold.map(a => a.actionId).join(', '));
          }
          await deleteBridgeActions([...plan.apply, ...plan.stale]);
          commitBridgeActionCursor(fetchedActions.maxSeq, plan.hold);
        }
      } catch (e) {
        console.warn('[Obsidian] sidebar action pass failed (retried next cycle):', e);
      }

      // ── CALENDAR PROJECTION (companion spec 4.2) ────────────────────────
      // Read-only calendar events never sync (payloadExclusions.js), so the
      // plugin's mirror cannot show them. Publish this device's view of them
      // for the sidebar's window as one upserted row; the publish guard
      // inside skips an unchanged calendar, and the daily window slide
      // republishes at least once a day. Paired-gated and fail-silent inside.
      try {
        const projection = buildCalendarProjection(currentTasks, {
          today: dateToString(new Date()), deviceId: getDeviceId(), multiUserEnabled,
        });
        void publishBridgeCalendarProjection(projection, calendarProjectionHash(projection));
      } catch (e) {
        console.warn('[Obsidian] calendar projection build failed:', e);
      }

      // Gate (b), as amended: a direct→plugin transition ARCHIVES the
      // detector baseline (stamped with the transition time); both
      // directions clear the live one — see utils/obsidianBridgeMode.js,
      // and the reconcile in the direct branch below.
      recordBridgeMode(authoritative ? 'plugin' : 'direct');
      // Bridge stream (Phase 6): once per cycle, refresh the pairing-meta
      // discovery (it also gates the emit sites), retry anything the emit
      // sites left queued, and (re)publish the config row the plugin's
      // observation scope reads. All fail-silent and paired-gated inside —
      // on an unpaired vault they are no-ops. FORCED past the cache TTL
      // while authoritative: on the authority rising edge a stale NEGATIVE
      // cache (written by the last pre-pairing cycle) would otherwise gate
      // emits off for up to a TTL while direct writes are already stopped —
      // a systematic silent-drop window after every pairing. While
      // authoritative the meta is load-bearing for every write, so the
      // per-cycle refresh is the honest cadence.
      void getBridgePairingMeta({ force: authoritative }).then(() => flushBridgeOutbox());
      void publishBridgeConfig({
        dailyNotesPath: obsidianConfig?.dailyNotesPath || '',
        dailyNotePattern: obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd',
        taskHeading: obsidianConfig?.taskHeading || '## Tasks',
        // Carries the §3.9 block-id write release to the plugin, which gates
        // normalize-then-observe (§3.10 ruling 7) on it — see
        // publishBridgeConfig. Read fresh each cycle so a release flip
        // reaches the plugin within one config republish.
        blockIdWrites: blockIdWritesEnabled(),
      });

      // Deletion tombstones apply to BOTH inbound sources (they record
      // past observed deletions; honoring them is not detecting new ones).
      let tombstones = {};
      try { tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-obsidian-keys') || '{}'); } catch { tombstones = {}; }

      if (authoritative) {
        // ── Plugin-mode inbound: apply the observation stream ───────────
        // Observations flow through the SAME per-note pipeline as a scan
        // (utils/obsidianBridgeInbound.js), then through the same merge
        // helpers. The VAULT-WIDE deletion detector does NOT run —
        // observations can never establish scan completeness — but each
        // observation IS complete at the grain of its one note, so
        // NOTE-SCOPED deletion inference runs below instead
        // (utils/obsidianNoteScopedDeletions.js): a task claiming to live
        // in an observed note whose parse no longer carries its id or hint
        // is tombstoned through the existing deletedObsidianKeys LWW
        // channel, stamped at the observation's mtime, after the WALL-CLOCK
        // confirmation hold (≥90s of continuous absence plus a subsequent
        // complete fetch — never a cycle count; see the util's header for
        // the 2026-08-31 lesson). What remains conservative: notes never
        // observed while paired still report nothing (§3.10 availability
        // note, as amended).
        // The cursor commits only after the merges are dispatched, so a
        // crash mid-cycle replays the batch — application is idempotent.
        const fetched = await fetchBridgeObservations();
        if (fetched) {
          const applied = fetched.observations.length
            ? applyBridgeObservations(fetched.observations, {
                existingTasks: currentTasks,
                existingInbox: currentInbox,
                dailyNotesPath: obsidianConfig?.dailyNotesPath || '',
                dailyNotePattern: obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd',
                onTitleConflict,
              })
            : null;

          // NOTE-SCOPED DELETION INFERENCE (see the util's header for the
          // full rules). Runs on EVERY successful fetch — an empty fetch is
          // still complete knowledge that no pended id reappeared, so it
          // confirms the hold. Tombstones extend BEFORE the merges so a
          // commit drops its task this cycle, and they are stamped with the
          // observation's file mtime, never "now" — an app edit newer than
          // the note beats them under the channel's existing LWW rule.
          const batchScannedIds = applied ? applied.scannedIds : new Set();
          // THE CONTINUITY GUARD (audit fix C1 — rationale in the util's
          // header): the store carries when reconcile last ran; a gap beyond
          // the bound (app closed, mode flipped, plugin gone, re-pair)
          // restarts every pending clock, because "90s of absence" is only
          // evidence while something was watching. Without this, the first
          // fetch after a days-long discontinuity committed stale entries
          // as deletions of live tasks.
          const pendingStore = readPendingNoteDeletions();
          const pendingNoteDeletions = applyPendingContinuityGuard(pendingStore.entries, pendingStore.touchedAt);
          const liveObsidianIds = new Set(
            [...currentTasks, ...currentInbox].filter(t => t?.importSource === 'obsidian').map(t => String(t.id)));
          const candidates = applied
            ? inferNoteScopedDeletionCandidates({
                observedNotes: applied.dailyNotes,
                scannedIds: batchScannedIds,
                tasks: currentTasks,
                inbox: currentInbox,
              })
            : [];
          const { commits, nextPending } = reconcileNoteScopedDeletions({
            pending: pendingNoteDeletions,
            candidates,
            scannedIds: batchScannedIds,
            liveIds: liveObsidianIds,
          });
          if (commits.length) {
            for (const c of commits) tombstones = addObsidianTombstones(tombstones, [c.id], c.deletedAt);
            localStorage.setItem('day-planner-deleted-obsidian-keys', JSON.stringify(tombstones));
            // Loud on purpose: a deletion inference is the one action here
            // that removes user-visible data, and its evidence should be on
            // the record when it runs.
            console.warn(
              `Obsidian: ${commits.length} task line(s) confirmed removed from observed note(s) — tombstoning (LWW, stamped at note mtime):`,
              commits.map(c => `${c.id} [note ${c.noteDate}, mtime ${c.deletedAt}]`).join('; '));
          }
          if (candidates.length) {
            console.log('Obsidian: note-scoped deletion candidates pending wall-clock confirmation (>=90s + a subsequent fetch):',
              candidates.map(c => `${c.id} [note ${c.noteDate}]`).join('; '));
          }
          writePendingNoteDeletions(nextPending);

          if (applied) {
            // BIN-VERSUS-VAULT (§3.10 ruling 5): an observed line whose task
            // sits in the recycle bin restores it, visibly. In plugin mode
            // this fires when the note is next OBSERVED — observations are
            // per-changed-note, so a binned task whose note never changes
            // waits for the next direct-mode scan (the same availability
            // bound as deletion detection; §3.10's availability note).
            const binRestore = restoreBinnedVaultTasks({
              recycleBin: recycleBinRef.current,
              scheduledTasks: applied.scheduledTasks,
              inboxTasks: applied.inboxTasks,
              liveIds: liveObsidianIds, // the live-copy guard (ruling 5 correction)
            });
            if ((binRestore.restored.length || binRestore.superseded.length) && setRecycleBin) {
              const dropIds = new Set([...binRestore.restored, ...binRestore.superseded].map(r => r.id));
              setRecycleBin(prev => (prev || []).filter(t => !dropIds.has(String(t.id))));
              binRestores.push(...binRestore.restored);
              if (binRestore.superseded.length) {
                console.info('[Obsidian] bin entries superseded by a live copy of the same task (dropped, not restored):',
                  binRestore.superseded.map(s => `${s.id} "${s.title}"`));
              }
            }
            setDailyNotes(prev => mergeObsidianDailyNotes(prev, applied.dailyNotes, tombstones));
            // The observed notes' mtimes are the revival evidence (§3.10
            // ruling 6): a scanned line whose tombstone predates its note's
            // mtime is re-admitted with lastModified lifted to that mtime.
            const observedNoteMtimes = noteMtimesFromDailyNotes(applied.dailyNotes);
            setTasks(prev => mergeObsidianTasks(prev, binRestore.scheduledTasks, applied.scannedIds, preserveObsidianAppFields, tombstones, observedNoteMtimes));
            setUnscheduledTasks(prev => mergeObsidianTasks(prev, binRestore.inboxTasks, applied.scannedIds, preserveObsidianAppFields, tombstones, observedNoteMtimes));
            // Refresh the writeback snapshot for the OBSERVED tasks only —
            // observations are per-note, so untouched entries stay put.
            // This is also how this device's own emitted writes settle
            // their bookkeeping: the plugin applies the intent, the file
            // comes back as an observation, and the existing adoption
            // machinery (title ownership, ^dg- identity) absorbs it exactly
            // like another device's write.
            const snap = obsidianPrevTaskStateRef.current;
            for (const t of [...binRestore.scheduledTasks, ...binRestore.inboxTasks]) {
              // A line whose time differs from DG's is recorded with the
              // LINE's time, so the writeback enforces DG's (see the helper).
              snap[t.id] = writebackSnapshotEntry(t, applied.lineSchedule);
            }
            // STAMP ON SIGHT (spec §3.10, identity-versus-content): an
            // imported untagged line should acquire its ^dg- identity on
            // first import, not on its next edit — the stamp is emitted by
            // the writeback effect (the ONE emit site, so gate (a)'s
            // commit-on-enqueue rule rides unchanged), but that effect's
            // run for THIS merge is skipped by the sync-in-progress guard
            // and would otherwise wait for an arbitrary later task change.
            // Nudge one writeback pass after the cycle ends (the finally
            // below) whenever stampable tasks exist. Self-limiting: once
            // stamped, nothing here matches and the nudge stops firing.
            if (blockIdWritesEnabled()
              && [...binRestore.scheduledTasks, ...binRestore.inboxTasks, ...currentTasks, ...currentInbox]
                .some(t => t?.importSource === 'obsidian' && t.obsidianRawTitle && !t.obsidianBlockId)) {
              nudgeWriteback = true;
            }
          } else if (commits.length) {
            // No observations this batch, but the hold just confirmed
            // deletions — apply the tombstones to state now rather than on
            // the next row-bearing merge. An empty scanned set retains
            // everything except the newly tombstoned.
            setTasks(prev => mergeObsidianTasks(prev, [], new Set(), preserveObsidianAppFields, tombstones));
            setUnscheduledTasks(prev => mergeObsidianTasks(prev, [], new Set(), preserveObsidianAppFields, tombstones));
          }
          if (fetched.maxSeq) commitBridgeObservationCursor(fetched.maxSeq);
        }
        await finishObsidianCycle(syncStart, titleConflicts, binRestores);
        return;
      }

      const result = isNative
        ? await syncObsidianVaultNative(
            obsidianConfig?.dailyNotesPath || '',
            OBSIDIAN_IMPORT_WINDOW_DAYS,
            currentTasks,
            currentInbox,
            onTitleConflict,
          )
        : await syncObsidianVault(
            obsidianVaultHandleRef.current,
            obsidianConfig?.dailyNotesPath || '',
            OBSIDIAN_IMPORT_WINDOW_DAYS,
            currentTasks,
            currentInbox,
            obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd',
            onTitleConflict,
          );

      // A successful DIRECT scan clears the note-scoped deletion pending set
      // (audit fix C1, second closure — rationale in the util's header): a
      // vault-wide scan is strictly stronger evidence than any observation
      // batch. Every pended id the scan finds is rescued by definition, and
      // every id it doesn't find is the vault-wide detector's jurisdiction
      // (below), with its own completeness guards and channel. Dropping the
      // entries is conservative — they re-infer from fresh evidence if
      // plugin mode resumes with the line still gone.
      try { localStorage.removeItem(PENDING_NOTE_DELETIONS_KEY); } catch { /* storage unavailable */ }

      // Keys this device's scan produced: daily-note dates + task ids (across BOTH
      // task lists, so a task that moved scheduled↔inbox counts as scanned and
      // isn't retained as a stale duplicate in the list it left).
      const allScannedTasks = [...result.scheduledTasks, ...result.inboxTasks];
      const scannedObsidianIds = new Set([
        ...allScannedTasks.map(t => String(t.id)),
        // Transition bridge (Phase 2): a ^dg- tagged line also "accounts for"
        // the content-derived id it would have had untagged. Including the
        // hint means the old id of a freshly-stamped line is neither retained
        // as a ghost copy (mergeObsidianTasks treats it as scanned) nor
        // reported to the deletion detector as missing — a rename is not a
        // deletion, and a burst of stampings must not trip the detector's
        // incomplete-scan threshold.
        ...allScannedTasks.filter(t => t.obsidianLegacyId).map(t => String(t.obsidianLegacyId)),
      ]);
      const scannedKeys = [...Object.keys(result.dailyNotes), ...scannedObsidianIds];
      // Dates for block-id task keys (obsidian-dg-…), which — unlike legacy
      // ids — carry no date of their own. The deletion detector needs a date
      // to tell "aged out of the scan window" from "deleted"; without one it
      // conservatively never tombstones, which would silently break deletion
      // propagation for every tagged task. A tagged task is visible exactly
      // while its daily note is in the window, so the note's date is the
      // honest answer.
      const scannedKeyDates = {};
      for (const t of allScannedTasks) {
        if (t.obsidianBlockId && t.obsidianFileDate) scannedKeyDates[String(t.id)] = t.obsidianFileDate;
      }

      // Option 1 — DELETION DETECTION (conservative). Diff this device's current
      // scan against what it scanned last time; keys it previously saw and no
      // longer sees were genuinely removed from the vault → tombstone them (synced,
      // so every device stops re-adding them). Only items THIS device scanned can
      // be reported, and an empty/large-drop scan is treated as incomplete and
      // reports nothing — so a not-yet-downloaded or partial vault can't delete
      // real data. See utils/obsidianDeletions.js. (Tombstones were read
      // above, shared with the plugin-mode branch.)
      let lastScanned = [];
      try { lastScanned = JSON.parse(localStorage.getItem('day-planner-obsidian-last-scanned') || '[]'); } catch { lastScanned = []; }
      // Sidecar of the PREVIOUS scan's key→date map — dates the missing-key
      // check below against the scan the keys actually came from. Absent (first
      // run after upgrade, or cleared storage) every dg key is conservatively
      // excluded from deletion detection for one cycle, exactly like any other
      // undatable key.
      let lastScannedDates = {};
      try { lastScannedDates = JSON.parse(localStorage.getItem('day-planner-obsidian-last-scanned-dates') || '{}'); } catch { lastScannedDates = {}; }
      // The scan only reads notes/tasks within the fixed Obsidian window of today
      // (OBSIDIAN_IMPORT_WINDOW_DAYS, src/obsidian.js), so notes aging out of that
      // window must NOT be mistaken for deletions. Use the SAME helper the scan uses
      // so the two windows can't drift.
      const obsidianCutoff = obsidianWindowCutoffDate(OBSIDIAN_IMPORT_WINDOW_DAYS);
      const { deletions, skipped } = detectObsidianDeletions(lastScanned, scannedKeys, obsidianCutoff, { keyDates: lastScannedDates });
      if (deletions.length) {
        // PROVENANCE (see utils/retiredTaskIds.js): THIS site is the
        // detector-observed vanish. It saw a key disappear and knows NEITHER
        // user intent NOR a successor (an untagged line retitled in the vault
        // is indistinguishable from delete+create by construction), so it
        // writes deletedObsidianKeys — the conservative, LWW-revivable
        // channel — and never retiredTaskIds (commit-that-renames) or
        // deletedTaskIds (user-pressed delete).
        tombstones = addObsidianTombstones(tombstones, deletions, new Date().toISOString());
        localStorage.setItem('day-planner-deleted-obsidian-keys', JSON.stringify(tombstones));
      }
      // Only advance the baseline on a scan we trusted — a skipped (incomplete) scan
      // leaves lastScanned intact so the next clean scan can still catch the delete.
      // The dates sidecar advances with it, in lockstep.
      if (!skipped) {
        localStorage.setItem('day-planner-obsidian-last-scanned', JSON.stringify(scannedKeys));
        localStorage.setItem('day-planner-obsidian-last-scanned-dates', JSON.stringify(scannedKeyDates));
      }

      // ARCHIVE RECONCILE (gate b, amended): if this device spent time in
      // plugin mode, its pre-pairing baseline is waiting in the archive —
      // run the SAME detector against this fresh scan so deletions made in
      // the vault while paired still propagate. The reconcile applies its
      // own guards (window cutoff, empty-scan, drop-too-large → archive
      // kept for the next scan) and its tombstones are stamped with the
      // ARCHIVE time, never now — anything touched since the device
      // entered plugin mode beats them under the existing LWW rule, so a
      // month-late detection can only drop rows untouched since before the
      // paired window. Runs before the merges below so the tombstones
      // apply this cycle.
      const reconciled = reconcileArchivedBaseline(scannedKeys, obsidianCutoff);
      if (reconciled && !reconciled.skipped && reconciled.deletions.length) {
        tombstones = addObsidianTombstones(tombstones, reconciled.deletions, reconciled.archivedAt);
        localStorage.setItem('day-planner-deleted-obsidian-keys', JSON.stringify(tombstones));
      }

      // Update daily notes — MERGE the scan in, don't replace. Replacing deletes
      // any note this device's vault lacks (different vault, shorter retention, or
      // no Obsidian at all), which another device then re-adds → an endless
      // cross-device delete↔re-add loop (measured via [pull] DELETE dailyNotes:… ↔
      // new dailyNotes:…). Merge keeps other devices' dates, carries the prior
      // lastModified forward for unchanged text, and honors deletion tombstones so
      // a genuine vault deletion still propagates. See mergeObsidianDailyNotes.
      setDailyNotes(prev => mergeObsidianDailyNotes(prev, result.dailyNotes, tombstones));

      // BIN-VERSUS-VAULT (§3.10 ruling 5): a scanned line whose task sits in
      // the recycle bin restores it — the vault controls task existence, and
      // this makes the win VISIBLE (notes record + toast) instead of the old
      // silent shape, where the bin copy's fresher delete stamp sent the
      // epoch-stamped re-import back through the cross-list reconciler every
      // cycle (a #1455-class delete/resupply loop). The restored copy rides
      // the scanned slot through the normal merges below.
      const binRestore = restoreBinnedVaultTasks({
        recycleBin: recycleBinRef.current,
        scheduledTasks: result.scheduledTasks,
        inboxTasks: result.inboxTasks,
        // The live-copy guard (ruling 5 correction): ids live in app state,
        // either list, are binned DUPLICATES, never restore candidates.
        liveIds: new Set(
          [...(obsidianTasksRef.current || []), ...(obsidianInboxRef.current || [])]
            .filter(t => t?.importSource === 'obsidian').map(t => String(t.id))),
      });
      if ((binRestore.restored.length || binRestore.superseded.length) && setRecycleBin) {
        const dropIds = new Set([...binRestore.restored, ...binRestore.superseded].map(r => r.id));
        setRecycleBin(prev => (prev || []).filter(t => !dropIds.has(String(t.id))));
        binRestores.push(...binRestore.restored);
        if (binRestore.superseded.length) {
          console.info('[Obsidian] bin entries superseded by a live copy of the same task (dropped, not restored):',
            binRestore.superseded.map(s => `${s.id} "${s.title}"`));
        }
      }

      // Update tasks/inbox — same merge-not-replace + honor-tombstones rule; RETAIN
      // prior Obsidian tasks this scan didn't produce (another device's vault),
      // drop only those with a deletion tombstone. See mergeObsidianTasks.
      // The scanned notes' mtimes carry the revival evidence (§3.10 ruling 6),
      // so a verbatim re-creation revives on a direct scan exactly as it does
      // on an observation.
      const scannedNoteMtimes = noteMtimesFromDailyNotes(result.dailyNotes);
      setTasks(prev => mergeObsidianTasks(prev, binRestore.scheduledTasks, scannedObsidianIds, preserveObsidianAppFields, tombstones, scannedNoteMtimes));
      setUnscheduledTasks(prev => mergeObsidianTasks(prev, binRestore.inboxTasks, scannedObsidianIds, preserveObsidianAppFields, tombstones, scannedNoteMtimes));

      // Snapshot the fresh task state so the writeback effect doesn't re-trigger
      const snapshot = {};
      for (const t of [...binRestore.scheduledTasks, ...binRestore.inboxTasks]) {
        // A line whose time differs from DG's is recorded with the LINE's
        // time, so the writeback enforces DG's (owned-schedule enforcement).
        snapshot[t.id] = writebackSnapshotEntry(t, result.lineSchedule);
      }
      obsidianPrevTaskStateRef.current = snapshot;

      await finishObsidianCycle(syncStart, titleConflicts, binRestores);
    } catch (err) {
      console.error('Obsidian sync error:', err);
      setObsidianSyncError(err.message);
      setObsidianSyncStatus('error');
      // The scan error owns the channel now — release the task-write latch so
      // a later write failure can re-report rather than being swallowed.
      taskWriteErrorRef.current = null;
      // Access-loss errors (revoked SAF grant, dead iOS bookmark — the #1461
      // read contract throws these with the fix in the message) PERSIST: they
      // are the user's only signal and don't heal on their own. Everything
      // else keeps the longstanding transient flash.
      if (!isVaultAccessLossError(err.message)) {
        setTimeout(() => setObsidianSyncStatus(s => s === 'error' ? 'idle' : s), 5000);
      }
    } finally {
      obsidianSyncInProgressRef.current = false;
      // Identity-only poke: re-runs the writeback effect now that the guard
      // is down. Two reasons to fire (audit fix M1 added the second): the
      // plugin-mode stamp nudge (stamp-on-sight acts this cycle instead of
      // riding the next unrelated task change), and a writeback pass the
      // in-progress guard SKIPPED mid-cycle — that pass may carry a user
      // change made during the cycle's ≥2s window, which otherwise stayed
      // unwritten (vault silently stale) until the task list next changed.
      // Content is untouched; a pass with nothing to diff is a no-op, so
      // this cannot loop.
      if (nudgeWriteback || writebackPendingRef.current) {
        // Consume the marker at poke time (the poked pass would clear it
        // anyway; consuming here keeps one skip = one poke even if the
        // effect never runs, e.g. the hook unmounted mid-cycle).
        writebackPendingRef.current = false;
        setTasks(prev => (prev || []).slice());
      }
      notifyNativeReady();
    }
  };

  // ── SSE → OBSIDIAN CYCLE (Phase 7 groundwork) ───────────────────────────
  // Bridge-row writes advance the account seq and already reach this app as
  // /events nudges (useVaultEventStream); this is the missing route from
  // those nudges to the observation-consuming cycle, replacing "wait for
  // the 5-minute poll or a visibility flip" with seconds. PACING, because
  // trigger-speed loops have burned this project twice (#1455 ×2):
  //  • the shared coalescer already debounces micro-bursts (400ms) and
  //    suppresses this device's own write echoes by exact ack identity —
  //    our stamps/intents/config publishes never wake a cycle; the PLUGIN's
  //    writes are peer writes whose nudges we want (its observations);
  //  • a cheap PROBE (pendingBridgeObservations: one list page, prefix
  //    check, no crypto) gates the wake — foreign DB-tier activity costs
  //    one GET and runs no cycle, no merges, no status flash;
  //  • a hard MIN GAP between nudged cycles, trailing-coalesced: nudges
  //    inside the gap collapse into one run at gap end;
  //  • a nudge landing while a cycle is in flight retries after the gap
  //    (performObsidianSync's in-progress guard DROPS overlapping calls, so
  //    without the retry a burst's tail would wait for the poll);
  //  • loop safety by construction: a nudged cycle that finds nothing
  //    performs reads only — no seq advance, no self-nudge; one that emits
  //    writes records its own acks, which the coalescer suppresses.
  // Gated on plugin authority (observations are only consumed while
  // paired-and-fresh; a direct-mode device's inbound is its own scan) and
  // on the enabled flag. The 5-minute poll and visibility flips stay
  // untouched as the correctness floor — SSE here is additive, exactly as
  // it is for the DB drains.
  const OBSIDIAN_NUDGE_MIN_GAP_MS = 5000;
  const obsidianNudgeRef = useRef({ timer: null, lastRunAt: 0 });
  const runNudgedObservationCycle = async () => {
    const st = obsidianNudgeRef.current;
    if (obsidianSyncInProgressRef.current) {
      // A cycle (poll, visibility, manual, or a prior nudge) is mid-flight —
      // it may not consume rows that land after its fetch. Retry after the
      // gap; each retry is one cheap probe until it lands.
      if (!st.timer) {
        st.timer = setTimeout(() => { st.timer = null; void runNudgedObservationCycle(); }, OBSIDIAN_NUDGE_MIN_GAP_MS);
      }
      return;
    }
    st.lastRunAt = Date.now();
    let pending = false;
    try { pending = await pendingBridgeObservations(); } catch { pending = false; }
    if (!pending) return;
    await performObsidianSync();
  };
  const nudgeObsidianObservations = () => {
    if (isTrayMode || !obsidianConfig?.enabled) return;
    if (!bridgeHeartbeatRef.current.pluginAuthoritative) return;
    const st = obsidianNudgeRef.current;
    if (st.timer) return; // a run is already scheduled — coalesce into it
    const wait = Math.max(0, st.lastRunAt + OBSIDIAN_NUDGE_MIN_GAP_MS - Date.now());
    st.timer = setTimeout(() => { st.timer = null; void runNudgedObservationCycle(); }, wait);
  };

  // Obsidian sync: restore vault handle on mount and do initial sync
  useEffect(() => {
    if (isTrayMode || !dataLoaded) return;
    if (isNativeApp()) {
      // Native app: vault is configured natively — detect and auto-enable
      try {
        const cfg = nativeGetVaultConfig();
        if (cfg?.configured) {
          obsidianVaultHandleRef.current = 'native';
          if (!obsidianConfig?.enabled) {
            setObsidianConfig({ enabled: true, dailyNotesPath: cfg.folder || '', newNotesFolder: cfg.newNotesFolder || 'dayGLANCE', dailyNotePattern: cfg.pattern || 'yyyy-MM-dd' });
          }
          // notifyNativeReady() is called in performObsidianSync's finally block
          performObsidianSync();
          // Populate wikilink autocomplete candidates from the vault index
          try {
            const notes = nativeListNotes('');
            if (notes) {
              setWikilinkCandidates(notes.map(p => p.split('/').pop().replace(/\.md$/i, '')).sort((a, b) => a.localeCompare(b)));
              setUnportableVaultFiles?.(classifyVaultPaths(notes));
            }
          } catch {}
        } else {
          // No Obsidian configured — release the splash immediately
          notifyNativeReady();
        }
      } catch (err) {
        console.error('Obsidian: failed to read native vault config', err);
        notifyNativeReady();
      }
      return;
    }
    if (!obsidianConfig?.enabled) return;
    (async () => {
      try {
        const handle = await tryRestoreVaultAccess();
        if (handle) {
          obsidianVaultHandleRef.current = handle;
          performObsidianSync();
          scanVaultNotes(handle).then(({ names, unportable }) => { setWikilinkCandidates(names); setUnportableVaultFiles?.(unportable); }).catch(() => {});
        }
      } catch (err) {
        console.error('Obsidian: failed to restore vault access', err);
      }
    })();
    // Keyed on dataLoaded + enabled. performObsidianSync/notifyNativeReady are
    // recreated per render and read at call time; vault refs are read via
    // .current, so they are intentionally not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded, obsidianConfig?.enabled]);

  // Obsidian sync: on visibility change (user switches back from Obsidian / native settings)
  useEffect(() => {
    if (isTrayMode) return;
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (isNativeApp()) {
        // Re-check in case user just configured the vault in native settings
        try {
          const cfg = nativeGetVaultConfig();
          if (cfg?.configured) {
            obsidianVaultHandleRef.current = 'native';
            if (!obsidianConfig?.enabled) {
              setObsidianConfig({ enabled: true, dailyNotesPath: cfg.folder || '', newNotesFolder: cfg.newNotesFolder || 'dayGLANCE', dailyNotePattern: cfg.pattern || 'yyyy-MM-dd' });
            }
            performObsidianSync();
            // Defer the blocking vault scan to after the next paint so the JS thread
            // isn't blocked mid-render (which causes a blank screen on resume).
            // rAF → setTimeout(0) guarantees the browser paints the current frame
            // before nativeListNotes runs.
            requestAnimationFrame(() => setTimeout(() => {
              try {
                const notes = nativeListNotes('');
                if (notes) {
              setWikilinkCandidates(notes.map(p => p.split('/').pop().replace(/\.md$/i, '')).sort((a, b) => a.localeCompare(b)));
              setUnportableVaultFiles?.(classifyVaultPaths(notes));
            }
              } catch {}
            }, 0));
          }
        } catch {}
        return;
      }
      // Deliberately NOT gated on a connected handle: performObsidianSync
      // re-acquires a lost one itself (see its null-handle branch), so a vault
      // that failed restore at startup reconnects when the user comes back.
      performObsidianSync();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
    // performObsidianSync/setObsidianConfig are read at call time; keyed on
    // enabled. Vault state is read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obsidianConfig?.enabled]);

  // Obsidian sync: poll every 5 minutes while open
  useEffect(() => {
    if (isTrayMode || !obsidianConfig?.enabled) return;
    // Deliberately NOT gated on a connected handle — same reason as the
    // visibility handler above: the poll is also the retry path for a vault
    // on a slow-mounting drive or network share. A still-missing vault costs
    // one silent restore attempt per tick and produces no error state.
    const timer = setInterval(() => {
      performObsidianSync();
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
    // performObsidianSync is read at call time; the poll is keyed on enabled,
    // and the vault handle is read via its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obsidianConfig?.enabled]);

  // Keep always-fresh refs so the interval-triggered performObsidianSync never reads stale state.
  useEffect(() => { obsidianTasksRef.current = tasks; }, [tasks, obsidianTasksRef]);
  useEffect(() => { obsidianInboxRef.current = unscheduledTasks; }, [unscheduledTasks, obsidianInboxRef]);

  // Obsidian writeback: detect completion/scheduling/title changes and write back to vault
  useEffect(() => {
    if (isTrayMode || !obsidianConfig?.enabled || !obsidianVaultHandleRef.current) return;
    // Skip writeback while a sync is replacing the task arrays — but leave a
    // marker so the cycle's finally re-runs this pass (audit fix M1): the
    // skipped run may carry a USER change, and without the re-poke it sat
    // unwritten until the next unrelated task change.
    if (obsidianSyncInProgressRef.current) { writebackPendingRef.current = true; return; }
    writebackPendingRef.current = false;

    const allObsidian = [...tasks, ...unscheduledTasks].filter(t => t.importSource === 'obsidian' && t.obsidianRawTitle);
    const prev = obsidianPrevTaskStateRef.current;
    const isNative = obsidianVaultHandleRef.current === 'native';
    // ── ARBITRATION (§3.2, Phase 6 PR 3) — gate (a): emit-in-same-tick ────
    // When the plugin is authoritative, the intent emission below IS the
    // write: the same tick that detects a change hands it to the transport
    // instead of the direct writer, so there is no "skipped write" state
    // for the snapshot to advance past — every advance is backed by exactly
    // one action. The authority answer is at most one sync cycle old
    // (refreshed per cycle); a write that lands through the WRONG side
    // during that window is harmless by construction — both writers
    // produce byte-identical output (the PR 2 convergence pins).
    // Launch-on-write debounce across the flip: nothing to cancel here —
    // suppression is evaluated at FIRE time against a fresh heartbeat read
    // (electron/obsidianLaunch.ts, Android arm chokepoint), and a fresh
    // AND paired heartbeat is by definition fresh, so any debounce armed
    // just before the flip suppresses itself when it fires.
    // Android SafeReplace note: with direct writes stopped, a stray .tmp
    // from a write that crashed just before the flip stays in the vault
    // until the next direct-mode write touches that note (the retry rides
    // vault touches). Benign leftover, invisible to Obsidian, cleaned on
    // the next direct cycle — accepted.
    const authoritative = bridgeHeartbeatRef.current.pluginAuthoritative;

    // Write-success commits from synchronous native writes, run after the
    // snapshot rebuild below. (Desktop commits run in each write's own .then,
    // which also lands after that point.)
    const nativeCommits = [];

    // ── Write-success bookkeeping ─────────────────────────────────────────
    // ALL id / obsidianRawTitle bookkeeping is gated on the vault write
    // reporting success — a failed write must leave the task exactly as it
    // was. obsidianRawTitle in particular means "what the vault line says we
    // last wrote"; advancing it optimistically made the field claim a write
    // that never landed, and the next scan then misclassified the FAILED
    // WRITE as an Obsidian-side edit (vault raw ≠ "last written") and
    // discarded the user's rename via the vault-title-wins rule.

    // Map oldId → { id, obsidianRawTitle } across both lists, moving the
    // change-detection snapshot entry along with the id.
    const applyTitleUpdate = ({ oldId, newId, newRawTitle }) => {
      const apply = t => (t.id === oldId ? { ...t, id: newId, obsidianRawTitle: newRawTitle } : t);
      setTasks(prevTasks => prevTasks.map(apply));
      setUnscheduledTasks(prevTasks => prevTasks.map(apply));
      const snap = obsidianPrevTaskStateRef.current;
      if (oldId !== newId && snap[oldId]) { snap[newId] = snap[oldId]; delete snap[oldId]; }
    };

    // Commit a fresh block-id assignment to app state once the vault write
    // that stamped it reported success: the task's id switches to the durable
    // block-derived form and the id is persisted as obsidianBlockId. The
    // snapshot entry moves with it so change detection stays keyed correctly.
    // Gated on write success deliberately — a failed stamp must leave the task
    // untouched, or the app would hold an id no vault line carries (a ghost no
    // scan could ever match or tombstone).
    const applyBlockIdAssignment = (fromId, blockId) => {
      const newId = appIdForBlockId(blockId);
      const apply = t => (t.id === fromId ? { ...t, id: newId, obsidianBlockId: blockId } : t);
      setTasks(prevTasks => prevTasks.map(apply));
      setUnscheduledTasks(prevTasks => prevTasks.map(apply));
      const snap = obsidianPrevTaskStateRef.current;
      if (snap[fromId]) { snap[newId] = snap[fromId]; delete snap[fromId]; }
    };

    // PROVENANCE (see utils/retiredTaskIds.js — three channels, three actors,
    // no write site ever has two valid choices): THIS site is the
    // commit-that-renames. It KNOWS the successor at write time — it did the
    // renaming — so retirements are recorded in `retiredTaskIds` as
    // { oldId → { retiredAt, successor } }, which the guard, the apply path,
    // and the file-tier merge treat as an identity move: superseded regardless
    // of timestamps, with a newer edit on the retired id redirected onto the
    // successor. (User-pressed deletes belong to deletedTaskIds — useTaskActions
    // / useRecycleBin; detector-observed vanishes to deletedObsidianKeys — the
    // scan block above. Neither knows a successor; this site never writes
    // theirs except the shim below.) The deletion DETECTOR still never infers
    // a deletion from a rename (the scanned-keys hints see to that): this is
    // the commit asserting a fact it holds. Entries prune at the shared 60-day
    // retention (sync/tombstoneRetention.js).
    //
    // RETIRED_ID_DUAL_WRITE (legacy-fleet shim — sunset condition documented
    // at the flag in utils/retiredTaskIds.js): the v4.7.x fleet's file-tier
    // merge consults ONLY deletedTaskIds, so retired ids are ALSO written
    // there as plain tombstones; without it, stale legacy rows resurrect on
    // un-upgraded devices. New clients act on the record and merely tolerate
    // the tombstone.
    const recordRetirements = (ids, successorId) => {
      if (!ids.length) return;
      const nowIso = new Date().toISOString();
      try {
        const record = recordRetirementEntries(readRetiredTaskIds(), ids, successorId, nowIso);
        localStorage.setItem(RETIRED_TASK_IDS_STORAGE_KEY, JSON.stringify(record));
      } catch { /* storage unavailable — scanned-keys hints still keep local state coherent */ }
      if (RETIRED_ID_DUAL_WRITE) {
        try {
          const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}');
          for (const id of ids) tombstones[String(id)] = nowIso;
          localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(tombstones));
        } catch { /* ditto */ }
      }
    };

    // RE-MINT REFUSAL inputs (utils/retiredTaskIds.js isTombstonedRemint —
    // the 2026-08-31 db-tier war's fix at the MINTING site). Read once per
    // pass: the record, every bundle that can tombstone a dg successor, and
    // the live-id set the refusal's live-successor exemption needs.
    const remintRecord = readRetiredTaskIds();
    let remintTombstoneBundles = [];
    try {
      remintTombstoneBundles = [
        JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}'),
        JSON.parse(localStorage.getItem('day-planner-deleted-obsidian-keys') || '{}'),
      ];
    } catch { remintTombstoneBundles = []; }
    const writebackLiveIds = new Set(allObsidian.map(t => String(t.id)));

    for (const task of allObsidian) {
      const p = prev[task.id];
      if (!p) continue;

      const titleChanged = p.title !== undefined && p.title !== task.title;
      const stateChanged = p.completed !== task.completed || p.startTime !== (task.startTime || null) || p.duration !== (task.duration || null);

      // Detect rescheduling to a different day by comparing against the prev snapshot
      // (not obsidianFileDate) so this is a one-shot trigger per reschedule.
      const dateChanged = !!(task.date && p.date && task.date !== p.date);

      // STAMP ON SIGHT (spec §3.10, identity-versus-content) — a NAMED new
      // write-trigger class: the IDENTITY-ASSIGNMENT WRITE FIRED BY IMPORT.
      // Obsidian owns task CONTENT; identity is a different question — an
      // untagged line's only identity is its own text, so any inbound edit
      // to it is structurally delete+create, and the task fractures on the
      // first rename. Stamping is how dayGLANCE keeps track of a line whose
      // content Obsidian owns; assigning it on FIRST IMPORT (not on the
      // task's next edit, as the Phase 2 opportunistic rule alone did)
      // closes that window. This is deliberately a write triggered by
      // merely READING the vault — not slipped into the change detection
      // above but its own condition, so the class stays visible. Scope:
      //  • PLUGIN MODE ONLY (authoritative): the direct writers arm the
      //    launch-on-write debounce at fire time, so a machine-initiated
      //    stamp in direct mode could pop Obsidian open with no user action
      //    behind it; direct mode also already janitors untagged renames
      //    via the vault-wide deletion detector. Direct-mode stamp-on-sight
      //    waits for a machine-write flag through the launch chokepoints
      //    (named follow-up in the spec).
      //  • Gated on the SAME block-id write release as every stamp
      //    (blockIdWritesEnabled) — this is Phase 2's opportunistic stamp
      //    with a widened trigger, not a second minting policy.
      // The emit below is the normal task_state intent carrying the
      // line's current state plus the derived block id; commit-on-enqueue
      // (gate (a)'s general rule) books the identity move exactly as for
      // any other stamping write.
      const stampNeeded = authoritative
        && !titleChanged && !stateChanged && !dateChanged
        && !task.obsidianBlockId && blockIdWritesEnabled();

      if (!titleChanged && !stateChanged && !dateChanged && !stampNeeded) continue;

      // Always write back to the original file the task was parsed from.
      // obsidianFileDate is set at parse time and never changes.
      const sourceDate = task.obsidianFileDate || task.id.match(/^obsidian-(\d{4}-\d{2}-\d{2})/)?.[1] || task.date;
      if (!sourceDate) continue;

      // Derive the new raw title: strip the #obsidian display tag, then
      // RE-ATTACH the line's verbatim Tasks-metadata segment (Step 2's
      // retitle-carry — a deliberate write-path change inside read support):
      // display titles no longer contain the metadata run, so deriving the
      // written line from the display alone would strip the user's 📅/⏳/🔁
      // text off the vault line on every dayGLANCE rename. Same helper as
      // the scan-time resolver's `ours` comparison, so what we compare and
      // what we write can never diverge.
      const newRawTitle = titleChanged
        ? reattachTasksMetadata(task.title.replace(/\s*#obsidian\b/gi, '').trim(), task.obsidianRawTitle)
        : undefined;

      // When the task has been rescheduled to a different day, pass the new date
      // so the write adds/updates an inline date prefix in the original file
      // (e.g. "- [ ] 2026-03-20 10:00 Task").  No new file is created.
      const targetDate = dateChanged ? task.date : undefined;

      // All-day tasks have startTime: '00:00' in state but must write back with no
      // time prefix so the line stays as "YYYY-MM-DD Task" (not "YYYY-MM-DD 00:00-00:30 Task").
      const writeStartTime = task.isAllDay ? null : (task.startTime || null);
      const writeDuration = task.isAllDay ? null : (task.duration || null);
      const taskHeading = obsidianConfig?.taskHeading || '## Tasks';

      // Phase 2 opportunistic migration: a changed task with no block id gets
      // one assigned at THIS write — updateTaskLines stamps it onto the
      // matched line, and the assignment is committed to app state only when
      // the write reports success. Existing untagged tasks acquire ids
      // naturally as they get edited; there is no sweep.
      //
      // GATED by the read/write release split (utils/obsidianWritePolicy.js):
      // on the READ release no NEW id is ever minted — this is one of the two
      // emit sites the gate covers. A task that ALREADY carries a block id
      // (adopted from a vault another release stamped) keeps writing it —
      // writeBlockId preserves existing tokens unconditionally, because
      // stripping one would destroy identity other devices rely on.
      //
      // The id is DERIVED from (sourceDate, the title as it will exist on the
      // line) — see deriveBlockId. Every device stamping "the same" line
      // derives the same token, so the echo-stamp race (an edit syncing under
      // the legacy id making N vault devices mint N different ids) mints one
      // token unanimously instead. Deriving from newRawTitle on a retitle
      // matters: the line will CARRY newRawTitle, and a later device deriving
      // from the parsed line must reach the same input.
      let assignBlockId = (!task.obsidianBlockId && blockIdWritesEnabled())
        ? deriveBlockId(sourceDate, newRawTitle !== undefined ? newRawTitle : task.obsidianRawTitle)
        : null;

      // THE RE-MINT REFUSAL (2026-08-31 db-tier war — see isTombstonedRemint
      // for the full argument). deriveBlockId's determinism is the unanimity
      // feature everywhere else, and exactly what armed the war here: every
      // resurrection of this row derives the SAME successor, whose retirement
      // is already on the record and whose row is already tombstoned. Minting
      // again is not assigning identity — it is re-running a completed
      // identity move whose outcome is known. Refuse at the minting site,
      // loudly: the row keeps its legacy id (identity-neutral writes still
      // work), and a stamp-only pass skips the write entirely. The refusal
      // clears by itself the moment the state stops being contradictory — the
      // successor revives (live → exemption) or its tombstone/retirement
      // prunes at retention.
      if (assignBlockId
        && isTombstonedRemint(remintRecord, task.id, appIdForBlockId(assignBlockId), remintTombstoneBundles, writebackLiveIds)) {
        console.error(
          `Obsidian: REFUSING to re-mint ^dg-${assignBlockId} for ${task.id} — the retirement record already names this exact successor and that successor is tombstoned (retire/tombstone oscillation guard). Delete or edit the vault line to resolve.`);
        assignBlockId = null;
        // A stamp was this write's only reason → nothing left to write.
        if (!titleChanged && !stateChanged && !dateChanged) continue;
      }
      const writeBlockId = task.obsidianBlockId || assignBlockId;

      // Title bookkeeping is COMPUTED here but applied only on write success:
      //  - tagged task: the block id owns identity — a retitle never changes
      //    the id, only obsidianRawTitle is refreshed;
      //  - untagged task: the legacy content-derived id is recomputed
      //    (then superseded by the block assignment from the same write).
      //
      // TWO-SIDED RETITLE GUARD: when updateTaskLines reports that the vault
      // line moved off obsidianRawTitle while we were retitling, the write
      // keeps the LINE's title and this flag makes commit() skip the
      // titleUpdate — obsidianRawTitle stays truthful as the merge base, the
      // DG rename stays in app state (title + snapshot untouched), and the
      // next scan resolves it through the single scan-time policy
      // (utils/obsidianTitleConflict.js). A delay of one scan cycle, never a
      // loss. Only tagged lines can conflict (untagged lines match by title
      // equality), so no block-id assignment or retirement is ever involved.
      // Completion marker (docs/obsidian-buildout-spec.md — completion
      // timestamps): regenerated from task state at every rewrite. Format
      // chosen by the per-cycle Tasks-plugin detection; the whole meta is
      // null when the synced setting is off — updateTaskLines then still
      // STRIPS an existing marker on the lines it rewrites (OFF converges
      // clean per-touch, never via a sweep) but regenerates nothing.
      // Gated twice: the §3.9 build-time write gate (correctness — may this
      // build emit the format) AND the synced user setting (aesthetics).
      const completionMeta = (completionMarkerWritesEnabled() && obsidianCompletionDates)
        ? { completedAt: task.completedAt ?? null, format: tasksPluginRef.current ? 'tasks' : 'dataview' }
        : null;

      let titleConflicted = false;
      const noteTitleConflict = () => { titleConflicted = true; };
      let titleUpdate = null;
      let postTitleId = task.id;
      if (titleChanged && newRawTitle) {
        // Mirrors parseTasksFromMarkdown's content-derived id for untagged tasks.
        const newId = task.obsidianBlockId ? task.id : `obsidian-${sourceDate}-${obsidianSimpleHash(newRawTitle)}`;
        titleUpdate = { oldId: task.id, newId, newRawTitle };
        postTitleId = newId;
      }

      // Everything the CONFIRMED write establishes, in order: the title /
      // rawTitle bookkeeping, the block-id assignment, then tombstones for
      // every id the rename chain retired (task.id → postTitleId → dg id).
      const commit = () => {
        if (titleUpdate && !titleConflicted) applyTitleUpdate(titleUpdate);
        if (assignBlockId) applyBlockIdAssignment(postTitleId, assignBlockId);
        const finalId = assignBlockId ? appIdForBlockId(assignBlockId) : postTitleId;
        // Every retired id in the rename chain maps DIRECTLY to the final id —
        // chains are collapsed at write time, so the record never needs a
        // stale L→M hop resolved later (resolveRetirement handles one anyway).
        recordRetirements([...new Set([task.id, postTitleId])].filter(id => id !== finalId), finalId);
      };

      // Bridge stream (Phase 6): the same write as a semantic intent — a
      // retitling write is task_retitle (it carries the state too: one
      // write, one intent), any other state/schedule change is task_state.
      // The path mirrors the direct write's file resolution exactly
      // (writeTaskStateToFile, PATTERN-AWARE since audit fix H1 — both
      // sides used to hardcode `${dateStr}.md`, so on a custom-pattern
      // vault the intent targeted a nonexistent file that applyBridgeIntent
      // could never change while commit-on-enqueue had already booked the
      // identity move), and applyBridgeIntent mirrors its line rewrite, so
      // a paired vault copy converges byte-for-byte whichever side lands
      // first. Fail-silent; a stream problem never touches the direct write.
      const queued = emitBridgeIntent(titleChanged && newRawTitle ? 'task_retitle' : 'task_state', {
        path: (obsidianConfig?.dailyNotesPath ? `${obsidianConfig.dailyNotesPath.replace(/\/+$/, '')}/` : '')
          + dailyNoteFilename(sourceDate, obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd'),
        date: sourceDate,
        obsidianRawTitle: task.obsidianRawTitle,
        completed: task.completed,
        startTime: writeStartTime,
        duration: writeDuration,
        ...(titleChanged && newRawTitle ? { newRawTitle } : {}),
        ...(targetDate ? { targetDate } : {}),
        taskHeading,
        blockId: writeBlockId,
        completedAt: completionMeta?.completedAt ?? null,
        completionFormat: completionMeta?.format ?? null,
      });

      if (authoritative) {
        // Plugin mode: the emitted intent above is this change's one write
        // (gate a). A failed ENQUEUE reuses the direct writer's latch
        // discipline: user-visible error, retried when the task next
        // changes — the same surface a failed direct write has always had.
        if (!queued) { reportTaskWriteFailure(); continue; }
        // GATE (a), THE GENERAL RULE (third and final form — twice-corrected;
        // the full record is in the spec's Phase 6 build notes):
        //
        //   EVERY IDENTITY MOVE COMMITS ITS BOOKKEEPING ON THE SAME ACTION
        //   THAT EMITS THE WRITE, REGARDLESS OF WHAT TRIGGERED THE WRITE.
        //
        // Two identity moves exist on this path — a retitle (legacy id
        // recomputed from the new title) and the OPPORTUNISTIC BLOCK-ID
        // STAMP (assignBlockId: legacy → ^dg-, fired by ANY write to an
        // untagged task: a schedule, a completion, anything — and, since
        // stamp-on-sight, by the import itself: the identity-assignment
        // write class rides the SAME assignBlockId and the same condition,
        // exactly as a trigger-agnostic rule demands). Both ride the
        // condition below. Enumerating triggers is what failed twice:
        //   • Shape 1 ran no commit() at all, claiming the observation
        //     round-trip absorbs identity "like another device's write" —
        //     false for a retitled legacy task (the rename-while-paired
        //     war of 2026-08-30, fixed in #1482).
        //   • Shape 2 (#1482) committed for retitles only, claiming the
        //     unchanged-title legacy hint bridges everything else. That
        //     claim is true for the MERGE — the hint really does collapse
        //     the copies there — and false ONE LAYER DOWN: the DB tier's
        //     snapshot-delete guard sees the legacy id vanish with no
        //     retirement on record, classifies the drop as a glitch, and
        //     HEALS THE OLD COPY BACK FROM THE VAULT. The guard is doing
        //     its job faithfully against missing bookkeeping — which is
        //     what turned a missing record into a PERMANENT duplicate
        //     (the schedule-while-paired duplicate of 2026-08-30).
        //
        // So commit() runs on SUCCESSFUL ENQUEUE for any write that moves
        // identity. Gate (a)'s principle is that every snapshot advance is
        // backed by exactly one action, and the id bookkeeping rides that
        // same action: the outbox is durable, so enqueue is the write in
        // every sense the snapshot already trusts. THE TRADE, weighed not
        // missed: if an enqueued intent is later lost (revoked pairing,
        // outbox overflow), the app briefly holds an id no vault line
        // carries — bounded by the same latch-and-surface discipline. The
        // alternative — teaching the observation side to bridge old ids —
        // stays rejected: it means carrying rename semantics in
        // observations, which §3.6 deliberately forbids. Identity-neutral
        // writes (tagged task, no stamp) still settle through the
        // round-trip: the ^dg- token IS their identity, nothing moves.
        // Deferred via nativeCommits so the entry moves operate on the
        // fresh snapshot, exactly like a confirmed native write.
        if (titleUpdate || assignBlockId) nativeCommits.push(commit);
        continue;
      }

      if (isNative) {
        // onWriteFailure fires only on a GENUINE failure (unreadable note,
        // refused write, exception) — never on the benign no-matching-line
        // case, where the vault simply no longer has the line and the next
        // scan reconciles. `updated` false alone can't tell the two apart.
        const updated = writeTaskStateNative(
          sourceDate,
          task.obsidianRawTitle,
          task.completed,
          writeStartTime,
          newRawTitle,
          writeDuration,
          targetDate,
          taskHeading,
          writeBlockId,
          reportTaskWriteFailure,
          noteTitleConflict,
          completionMeta,
        );
        if (updated) nativeCommits.push(commit);
      } else {
        writeTaskStateToFile(
          obsidianVaultHandleRef.current,
          obsidianConfig.dailyNotesPath || '',
          sourceDate,
          task.obsidianRawTitle,
          task.completed,
          writeStartTime,
          newRawTitle,
          writeDuration,
          targetDate,
          taskHeading,
          writeBlockId,
          noteTitleConflict,
          completionMeta,
          obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd', // audit fix H1: pattern-aware
        ).then(updated => {
          // `updated` false here is the benign NotFound case (file gone —
          // the scan reconciles); a real write failure REJECTS instead.
          if (updated) { commit(); reportTaskWriteSuccess(); }
        }).catch(err => {
          console.error('Obsidian: failed to write task state back', err);
          reportTaskWriteFailure();
        });
      }
    }

    // Update previous-state snapshot, keyed by the tasks' CURRENT ids — all
    // id / rawTitle bookkeeping is write-success-gated and moves its own
    // snapshot entry when it commits. After a FAILED write the entry keeps
    // the task's new display state under the old id, so the failed write is
    // not re-attempted until the task changes again (unchanged from the old
    // behavior — minus the misclassification the optimistic advance caused).
    // Include date so we can detect future rescheduling to a different day.
    const next = {};
    for (const task of allObsidian) {
      next[task.id] = { completed: task.completed, startTime: task.startTime || null, duration: task.duration || null, title: task.title, date: task.date || null };
    }
    obsidianPrevTaskStateRef.current = next;

    // Native writes are synchronous, so their confirmed commits run here —
    // after the snapshot rebuild, so the entry moves inside the commit operate
    // on the fresh snapshot. (Desktop commits run in each write's own .then,
    // which also lands after this point.)
    for (const commit of nativeCommits) commit();
    // Any confirmed native write proves the vault is writable again —
    // clearing path 1 for a latched task-write error.
    if (nativeCommits.length) reportTaskWriteSuccess();
    // Keyed on task changes — writeback fires when tasks change and reads the
    // current obsidianConfig paths + dedup refs at that moment. Adding the config
    // paths would re-run a writeback on a mere settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, unscheduledTasks, obsidianConfig?.enabled]);

  // Push the effective launch-on-write value to the platform layer that owns
  // the post-write debounce: Electron main (obsidian:set-launch-on-write) or
  // the Android bridge. Runs on mount and on every tri-state change; both
  // schedulers start disabled, so nothing can fire before the first push.
  // Plain browser has no launch mechanism (a window.open from a debounce timer
  // is popup-blocked without a user gesture) — deliberately a no-op there.
  useEffect(() => {
    if (isTrayMode) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (api?.obsidian?.setLaunchOnWrite) {
      api.obsidian.setLaunchOnWrite(effectiveLaunchOnWrite(obsidianLaunchOnWrite, api.platform));
    } else if (isNativeAndroid()) {
      nativeSetLaunchOnWrite(effectiveLaunchOnWrite(obsidianLaunchOnWrite, 'android'));
    }
  }, [obsidianLaunchOnWrite, isTrayMode]);

  // On iOS, persist Obsidian folder/pattern/newNotesFolder to UserDefaults so
  // getDailyNote/writeDailyNote use the correct path (iOS has no SettingsActivity).
  useEffect(() => {
    if (!isNativeApp() || isNativeAndroid() || !obsidianConfig?.enabled) return;
    nativeSetVaultSettings(
      obsidianConfig.dailyNotesPath ?? '',
      obsidianConfig.dailyNotePattern ?? 'yyyy-MM-dd',
      obsidianConfig.newNotesFolder ?? 'dayGLANCE',
    );
  }, [obsidianConfig?.dailyNotesPath, obsidianConfig?.dailyNotePattern, obsidianConfig?.newNotesFolder, obsidianConfig?.enabled]);

  return { performObsidianSync, nudgeObsidianObservations, loadWikiNote, saveWikiNote, openInObsidian, notifyNativeReady, bridgeHeartbeatRef };
}
