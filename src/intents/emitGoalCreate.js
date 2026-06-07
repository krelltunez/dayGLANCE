import { buildEnvelope, buildEncryptedEnvelope, ENTITY_TYPES, SOURCE_APPS, deriveEnvelopeKey } from '@glance-apps/intents';
import { loadIntentsRootKey } from './intentsKeyStore.js';
import { writeEventFile, writeEventFileICloud, INTENT_CONFIG_KEY } from './useIntentPoller.js';
import { logActivity } from './intentLog.js';

/**
 * Emit an outbound `create` intent for a dayGLANCE Goal so lifeGLANCE can
 * pick it up and create a mirrored milestone.
 *
 * Fire-and-forget: the caller does not need to await this.
 * No-ops silently if the WebDAV intents config is absent.
 */
// Produces a stable event_id in the required `20260607T014953Z-xxxxxx` format,
// derived deterministically from the goal so retries emit the same filename.
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
  const hasWebDAV = !!(config?.webdavUrl && config?.username && config?.appPassword);
  if (!hasWebDAV) return;

  const payload = {
    title: goal.title,
    ...(goal.targetDate ? { due: goal.targetDate } : {}),
    entity_type: ENTITY_TYPES.GOAL,
    source_app: SOURCE_APPS.DAYGLANCE,
    source_entity_id: goal.id,
  };

  const now = new Date().toISOString();

  let deriveKey = null;
  if (config.encryptionEnabled) {
    const rootKey = await loadIntentsRootKey();
    if (!rootKey) {
      console.warn('[goal-create] intents encryption setup incomplete — skipping emit');
      logActivity({
        direction: 'out',
        action: 'create',
        event: null,
        source_app: SOURCE_APPS.DAYGLANCE,
        title: goal.title,
        timestamp: now,
        status: 'error',
        error: 'setup_incomplete',
      });
      return;
    }
    deriveKey = (salt) => deriveEnvelopeKey(rootKey, salt);
  }

  try {
    const eventId = await stableEventId(goal);
    const envelope = deriveKey
      ? await buildEncryptedEnvelope({ action: 'create', payload, emittedBy: SOURCE_APPS.DAYGLANCE, eventId }, deriveKey)
      : buildEnvelope({ action: 'create', payload, emittedBy: SOURCE_APPS.DAYGLANCE, eventId });
    await writeEventFile(config, envelope);
    await writeEventFileICloud(config, envelope);
    logActivity({
      direction: 'out',
      action: 'create',
      event: null,
      source_app: SOURCE_APPS.DAYGLANCE,
      title: goal.title,
      timestamp: now,
      status: 'ok',
      error: null,
    });
  } catch (err) {
    console.warn('[goal-create] emit failed for goal', goal.id, ':', err.message);
    logActivity({
      direction: 'out',
      action: 'create',
      event: null,
      source_app: SOURCE_APPS.DAYGLANCE,
      title: goal.title,
      timestamp: now,
      status: 'error',
      error: err.name ?? err.message,
    });
  }
}
