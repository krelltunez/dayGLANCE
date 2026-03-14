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
 * Strip leading date / date+time / time prefixes from a raw task line body
 * (the text after `- [x] `) to get the bare title, mirroring
 * parseTasksFromMarkdown.  Returns { bareTitle, datePrefix } where datePrefix
 * is the "YYYY-MM-DD " string (with trailing space) if one was present, or ''.
 */
function stripLinePrefixes(text) {
  const trimmed = text.trim();
  // 1) Leading date: "YYYY-MM-DD ..."
  const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (dateMatch) {
    const datePrefix = dateMatch[1] + ' ';
    const afterDate = dateMatch[2];
    // Date + time
    const tm = afterDate.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(.+)$/);
    if (tm) return { bareTitle: tm[4], datePrefix };
    // Date only
    return { bareTitle: afterDate, datePrefix };
  }
  // 2) Time only
  const tm = trimmed.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(.+)$/);
  if (tm) return { bareTitle: tm[4], datePrefix: '' };
  // 3) Plain title
  return { bareTitle: trimmed, datePrefix: '' };
}

/**
 * Write a task's completion and scheduling state back to its Obsidian file.
 *
 * Finds the task line by matching `obsidianRawTitle` (the title text as it
 * originally appeared, without #obsidian tag or time prefix). Reconstructs
 * the line with updated checkbox and optional time, preserving any inline
 * date prefix that was already in the line.
 */
