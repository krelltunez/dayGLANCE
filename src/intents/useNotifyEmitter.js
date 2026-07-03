import { useEffect, useRef, useReducer } from 'react';
import { eventId as makeEventId, EVENTS, ENTITY_TYPES } from '@glance-apps/intents';
import { INTENT_CONFIG_KEY, MULTI_USER_CONFIG_KEY } from './useIntentPoller.js';
import { enabledIntentTargets } from './emitTargets.js';
import { enqueueAndFlush } from './outboxEmit.js';
import { logActivity } from './intentLog.js';
import { isNativeAndroid } from '../native';

// The tray holds a read-only state snapshot. Any task-state changes in tray
// mode (e.g. from an iCloud sync download) were already handled by the main
// window. Emitting here would produce duplicate WebDAV notify events.
const isTrayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tray');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Reconstruct an ISO due string from dayGLANCE's split date/time fields. */
function taskDue(task) {
  if (!task.date) return undefined;
  if (task.isAllDay) return task.date;
  // Append the local UTC offset so the wall-clock time is preserved (e.g. 09:00+05:00,
  // not converted to 04:00Z). The intents schema requires datetime({ offset: true }).
  const off = -new Date().getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? '+' : '-';
  const pad = n => String(Math.abs(n)).padStart(2, '0');
  const offsetStr = `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  return `${task.date}T${task.startTime}:00${offsetStr}`;
}

/**
 * Compare two task snapshots and return the notify event that should fire,
 * or null if nothing notification-worthy changed. Priority: completion state
 * changes > rescheduled > updated.
 */
function detectChange(prev, next) {
  // Completion state changes
  if (!prev.completed && next.completed) {
    // completedAt may be stored as a bare YYYY-MM-DD date; normalize to ISO datetime.
    const completed_at = next.completedAt
      ? new Date(next.completedAt).toISOString()
      : new Date().toISOString();
    return { event: EVENTS.COMPLETED, completed_at };
  }
  if (prev.completed && !next.completed) {
    return { event: EVENTS.UNCOMPLETED };
  }

  // Due date / time changes (scheduled tasks only)
  const prevDue = taskDue(prev);
  const nextDue = taskDue(next);
  if (prevDue !== nextDue) {
    return { event: EVENTS.RESCHEDULED, due: nextDue, previous_due: prevDue };
  }

  // Field-level changes: title (includes tags), notes, priority, projectId, recurrence
  const fields = ['title', 'notes', 'priority', 'projectId'];
  const recurrenceChanged =
    JSON.stringify(prev.recurrence ?? null) !== JSON.stringify(next.recurrence ?? null);
  if (recurrenceChanged || fields.some(f => prev[f] !== next[f])) {
    return { event: EVENTS.UPDATED, due: nextDue };
  }

  return null;
}

function shouldEmit(task) {
  return !!(task.source_app && task.source_entity_id);
}

/** Pure payload builder — exported for testing. */
export function buildNotifyPayload(task, change, now, meUserSyncId = null) {
  return {
    event_id: task.transitionId ?? makeEventId(),
    source_app: task.source_app,
    source_entity_id: task.source_entity_id,
    event: change.event,
    task_id: task.id,
    title: task.title,
    timestamp: now,
    entity_type: ENTITY_TYPES.TASK,
    ...(change.due !== undefined ? { due: change.due } : {}),
    ...(change.previous_due !== undefined ? { previous_due: change.previous_due } : {}),
    ...(change.completed_at !== undefined ? { completed_at: change.completed_at } : {}),
    ...(change.completed_at !== undefined && meUserSyncId ? { completed_by_user_id: meUserSyncId } : {}),
  };
}

// ─── hook ────────────────────────────────────────────────────────────────────

/**
 * Pure planner: decide what to emit for a prev→next tasks snapshot transition,
 * and what the new baseline snapshot should be. Extracted from the effect so the
 * remote-apply guard and the deleted/changed diff are unit-testable without a
 * React renderer.
 *
 * Returns { emits, advanceTo } — see planGoalNotifyEmits for the contract.
 *
 * The isRemoteApply branch is the echo guard: a tasks change driven by a
 * sync/remote apply (applyEngineData's setTasks/setUnscheduledTasks, or any
 * merge-driven mutation) must NOT emit an outbound intent — it did not come from
 * the user. It is consumed into the baseline silently, mirroring how the
 * cloud-upload effect bails on suppressCloudUploadRef.
 */
export function planTaskNotifyEmits(prev, next, { isRemoteApply = false, hasTargets = true, inFlight = false } = {}) {
  if (prev === null) return { emits: [], advanceTo: next };
  if (isRemoteApply) return { emits: [], advanceTo: next };
  if (inFlight) return { emits: [], advanceTo: null };
  if (!hasTargets) return { emits: [], advanceTo: next };

  const prevMap = new Map(prev.map(t => [t.id, t]));
  const nextMap = new Map(next.map(t => [t.id, t]));

  const emits = [];

  // Deleted: present in prev but gone from next
  for (const [id, prevTask] of prevMap) {
    if (!shouldEmit(prevTask)) continue;
    if (!nextMap.has(id)) {
      emits.push({ task: prevTask, change: { event: EVENTS.DELETED } });
    }
  }

  // Changed: present in both prev and next
  for (const [id, nextTask] of nextMap) {
    if (!shouldEmit(nextTask)) continue;
    const prevTask = prevMap.get(id);
    if (!prevTask) continue; // new task — no notify for creation
    const change = detectChange(prevTask, nextTask);
    if (change) emits.push({ task: nextTask, change });
  }

  if (!emits.length) return { emits: [], advanceTo: next };
  return { emits, advanceTo: null }; // advanced after durable enqueue
}

/**
 * Watches tasks and unscheduledTasks for changes to tasks that carry
 * source_app + source_entity_id, and emits a WebDAV notify event for each
 * state change. No-ops when the intent WebDAV config is absent.
 *
 * Covered events: completed, uncompleted, deleted, rescheduled, updated.
 * Recurring templates are excluded — their completion model (completedDates)
 * differs from the boolean model assumed here.
 *
 * `isRemoteApply` (optional) is a getter returning true while a sync/remote
 * apply is mutating task state, so those changes are never echoed outbound.
 */
export function useNotifyEmitter({ tasks, unscheduledTasks, isRemoteApply }) {
  const prevRef = useRef(null);
  // Guard so a re-render during the async enqueue/flush window can't re-detect
  // and double-enqueue the same change (notify event_ids are freshly generated,
  // so a re-detection would not be deduped by the outbox).
  const inFlightRef = useRef(false);
  // After a fire() completes (and advances the snapshot), force one more effect
  // run so any change that arrived DURING the in-flight window is picked up.
  const [, bump] = useReducer(x => x + 1, 0);

  useEffect(() => {
    if (isTrayMode) return;

    const config = (() => {
      const raw = localStorage.getItem(INTENT_CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    })();

    const allTasks = [...tasks, ...unscheduledTasks];

    // Targets enabled for this emit ('webdav' | 'icloud' | 'vault'). When NONE
    // are enabled there's nowhere to send, so the planner consumes the changes
    // (advances the snapshot) and bails — matching the old behavior.
    const targets = enabledIntentTargets(config);
    const now = new Date().toISOString();

    const { emits, advanceTo } = planTaskNotifyEmits(prevRef.current, allTasks, {
      isRemoteApply: !!isRemoteApply?.(),
      hasTargets: targets.length > 0,
      inFlight: inFlightRef.current,
    });

    if (!emits.length) {
      if (advanceTo !== null) prevRef.current = advanceTo;
      return;
    }

    inFlightRef.current = true;
    const fire = async () => {
      try {
        // Resolve this device's user sync_id for completion attribution.
        const muRaw = localStorage.getItem(MULTI_USER_CONFIG_KEY);
        const meUserSyncId = muRaw ? (JSON.parse(muRaw).meUserSyncId || null) : null;

        // Build a RAW intent per change (NOT an envelope — encryption happens at
        // flush in the per-target deliverer). The payload's event_id, stable per
        // change, is the outbox id AND the server idempotency key, and flows
        // unchanged through every retry.
        const items = emits.map(({ task, change }) => {
          const payload = buildNotifyPayload(task, change, now, meUserSyncId);
          const intent = {
            event_id: payload.event_id,
            action: 'notify',
            emitted_by: 'app.dayglance',
            payload,
          };
          return {
            intent,
            onOk: () => {
              logActivity({
                direction: 'out', action: 'notify', event: change.event,
                source_app: task.source_app, title: task.title, timestamp: now,
                status: 'ok', error: null,
                event_id: payload.event_id, delivery: 'queued',
              });
              // Android broadcast for local Tasker listeners — a LOCAL notification,
              // independent of the durable outbox. Only on a plaintext WebDAV posture
              // (encrypted payloads are unusable by keyless local listeners).
              if (isNativeAndroid() && !config?.encryptionEnabled) {
                try { window.DayGlanceNative?.sendNotifyBroadcast?.(JSON.stringify(payload)); } catch (_) {}
              }
            },
            onError: (err) => {
              console.warn('[notify] enqueue failed for task', task.id, ':', err.message);
              logActivity({
                direction: 'out', action: 'notify', event: change.event,
                source_app: task.source_app, title: task.title, timestamp: now,
                status: 'error', error: err.name ?? err.message,
              });
            },
          };
        });

        // Advance the change-snapshot ONLY after the intents are durably queued.
        const allEnqueued = await enqueueAndFlush(items, targets);
        if (allEnqueued) prevRef.current = allTasks;
      } finally {
        inFlightRef.current = false;
        bump(); // re-run the effect to catch any change from the in-flight window
      }
    };

    fire();
  });
}
