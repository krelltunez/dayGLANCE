import { useEffect, useRef, useReducer } from 'react';
import {
  formatCompletionLogEntry, completionLogDate, DEFAULT_COMPLETION_LOG_HEADING,
  applyBridgeIntent, dailyNoteFilename,
} from '@glance-apps/obsidian-format';
import { emitBridgeIntent } from '../utils/obsidianBridgeStream.js';
import {
  readDailyNoteFresh, writeDailyNoteFile, readDailyNoteNative, writeDailyNoteNative,
} from '../obsidian.js';
import { completionTimestamp } from '../utils/taskUtils.js';
import { isTrayMode } from '../utils/trayMode.js';

// COMPLETION LOG detector (companion spec 4.1). Watches task state for
// completed transitions and appends one permanent log line to the daily
// note of the completion date. Mirrors useNotifyEmitter's shape: a pure
// planner over prev→next snapshots, a remote-apply echo guard, an in-flight
// guard, and snapshot advance after the write attempt.
//
// WHO LOGS WHAT (ruling: every single task completion):
// - Local completions (toggle, focus, HyperGlance, sidebar, voice, intents,
//   MCP): the device that flipped the state observes the transition.
// - Vault-originated completions (checkbox in Obsidian → scan/observation
//   merge): the device whose sync cycle first applies the flip observes it —
//   those merges do not run under the engine's remote-apply flag, on
//   purpose: SOME device must log them.
// - Engine applies (a pull/merge is mutating task state): the diff is
//   DEFERRED to the next quiet render, never consumed — see the hold note
//   in planCompletionLog. Completions arriving from other devices then log
//   here too, which is what ruling 4 wants (the completing device may have
//   the log toggle off); a device that already logged the same completion
//   is a no-op, because entries are deterministic and the applier's
//   landed-check scans the whole note.
// - Recurring instances (completedDates on the template): logged with
//   [recurring:: true], bucketed to the INSTANCE date (the semantic
//   completion date), timed by completedDatesTimestamps when present.
//
// The log is one-shot by design, like task appends: the intent path queues
// durably (the outbox), the direct path logs failures to the console — the
// snapshot always advances, so a transition is attempted exactly once.

/** Minimal snapshot: enough to see a completed edge, nothing more. */
export function snapshotCompletionState(tasks, unscheduledTasks, recurringTasks) {
  const items = {};
  for (const t of [...(tasks || []), ...(unscheduledTasks || [])]) {
    items[t.id] = !!t.completed;
  }
  const recurring = {};
  for (const r of recurringTasks || []) {
    recurring[r.id] = Array.isArray(r.completedDates) ? [...r.completedDates] : [];
  }
  return { items, recurring };
}

/**
 * Pure planner: which completions became true between prev and next.
 * Returns { candidates, advanceTo } — advanceTo null means hold the
 * snapshot (in-flight), candidates only ever accompany advanceTo null
 * consumption by the caller after its write attempt.
 */
