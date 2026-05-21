import { useEffect, useRef } from 'react';
import { buildEnvelope, eventId as makeEventId, EVENTS, ENTITY_TYPES } from '@glance-apps/intents';
import { writeEventFile, INTENT_CONFIG_KEY } from './useIntentPoller.js';
import { logActivity } from './intentLog.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Reconstruct an ISO due string from dayGLANCE's split date/time fields. */
function taskDue(task) {
  if (!task.date) return undefined;
  if (task.isAllDay) return task.date;
  return `${task.date}T${task.startTime}:00`;
}

/**
 * Compare two task snapshots and return the notify event that should fire,
 * or null if nothing notification-worthy changed. Priority: completion state
 * changes > rescheduled > updated.
 */
function detectChange(prev, next) {
  // Completion state changes
  if (!prev.completed && next.completed) {
    return { event: EVENTS.COMPLETED, completed_at: next.completedAt || new Date().toISOString() };
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

// ─── hook ────────────────────────────────────────────────────────────────────

/**
 * Watches tasks and unscheduledTasks for changes to tasks that carry
 * source_app + source_entity_id, and emits a WebDAV notify event for each
 * state change. No-ops when the intent WebDAV config is absent.
 *
 * Covered events: completed, uncompleted, deleted, rescheduled, updated.
 * Recurring templates are excluded — their completion model (completedDates)
 * differs from the boolean model assumed here.
 */
export function useNotifyEmitter({ tasks, unscheduledTasks }) {
  const prevRef = useRef(null);

  useEffect(() => {
    const config = (() => {
      const raw = localStorage.getItem(INTENT_CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    })();

    const allTasks = [...tasks, ...unscheduledTasks];
    const prev = prevRef.current;
    prevRef.current = allTasks;

    // Skip the initial snapshot — no previous state to diff against
    if (prev === null) return;
    // Skip emit when config is absent
    if (!config?.webdavUrl || !config?.username || !config?.appPassword) return;

    const prevMap = new Map(prev.map(t => [t.id, t]));
    const nextMap = new Map(allTasks.map(t => [t.id, t]));
    const now = new Date().toISOString();

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

    if (!emits.length) return;

    const fire = async () => {
      for (const { task, change } of emits) {
        try {
          const envelope = buildEnvelope({
            action: 'notify',
            payload: {
              event_id: makeEventId(),
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
            },
            emittedBy: 'app.dayglance',
          });
          await writeEventFile(config, envelope);
          logActivity({
            direction: 'out',
            action: 'notify',
            event: change.event,
            source_app: task.source_app,
            title: task.title,
            timestamp: now,
            status: 'ok',
            error: null,
          });
        } catch (err) {
          console.warn('[notify] emit failed for task', task.id, ':', err.message);
          logActivity({
            direction: 'out',
            action: 'notify',
            event: change.event,
            source_app: task.source_app,
            title: task.title,
            timestamp: now,
            status: 'error',
            error: err.message,
          });
        }
      }
    };

    fire();
  });
}