export async function writeTaskStateToFile(vaultHandle, dailyNotesPath, dateStr, obsidianRawTitle, completed, startTime, newRawTitle) {
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

    const { bareTitle, datePrefix } = stripLinePrefixes(m[3]);
    if (bareTitle !== obsidianRawTitle) continue;

    const indent = m[1];
    const timeStr = startTime ? `${startTime} ` : '';
    const writtenTitle = newRawTitle !== undefined ? newRawTitle : obsidianRawTitle;
    lines[i] = `${indent}- [${completed ? 'x' : ' '}] ${datePrefix}${timeStr}${writtenTitle}`;
    updated = true;
    break; // first match only
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

export function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Try to parse a time string from the beginning of text.
 * Returns { hours, minutes, rest } or null.
 */
function parseLeadingTime(text) {
  const timeMatch = text.match(
    /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(.+)$/
  );
  if (!timeMatch) return null;
  let hours = parseInt(timeMatch[1], 10);
  const minutes = timeMatch[2];
  const ampm = timeMatch[3];
  if (ampm) {
    const upper = ampm.toUpperCase();
    if (upper === 'PM' && hours < 12) hours += 12;
    if (upper === 'AM' && hours === 12) hours = 0;
  }
  if (hours < 0 || hours > 23) return null;
  return {
    startTime: `${hours.toString().padStart(2, '0')}:${minutes}`,
    rest: timeMatch[4],
  };
}

/**
 * Parse tasks from Obsidian markdown content.
 *
 * Recognised patterns (in priority order):
 *   - [ ] 2026-02-21 09:00 Date+time task  → scheduled on that date/time
 *   - [ ] 2026-02-21 Date-only task         → all-day task on that date
 *   - [ ] 09:00 Timed task                  → scheduled on the file's date
 *   - [ ] 9:00 AM Timed task                → scheduled on the file's date
 *   - [ ] Simple task                        → inbox task
 *   - [x] Completed task                     → completed (any of the above)
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

    let taskDate = dateStr;
    let startTime = null;
    let isAllDay = false;

    // 1) Try inline date: "YYYY-MM-DD ..." at the beginning
    const dateMatch = rawTitle.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (dateMatch) {
      taskDate = dateMatch[1];
      const afterDate = dateMatch[2];

      // 1a) Try date + time: "YYYY-MM-DD HH:MM[am/pm] Title"
      const timePart = parseLeadingTime(afterDate);
      if (timePart) {
        startTime = timePart.startTime;
        rawTitle = timePart.rest;
      } else {
        // 1b) Date only → all-day task
        isAllDay = true;
        rawTitle = afterDate;
      }
    } else {
      // 2) Try time only: "HH:MM[am/pm] Title"
      const timePart = parseLeadingTime(rawTitle);
      if (timePart) {
        startTime = timePart.startTime;
        rawTitle = timePart.rest;
      }
    }

    // Add #obsidian tag if not already present
    const title = rawTitle.includes('#obsidian') ? rawTitle : `${rawTitle} #obsidian`;

    // Stable ID: based on task's effective date + hash of raw title
    const id = `obsidian-${taskDate}-${simpleHash(rawTitle)}`;

    if (startTime) {
      // Timed task (with or without inline date)
      scheduled.push({
        id,
        title,
        date: taskDate,
        startTime,
        duration: 30,
        color: 'bg-purple-600',
        completed,
        isAllDay: false,
        notes: '',
        subtasks: [],
        importSource: 'obsidian',
        obsidianRawTitle: rawTitle,
        obsidianFileDate: dateStr,
      });
    } else if (isAllDay) {
      // Date-only task → all-day scheduled task
      scheduled.push({
        id,
        title,
        date: taskDate,
        startTime: '00:00',
        duration: 30,
        color: 'bg-purple-600',
        completed,
        isAllDay: true,
        notes: '',
        subtasks: [],
        importSource: 'obsidian',
        obsidianRawTitle: rawTitle,
        obsidianFileDate: dateStr,
      });
    } else {
      // No date, no time → inbox
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
        obsidianFileDate: dateStr,
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

  // Build a lookup of ALL existing Obsidian task properties so we can
  // preserve app-controlled fields through sync.  Also track which array
  // (scheduled vs inbox) each task currently lives in so we honour
  // cross-array moves the user made inside DG.
  const existingTaskMap = {};
  const userScheduledIds = new Set();
  const userInboxIds = new Set();
  for (const t of existingTasks) {
    if (t.importSource === 'obsidian') {
      existingTaskMap[t.id] = t;
      userScheduledIds.add(t.id);
    }
  }
  for (const t of existingInbox) {
    if (t.importSource === 'obsidian') {
      existingTaskMap[t.id] = t;
      userInboxIds.add(t.id);
    }
  }
  // Supplement with localStorage — handles the race on app open where the
  // Obsidian sync fires before cloud-sync's applyRemoteData has had a chance
  // to push the remote state into React state.  Without this, a desktop
  // session whose Obsidian sync wins the race would see an empty
  // existingTaskMap, default every duration to 30, then upload that stale
  // value with a fresh timestamp that beats Android's custom duration in the
  // next cloud merge.
  try {
    const lsTasks = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]');
    const lsUnsched = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]');
    for (const t of [...lsTasks, ...lsUnsched]) {
      if (t.importSource === 'obsidian' && !existingTaskMap[t.id]) {
        existingTaskMap[t.id] = t;
      }
    }
  } catch { /* localStorage unavailable or corrupt — skip */ }

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

    // Merge: once imported, DG owns scheduling, title, and app-controlled
    // properties.  Obsidian only controls task *existence* and initial values.
    // We also honour cross-array moves: if the user moved a vault-scheduled
    // task into the inbox (or vice versa), the task goes into the array the
    // user chose, not the one the vault dictates.
    for (const task of scheduledTasks) {
      const existing = existingTaskMap[task.id];
      if (existing) {
        // Completed: OR logic — completed in DG OR in Obsidian → completed
        if (existing.completed) task.completed = true;
        // Preserve app-controlled properties the user may have changed in DG
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        if (existing.priority !== undefined) task.priority = existing.priority;
        // Preserve scheduling & title changes made in DG so sync never
        // overwrites moves/renames the user made inside the app.
        if (existing.date !== undefined) task.date = existing.date;
        if (existing.startTime !== undefined) task.startTime = existing.startTime;
        if (existing.isAllDay !== undefined) task.isAllDay = existing.isAllDay;
        if (existing.title !== undefined) task.title = existing.title;
        // Preserve lastModified so cloud merge keeps recognising the
        // version the user actually edited rather than treating re-imports
        // as brand-new tasks with a fresh timestamp.
        if (existing.lastModified) task.lastModified = existing.lastModified;

        // User moved this to inbox — respect the cross-array move
        if (userInboxIds.has(task.id)) {
          allInbox.push(task);
          continue;
        }
      } else {
        // Fresh import with no local match — use epoch so cloud merge
        // correctly prefers real user edits from other devices.
        task.lastModified = new Date(0).toISOString();
      }
      allScheduled.push(task);
    }
    for (const task of inboxTasks) {
      const existing = existingTaskMap[task.id];
      if (existing) {
        if (existing.completed) task.completed = true;
        if (existing.priority !== undefined) task.priority = existing.priority;
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        if (existing.title !== undefined) task.title = existing.title;
        if (existing.lastModified) task.lastModified = existing.lastModified;

        // User scheduled this from inbox — respect the cross-array move
        if (userScheduledIds.has(task.id)) {
          if (existing.date !== undefined) task.date = existing.date;
          if (existing.startTime !== undefined) task.startTime = existing.startTime;
          if (existing.isAllDay !== undefined) task.isAllDay = existing.isAllDay;
          allScheduled.push(task);
          continue;
        }
      } else {
        task.lastModified = new Date(0).toISOString();
      }
      allInbox.push(task);
    }
  }

  return { dailyNotes, scheduledTasks: allScheduled, inboxTasks: allInbox };
}