export function planCompletionLog(prev, next, { tasks, unscheduledTasks, recurringTasks, isRemoteApply = false, enabled = true, inFlight = false } = {}) {
  if (prev === null) return { candidates: [], advanceTo: next };
  if (inFlight) return { candidates: [], advanceTo: null };
  // A remote apply HOLDS the snapshot — it must never CONSUME it. The first
  // shape copied the notify emitter's consume semantics, and the 2026-09-01
  // field test showed why that's wrong for a permanent record: during a
  // cross-list delete/resupply war the engine applies fire continuously, the
  // remote-apply flag is up in wide windows, and LOCAL completions landing
  // inside those windows were swallowed forever (a global veto eats the
  // whole diff, not just the remote half). Holding defers the diff to the
  // next quiet render: local edges log late instead of never, and
  // remote-arrived completions log too — which ruling 4 (every single
  // completion) wants, since the completing device may have the log toggle
  // off. Double-logging collapses in the applier: entries are deterministic
  // when completedAt is present, and the landed-check scans the WHOLE note,
  // so a second writer's identical line is a no-op wherever its heading is.
  if (isRemoteApply) return { candidates: [], advanceTo: null };
  // Disabled stays CONSUME, deliberately: transitions made while the user
  // has the log off are never retro-logged on enable.
  if (!enabled) return { candidates: [], advanceTo: next };

  const candidates = [];
  for (const t of [...(tasks || []), ...(unscheduledTasks || [])]) {
    const was = prev.items[t.id];
    // First sight is never a transition — a task that ARRIVES completed
    // (import, restore) was not completed now.
    if (was === undefined || was === true || !t.completed) continue;
    candidates.push({
      title: t.title, completedAt: t.completedAt ?? null,
      projectId: t.projectId ?? null, priority: t.priority,
      deadline: t.deadline ?? null, recurring: false, bucketOverride: null,
    });
  }
  for (const r of recurringTasks || []) {
    const prevDates = prev.recurring[r.id];
    if (prevDates === undefined) continue; // first sight of the template
    const prevSet = new Set(prevDates);
    for (const dateStr of r.completedDates || []) {
      if (prevSet.has(dateStr)) continue;
      candidates.push({
        title: r.title, completedAt: r.completedDatesTimestamps?.[dateStr] ?? null,
        projectId: r.projectId ?? null, priority: undefined,
        deadline: null, recurring: true, bucketOverride: dateStr,
      });
    }
  }
  return { candidates, advanceTo: candidates.length ? null : next };
}

