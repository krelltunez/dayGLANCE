import { useEffect, useRef } from 'react';
import { buildEnvelope, buildEncryptedEnvelope, eventId as makeEventId, EVENTS, ENTITY_TYPES, deriveEnvelopeKey } from '@glance-apps/intents';
import { loadIntentsRootKey } from './intentsKeyStore.js';
import { writeEventFile, writeEventFileICloud, INTENT_CONFIG_KEY } from './useIntentPoller.js';
import { logActivity } from './intentLog.js';
import * as iCloudTransport from './icloudFileTransport.js';

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
 * Watches goals for changes to goals that carry source_app + source_entity_id,
 * and emits a WebDAV notify event for each state change. No-ops when the intent
 * WebDAV config is absent.
 *
 * Mirrors useNotifyEmitter but for the Goals entity type.
 */
export function useGoalNotifyEmitter({ goals }) {
  const prevRef = useRef(null);

  useEffect(() => {
    if (isTrayMode) return;

    const config = (() => {
      const raw = localStorage.getItem(INTENT_CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    })();

    const prev = prevRef.current;
    prevRef.current = goals;

    if (prev === null) return;

    const hasWebDAV = !!(config?.webdavUrl && config?.username && config?.appPassword);
    const hasICloud = iCloudTransport.isAvailable();
    if (!hasWebDAV && !hasICloud) return;

    const prevMap = new Map(prev.map(g => [g.id, g]));
    const nextMap = new Map(goals.map(g => [g.id, g]));
    const now = new Date().toISOString();

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

    if (!emits.length) return;

    const fire = async () => {
      let deriveKey = null;
      if (config.encryptionEnabled) {
        const rootKey = await loadIntentsRootKey();
        if (!rootKey) {
          console.warn('[goal-notify] intents encryption setup incomplete — skipping', emits.length, 'emit(s)');
          logActivity({
            direction: 'out',
            action: 'notify',
            event: null,
            source_app: null,
            title: null,
            timestamp: now,
            status: 'error',
            error: 'setup_incomplete',
          });
          return;
        }
        deriveKey = (salt) => deriveEnvelopeKey(rootKey, salt);
      }

      for (const { goal, change } of emits) {
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

        try {
          const envelope = deriveKey
            ? await buildEncryptedEnvelope({ action: 'notify', payload, emittedBy: 'app.dayglance' }, deriveKey)
            : buildEnvelope({ action: 'notify', payload, emittedBy: 'app.dayglance' });
          await writeEventFile(config, envelope);
          await writeEventFileICloud(config, envelope);
          logActivity({
            direction: 'out',
            action: 'notify',
            event: change.event,
            source_app: goal.source_app,
            title: goal.title,
            timestamp: now,
            status: 'ok',
            error: null,
          });
        } catch (err) {
          console.warn('[goal-notify] emit failed for goal', goal.id, ':', err.message);
          logActivity({
            direction: 'out',
            action: 'notify',
            event: change.event,
            source_app: goal.source_app,
            title: goal.title,
            timestamp: now,
            status: 'error',
            error: err.name ?? err.message,
          });
        }
      }
    };

    fire();
  });
}
