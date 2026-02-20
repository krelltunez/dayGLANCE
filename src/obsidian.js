/**
 * Obsidian Vault Integration Module
 *
 * Provides one-way task import (Obsidian → DG) and two-way daily notes
 * via the File System Access API. Vault directory handles are persisted
 * in IndexedDB so re-granting permission is a single click.
 */

// ---------------------------------------------------------------------------
// IndexedDB — persist the vault directory handle across sessions
// ---------------------------------------------------------------------------

const DB_NAME = 'dayglance-obsidian';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

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

async function saveVaultHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, 'vault');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadVaultHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('vault');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function removeVaultHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete('vault');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// ---------------------------------------------------------------------------
// Vault access — request / restore / disconnect
// ---------------------------------------------------------------------------

/**
 * Prompt the user to pick their Obsidian vault directory.
 * Returns the directory handle or null if cancelled.
 */
export async function requestVaultAccess() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveVaultHandle(handle);
    return handle;
  } catch (err) {
    if (err.name === 'AbortError') return null; // user cancelled
    throw err;
  }
}

/**
 * Try to restore a previously-granted vault handle from IndexedDB.
 * Re-requests permission if needed (requires a user gesture the first time
 * after a page reload). Returns the handle or null.
 */
export async function getVaultAccess() {
  const handle = await loadVaultHandle();
  if (!handle) return null;

  // queryPermission doesn't require a gesture; requestPermission does
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return handle;

  try {
    const result = await handle.requestPermission({ mode: 'readwrite' });
    return result === 'granted' ? handle : null;
  } catch {
    return null; // permission denied or no user gesture
  }
}

/**
 * Disconnect — remove the stored handle.
 */
export async function disconnectVault() {
  await removeVaultHandle();
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/**
 * Navigate into a sub-path within the vault (e.g. "Daily Notes").
 * Creates directories if they don't exist.
 */
async function getDailyNotesDir(vaultHandle, subPath) {
  if (!subPath || subPath === '/' || subPath === '.') return vaultHandle;
  const parts = subPath.split('/').filter(Boolean);
  let current = vaultHandle;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

/**
 * Read a single daily note markdown file. Returns the text or null.
 */
async function readDailyNoteFile(dirHandle, dateStr) {
  try {
    const fileHandle = await dirHandle.getFileHandle(`${dateStr}.md`);
    const file = await fileHandle.getFile();
    return { text: await file.text(), lastModified: new Date(file.lastModified).toISOString() };
  } catch (err) {
    if (err.name === 'NotFoundError') return null;
    throw err;
  }
}

/**
 * Write (create or overwrite) a daily note markdown file.
 */
export async function writeDailyNoteFile(vaultHandle, dailyNotesPath, dateStr, content) {
  const dirHandle = await getDailyNotesDir(vaultHandle, dailyNotesPath);
  const fileHandle = await dirHandle.getFileHandle(`${dateStr}.md`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Read a daily note fresh from the vault (for modal opening).
 */
export async function readDailyNoteFresh(vaultHandle, dailyNotesPath, dateStr) {
  const dirHandle = await getDailyNotesDir(vaultHandle, dailyNotesPath);
  return readDailyNoteFile(dirHandle, dateStr);
}

/**
 * Write a task's completion and scheduling state back to its Obsidian file.
 *
 * Finds the task line by matching `obsidianRawTitle` (the title text as it
 * originally appeared, without #obsidian tag or time prefix). Reconstructs
 * the line with updated checkbox and optional time.
 */
export async function writeTaskStateToFile(vaultHandle, dailyNotesPath, dateStr, obsidianRawTitle, completed, startTime) {
  const dirHandle = await getDailyNotesDir(vaultHandle, dailyNotesPath);
  let fileHandle, text;
  try {
    fileHandle = await dirHandle.getFileHandle(`${dateStr}.md`);
    const file = await fileHandle.getFile();
    text = await file.text();
  } catch (err) {
    if (err.name === 'NotFoundError') return; // file gone, nothing to update
    throw err;
  }

  const lines = text.split('\n');
  let updated = false;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- \[([ xX])\]\s+(.+)$/);
    if (!m) continue;

    // Strip time prefix from the line to get the core title
    let lineTitle = m[3].trim();
    const tm = lineTitle.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(.+)$/);
    if (tm) lineTitle = tm[4];

    if (lineTitle === obsidianRawTitle) {
      const indent = m[1];
      const timeStr = startTime ? `${startTime} ` : '';
      lines[i] = `${indent}- [${completed ? 'x' : ' '}] ${timeStr}${obsidianRawTitle}`;
      updated = true;
      break; // first match only
    }
  }

  if (updated) {
    const writable = await fileHandle.createWritable();
    await writable.write(lines.join('\n'));
    await writable.close();
  }
}

// ---------------------------------------------------------------------------
// Markdown task parser
// ---------------------------------------------------------------------------

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Parse tasks from Obsidian markdown content.
 *
 * Recognised patterns:
 *   - [ ] Simple task
 *   - [x] Completed task
 *   - [ ] 09:00 Timed task
 *   - [ ] 9:00 AM Timed task
 *   - [ ] 14:30 Timed task
 *
 * Returns { scheduledTasks: [...], inboxTasks: [...] }
 */
export function parseTasksFromMarkdown(content, dateStr) {
  const scheduled = [];
  const inbox = [];
  if (!content) return { scheduledTasks: scheduled, inboxTasks: inbox };

  const lines = content.split('\n');

  for (const line of lines) {
    // Match: optional whitespace, -, space, [x or space], space, rest
    const match = line.match(/^\s*- \[([ xX])\]\s+(.+)$/);
    if (!match) continue;

    const completed = match[1] !== ' ';
    let rawTitle = match[2].trim();

    // Try to extract time from the beginning of the title
    // Patterns: "09:00 Title", "9:00 Title", "9:00 AM Title", "9:00am Title"
    let startTime = null;
    const timeMatch = rawTitle.match(
      /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(.+)$/
    );
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2];
      const ampm = timeMatch[3];
      if (ampm) {
        const upper = ampm.toUpperCase();
        if (upper === 'PM' && hours < 12) hours += 12;
        if (upper === 'AM' && hours === 12) hours = 0;
      }
      if (hours >= 0 && hours <= 23) {
        startTime = `${hours.toString().padStart(2, '0')}:${minutes}`;
        rawTitle = timeMatch[4];
      }
    }

    // Add #obsidian tag if not already present
    const title = rawTitle.includes('#obsidian') ? rawTitle : `${rawTitle} #obsidian`;

    // Stable ID: based on date + hash of raw title (before our tag addition)
    const id = `obsidian-${dateStr}-${simpleHash(rawTitle)}`;

    if (startTime) {
      scheduled.push({
        id,
        title,
        date: dateStr,
        startTime,
        duration: 30,
        color: 'bg-purple-600',
        completed,
        isAllDay: false,
        notes: '',
        subtasks: [],
        imported: true,
        importSource: 'obsidian',
        obsidianRawTitle: rawTitle,
      });
    } else {
      inbox.push({
        id,
        title,
        priority: 0,
        completed,
        notes: '',
        subtasks: [],
        duration: 30,
        color: 'bg-purple-600',
        importSource: 'obsidian',
        obsidianRawTitle: rawTitle,
      });
    }
  }

  return { scheduledTasks: scheduled, inboxTasks: inbox };
}