// ---------------------------------------------------------------------------
// Android native bridge equivalents
//
// These mirror the File System Access API functions above but use the
// window.DayGlanceObsidian bridge injected by the Android WebView.
// ---------------------------------------------------------------------------

/**
 * Read a daily note via the native bridge. Returns { text, lastModified } or null.
 * [date] is ISO format yyyy-MM-dd.
 */
export function readDailyNoteNative(date) {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge?.getDailyNote) return null;
  try {
    const text = bridge.getDailyNote(date);
    if (text === null || text === undefined) return null;
    return { text, lastModified: new Date().toISOString(), fromObsidian: true };
  } catch {
    return null;
  }
}

/**
 * Write (create or overwrite) a daily note via the native bridge.
 * [date] is ISO format yyyy-MM-dd.
 */
export function writeDailyNoteNative(date, content) {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge?.writeDailyNote) return false;
  try {
    return bridge.writeDailyNote(date, content);
  } catch {
    return false;
  }
}

/**
 * Write a task's completion and scheduling state back to its Obsidian file
 * via the native bridge.
 *
 * Reads the note with getDailyNote, applies the same regex-replace logic as
 * writeTaskStateToFile, then writes the result back with writeDailyNote.
 */
export function writeTaskStateNative(date, obsidianRawTitle, completed, startTime, newRawTitle) {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge?.getDailyNote || !bridge?.writeDailyNote) return;

  try {
    const text = bridge.getDailyNote(date);
    if (!text && text !== '') return; // vault not configured

    const lines = text.split('\n');
    let updated = false;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)- \[([ xX])\]\s+(.+)$/);
      if (!m) continue;

      const { bareTitle, datePrefix } = stripLinePrefixes(m[3]);
      if (bareTitle !== obsidianRawTitle) continue;

      const indent = m[1];
      const timeStr = startTime ? `${startTime} ` : '';
      const writtenTitle = newRawTitle !== undefined ? newRawTitle : obsidianRawTitle;
      lines[i] = `${indent}- [${completed ? 'x' : ' '}] ${datePrefix}${timeStr}${writtenTitle}`;
      updated = true;
      break;
    }

    if (updated) {
      bridge.writeDailyNote(date, lines.join('\n'));
    }
  } catch (err) {
    console.error('Obsidian native writeback error:', err);
  }
}

/**
 * Sync daily notes + tasks from the Obsidian vault via the Android native bridge.
 *
 * Mirrors syncObsidianVault but uses DayGlanceObsidian.listNotes + getDailyNote
 * instead of the File System Access API.
 *
 * @param {string} folder         Daily notes sub-folder (from native vault config)
 * @param {number} retentionDays  How far back to read (0 = unlimited)
 * @param {Array}  existingTasks  Current DG scheduled tasks
 * @param {Array}  existingInbox  Current DG inbox tasks
 * @returns {{ dailyNotes, scheduledTasks, inboxTasks }}
 */
