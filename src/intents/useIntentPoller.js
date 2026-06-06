import { useEffect, useRef } from 'react';
import { parseEnvelope, parseEncryptedEnvelope, filenameFor, parseFilename, deriveEnvelopeKey, NoKeyError, WrongKeyError, NotEncryptedError, MalformedEnvelopeError, ACTIONS } from '@glance-apps/intents';
import { loadIntentsRootKey } from './intentsKeyStore.js';
import { webdavFetch } from '../utils/cloudSyncProviders.js';
import { handleIntent } from './handleIntent.js';
import { logActivity } from './intentLog.js';
import * as iCloudTransport from './icloudFileTransport.js';

export const INTENT_CONFIG_KEY = 'dayglance-intent-config';
export const MULTI_USER_CONFIG_KEY = 'dayglance-multi-user-config';
const CURSOR_KEY = 'dayglance-intent-cursor';
const GC_LAST_RUN_KEY = 'dayglance-intent-gc-last-run';
const DEFAULT_EVENTS_PATH = '/GLANCE/events/';
const DEFAULT_FG_MS = 2 * 60 * 1000;    // 2 minutes
const DEFAULT_BG_MS = 15 * 60 * 1000;   // 15 minutes
const DEFAULT_RETENTION_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// The tray popup holds a read-only state snapshot; it must never poll for
// intents because processing an event would advance the cursor and consume
// the event before the main window can act on it.
const isTrayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tray');

// Module-level lock: prevents React StrictMode's double-mount from running two
// concurrent poll() calls, which would both see cursor=null and duplicate tasks.
let pollLock = false;

// Separate lock for iCloud polls so they don't run concurrently.
let iCloudPollLock = false;

// ─── helpers ────────────────────────────────────────────────────────────────

function authHeaders(config) {
  const cred = btoa(`${config.username}:${config.appPassword}`);
  return { 'X-WebDAV-Auth': `Basic ${cred}` };
}

function eventsDir(config) {
  const base = (config.webdavUrl ?? '').replace(/\/+$/, '');
  const path = (config.eventsPath ?? DEFAULT_EVENTS_PATH).replace(/\/+$/, '') + '/';
  return `${base}${path}`;
}

function getCursor() {
  return localStorage.getItem(CURSOR_KEY) || null;
}

function setCursor(id) {
  localStorage.setItem(CURSOR_KEY, id);
}

// '20260510T143022Z' → Date
function parseFilenameDate(ts) {
  const iso = ts.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    '$1-$2-$3T$4:$5:$6Z',
  );
  return new Date(iso);
}

// ─── public: write one event file to WebDAV ─────────────────────────────────

/**
 * PUT a single envelope as a JSON file into the intent events directory.
 * Creates the directory (MKCOL) on first use. Silently no-ops if config is absent.
 */
export async function writeEventFile(config, envelope) {
  if (!config?.webdavUrl || !config?.username || !config?.appPassword) return;

  const dir = eventsDir(config);
  const filename = filenameFor(envelope);
  const fileUrl = `${dir}${filename}`;
  const body = JSON.stringify(envelope);
  const headers = { ...authHeaders(config), 'Content-Type': 'application/json' };

  let res = await webdavFetch('PUT', fileUrl, headers, body);
  if (res.status === 403 || res.status === 404 || res.status === 409) {
    await webdavFetch('MKCOL', dir, authHeaders(config));
    res = await webdavFetch('PUT', fileUrl, headers, body);
  }
  if (!res.ok) {
    console.error('[intent] writeEventFile failed:', res.status, filename);
  }
}

// ─── public: garbage-collect old event files ────────────────────────────────

/**
 * Delete event files older than config.gcRetentionDays (default 30).
 * Best-effort: 404 responses (already deleted by another app) are treated as
 * success. Silently no-ops if config is absent.
 */
