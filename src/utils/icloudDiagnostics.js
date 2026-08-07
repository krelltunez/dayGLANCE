/**
 * iCloud diagnostics — what does this device actually see in the container?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * A "my data came back after deleting the app" report is hard to diagnose from
 * the outside, because every candidate store is invisible from the UI. The
 * question that matters is narrow and factual:
 *
 *     Does this device resolve an iCloud container, and is dayglance-sync.json
 *     sitting in it right now?
 *
 * Safari Web Inspector can answer that, but only on a Debug or TestFlight build
 * (WebView.swift gates isInspectable on a receipt check that is not reliable),
 * and it needs a Mac, a cable, and two settings toggles. This module answers the
 * same question from inside the app on any build.
 *
 * The reading that matters most: ICloudBridge.isAvailable() is a bare
 * `containerURL() != nil`, which answers "can I resolve a path", NOT "is iCloud
 * enabled for this app". If `available` reports true on a device where the user
 * has switched dayGLANCE's iCloud toggle OFF, that is the bug — the app is
 * reading a store the user believes they disabled. If it reports false, the
 * iCloud theory is dead and the surviving store is something else.
 *
 * Read-only by construction: nothing here writes, deletes, or triggers a sync.
 * Every platform API is injected so the whole thing is testable without a device.
 */

/** Shape returned when a probe cannot run on this platform. */
const UNSUPPORTED = 'unsupported';

/**
 * Byte length of a UTF-8 string. `str.length` counts UTF-16 code units, which
 * under-reports any payload containing emoji or non-Latin text — and task titles
 * routinely contain both.
 */
export function utf8Bytes(str, TextEncoderImpl = typeof TextEncoder !== 'undefined' ? TextEncoder : null) {
  if (typeof str !== 'string') return 0;
  if (!TextEncoderImpl) return str.length;
  return new TextEncoderImpl().encode(str).length;
}

/** Human-readable byte count. Diagnostics are read by people, not parsers. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Which Apple transport this device has, if any.
 * @returns {'ios'|'macos'|'none'}
 */
export function detectPlatform({ nativeBridge, electronAPI } = {}) {
  if (nativeBridge?.iCloudAvailable) return 'ios';
  if (electronAPI?.readICloud) return 'macos';
  return 'none';
}

/**
 * Probes container availability.
 *
 * iOS asks the bridge directly. macOS has no availability probe — electron/icloud.ts
 * resolves the container by raw filesystem path and never registers with the iCloud
 * daemon — so availability there can only be inferred from whether a read succeeds,
 * and is reported as null rather than guessed.
 *
 * @returns {{value: boolean|null, raw: string|null, error: string|null}}
 */
export function probeAvailability({ nativeBridge } = {}) {
  if (!nativeBridge?.iCloudAvailable) {
    return { value: null, raw: null, error: null };
  }
  let raw = null;
  try {
    raw = nativeBridge.iCloudAvailable();
    const parsed = JSON.parse(raw);
    if (parsed?.error) return { value: false, raw, error: String(parsed.error) };
    return { value: parsed?.available === true, raw, error: null };
  } catch (err) {
    return { value: null, raw, error: err?.message ?? String(err) };
  }
}

/**
 * Classifies the raw readICloudSync/readICloud response.
 *
 * The bridge overloads one string return across five outcomes, so this is the
 * single place that untangles them — see ICloudBridge.readSync for the contract.
 *
 * @returns {{state: 'present'|'absent'|'downloading'|'error'|'unsupported',
 *            bytes: number, lastModified: string|null, version: number|null,
 *            taskCount: number|null, inboxCount: number|null, error: string|null}}
 */
