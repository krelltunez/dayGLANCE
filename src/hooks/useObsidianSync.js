import { useEffect, useCallback, useRef } from 'react';
import {
  tryRestoreVaultAccess, getVaultAccess,
  syncObsidianVault, syncObsidianVaultNative,
  writeTaskStateToFile, writeTaskStateNative,
  simpleHash as obsidianSimpleHash,
  generateBlockId, appIdForBlockId,
  readWikiNote, writeWikiNote, scanVaultNotes,
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
import { mergeObsidianTasks } from '../utils/mergeObsidianTasks.js';
import { detectObsidianDeletions, addObsidianTombstones } from '../utils/obsidianDeletions.js';
import {
  readRetiredTaskIds,
  recordRetirements as recordRetirementEntries,
  RETIRED_TASK_IDS_STORAGE_KEY,
  RETIRED_ID_DUAL_WRITE,
} from '../utils/retiredTaskIds.js';

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
export default function useObsidianSync({
  isTrayMode, dataLoaded,
  tasks, setTasks,
  unscheduledTasks, setUnscheduledTasks,
  setDailyNotes,
  setWikilinkCandidates,
  setUnportableVaultFiles,
  obsidianConfig, setObsidianConfig,
  obsidianLaunchOnWrite,
  setObsidianSyncStatus, setObsidianSyncError, setObsidianLastSynced,
  obsidianVaultHandleRef, obsidianSyncInProgressRef, obsidianPrevTaskStateRef,
  obsidianTasksRef, obsidianInboxRef,
}) {
  // Callbacks for reading/writing linked wiki notes from the vault
  const loadWikiNote = useCallback(async (noteName) => {
    const handle = obsidianVaultHandleRef.current;
    if (!handle) return null;
    // Strip [[Note#Heading]] fragment — we load the whole note file, not just a section
    const notePath = noteName.split('#')[0].trim();
    if (handle === 'native') {
      return nativeGetNote(notePath);
    }
    try {
      return await readWikiNote(handle, notePath);
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
    // Portability gate on CREATION ONLY (see writeWikiNote): the existence
    // check runs before the validator, so a note that already exists is
    // written whatever its name — the harm is in creating NEW unportable
    // names, and refusing writes to existing files would strand the task in a
    // permanent error state. Refusals surface through the same visible
    // sync-error state performObsidianSync uses; the old console.error was a
    // silent write loss the user could never see.
    if (handle === 'native') {
      // Android: same ordering — only validate when the note doesn't exist yet.
      const existing = await Promise.resolve(nativeGetNote(notePath)).catch(() => null);
      if (!existing) {
        const reason = validateWikiNoteName(notePath);
        if (reason) {
          setObsidianSyncError(`Note "${notePath}" was not written: ${reason}. Edit the [[wikilink]] in the task title.`);
          setObsidianSyncStatus('error');
          return;
        }
      }
      nativeWriteNote(notePath, content);
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
      const result = isNative
        ? await syncObsidianVaultNative(
            obsidianConfig?.dailyNotesPath || '',
            OBSIDIAN_IMPORT_WINDOW_DAYS,
            currentTasks,
            currentInbox,
          )
        : await syncObsidianVault(
            obsidianVaultHandleRef.current,
            obsidianConfig?.dailyNotesPath || '',
            OBSIDIAN_IMPORT_WINDOW_DAYS,
            currentTasks,
            currentInbox,
            obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd',
          );

      // App-only fields that live in dayGLANCE but NOT in the Obsidian markdown,
      // so a re-parse (parseTasksFromMarkdown) can't reproduce them. They must be
      // carried over from the existing in-memory copy or every cold-open re-sync
      // silently wipes them — which for `archived`/`completedAt` on a completed
      // task looked like a phantom change and re-stamped lastModified every load
      // (the DB-sync push churn). Only carry a value that is actually present so we
      // never inject undefined keys.
      const preserveObsidianAppFields = (old) => ({
        ...(old.projectId ? { projectId: old.projectId } : {}),
        ...(old.deadline ? { deadline: old.deadline } : {}),
        ...(old.archived !== undefined ? { archived: old.archived } : {}),
        ...(old.completedAt !== undefined ? { completedAt: old.completedAt } : {}),
        // assignedUserSyncIds is an app-only synced field (user assignment) that
        // the markdown re-parse can't reproduce; without this an assigned Obsidian
        // task drops it on every re-scan → the same per-cycle false-diff/re-push.
        ...(old.assignedUserSyncIds !== undefined ? { assignedUserSyncIds: old.assignedUserSyncIds } : {}),
      });

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
      // real data. See utils/obsidianDeletions.js.
      let tombstones = {};
      try { tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-obsidian-keys') || '{}'); } catch { tombstones = {}; }
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

      // Update daily notes — MERGE the scan in, don't replace. Replacing deletes
      // any note this device's vault lacks (different vault, shorter retention, or
      // no Obsidian at all), which another device then re-adds → an endless
      // cross-device delete↔re-add loop (measured via [pull] DELETE dailyNotes:… ↔
      // new dailyNotes:…). Merge keeps other devices' dates, carries the prior
      // lastModified forward for unchanged text, and honors deletion tombstones so
      // a genuine vault deletion still propagates. See mergeObsidianDailyNotes.
      setDailyNotes(prev => mergeObsidianDailyNotes(prev, result.dailyNotes, tombstones));

      // Update tasks/inbox — same merge-not-replace + honor-tombstones rule; RETAIN
      // prior Obsidian tasks this scan didn't produce (another device's vault),
      // drop only those with a deletion tombstone. See mergeObsidianTasks.
      setTasks(prev => mergeObsidianTasks(prev, result.scheduledTasks, scannedObsidianIds, preserveObsidianAppFields, tombstones));
      setUnscheduledTasks(prev => mergeObsidianTasks(prev, result.inboxTasks, scannedObsidianIds, preserveObsidianAppFields, tombstones));

      // Snapshot the fresh task state so the writeback effect doesn't re-trigger
      const snapshot = {};
      for (const t of [...result.scheduledTasks, ...result.inboxTasks]) {
        snapshot[t.id] = { completed: t.completed, startTime: t.startTime || null, duration: t.duration || null, title: t.title, date: t.date || null };
      }
      obsidianPrevTaskStateRef.current = snapshot;

      const elapsed = Date.now() - syncStart;
      if (elapsed < 2000) await new Promise(r => setTimeout(r, 2000 - elapsed));
      const now = new Date().toISOString();
      setObsidianLastSynced(now);
      localStorage.setItem('day-planner-obsidian-last-synced', now);
      setObsidianSyncError(null);
      setObsidianSyncStatus('success');
      setTimeout(() => setObsidianSyncStatus(s => s === 'success' ? 'idle' : s), 3000);
    } catch (err) {
      console.error('Obsidian sync error:', err);
      setObsidianSyncError(err.message);
      setObsidianSyncStatus('error');
      setTimeout(() => setObsidianSyncStatus(s => s === 'error' ? 'idle' : s), 5000);
    } finally {
      obsidianSyncInProgressRef.current = false;
      notifyNativeReady();
    }
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
    // Skip writeback while a sync is replacing the task arrays
    if (obsidianSyncInProgressRef.current) return;

    const allObsidian = [...tasks, ...unscheduledTasks].filter(t => t.importSource === 'obsidian' && t.obsidianRawTitle);
    const prev = obsidianPrevTaskStateRef.current;
    const isNative = obsidianVaultHandleRef.current === 'native';

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

    for (const task of allObsidian) {
      const p = prev[task.id];
      if (!p) continue;

      const titleChanged = p.title !== undefined && p.title !== task.title;
      const stateChanged = p.completed !== task.completed || p.startTime !== (task.startTime || null) || p.duration !== (task.duration || null);

      // Detect rescheduling to a different day by comparing against the prev snapshot
      // (not obsidianFileDate) so this is a one-shot trigger per reschedule.
      const dateChanged = !!(task.date && p.date && task.date !== p.date);

      if (!titleChanged && !stateChanged && !dateChanged) continue;

      // Always write back to the original file the task was parsed from.
      // obsidianFileDate is set at parse time and never changes.
      const sourceDate = task.obsidianFileDate || task.id.match(/^obsidian-(\d{4}-\d{2}-\d{2})/)?.[1] || task.date;
      if (!sourceDate) continue;

      // Derive the new raw title (strip #obsidian tag the app appends for display)
      const newRawTitle = titleChanged
        ? task.title.replace(/\s*#obsidian\b/gi, '').trim()
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
      const assignBlockId = task.obsidianBlockId ? null : generateBlockId();
      const writeBlockId = task.obsidianBlockId || assignBlockId;

      // Title bookkeeping is COMPUTED here but applied only on write success:
      //  - tagged task: the block id owns identity — a retitle never changes
      //    the id, only obsidianRawTitle is refreshed;
      //  - untagged task: the legacy content-derived id is recomputed
      //    (then superseded by the block assignment from the same write).
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
        if (titleUpdate) applyTitleUpdate(titleUpdate);
        if (assignBlockId) applyBlockIdAssignment(postTitleId, assignBlockId);
        const finalId = assignBlockId ? appIdForBlockId(assignBlockId) : postTitleId;
        // Every retired id in the rename chain maps DIRECTLY to the final id —
        // chains are collapsed at write time, so the record never needs a
        // stale L→M hop resolved later (resolveRetirement handles one anyway).
        recordRetirements([...new Set([task.id, postTitleId])].filter(id => id !== finalId), finalId);
      };

      if (isNative) {
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
        ).then(updated => {
          if (updated) commit();
        }).catch(err => console.error('Obsidian: failed to write task state back', err));
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

  return { performObsidianSync, loadWikiNote, saveWikiNote, openInObsidian, notifyNativeReady };
}
