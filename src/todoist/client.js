import { mergeResponse } from './core.js';
// No proxy, configurable host, telemetry, token-in-URL, or logged response body.
export const TODOIST_ENDPOINT = 'https://api.todoist.com/api/v1/sync';
export async function requestSync(token, cursor = '*', commands = [], { signal, fetchImpl = globalThis.fetch } = {}) {
  if (!token?.trim() || /[\r\n]/.test(token)) throw new Error('tokenRequired');
  const body = new URLSearchParams({ sync_token: cursor,
    resource_types: JSON.stringify(['items', 'projects', 'labels', 'user']) });
  if (commands.length) body.set('commands', JSON.stringify(commands.map(({ uuid, type, args }) => ({ uuid, type, args }))));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 30000);
  try {
    const response = await fetchImpl(TODOIST_ENDPOINT, {
      method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body, signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(response.status === 401 || response.status === 403 ? 'unauthorized'
        : response.status === 429 ? 'rateLimited' : 'requestFailed');
      error.retryAfter = response.status === 429 ? Math.max(60, Number(response.headers.get('Retry-After')) || 60) : 0;
      throw error;
    }
    try { return await response.json(); } catch { throw new Error('invalidResponse'); }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('cancelled');
    if (error instanceof TypeError) throw new Error('networkError');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export const CONFIG_KEY = 'dg-todoist-config-v1';
export const TOKEN_KEY = 'dg-todoist-token-v1';
export const ACCOUNT_KEY = 'dg-todoist-account-v1';
export const stateKey = id => `dg-todoist-state-v1:${id}`;
export function readJSON(storage, key, fallback) {
  const raw = storage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { throw new Error('storageCorrupt'); }
}
export function writeJSON(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { throw new Error('storageFull'); }
}

// Verify identity first, then resume the saved cursor rather than discarding
// completions received while the app was closed. Never write during connect.
export async function connectAccount(token, loadStored, options = {}) {
  const fresh = mergeResponse({}, await requestSync(token, '*', [], options));
  const stored = loadStored(String(fresh.user.id));
  const base = stored.cache?.cursor ? stored.cache : fresh;
  const cache = mergeResponse(base, await requestSync(token, base.cursor, [], options));
  if (String(cache.user.id) !== String(fresh.user.id)) throw new Error('accountChanged');
  return { cache, stored };
}

// Returns the number of unconfirmed receipts. A pending queue is deliberately
// not erased: after reconnecting, retries must reuse the original UUIDs.
export function clearIdleCache(storage, accountId) {
  const key = stateKey(accountId);
  const stored = readJSON(storage, key, {});
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)
    || (stored.queue != null && !Array.isArray(stored.queue))) {
    throw new Error('storageCorrupt');
  }
  const pending = stored.queue?.length || 0;
  if (pending === 0) {
    try { storage.removeItem(key); } catch { throw new Error('storageFull'); }
  }
  return pending;
}