// ---------------------------------------------------------------------------
// Full vault sync
// ---------------------------------------------------------------------------

/**
 * Sync daily notes + tasks from the Obsidian vault.
 *
 * @param {FileSystemDirectoryHandle} vaultHandle
 * @param {string} dailyNotesPath   Sub-path within vault (e.g. "" or "Daily Notes")
 * @param {number} retentionDays    How far back to read (0 = unlimited)
 * @param {Array}  existingTasks    Current DG scheduled tasks
 * @param {Array}  existingInbox    Current DG inbox tasks
 * @returns {{ dailyNotes, scheduledTasks, inboxTasks }}
 */
export async function syncObsidianVault(
  vaultHandle,
  dailyNotesPath,
  retentionDays,
  existingTasks,
  existingInbox,
) {
  const dirHandle = await getDailyNotesDir(vaultHandle, dailyNotesPath);

  // Compute cutoff date string
  let cutoffStr = '0000-00-00';
  if (retentionDays && retentionDays > 0) {
    const today = new Date();
    const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - retentionDays);
    const yyyy = cutoff.getFullYear();
    const mm = String(cutoff.getMonth() + 1).padStart(2, '0');
    const dd = String(cutoff.getDate()).padStart(2, '0');
    cutoffStr = `${yyyy}-${mm}-${dd}`;
  }

  const dailyNotes = {};
  const allScheduled = [];
  const allInbox = [];

  // Build a lookup of existing Obsidian task completion states
  const existingCompletionMap = {};
  for (const t of existingTasks) {
    if (t.importSource === 'obsidian') existingCompletionMap[t.id] = t.completed;
  }
  for (const t of existingInbox) {
    if (t.importSource === 'obsidian') existingCompletionMap[t.id] = t.completed;
  }

  // Iterate files in the daily notes directory
  for await (const [name, handle] of dirHandle) {
    if (handle.kind !== 'file' || !name.endsWith('.md')) continue;

    const dateStr = name.replace('.md', '');
    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    // Apply cutoff
    if (dateStr < cutoffStr) continue;

    const file = await handle.getFile();
    const text = await file.text();
    const lastModified = new Date(file.lastModified).toISOString();

    // Store daily note
    dailyNotes[dateStr] = { text, lastModified, fromObsidian: true };

    // Parse tasks
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(text, dateStr);

    // Merge completion state: completed in DG OR in Obsidian → completed
    for (const task of scheduledTasks) {
      if (existingCompletionMap[task.id]) task.completed = true;
      allScheduled.push(task);
    }
    for (const task of inboxTasks) {
      if (existingCompletionMap[task.id]) task.completed = true;
      allInbox.push(task);
    }
  }

  return { dailyNotes, scheduledTasks: allScheduled, inboxTasks: allInbox };
}