export function syncObsidianVaultNative(folder, retentionDays, existingTasks, existingInbox) {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge) return { dailyNotes: {}, scheduledTasks: [], inboxTasks: [] };

  // Compute cutoff date string
  let cutoffStr = '0000-00-00';
  if (retentionDays && retentionDays > 0) {
    const today = new Date();
    const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - retentionDays);
    cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  }

  // Build lookup of existing Obsidian tasks to preserve app-controlled properties
  const existingTaskMap = {};
  const userScheduledIds = new Set();
  const userInboxIds = new Set();
  for (const t of existingTasks) {
    if (t.importSource === 'obsidian') { existingTaskMap[t.id] = t; userScheduledIds.add(t.id); }
  }
  for (const t of existingInbox) {
    if (t.importSource === 'obsidian') { existingTaskMap[t.id] = t; userInboxIds.add(t.id); }
  }
  // Supplement with localStorage — same race-condition fix as syncObsidianVault.
  try {
    const lsTasks = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]');
    const lsUnsched = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]');
    for (const t of [...lsTasks, ...lsUnsched]) {
      if (t.importSource === 'obsidian' && !existingTaskMap[t.id]) {
        existingTaskMap[t.id] = t;
      }
    }
  } catch { /* localStorage unavailable or corrupt — skip */ }

  const dailyNotes = {};
  const allScheduled = [];
  const allInbox = [];

  // Prefer the batch getAllDailyNotes method (single native round trip) over the
  // old listNotes + per-note getDailyNote loop (N round trips that each block the
  // JS thread and cause the app to freeze during sync).
  let noteEntries; // [{ date, text }]
  if (bridge.getAllDailyNotes) {
    try {
      noteEntries = JSON.parse(bridge.getAllDailyNotes(folder, cutoffStr));
    } catch {
      return { dailyNotes, scheduledTasks: allScheduled, inboxTasks: allInbox };
    }
  } else if (bridge.listNotes && bridge.getDailyNote) {
    // Fallback: legacy path used when running against an older app build
    let notePaths;
    try {
      notePaths = JSON.parse(bridge.listNotes(folder));
    } catch {
      return { dailyNotes, scheduledTasks: allScheduled, inboxTasks: allInbox };
    }
    noteEntries = [];
    for (const notePath of notePaths) {
      const fileName = notePath.split('/').pop();
      if (!fileName?.endsWith('.md')) continue;
      const dateStr = fileName.replace('.md', '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || dateStr < cutoffStr) continue;
      try {
        const text = bridge.getDailyNote(dateStr);
        if (text !== null && text !== undefined) noteEntries.push({ date: dateStr, text });
      } catch { /* skip unreadable notes */ }
    }
  } else {
    return { dailyNotes, scheduledTasks: allScheduled, inboxTasks: allInbox };
  }

  for (const { date: dateStr, text } of noteEntries) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (text === null || text === undefined) continue;

    dailyNotes[dateStr] = { text, lastModified: new Date().toISOString(), fromObsidian: true };

    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(text, dateStr);

    // Same merge logic as syncObsidianVault
    for (const task of scheduledTasks) {
      const existing = existingTaskMap[task.id];
      if (existing) {
        if (existing.completed) task.completed = true;
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        if (existing.priority !== undefined) task.priority = existing.priority;
        if (existing.date !== undefined) task.date = existing.date;
        if (existing.startTime !== undefined) task.startTime = existing.startTime;
        if (existing.isAllDay !== undefined) task.isAllDay = existing.isAllDay;
        if (existing.title !== undefined) task.title = existing.title;
        if (existing.lastModified) task.lastModified = existing.lastModified;
        if (userInboxIds.has(task.id)) { allInbox.push(task); continue; }
      } else {
        task.lastModified = new Date(0).toISOString();
      }
      allScheduled.push(task);
    }

    for (const task of inboxTasks) {
      const existing = existingTaskMap[task.id];
      if (existing) {
        if (existing.completed) task.completed = true;
        if (existing.priority !== undefined) task.priority = existing.priority;
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        if (existing.title !== undefined) task.title = existing.title;
        if (existing.lastModified) task.lastModified = existing.lastModified;
        if (userScheduledIds.has(task.id)) {
          if (existing.date !== undefined) task.date = existing.date;
          if (existing.startTime !== undefined) task.startTime = existing.startTime;
          if (existing.isAllDay !== undefined) task.isAllDay = existing.isAllDay;
          allScheduled.push(task);
          continue;
        }
      } else {
        task.lastModified = new Date(0).toISOString();
      }
      allInbox.push(task);
    }
  }

  return { dailyNotes, scheduledTasks: allScheduled, inboxTasks: allInbox };
}
