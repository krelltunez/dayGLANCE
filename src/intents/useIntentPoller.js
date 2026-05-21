import { useEffect, useRef } from 'react';
import { parseEnvelope, filenameFor, parseFilename } from '@glance-apps/intents';
import { webdavFetch } from '../utils/cloudSyncProviders.js';
import { handleIntent } from './handleIntent.js';

export const INTENT_CONFIG_KEY = 'dayglance-intent-config';
const CURSOR_KEY = 'dayglance-intent-cursor';
const DEFAULT_EVENTS_PATH = '/GLANCE/events/';
const DEFAULT_FG_MS = 2 * 60 * 1000;   // 2 minutes
const DEFAULT_BG_MS = 15 * 60 * 1000;  // 15 minutes

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
  if (res.status === 404 || res.status === 409) {
    await webdavFetch('MKCOL', dir, authHeaders(config));
    res = await webdavFetch('PUT', fileUrl, headers, body);
  }
  if (!res.ok) {
    console.error('[intent] writeEventFile failed:', res.status, filename);
  }
}

// ─── poll once ──────────────────────────────────────────────────────────────

async function poll(config, context) {
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
      let envelope;
      try {
        envelope = parseEnvelope(raw);
      } catch {
        console.warn('[intent] Unparseable envelope, skipping:', name);
        setCursor(parsed.event_id);
        continue;
      }

      // Skip events we emitted ourselves to prevent loopback
      if (envelope.emitted_by === 'app.dayglance') {
        setCursor(parsed.event_id);
        continue;
      }

      await handleIntent(envelope.action, envelope.payload, context);
    } catch (err) {
      console.warn('[intent] Error processing', name, ':', err.message);
    }

    setCursor(parsed.event_id);
  }
}

// ─── hook ────────────────────────────────────────────────────────────────────

/**
 * Polls the WebDAV intent event log on a configurable cadence, processing
 * new events through handleIntent. Config is read from localStorage at mount.
 * Pass state and setters in `context`; the ref pattern ensures the poller
 * always sees the latest values without restarting the interval.
 *
 * context shape: { tasks, unscheduledTasks, recurringTasks, projects,
 *                  setTasks, setUnscheduledTasks, setRecurringTasks, navigate }
 */
export function useIntentPoller(context) {
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const config = (() => {
      const raw = localStorage.getItem(INTENT_CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    })();

    if (!config?.webdavUrl || !config?.username || !config?.appPassword) return;

    const fgMs = config.foregroundInterval ?? DEFAULT_FG_MS;
    const bgMs = config.backgroundInterval ?? DEFAULT_BG_MS;
    let timerId = null;
    let destroyed = false;

    const scheduleNext = () => {
      if (destroyed) return;
      timerId = setTimeout(run, document.hidden ? bgMs : fgMs);
    };

    const run = async () => {
      if (destroyed) return;
      try {
        await poll(config, contextRef.current);
      } catch (err) {
        console.warn('[intent] poll error:', err.message);
      }
      scheduleNext();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        clearTimeout(timerId);
        run();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    run();

    return () => {
      destroyed = true;
      clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
