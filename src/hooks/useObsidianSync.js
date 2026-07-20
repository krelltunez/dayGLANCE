import { useEffect, useCallback, useRef } from 'react';
import {
  tryRestoreVaultAccess, getVaultAccess,
  syncObsidianVault, syncObsidianVaultNative,
  writeTaskStateToFile, writeTaskStateNative,
  simpleHash as obsidianSimpleHash,
  readWikiNote, writeWikiNote, listVaultNotes,
  OBSIDIAN_IMPORT_WINDOW_DAYS, obsidianWindowCutoffDate,
} from '../obsidian.js';
import {
  isNativeAndroid, isNativeApp,
  nativeGetVaultConfig, nativeGetNote, nativeWriteNote, nativeOpenNote,
  nativeListNotes, nativeSetVaultSettings,
} from '../native.js';
import { mergeObsidianDailyNotes } from '../utils/mergeObsidianDailyNotes.js';
import { mergeObsidianTasks } from '../utils/mergeObsidianTasks.js';
import { detectObsidianDeletions, addObsidianTombstones } from '../utils/obsidianDeletions.js';

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
  obsidianConfig, setObsidianConfig,
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
    if (handle === 'native') {
      nativeWriteNote(notePath, content);
      return;
    }
    try {
      await writeWikiNote(handle, notePath, content, obsidianConfig?.newNotesFolder ?? 'dayGLANCE');
    } catch (err) {
      console.error('Failed to write wiki note:', err);
    }
  }, [obsidianConfig?.newNotesFolder, obsidianVaultHandleRef]);

  // Opens a vault note in the Obsidian app (Android) or via obsidian:// URI (web/desktop).
  const openInObsidian = useCallback((noteName) => {
    const handle = obsidianVaultHandleRef.current;
    if (!handle) return;
    if (handle === 'native') {
      nativeOpenNote(noteName);
      return;
    }
    // Web/desktop: construct obsidian:// deep link using the vault folder name
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
    // If the vault handle was lost (e.g. permission expired after page reload),
    // try to re-acquire it. When called from a button click this will trigger
    // the browser's requestPermission prompt. When called from a timer/visibility
    // event without a user gesture it will silently return null and we skip.
    if (!obsidianVaultHandleRef.current) {
      try {
        const handle = await getVaultAccess();
        if (!handle) return;
        obsidianVaultHandleRef.current = handle;
        listVaultNotes(handle).then(names => setWikilinkCandidates(names)).catch(() => {});
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
      const scannedObsidianIds = new Set([
        ...result.scheduledTasks.map(t => String(t.id)),
        ...result.inboxTasks.map(t => String(t.id)),
      ]);
      const scannedKeys = [...Object.keys(result.dailyNotes), ...scannedObsidianIds];

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
      // The scan only reads notes/tasks within the fixed Obsidian window of today
      // (OBSIDIAN_IMPORT_WINDOW_DAYS, src/obsidian.js), so notes aging out of that
      // window must NOT be mistaken for deletions. Use the SAME helper the scan uses
      // so the two windows can't drift.
      const obsidianCutoff = obsidianWindowCutoffDate(OBSIDIAN_IMPORT_WINDOW_DAYS);
      const { deletions, skipped } = detectObsidianDeletions(lastScanned, scannedKeys, obsidianCutoff);
      if (deletions.length) {
        tombstones = addObsidianTombstones(tombstones, deletions, new Date().toISOString());
        localStorage.setItem('day-planner-deleted-obsidian-keys', JSON.stringify(tombstones));
      }
      // Only advance the baseline on a scan we trusted — a skipped (incomplete) scan
      // leaves lastScanned intact so the next clean scan can still catch the delete.
      if (!skipped) localStorage.setItem('day-planner-obsidian-last-scanned', JSON.stringify(scannedKeys));

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
            if (notes) setWikilinkCandidates(notes.map(p => p.split('/').pop().replace(/\.md$/i, '')).sort((a, b) => a.localeCompare(b)));
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
          listVaultNotes(handle).then(names => setWikilinkCandidates(names)).catch(() => {});
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
                if (notes) setWikilinkCandidates(notes.map(p => p.split('/').pop().replace(/\.md$/i, '')).sort((a, b) => a.localeCompare(b)));
              } catch {}
            }, 0));
          }
        } catch {}
        return;
      }
      if (obsidianVaultHandleRef.current) {
        performObsidianSync();
      }
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
    const timer = setInterval(() => {
      if (obsidianVaultHandleRef.current) performObsidianSync();
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

    // IDs of tasks whose obsidianRawTitle / id changed during this loop (title writeback).
    // We collect them and apply a single batched state update after the loop.
    const titleUpdates = []; // { oldId, newId, newRawTitle }

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
      if (isNative) {
        writeTaskStateNative(
          sourceDate,
          task.obsidianRawTitle,
          task.completed,
          writeStartTime,
          newRawTitle,
          writeDuration,
          targetDate,
          taskHeading,
        );
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
        ).catch(err => console.error('Obsidian: failed to write task state back', err));
      }

      if (titleChanged && newRawTitle) {
        // New stable ID based on the updated raw title (mirrors parseTasksFromMarkdown)
        const newId = `obsidian-${sourceDate}-${obsidianSimpleHash(newRawTitle)}`;
        titleUpdates.push({ oldId: task.id, newId, newRawTitle });
      }
    }

    // Apply title-writeback ID/obsidianRawTitle updates to React state
    if (titleUpdates.length > 0) {
      const applyUpdates = t => {
        const u = titleUpdates.find(u => u.oldId === t.id);
        return u ? { ...t, id: u.newId, obsidianRawTitle: u.newRawTitle } : t;
      };
      setTasks(prev => prev.map(applyUpdates));
      setUnscheduledTasks(prev => prev.map(applyUpdates));
    }

    // Update previous-state snapshot (keyed by new IDs after title changes)
    // Include date so we can detect future rescheduling to a different day
    const next = {};
    for (const task of allObsidian) {
      const u = titleUpdates.find(u => u.oldId === task.id);
      const snapshotId = u ? u.newId : task.id;
      next[snapshotId] = { completed: task.completed, startTime: task.startTime || null, duration: task.duration || null, title: task.title, date: task.date || null };
    }
    obsidianPrevTaskStateRef.current = next;
    // Keyed on task changes — writeback fires when tasks change and reads the
    // current obsidianConfig paths + dedup refs at that moment. Adding the config
    // paths would re-run a writeback on a mere settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, unscheduledTasks, obsidianConfig?.enabled]);

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
