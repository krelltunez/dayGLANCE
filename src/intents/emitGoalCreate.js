import { ENTITY_TYPES, SOURCE_APPS } from '@glance-apps/intents';
import { INTENT_CONFIG_KEY } from './useIntentPoller.js';
import { enabledIntentTargets } from './emitTargets.js';
import { enqueueAndFlush } from './outboxEmit.js';
import { logActivity } from './intentLog.js';

/**
 * Emit an outbound `create` intent for a dayGLANCE Goal so lifeGLANCE can
 * pick it up and create a mirrored milestone.
 *
 * Fire-and-forget: the caller does not need to await this. The intent is queued
 * in the durable outbox (so it survives failures/restarts) and a flush is
 * triggered; encryption happens at flush inside the per-target deliverer.
 * No-ops silently if no transport target is enabled.
 */
// Produces a stable event_id in the required `20260607T014953Z-xxxxxx` format,
// derived deterministically from the goal so retries reuse the same id (it is
// the outbox entry id AND the server idempotency key).
async function stableEventId(goal) {
  const ts = new Date(goal.createdAt)
    .toISOString()
    .replace(/-/g, '')
    .replace(/:/g, '')
    .replace(/\.\d+/, '');
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(goal.id))
  );
  const hex = [...hash.slice(0, 3)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${ts}-${hex}`;
}

export async function emitGoalCreate(goal) {
  const raw = localStorage.getItem(INTENT_CONFIG_KEY);
  const config = raw ? JSON.parse(raw) : null;

  // Targets enabled for this emit ('webdav' | 'icloud' | 'vault'). Nothing
  // enabled → nowhere to send; no-op.
  const targets = enabledIntentTargets(config);
  if (targets.length === 0) return;

  const payload = {
    title: goal.title,
    ...(goal.targetDate ? { due: goal.targetDate } : {}),
    entity_type: ENTITY_TYPES.GOAL,
    source_app: SOURCE_APPS.DAYGLANCE,
    source_entity_id: goal.id,
  };

  const now = new Date().toISOString();

  const eventId = await stableEventId(goal);
  // RAW intent — encryption happens at flush in the per-target deliverer. The
  // deterministic eventId is the outbox id AND the server idempotency key.
  const intent = {
    event_id: eventId,
    action: 'create',
    emitted_by: SOURCE_APPS.DAYGLANCE,
    payload,
  };

  await enqueueAndFlush([{
    intent,
    onOk: () => logActivity({
      direction: 'out', action: 'create', event: null,
      source_app: SOURCE_APPS.DAYGLANCE, title: goal.title, timestamp: now,
      status: 'ok', error: null,
    }),
    onError: (err) => {
      console.warn('[goal-create] enqueue failed for goal', goal.id, ':', err.message);
      logActivity({
        direction: 'out', action: 'create', event: null,
        source_app: SOURCE_APPS.DAYGLANCE, title: goal.title, timestamp: now,
        status: 'error', error: err.name ?? err.message,
      });
    },
  }], targets);
}
