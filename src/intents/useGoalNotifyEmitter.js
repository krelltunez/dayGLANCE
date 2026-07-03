import { useEffect, useRef, useReducer } from 'react';
import { eventId as makeEventId, EVENTS, ENTITY_TYPES } from '@glance-apps/intents';
import { INTENT_CONFIG_KEY } from './useIntentPoller.js';
import { enabledIntentTargets } from './emitTargets.js';
import { enqueueAndFlush } from './outboxEmit.js';
import { logActivity } from './intentLog.js';

const isTrayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tray');

function shouldEmit(goal) {
  return !!(goal.source_app && goal.source_entity_id);
}

/**
 * Compare two goal snapshots and return the notify event that should fire,
 * or null if nothing notification-worthy changed.
 * Priority: completion state > rescheduled > updated.
 */
function detectGoalChange(prev, next) {
  if (prev.status !== 'completed' && next.status === 'completed') {
    return { event: EVENTS.COMPLETED };
  }
  if (prev.status === 'completed' && next.status !== 'completed') {
    return { event: EVENTS.UNCOMPLETED };
  }
  const prevDue = prev.targetDate ?? null;
  const nextDue = next.targetDate ?? null;
  if (prevDue !== nextDue) {
    return {
      event: EVENTS.RESCHEDULED,
      ...(nextDue ? { due: nextDue } : {}),
      ...(prevDue ? { previous_due: prevDue } : {}),
    };
  }
  if (
    prev.title !== next.title ||
    (prev.description ?? '') !== (next.description ?? '') ||
    (prev.color ?? '') !== (next.color ?? '')
  ) {
    return { event: EVENTS.UPDATED, ...(nextDue ? { due: nextDue } : {}) };
  }
  return null;
}

/**
 * Pure planner: decide what to emit for a prev→next goals snapshot transition,
 * and what the new baseline snapshot should be. Extracted from the effect so the
 * remote-apply guard and the deleted/changed diff are unit-testable without a
 * React renderer.
 *
 * Returns { emits, advanceTo }:
 *   - emits:     array of { goal, change } to enqueue (empty when nothing to send)
 *   - advanceTo: the snapshot to store as prevRef, or null to leave it unchanged
 *                (null while a fire() is in flight — it advances the ref itself,
 *                or when there are emits, which advance after a durable enqueue)
 *
 * The isRemoteApply branch is the echo guard: a goals change driven by a
 * sync/remote apply (applyEngineData's setGoals, or any merge-driven mutation)
 * must NOT emit an outbound intent — it did not come from the user. It is
 * consumed into the baseline silently, mirroring how the cloud-upload effect
 * bails on suppressCloudUploadRef. Without it, a merge that drops a goal (e.g.
 * re-applying a stale tombstone) looks identical to a user delete and echoes a
 * spurious `deleted` back to the source app.
 */
export function planGoalNotifyEmits(prev, next, { isRemoteApply = false, hasTargets = true, inFlight = false } = {}) {
  if (prev === null) return { emits: [], advanceTo: next };
  if (isRemoteApply) return { emits: [], advanceTo: next };
  if (inFlight) return { emits: [], advanceTo: null };
  if (!hasTargets) return { emits: [], advanceTo: next };

  const prevMap = new Map(prev.map(g => [g.id, g]));
  const nextMap = new Map(next.map(g => [g.id, g]));

  const emits = [];

  // Deleted: present in prev but gone from next
  for (const [id, prevGoal] of prevMap) {
    if (!shouldEmit(prevGoal)) continue;
    if (!nextMap.has(id)) {
      emits.push({ goal: prevGoal, change: { event: EVENTS.DELETED } });
    }
  }

  // Changed: present in both prev and next
  for (const [id, nextGoal] of nextMap) {
    if (!shouldEmit(nextGoal)) continue;
    const prevGoal = prevMap.get(id);
    if (!prevGoal) continue; // new goal — no notify for creation
    const change = detectGoalChange(prevGoal, nextGoal);
    if (change) emits.push({ goal: nextGoal, change });
  }

  if (!emits.length) return { emits: [], advanceTo: next };
  return { emits, advanceTo: null }; // advanced after durable enqueue
}

/**
 * Watches goals for changes to goals that carry source_app + source_entity_id,
 * and emits a WebDAV notify event for each state change. No-ops when the intent
 * WebDAV config is absent.
 *
 * Mirrors useNotifyEmitter but for the Goals entity type.
 *
 * `isRemoteApply` (optional) is a getter returning true while a sync/remote
 * apply is mutating goals state, so those changes are never echoed outbound.
 */
export function useGoalNotifyEmitter({ goals, isRemoteApply }) {
  const prevRef = useRef(null);
  const inFlightRef = useRef(false);
  const [, bump] = useReducer(x => x + 1, 0);

  useEffect(() => {
    if (isTrayMode) return;

    const config = (() => {
      const raw = localStorage.getItem(INTENT_CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    })();

    const targets = enabledIntentTargets(config);
    const now = new Date().toISOString();

    const { emits, advanceTo } = planGoalNotifyEmits(prevRef.current, goals, {
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
        const items = emits.map(({ goal, change }) => {
          const payload = {
            event_id: makeEventId(),
            source_app: goal.source_app,
            source_entity_id: goal.source_entity_id,
            event: change.event,
            task_id: goal.id,
            title: goal.title,
            timestamp: now,
            entity_type: ENTITY_TYPES.GOAL,
            ...(change.due !== undefined ? { due: change.due } : {}),
            ...(change.previous_due !== undefined ? { previous_due: change.previous_due } : {}),
            ...(change.event === EVENTS.COMPLETED ? { completed_at: now } : {}),
          };
          // RAW intent — encryption happens at flush in the per-target deliverer.
          const intent = {
            event_id: payload.event_id,
            action: 'notify',
            emitted_by: 'app.dayglance',
            payload,
          };
          return {
            intent,
            onOk: () => logActivity({
              direction: 'out', action: 'notify', event: change.event,
              source_app: goal.source_app, title: goal.title, timestamp: now,
              status: 'ok', error: null,
              event_id: payload.event_id, delivery: 'queued',
            }),
            onError: (err) => {
              console.warn('[goal-notify] enqueue failed for goal', goal.id, ':', err.message);
              logActivity({
                direction: 'out', action: 'notify', event: change.event,
                source_app: goal.source_app, title: goal.title, timestamp: now,
                status: 'error', error: err.name ?? err.message,
              });
            },
          };
        });

        // Advance the snapshot ONLY after durable enqueue.
        const allEnqueued = await enqueueAndFlush(items, targets);
        if (allEnqueued) prevRef.current = goals;
      } finally {
        inFlightRef.current = false;
        bump();
      }
    };

    fire();
  });
}
