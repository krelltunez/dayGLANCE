import { buildEnvelope, buildEncryptedEnvelope, SOURCE_APPS, deriveEnvelopeKey } from '@glance-apps/intents';
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
export async function emitGoalCreate(goal) {
  const raw = localStorage.getItem(INTENT_CONFIG_KEY);
  const config = raw ? JSON.parse(raw) : null;
  const hasWebDAV = !!(config?.webdavUrl && config?.username && config?.appPassword);
  if (!hasWebDAV) return;

  // entity_type is not in CreateSchema (it uses .strict()), so it cannot be
  // included in the validated payload. lifeGLANCE infers this is a goal create
  // from emitted_by === 'app.dayglance'; dayGLANCE infers the reverse the same way.
  const payload = {
    title: goal.title,
    ...(goal.targetDate ? { due: goal.targetDate } : {}),
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
    const envelope = deriveKey
      ? await buildEncryptedEnvelope({ action: 'create', payload, emittedBy: SOURCE_APPS.DAYGLANCE }, deriveKey)
      : buildEnvelope({ action: 'create', payload, emittedBy: SOURCE_APPS.DAYGLANCE });
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