export async function runIntentGC(config) {
  if (!config?.webdavUrl || !config?.username || !config?.appPassword) return;

  const dir = eventsDir(config);
  const headers = authHeaders(config);
  const retentionMs = (config.gcRetentionDays ?? DEFAULT_RETENTION_DAYS) * ONE_DAY_MS;
  const cutoff = Date.now() - retentionMs;

  let res;
  try {
    res = await webdavFetch('PROPFIND', dir, headers, undefined, { Depth: '1' });
  } catch (err) {
    console.warn('[intent-gc] PROPFIND error:', err.message);
    return;
  }

  if (res.status === 404) return; // directory doesn't exist yet
  if (!res.ok) {
    console.warn('[intent-gc] PROPFIND returned', res.status);
    return;
  }

  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const files = [...doc.querySelectorAll('response href')]
    .map(el => decodeURIComponent(el.textContent.trim().split('/').filter(Boolean).pop()))
    .filter(name => name.endsWith('.json'))
    .map(name => ({ name, parsed: parseFilename(name) }))
    .filter(f => f.parsed !== null);

  let deleted = 0;
  for (const { name, parsed } of files) {
    const fileDate = parseFilenameDate(parsed.timestamp);
    if (isNaN(fileDate) || fileDate.getTime() > cutoff) continue;

    try {
      const delRes = await webdavFetch('DELETE', `${dir}${name}`, headers);
      if (delRes.ok || delRes.status === 404) {
        deleted++;
      } else {
        console.warn('[intent-gc] DELETE failed:', delRes.status, name);
      }
    } catch (err) {
      console.warn('[intent-gc] DELETE error:', name, err.message);
    }
  }

  if (deleted > 0) {
    console.log(`[intent-gc] Deleted ${deleted} expired event file(s)`);
  }

  localStorage.setItem(GC_LAST_RUN_KEY, new Date().toISOString());
}

// ─── iCloud: write one event file ───────────────────────────────────────────

/**
 * Write a single envelope as a JSON file to iCloud Drive.
 * No-ops if iCloud is unavailable. Creates the events directory on first use.
 */