/** Pure write-builder: candidate → the completion_log_append intent fields. */
export function buildCompletionLogWrite(candidate, { projects, obsidianConfig, dailyNoteTemplate, localToday }) {
  const bucket = candidate.bucketOverride
    ?? completionLogDate(candidate.completedAt, localToday);
  const entry = formatCompletionLogEntry({
    title: candidate.title,
    completedAt: candidate.completedAt,
    fallbackDate: bucket,
    // Projects carry their display name in `title` (every UI surface renders
    // project.title; `name` is the AREA shape's field).
    projectName: candidate.projectId
      ? (projects || []).find((p) => p.id === candidate.projectId)?.title ?? null
      : null,
    priority: candidate.priority,
    deadline: candidate.deadline,
    recurring: candidate.recurring,
  });
  const prefix = obsidianConfig?.dailyNotesPath
    ? `${obsidianConfig.dailyNotesPath.replace(/\/+$/, '')}/`
    : '';
  return {
    path: prefix + dailyNoteFilename(bucket, obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd'),
    date: bucket,
    heading: (obsidianConfig?.completionLogHeading || '').trim() || DEFAULT_COMPLETION_LOG_HEADING,
    template: dailyNoteTemplate || '',
    entry,
  };
}

export default function useCompletionLog({
  tasks, unscheduledTasks, recurringTasks, projects,
  obsidianConfig, dailyNoteTemplate,
  obsidianVaultHandleRef, bridgeHeartbeatRef,
  setObsidianSyncError, setObsidianSyncStatus,
  isRemoteApply,
  // Multi-user (companion 4.1 amendment): the log is THIS user's record.
  // App.jsx's visibility rule — unassigned, or assigned to me — decides
  // which completions this device logs; another member's completions sync
  // into the same state but are theirs to log. Optional: absent means
  // everything is visible (single-user, or an older harness).
  isVisibleForUser = null,
}) {
  const prevRef = useRef(null);
  const inFlightRef = useRef(false);
  const holdLoggedRef = useRef(false);
  const [, bump] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    if (isTrayMode) return;
    // The ENABLED gate is the user's intent only (Obsidian on + log on).
    // The vault handle is NOT part of it — the first shape gated on the
    // handle too, which silently consumed every completion made while the
    // handle was still restoring after launch, and would consume forever on
    // plugin-authoritative devices with no local handle at all (the emit
    // route needs none). Route availability is a HOLD below, never a
    // consume.
    const enabled = !!(obsidianConfig?.enabled && obsidianConfig?.completionLogEnabled);
    const authoritative = !!bridgeHeartbeatRef?.current?.pluginAuthoritative;
    const routeAvailable = authoritative || !!obsidianVaultHandleRef.current;

    const visible = typeof isVisibleForUser === 'function' ? (list) => (list || []).filter((t) => t && isVisibleForUser(t)) : (list) => list;
    const myTasks = visible(tasks);
    const myInbox = visible(unscheduledTasks);
    const myRecurring = visible(recurringTasks);
    const nextSnap = snapshotCompletionState(myTasks, myInbox, myRecurring);
    const { candidates, advanceTo } = planCompletionLog(prevRef.current, nextSnap, {
      tasks: myTasks, unscheduledTasks: myInbox, recurringTasks: myRecurring,
      isRemoteApply: !!isRemoteApply?.(),
      enabled,
      inFlight: inFlightRef.current,
    });

    if (!candidates.length) {
      if (advanceTo !== null) prevRef.current = advanceTo;
      return;
    }

    if (!routeAvailable) {
      // No way to write yet (vault handle restoring, pairing not
      // authoritative): HOLD the snapshot so the edge stays in the diff and
      // logs as soon as a route exists. Entries are deterministic, so the
      // late write is byte-identical to what an on-time write would have
      // been.
      if (!holdLoggedRef.current) {
        holdLoggedRef.current = true;
        console.info(`[Obsidian] Completion log: ${candidates.length} completion(s) waiting for vault access.`);
      }
      return;
    }
    holdLoggedRef.current = false;

    inFlightRef.current = true;
    const fire = async () => {
      try {
        const localToday = completionTimestamp().slice(0, 10);
        for (const candidate of candidates) {
          const write = buildCompletionLogWrite(candidate, { projects, obsidianConfig, dailyNoteTemplate, localToday });
          // Bridge stream first, like every vault write: the same append as
          // a semantic intent; applyBridgeIntent dedupes by exact line, so
          // a paired vault converges whichever side appends first.
          const queued = emitBridgeIntent('completion_log_append', write);
          if (bridgeHeartbeatRef?.current?.pluginAuthoritative) {
            // The intent IS the write. Nothing re-emits a log entry, so a
            // dropped emit must surface (the task_append precedent).
            if (!queued) {
              setObsidianSyncError?.(`Completion of "${candidate.title}" was not logged to your vault: the bridge queue is unavailable.`);
              setObsidianSyncStatus?.('error');
            }
            continue;
          }
          const handle = obsidianVaultHandleRef.current;
          if (handle === 'native') {
            // Read contract: null = FAILED read (never "absent") — refuse
            // rather than recreate over an unreadable note. "" is reported
            // absence; the applier treats it as an empty note (native has
            // never applied templates — the append precedent).
            const note = readDailyNoteNative(write.date);
            if (note === null) { console.error('[Obsidian] Completion log: daily note read failed, entry skipped:', write.date); continue; }
            const applied = applyBridgeIntent(note.text, { type: 'completion_log_append', ...write });
            if (applied.changed && !writeDailyNoteNative(write.date, applied.text)) {
              console.error('[Obsidian] Completion log: daily note write failed:', write.date);
            }
          } else {
            try {
              const note = await readDailyNoteFresh(handle, obsidianConfig.dailyNotesPath || '', write.date, obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd');
              const applied = applyBridgeIntent(note?.text ?? null, { type: 'completion_log_append', ...write });
              if (applied.changed) {
                await writeDailyNoteFile(handle, obsidianConfig.dailyNotesPath || '', write.date, applied.text, obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd');
              }
            } catch (err) {
              console.error('[Obsidian] Completion log: failed to append entry:', err);
            }
          }
        }
      } finally {
        // One-shot: the snapshot advances whatever happened above (the
        // intent path is durably queued; direct failures were surfaced).
        prevRef.current = nextSnap;
        inFlightRef.current = false;
        bump(); // catch transitions that arrived during the in-flight window
      }
    };
    fire();
  });
}