export function classifySnapshot(raw, deps = {}) {
  const empty = {
    state: UNSUPPORTED, bytes: 0, lastModified: null, version: null,
    taskCount: null, inboxCount: null, error: null,
  };
  if (raw == null) return { ...empty, state: 'absent' };
  if (raw === 'null' || raw === '') return { ...empty, state: 'absent' };

  const bytes = utf8Bytes(raw, deps.TextEncoderImpl);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Bytes are present but unparseable — a truncated or corrupt file. Worth
    // surfacing as its own state rather than folding into 'error', because it
    // still means the file EXISTS, which is the fact being investigated.
    return { ...empty, state: 'error', bytes, error: `unparseable JSON (${err?.message ?? err})` };
  }

  if (parsed?.downloading) return { ...empty, state: 'downloading', bytes };
  if (parsed?.error) return { ...empty, state: 'error', bytes, error: String(parsed.error) };

  return {
    state: 'present',
    bytes,
    lastModified: parsed?.lastModified ?? null,
    version: typeof parsed?.version === 'number' ? parsed.version : null,
    taskCount: Array.isArray(parsed?.data?.tasks) ? parsed.data.tasks.length : null,
    inboxCount: Array.isArray(parsed?.data?.unscheduledTasks) ? parsed.data.unscheduledTasks.length : null,
    error: null,
  };
}

/** Local counts + last-sync record, for comparison against the container copy. */
export function readLocalState({ localStorage } = {}) {
  const count = (key) => {
    try {
      const v = JSON.parse(localStorage?.getItem(key) || '[]');
      return Array.isArray(v) ? v.length : 0;
    } catch {
      return 0;
    }
  };
  let lastSynced = null;
  try {
    lastSynced = localStorage?.getItem('day-planner-cloud-sync-last-synced') ?? null;
  } catch {
    lastSynced = null;
  }
  return {
    taskCount: count('day-planner-tasks'),
    inboxCount: count('day-planner-unscheduled'),
    lastSynced,
  };
}

const defaultDeps = () => ({
  nativeBridge: typeof window !== 'undefined' ? window.DayGlanceNative : null,
  electronAPI: typeof window !== 'undefined' ? window.electronAPI : null,
  localStorage: typeof window !== 'undefined' ? window.localStorage : null,
});

/**
 * Runs every probe and returns a flat report.
 *
 * Deliberately user-triggered rather than run on render: readICloudSync is a
 * SYNCHRONOUS bridge call on iOS that returns the entire snapshot, so on a large
 * dataset it blocks the JS thread. Fine for a button press, not for mounting a
 * settings pane.
 *
 * @returns {Promise<{platform, available, snapshot, local}>}
 */
export async function collectICloudDiagnostics(deps = defaultDeps()) {
  const platform = detectPlatform(deps);
  const available = probeAvailability(deps);

  let raw = null;
  if (platform === 'ios') {
    try {
      raw = deps.nativeBridge.readICloudSync();
    } catch (err) {
      raw = JSON.stringify({ error: err?.message ?? String(err) });
    }
  } else if (platform === 'macos') {
    try {
      raw = await deps.electronAPI.readICloud();
    } catch (err) {
      raw = JSON.stringify({ error: err?.message ?? String(err) });
    }
  }

  const snapshot = platform === 'none'
    ? { state: UNSUPPORTED, bytes: 0, lastModified: null, version: null, taskCount: null, inboxCount: null, error: null }
    : classifySnapshot(raw, deps);

  return { platform, available, snapshot, local: readLocalState(deps) };
}

/**
 * Plain-text report for the copy-to-clipboard button, so a user can paste the
 * findings into an issue without retyping or screenshotting them.
 */
export function formatDiagnosticsReport({ platform, available, snapshot, local }) {
  const lines = [
    'dayGLANCE iCloud diagnostics',
    `platform:        ${platform}`,
    `container:       ${available.value === null ? 'not probeable on this platform' : available.value ? 'AVAILABLE' : 'unavailable'}`,
  ];
  if (available.raw) lines.push(`  raw:           ${available.raw}`);
  if (available.error) lines.push(`  error:         ${available.error}`);
  lines.push(
    `snapshot file:   ${snapshot.state}`,
    `  size:          ${formatBytes(snapshot.bytes)}`,
    `  lastModified:  ${snapshot.lastModified ?? '—'}`,
    `  tasks/inbox:   ${snapshot.taskCount ?? '—'} / ${snapshot.inboxCount ?? '—'}`,
  );
  if (snapshot.error) lines.push(`  error:         ${snapshot.error}`);
  lines.push(
    `local tasks:     ${local.taskCount}`,
    `local inbox:     ${local.inboxCount}`,
    `last synced:     ${local.lastSynced ?? 'never'}`,
  );
  return lines.join('\n');
}
