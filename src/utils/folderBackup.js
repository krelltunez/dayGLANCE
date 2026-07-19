/**
 * Local Folder Backup (File System Access API)
 *
 * Continuously mirrors the app's data into a user-chosen folder on the local
 * disk. Designed for environments where the browser wipes site data on close
 * (managed/enterprise Chrome, kiosk profiles): everything the app persists in
 * localStorage/IndexedDB is lost between sessions, but a real file on disk
 * survives. No data ever leaves the machine.
 *
 * Layout inside the chosen folder:
 *   dayglance-data.json                   — the LIVE file, rewritten (debounced)
 *                                           on every save; what restore reads.
 *   dayglance-backup-YYYY-MM-DD-HHMM.json — point-in-time snapshots on the
 *                                           configured cadence, pruned to a
 *                                           retention count. Safety net against
 *                                           the live file faithfully mirroring
 *                                           a mistake (bulk delete, bad merge).
 *
 * The directory handle is persisted in IndexedDB (same pattern as the Obsidian
 * vault integration) so reconnecting is a single click when the profile
 * survives. On a wipe-on-exit machine the handle is lost too — the welcome
 * modal's "Restore from a backup" flow re-picks the folder, restores, and
 * re-arms in one dialog.
 */

export const LIVE_BACKUP_FILENAME = 'dayglance-data.json';
export const SNAPSHOT_PREFIX = 'dayglance-backup-';

const SNAPSHOT_RE = /^dayglance-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

// Web/PWA only. Electron routes folder access through the main process (the
// renderer's FS Access handles can't persist under the MAS sandbox) and ships
// with real disk persistence anyway; native WebViews lack showDirectoryPicker.
export function isFolderBackupSupported() {
  return (
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    !window.electronAPI?.isElectron
  );
}

// ---------------------------------------------------------------------------
// IndexedDB — persist the folder directory handle across sessions
// ---------------------------------------------------------------------------

const DB_NAME = 'dayglance-folder-backup';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const HANDLE_KEY = 'folder';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveFolderHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadFolderHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function removeFolderHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export function queryFolderPermission(handle) {
  return handle.queryPermission({ mode: 'readwrite' });
}

// Must be called from a user gesture.
export function requestFolderPermission(handle) {
  return handle.requestPermission({ mode: 'readwrite' });
}

// Must be called from a user gesture. Persists the picked handle; persistence
// failure is non-fatal — the session still works, only next-launch reconnect
// falls back to the picker.
export async function pickBackupFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  try {
    await saveFolderHandle(handle);
  } catch (err) {
    console.warn('Folder backup: could not persist folder handle:', err);
  }
  return handle;
}

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

/**
 * Read and parse the live backup file. Returns null when the file doesn't
 * exist or contains invalid JSON (a corrupt live file should not brick the
 * connect/restore flows — the next write-through replaces it). Permission and
 * I/O errors still throw.
 */
export async function readLiveBackup(dirHandle) {
  let file;
  try {
    const fh = await dirHandle.getFileHandle(LIVE_BACKUP_FILENAME);
    file = await fh.getFile();
  } catch (e) {
    if (e?.name === 'NotFoundError') return null;
    throw e;
  }
  try {
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

async function writeJsonFile(dirHandle, filename, payload) {
  const fh = await dirHandle.getFileHandle(filename, { create: true });
  // createWritable stages into a temp file and atomically swaps on close, so a
  // crash mid-write never corrupts the existing copy.
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

export function writeLiveBackup(dirHandle, payload) {
  return writeJsonFile(dirHandle, LIVE_BACKUP_FILENAME, payload);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

// Zero-padded local timestamp so filenames sort lexically = chronologically.
export function snapshotFilename(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${SNAPSHOT_PREFIX}${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}.json`
  );
}

/** Snapshot filenames in the folder, newest first. */
export async function listSnapshots(dirHandle) {
  const names = [];
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind === 'file' && SNAPSHOT_RE.test(name)) names.push(name);
  }
  return names.sort().reverse();
}

/** Delete snapshots beyond `keep`, newest kept. Returns surviving names. */
export async function pruneSnapshots(dirHandle, keep) {
  const names = await listSnapshots(dirHandle);
  for (const name of names.slice(keep)) {
    await dirHandle.removeEntry(name);
  }
  return names.slice(0, keep);
}

export async function writeSnapshotBackup(dirHandle, payload, keep, now = new Date()) {
  await writeJsonFile(dirHandle, snapshotFilename(now), payload);
  await pruneSnapshots(dirHandle, keep);
}

// ---------------------------------------------------------------------------
// Payload inspection
// ---------------------------------------------------------------------------

/**
 * Whether a backup payload contains any user data worth protecting. Used by
 * the empty-state guard: a payload with no tasks/habits/goals/etc. must never
 * overwrite a live file that has them (e.g. a freshly wiped profile arming
 * write-through before the user restores).
 */
export function payloadHasData(payload) {
  const d = payload?.data;
  if (!d) return false;
  const lists = [
    d.tasks, d.unscheduledTasks, d.recycleBin, d.recurringTasks,
    d.habits, d.goals, d.projects, d.areas,
  ];
  if (lists.some((l) => Array.isArray(l) && l.length > 0)) return true;
  if (d.routineDefinitions &&
      Object.values(d.routineDefinitions).some((v) => Array.isArray(v) && v.length > 0)) {
    return true;
  }
  return false;
}