export async function writeEventFileICloud(config, envelope) {
  if (!iCloudTransport.isAvailable()) return;
  const eventsRelPath = ((config?.eventsPath ?? DEFAULT_EVENTS_PATH).replace(/^\//, '').replace(/\/*$/, '')) + '/';
  const filename = filenameFor(envelope);
  const filePath = eventsRelPath + filename;
  const body = JSON.stringify(envelope);
  const ok = await iCloudTransport.writeFile(filePath, body);
  if (!ok) {
    // Directory may not exist yet — create it and retry
    await iCloudTransport.makeDir(eventsRelPath);
    await iCloudTransport.writeFile(filePath, body);
  }
}

// ─── iCloud: garbage-collect old event files ─────────────────────────────────

/**
 * Delete iCloud event files older than config.gcRetentionDays.
 * Best-effort; no-ops if iCloud is unavailable.
 */
export async function runIntentGCICloud(config) {
  if (!iCloudTransport.isAvailable()) return;
  const eventsRelPath = ((config?.eventsPath ?? DEFAULT_EVENTS_PATH).replace(/^\//, '').replace(/\/*$/, '')) + '/';
  const retentionMs = (config?.gcRetentionDays ?? DEFAULT_RETENTION_DAYS) * ONE_DAY_MS;
  const cutoff = Date.now() - retentionMs;

  let names;
  try {
    names = await iCloudTransport.listFiles(eventsRelPath);
  } catch (err) {
    console.warn('[intent-gc/icloud] listFiles error:', err.message);
    return;
  }

  const files = names
    .filter(name => name.endsWith('.json'))
    .map(name => ({ name, parsed: parseFilename(name) }))
    .filter(f => f.parsed !== null);

  let deleted = 0;
  for (const { name, parsed } of files) {
    const fileDate = parseFilenameDate(parsed.timestamp);
    if (isNaN(fileDate) || fileDate.getTime() > cutoff) continue;
    try {
      await iCloudTransport.deleteFile(eventsRelPath + name);
      deleted++;
    } catch (err) {
      console.warn('[intent-gc/icloud] deleteFile error:', name, err.message);
    }
  }

  if (deleted > 0) {
    console.log(`[intent-gc/icloud] Deleted ${deleted} expired event file(s)`);
  }
}

// ─── iCloud: poll once ──────────────────────────────────────────────────────

async function pollICloud(config, context) {
  if (iCloudPollLock) return;
  iCloudPollLock = true;
  try {
    await _pollICloud(config, context);
  } finally {
    iCloudPollLock = false;
  }
}

async function _pollICloud(config, context) {
  const eventsRelPath = ((config?.eventsPath ?? DEFAULT_EVENTS_PATH).replace(/^\//, '').replace(/\/*$/, '')) + '/';

  let names;
  try {
    names = await iCloudTransport.listFiles(eventsRelPath);
  } catch (err) {
    console.warn('[intent/icloud] listFiles error:', err.message);
    return;
  }

  const files = names
    .filter(name => name.endsWith('.json'))
    .map(name => ({ name, parsed: parseFilename(name) }))
    .filter(f => f.parsed !== null)
    .sort((a, b) => a.parsed.event_id.localeCompare(b.parsed.event_id));

  const cursor = getCursor();
  const pending = cursor ? files.filter(f => f.parsed.event_id > cursor) : files;

  for (const { name, parsed } of pending) {
    try {
      const rawStr = await iCloudTransport.readFile(eventsRelPath + name);
      if (rawStr === null || rawStr === 'null') {
        setCursor(parsed.event_id);
        continue;
      }

      // Still downloading from iCloud — skip for now; next poll will retry
      let raw;
      try {
        raw = JSON.parse(rawStr);
      } catch {
        setCursor(parsed.event_id);
        continue;
      }

      if (raw?.downloading === true) {
        // Don't advance cursor — retry on next poll
        continue;
      }

      // iCloud transport should never carry encrypted envelopes — skip with warning
      if (raw?.encrypted === true) {
        console.warn('[intent/icloud] Skipping encrypted envelope on iCloud transport (misconfigured sender):', name);
        logActivity({
          direction: 'in',
          action: 'unknown',
          event: null,
          source_app: null,
          title: null,
          timestamp: new Date().toISOString(),
          status: 'warn',
          error: 'encrypted_on_icloud',
        });
        setCursor(parsed.event_id);
        continue;
      }

      if (raw?.emitted_by === 'app.dayglance') {
        setCursor(parsed.event_id);
        continue;
      }

      let envelope;
      try {
        envelope = parseEnvelope(raw);
      } catch (parseErr) {
        let errorCode = parseErr.name ?? 'parse_error';
        let logStatus = 'error';
        if (parseErr instanceof MalformedEnvelopeError) {
          console.warn('[intent/icloud] Skipping malformed envelope:', name, parseErr.message);
          logStatus = 'warn';
        } else if (parseErr instanceof NotEncryptedError) {
          console.warn('[intent/icloud] Skipping malformed envelope:', name);
        } else {
          console.warn('[intent/icloud] Unparseable envelope, skipping:', name);
          errorCode = 'parse_error';
        }
        logActivity({
          direction: 'in',
          action: 'unknown',
          event: null,
          source_app: null,
          title: null,
          timestamp: new Date().toISOString(),
          status: logStatus,
          error: errorCode,
        });
        setCursor(parsed.event_id);
        continue;
      }

      if (envelope.emitted_by === 'app.dayglance') {
        setCursor(parsed.event_id);
        continue;
      }

      // Multi-user visibility filter
      if (envelope.action === ACTIONS.CREATE) {
        const multiUserEnabled = JSON.parse(localStorage.getItem('dayglance-multi-user-enabled') || 'false');
        const muRaw = localStorage.getItem(MULTI_USER_CONFIG_KEY);
        const meUserSyncId = muRaw ? JSON.parse(muRaw).meUserSyncId : null;
        if (multiUserEnabled && meUserSyncId) {
          const assigned = envelope.payload.assigned_user_ids ?? [];
          if (assigned.length > 0 && !assigned.includes(meUserSyncId)) {
            logActivity({
              direction: 'in',
              action: envelope.action,
              event: null,
              source_app: envelope.payload.source_app ?? envelope.emitted_by ?? null,
              title: envelope.payload.title ?? null,
              timestamp: envelope.emitted_at,
              status: 'ok',
              error: null,
            });
            setCursor(parsed.event_id);
            continue;
          }
        }
      }

      const result = await handleIntent(envelope.action, envelope.payload, { ...context, eventId: envelope.event_id });
      logActivity({
        direction: 'in',
        action: envelope.action,
        event: envelope.payload.event ?? null,
        source_app: envelope.payload.source_app ?? envelope.emitted_by ?? null,
        title: envelope.payload.title ?? null,
        timestamp: envelope.emitted_at,
        status: result.success ? 'ok' : 'error',
        error: result.success ? null : result.error,
      });
    } catch (err) {
      console.warn('[intent/icloud] Error processing', name, ':', err.message);
      logActivity({
        direction: 'in',
        action: 'unknown',
        event: null,
        source_app: null,
        title: null,
        timestamp: new Date().toISOString(),
        status: 'error',
        error: err.message,
      });
    }

    setCursor(parsed.event_id);
  }
}

// ─── poll once ──────────────────────────────────────────────────────────────

async function poll(config, context) {
  if (pollLock) return;
  pollLock = true;
  try {
    await _poll(config, context);
  } finally {
    pollLock = false;
  }
}

async function _poll(config, context) {
  const dir = eventsDir(config);
  const headers = authHeaders(config);

  let res;
  try {
    res = await webdavFetch('PROPFIND', dir, headers, undefined, { Depth: '1' });
  } catch (err) {
    console.warn('[intent] PROPFIND error:', err.message);
    return;
  }

  if (res.status === 404) return; // events dir not created yet — nothing to process
  if (!res.ok) {
    console.warn('[intent] PROPFIND returned', res.status);
    return;
  }

  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const files = [...doc.querySelectorAll('response href')]
    .map(el => decodeURIComponent(el.textContent.trim().split('/').filter(Boolean).pop()))
    .filter(name => name.endsWith('.json'))
    .map(name => ({ name, parsed: parseFilename(name) }))
    .filter(f => f.parsed !== null)
    .sort((a, b) => a.parsed.event_id.localeCompare(b.parsed.event_id));

  const cursor = getCursor();
  // event_id is a sortable timestamp string: only process files strictly after cursor
  const pending = cursor ? files.filter(f => f.parsed.event_id > cursor) : files;

  for (const { name, parsed } of pending) {
    try {
      const fileRes = await webdavFetch('GET', `${dir}${name}`, headers);
      if (!fileRes.ok) {
        console.warn('[intent] GET failed:', fileRes.status, name);
        setCursor(parsed.event_id);
        continue;
      }

      const raw = await fileRes.json();

      // Check emitted_by on the raw object before parsing. Our own notify
      // envelopes use a different action schema that parseEnvelope rejects as
      // malformed, so the post-parse check would never be reached for them.
      if (raw?.emitted_by === 'app.dayglance') {
        setCursor(parsed.event_id);
        continue;
      }

      let envelope;
      try {
        if (raw?.encrypted === true) {
          const rootKey = await loadIntentsRootKey();
          if (!rootKey) {
            // Encrypted envelope received but intents encryption not set up on this device.
            console.warn('[intent] Skipping encrypted event — intents encryption not set up:', name);
            logActivity({
              direction: 'in',
              action: 'unknown',
              event: null,
              source_app: null,
              title: null,
              timestamp: new Date().toISOString(),
              status: 'error',
              error: 'no_root_key',
            });
            setCursor(parsed.event_id);
            continue;
          }
          envelope = await parseEncryptedEnvelope(raw, (salt) => deriveEnvelopeKey(rootKey, salt));
        } else {
          envelope = parseEnvelope(raw);
        }
      } catch (parseErr) {
        let errorCode = parseErr.name ?? 'parse_error';
        // MalformedEnvelopeError means the envelope decrypted fine but failed schema
        // validation — a protocol mismatch, not a genuine key/network failure.
        // Log as 'warn' so it gets an amber badge rather than red in the activity log.
        let logStatus = 'error';
        if (parseErr instanceof NoKeyError) {
          console.warn('[intent] Skipping encrypted event (no key):', name);
        } else if (parseErr instanceof WrongKeyError) {
          console.warn('[intent] Skipping encrypted event (wrong key):', name);
        } else if (parseErr instanceof MalformedEnvelopeError) {
          console.warn('[intent] Skipping malformed envelope:', name, parseErr.message);
          logStatus = 'warn';
        } else if (parseErr instanceof NotEncryptedError) {
          console.warn('[intent] Skipping malformed envelope:', name);
        } else {
          console.warn('[intent] Unparseable envelope, skipping:', name);
          errorCode = 'parse_error';
        }
        logActivity({
          direction: 'in',
          action: 'unknown',
          event: null,
          source_app: null,
          title: null,
          timestamp: new Date().toISOString(),
          status: logStatus,
          error: errorCode,
        });
        setCursor(parsed.event_id);
        continue;
      }

      // Skip events we emitted ourselves to prevent loopback
      if (envelope.emitted_by === 'app.dayglance') {
        setCursor(parsed.event_id);
        continue;
      }

      // Multi-user visibility filter: skip CREATE intents not assigned to this device's user.
      if (envelope.action === ACTIONS.CREATE) {
        const multiUserEnabled = JSON.parse(localStorage.getItem('dayglance-multi-user-enabled') || 'false');
        const muRaw = localStorage.getItem(MULTI_USER_CONFIG_KEY);
        const meUserSyncId = muRaw ? JSON.parse(muRaw).meUserSyncId : null;
        if (multiUserEnabled && meUserSyncId) {
          const assigned = envelope.payload.assigned_user_ids ?? [];
          if (assigned.length > 0 && !assigned.includes(meUserSyncId)) {
            logActivity({
              direction: 'in',
              action: envelope.action,
              event: null,
              source_app: envelope.payload.source_app ?? envelope.emitted_by ?? null,
              title: envelope.payload.title ?? null,
              timestamp: envelope.emitted_at,
              status: 'ok',
              error: null,
            });
            setCursor(parsed.event_id);
            continue;
          }
        }
      }

      const result = await handleIntent(envelope.action, envelope.payload, { ...context, eventId: envelope.event_id });
      logActivity({
        direction: 'in',
        action: envelope.action,
        event: envelope.payload.event ?? null,
        source_app: envelope.payload.source_app ?? envelope.emitted_by ?? null,
        title: envelope.payload.title ?? null,
        timestamp: envelope.emitted_at,
        status: result.success ? 'ok' : 'error',
        error: result.success ? null : result.error,
      });
    } catch (err) {
      console.warn('[intent] Error processing', name, ':', err.message);
      logActivity({
        direction: 'in',
        action: 'unknown',
        event: null,
        source_app: null,
        title: null,
        timestamp: new Date().toISOString(),
        status: 'error',
        error: err.message,
      });
    }

    setCursor(parsed.event_id);
  }
}

// ─── hook ────────────────────────────────────────────────────────────────────

/**
 * Polls the WebDAV intent event log on a configurable cadence, processing
 * new events through handleIntent. Runs GC once per day (checked on mount
 * and rescheduled every 24 h while the app stays open).
 * Config is read from localStorage at mount; no-ops when unconfigured.
 *
 * context shape: { tasks, unscheduledTasks, recurringTasks, projects,
 *                  setTasks, setUnscheduledTasks, setRecurringTasks, navigate }
 */
export function useIntentPoller(context) {
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (isTrayMode) return;

    const config = (() => {
      const raw = localStorage.getItem(INTENT_CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    })();

    const hasWebDAV = !!(config?.webdavUrl && config?.username && config?.appPassword);
    const hasICloud = iCloudTransport.isAvailable();
    if (!hasWebDAV && !hasICloud) return;

    const fgMs = config?.foregroundInterval ?? DEFAULT_FG_MS;
    const bgMs = config?.backgroundInterval ?? DEFAULT_BG_MS;
    let pollTimerId = null;
    let gcTimerId = null;
    let destroyed = false;

    // ── polling ──────────────────────────────────────────────────────────────

    const scheduleNextPoll = () => {
      if (destroyed) return;
      pollTimerId = setTimeout(runPoll, document.hidden ? bgMs : fgMs);
    };

    const runPoll = async () => {
      if (destroyed) return;
      try {
        await poll(config, contextRef.current);           // WebDAV (no-ops if not configured)
        if (iCloudTransport.isAvailable()) {
          await pollICloud(config, contextRef.current);   // iCloud (sequential, sees advanced cursor)
        }
      } catch (err) {
        console.warn('[intent] poll error:', err.message);
      }
      scheduleNextPoll();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        clearTimeout(pollTimerId);
        runPoll();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ── GC ───────────────────────────────────────────────────────────────────

    const scheduleNextGC = () => {
      if (destroyed) return;
      gcTimerId = setTimeout(runGC, ONE_DAY_MS);
    };

    const runGC = async () => {
      if (destroyed) return;
      try {
        await runIntentGC(config);
        await runIntentGCICloud(config);
      } catch (err) {
        console.warn('[intent-gc] error:', err.message);
      }
      scheduleNextGC();
    };

    // Run GC on mount if it hasn't run in the last 24 h
    const lastGC = localStorage.getItem(GC_LAST_RUN_KEY);
    const gcDue = !lastGC || (Date.now() - new Date(lastGC).getTime() > ONE_DAY_MS);
    if (gcDue) {
      runGC();
    } else {
      // Schedule next GC for when the 24 h window expires
      const msSinceLastGC = Date.now() - new Date(lastGC).getTime();
      gcTimerId = setTimeout(runGC, ONE_DAY_MS - msSinceLastGC);
    }

    // ── initial poll ─────────────────────────────────────────────────────────
    runPoll();

    return () => {
      destroyed = true;
      clearTimeout(pollTimerId);
      clearTimeout(gcTimerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}

