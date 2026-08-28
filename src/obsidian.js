/**
 * Obsidian Vault Integration Module
 *
 * Provides one-way task import (Obsidian → DG) and two-way daily notes
 * via the File System Access API. Vault directory handles are persisted
 * in IndexedDB so re-granting permission is a single click.
 *
 * On Electron the File System Access handle can't persist across relaunch under
 * the Mac App Store sandbox, so vault access is delegated to the main process
 * (native folder picker + security-scoped bookmark). requestVaultAccess/restore/
 * disconnect route through electronAPI.obsidian and return a handle SHIM
 * (makeElectronVaultHandle) that the rest of this module drives unchanged.
 */

import { makeElectronVaultHandle } from './obsidianElectronHandle.js';
import {
  validateVaultNameSegment,
  validateWikiNoteName,
  validateVaultFolderSetting,
} from './utils/obsidianFilename.js';
import { unportableEntryReason } from './utils/vaultPortability.js';
import { blockIdWritesEnabled } from './utils/obsidianWritePolicy.js';
import { detectTwoSidedRetitle, appendTitleConflictNote, stripObsidianDisplayTag } from './utils/obsidianTitleConflict.js';

// How far back the Obsidian daily-note scan reads, in days. DELIBERATELY FIXED and
// decoupled from the calendar "Keep past events" retention (syncRetentionDays):
// that dropdown governs how long IMPORTED CALENDAR EVENTS are kept, and wiring the
// vault scan to it meant lowering calendar retention (e.g. to 7 days to save
// storage) silently stopped importing older daily-note tasks. 90 days is a generous
// "recent" window that never shrinks the scan for anyone on the common defaults.
export const OBSIDIAN_IMPORT_WINDOW_DAYS = 90;

/**
 * Local-date cutoff string 'YYYY-MM-DD' for a scan window of `days` — notes/tasks
 * dated before it are outside the window. Returns null for an unlimited window
 * (days <= 0). Uses LOCAL date parts to match daily-note filenames, which are
 * authored in the user's local timezone.
 *
 * Shared by the scan (which skips notes older than the cutoff) AND the deletion
 * detector (which must NOT mistake a note that aged out of the SAME window for a
 * vault deletion), so the two windows can never drift apart.
 *
 * @param {number} days   window size; <= 0 → unlimited (null)
 * @param {Date}   [now]  reference "today" (injectable for tests)
 * @returns {string|null} 'YYYY-MM-DD' cutoff, or null for no limit
 */
export function obsidianWindowCutoffDate(days, now = new Date()) {
  if (!(days > 0)) return null;
  const c = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
}

// All Electron builds route vault access through the main process (native picker +
// security-scoped bookmark). Required under the MAS sandbox (a renderer FS Access
// handle can't persist there); the unsandboxed Developer ID / dev builds simply get
// an empty bookmark and read/write the path directly. Unifying on one path — now
// that it's verified on MAS — means dev exercises the same code that ships, so shim
// bugs surface on the desk instead of only in the sandbox. Web and native (iOS/
// Android) have no electronAPI and keep their existing paths.
//
// Migration note: an existing Developer ID user's vault lives as an FS Access handle
// in IndexedDB (no extractable filesystem path), so there's no auto-migration — they
// reconnect the vault once via the native picker. Sync just no-ops until then.
const isElectronObsidian = () =>
  typeof window !== 'undefined' &&
  !!(window.electronAPI && window.electronAPI.isElectron && window.electronAPI.obsidian);

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
  if (isElectronObsidian()) return true; // native picker + bookmark in the main process
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
  if (isElectronObsidian()) {
    // Native folder picker in the main process; persists a security-scoped bookmark.
    const res = await window.electronAPI.obsidian.pick();
    return res ? makeElectronVaultHandle() : null;
  }
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
 * Silently restore a previously-granted vault handle from IndexedDB.
 * Only succeeds if permission is already 'granted' — does NOT call
 * requestPermission, so it is safe to call on page load without a user gesture.
 * Returns the handle or null.
 */
export async function tryRestoreVaultAccess() {
  if (isElectronObsidian()) {
    // Re-open the stored bookmark in the main process; no user gesture needed.
    const res = await window.electronAPI.obsidian.restore();
    return res ? makeElectronVaultHandle() : null;
  }
  const handle = await loadVaultHandle();
  if (!handle) return null;
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  return perm === 'granted' ? handle : null;
}

/**
 * Try to restore a previously-granted vault handle from IndexedDB.
 * Re-requests permission if needed (requires a user gesture). Returns the handle or null.
 */
export async function getVaultAccess() {
  if (isElectronObsidian()) {
    // Bookmark-backed access is re-established by the main process; nothing to
    // re-prompt for. Returns a handle when a vault is configured, else null.
    const res = await window.electronAPI.obsidian.restore();
    return res ? makeElectronVaultHandle() : null;
  }
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
  if (isElectronObsidian()) {
    await window.electronAPI.obsidian.disconnect();
    return;
  }
  await removeVaultHandle();
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/**
 * Navigate into a sub-path within the vault (e.g. "Daily Notes").
 * Creates directories if they don't exist.
 *
 * Path segments are sanitised: empty, `.`, and `..` components are rejected
 * so that a misconfigured or maliciously crafted dailyNotesPath cannot
 * traverse outside the user-selected vault root.
 */
async function getDailyNotesDir(vaultHandle, subPath) {
  if (!subPath || subPath === '/' || subPath === '.') return vaultHandle;
  const parts = subPath.split('/').filter(Boolean);
  for (const part of parts) {
    if (part === '..' || part === '.') {
      throw new Error(`Obsidian: unsafe path segment "${part}" in dailyNotesPath`);
    }
  }
  let current = vaultHandle;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

/** Reject date strings that aren't strictly YYYY-MM-DD to prevent path injection. */
function assertSafeDateStr(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Obsidian: invalid date string "${dateStr}"`);
  }
}

// ---------------------------------------------------------------------------
// Daily note filename pattern helpers
// Supports Java-style DateTimeFormatter tokens: yyyy, yy, MMMM, MMM, MM, M, dd, d
// This matches the subset understood by Android's native ObsidianRepository.
// ---------------------------------------------------------------------------

const DATE_MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DATE_MONTHS_SHORT = DATE_MONTHS_FULL.map(m => m.slice(0, 3));
const DATE_TOKEN_RE     = /yyyy|yy|MMMM|MMM|MM|M|dd|d/g;

/**
 * Format a Date object into a daily note filename stem using a DateTimeFormatter-style pattern.
 * The default pattern "yyyy-MM-dd" produces "2026-04-05".
 */
export function formatDatePattern(date, pattern = 'yyyy-MM-dd') {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  return pattern.replace(DATE_TOKEN_RE, (token) => {
    switch (token) {
      case 'yyyy': return y;
      case 'yy':   return String(y).slice(-2);
      case 'MMMM': return DATE_MONTHS_FULL[date.getMonth()];
      case 'MMM':  return DATE_MONTHS_SHORT[date.getMonth()];
      case 'MM':   return String(m).padStart(2, '0');
      case 'M':    return m;
      case 'dd':   return String(d).padStart(2, '0');
      case 'd':    return d;
      default:     return token;
    }
  });
}

/**
 * Build a parser object from a pattern string. Used to convert a daily note
 * filename back to a YYYY-MM-DD date string during vault sync.
 */
function buildDateParser(pattern) {
  const tokenOrder = [];
  const captureFor = { yyyy: '(\\d{4})', yy: '(\\d{2})', MMMM: '([A-Za-z]+)', MMM: '([A-Za-z]+)', MM: '(\\d{1,2})', M: '(\\d{1,2})', dd: '(\\d{1,2})', d: '(\\d{1,2})' };
  let regexStr = '^' + pattern.replace(DATE_TOKEN_RE, (t) => { tokenOrder.push(t); return captureFor[t]; }).replace(/[.+?^${}()|[\]\\]/g, (c) => (tokenOrder.length ? c : '\\' + c)) + '\\.md$';
  // Rebuild properly: escape literal parts only
  tokenOrder.length = 0;
  regexStr = '^';
  let lastIdx = 0;
  DATE_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = DATE_TOKEN_RE.exec(pattern)) !== null) {
    const lit = pattern.slice(lastIdx, m.index);
    if (lit) regexStr += lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regexStr += captureFor[m[0]];
    tokenOrder.push(m[0]);
    lastIdx = m.index + m[0].length;
  }
  const trailing = pattern.slice(lastIdx);
  if (trailing) regexStr += trailing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  regexStr += '\\.md$';
  return { regex: new RegExp(regexStr, 'i'), tokenOrder };
}

/**
 * Attempt to parse a daily note filename (e.g. "05-04-2026.md") back to
 * a YYYY-MM-DD string using the given parser. Returns null on failure.
 */
function parseDateFromFilename(filename, parser) {
  const match = parser.regex.exec(filename);
  if (!match) return null;
  let year, month, day;
  parser.tokenOrder.forEach((token, i) => {
    const val = match[i + 1];
    if (token === 'yyyy')       year  = parseInt(val, 10);
    else if (token === 'yy')    year  = 2000 + parseInt(val, 10);
    else if (token === 'MMMM')  month = DATE_MONTHS_FULL.findIndex(n => n.toLowerCase() === val.toLowerCase()) + 1;
    else if (token === 'MMM')   month = DATE_MONTHS_SHORT.findIndex(n => n.toLowerCase() === val.toLowerCase()) + 1;
    else if (token === 'MM' || token === 'M') month = parseInt(val, 10);
    else if (token === 'dd' || token === 'd') day   = parseInt(val, 10);
  });
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Compute the filename (with .md) for a daily note given an internal YYYY-MM-DD
 * date string and an optional pattern. Returns e.g. "2026-04-05.md".
 */
function dailyNoteFilename(dateStr, pattern) {
  if (!pattern || pattern === 'yyyy-MM-dd') return `${dateStr}.md`;
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${formatDatePattern(new Date(y, m - 1, d), pattern)}.md`;
}

/**
 * Write-side file-handle resolution with the portability gate on CREATION
 * ONLY. ORDERING IS THE POINT: the existence check runs BEFORE the validator.
 * A daily note that already exists gets written regardless of its name — the
 * portability harm is entirely in bringing a NEW unportable name into being;
 * a file already in the vault is already there whether or not we write to it,
 * and refusing would strand sync in a permanent error state. The validator
 * (backstop for patterns saved before entry-time validation shipped — the
 * Settings inputs are the primary check) gates only the create branch.
 * Reads never validate, so legacy-named files always stay readable.
 */
async function getDailyNoteHandleForWrite(dirHandle, dateStr, pattern) {
  const name = dailyNoteFilename(dateStr, pattern);
  try {
    return await dirHandle.getFileHandle(name); // exists → write proceeds, name notwithstanding
  } catch (err) {
    if (err.name !== 'NotFoundError') throw err;
  }
  const reason = validateVaultNameSegment(name.slice(0, -3));
  if (reason) {
    throw new Error(`Obsidian: daily note pattern "${pattern}" renders an unusable filename — ${reason}. Fix the pattern in Settings → Obsidian.`);
  }
  return dirHandle.getFileHandle(name, { create: true });
}

/**
 * Read a single daily note markdown file. Returns the text or null.
 * @param {string} [pattern] DateTimeFormatter-style filename pattern (default "yyyy-MM-dd")
 */
async function readDailyNoteFile(dirHandle, dateStr, pattern) {
  assertSafeDateStr(dateStr);
  try {
    const fileHandle = await dirHandle.getFileHandle(dailyNoteFilename(dateStr, pattern));
    const file = await fileHandle.getFile();
    return { text: await file.text(), lastModified: new Date(file.lastModified).toISOString() };
  } catch (err) {
    if (err.name === 'NotFoundError') return null;
    throw err;
  }
}

/**
 * Write (create or overwrite) a daily note markdown file.
 * @param {string} [pattern] DateTimeFormatter-style filename pattern (default "yyyy-MM-dd")
 */
export async function writeDailyNoteFile(vaultHandle, dailyNotesPath, dateStr, content, pattern) {
  assertSafeDateStr(dateStr);
  const dirHandle = await getDailyNotesDir(vaultHandle, dailyNotesPath);
  const fileHandle = await getDailyNoteHandleForWrite(dirHandle, dateStr, pattern);
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Read a daily note fresh from the vault (for modal opening).
 * @param {string} [pattern] DateTimeFormatter-style filename pattern (default "yyyy-MM-dd")
 */
export async function readDailyNoteFresh(vaultHandle, dailyNotesPath, dateStr, pattern) {
  const dirHandle = await getDailyNotesDir(vaultHandle, dailyNotesPath);
  return readDailyNoteFile(dirHandle, dateStr, pattern);
}

/**
 * Build a sort key for a task line so tasks can be ordered chronologically.
 * Key format: "YYYY-MM-DD THH:MM" — tasks with no date use noteDate (the
 * date of the file), tasks with no time sort after timed tasks of the same date.
 */
function taskLineSortKey(line, noteDate) {
  const m = line.match(/^\s*- \[[ xX]\]\s+(.*)$/);
  if (!m) return '\uffff';
  const body = m[1].trim();
  const dateMatch = body.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
  const date = dateMatch ? dateMatch[1] : (noteDate || '0000-00-00');
  const afterDate = dateMatch ? dateMatch[2] : body;
  const timeMatch = afterDate.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    return `${date}T${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  }
  return `${date}T\uffff`; // all-day / no-time → sort after timed tasks
}

/**
 * Sort all top-level task lines within a heading section chronologically,
 * leaving non-task lines (prose, blank lines) after the sorted tasks.
 * Returns a new lines array; the original is not mutated.
 */
function sortTaskLinesInSection(lines, headingStr, noteDate) {
  const headingIdx = lines.findIndex(l => l === headingStr);
  if (headingIdx === -1) return lines;
  const headingLevel = (headingStr.match(/^#+/) || [''])[0].length;
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const hm = lines[i].match(/^(#+)\s/);
    if (hm && hm[1].length <= headingLevel) { sectionEnd = i; break; }
  }
  const interior = lines.slice(headingIdx + 1, sectionEnd);
  const taskLines = interior.filter(l => /^\s*- \[/.test(l));
  const otherLines = interior.filter(l => !/^\s*- \[/.test(l));
  taskLines.sort((a, b) => {
    const ka = taskLineSortKey(a, noteDate);
    const kb = taskLineSortKey(b, noteDate);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  // Non-task lines (prose, blank lines) go after sorted tasks.
  // Drop trailing blanks to avoid accumulating empty lines on each write.
  const nonBlank = otherLines.filter(l => l.trim() !== '');
  const newSection = [...taskLines, ...nonBlank];
  if (sectionEnd < lines.length && newSection.length > 0) newSection.push('');
  return [...lines.slice(0, headingIdx + 1), ...newSection, ...lines.slice(sectionEnd)];
}

/**
 * Build the formatted markdown task line for a dayGLANCE task, mirroring the
 * format that parseTasksFromMarkdown recognises:
 *   - [ ] Title                         (inbox / all-day today)
 *   - [ ] 2026-03-29 Title              (all-day on another date)
 *   - [ ] 08:00-09:00 Title             (timed task on note's own date)
 *   - [ ] 2026-03-29 08:00-09:00 Title  (timed task on a different date)
 *
 * @param {{ title, startTime, duration, isAllDay, date, blockId }} task
 * @param {string} noteDate  The YYYY-MM-DD date of the note being written to
 */
function buildObsidianTaskLine(task, noteDate) {
  const datePrefix = task.date && task.date !== noteDate ? `${task.date} ` : '';
  const timePrefix = (!task.isAllDay && task.startTime) ? buildTimePrefix(task.startTime, task.duration || null) : '';
  // Phase 2: a task created in dayGLANCE lands in the vault already carrying
  // its ^dg- block id, assigned at creation time (useTaskActions) and
  // persisted on the app task — never derived at read time.
  return `- [ ] ${datePrefix}${timePrefix}${task.title}${blockIdSuffix(task.blockId, task.title)}`;
}

/**
 * Append a task line to a daily note under the specified heading.
 * Creates the note from the template if it doesn't exist.
 * Creates the heading section if it doesn't already exist in the note.
 *
 * @param task {{ title, startTime, duration, isAllDay, date }}
 */
export async function appendTaskToDailyNote(vaultHandle, dailyNotesPath, dateStr, task, heading, template, pattern) {
  assertSafeDateStr(dateStr);
  const dirHandle = await getDailyNotesDir(vaultHandle, dailyNotesPath);

  const existing = await readDailyNoteFile(dirHandle, dateStr, pattern);
  let content = existing ? existing.text : (template || '');

  const taskLine = buildObsidianTaskLine(task, dateStr);
  const lines = content.split('\n');

  if (heading && heading.trim()) {
    const headingStr = heading.trim();
    const headingLineIdx = lines.findIndex(l => l === headingStr);

    if (headingLineIdx !== -1) {
      // Insert the task right after the heading line
      lines.splice(headingLineIdx + 1, 0, taskLine);
    } else {
      // Heading not found — append it along with the task
      if (lines[lines.length - 1] !== '') lines.push('');
      lines.push(headingStr, taskLine, '');
    }
  } else {
    // No heading — append at end
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(taskLine);
  }

  const sorted = heading && heading.trim()
    ? sortTaskLinesInSection(lines, heading.trim(), dateStr)
    : lines;
  const fileHandle = await getDailyNoteHandleForWrite(dirHandle, dateStr, pattern);
  const writable = await fileHandle.createWritable();
  await writable.write(sorted.join('\n'));
  await writable.close();
}

/**
 * Recursively search a directory for `{fileName}.md`, skipping hidden dirs.
 * Returns the FileSystemFileHandle or null. Capped at depth 8 to avoid
 * runaway traversal of unusually deep vaults.
 */
async function findFileHandleInDir(dirHandle, mdFileName, depth = 0) {
  if (depth > 8) return null;
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && name === mdFileName) return handle;
    if (handle.kind === 'directory' && !name.startsWith('.')) {
      const found = await findFileHandleInDir(handle, mdFileName, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Read an arbitrary vault note by wikilink name (e.g. "My Note" or "Folder/My Note").
 * Returns { text, lastModified } or null if the file doesn't exist.
 *
 * When the name contains path separators (e.g. "Folder/My Note") the exact
 * path is used. When it is a bare name (e.g. "My Note") the entire vault is
 * searched recursively — mirroring how Obsidian resolves wikilinks.
 */
export async function readWikiNote(vaultHandle, noteName) {
  const parts = noteName.split('/').filter(Boolean);
  for (const part of parts) {
    if (part === '..' || part === '.') {
      throw new Error(`Obsidian: unsafe path segment "${part}" in wiki note name`);
    }
  }
  const mdFileName = `${parts[parts.length - 1]}.md`;

  let fileHandle;
  if (parts.length > 1) {
    // Explicit path — navigate directly
    let dir = vaultHandle;
    for (const part of parts.slice(0, -1)) {
      try { dir = await dir.getDirectoryHandle(part); }
      catch (err) { if (err.name === 'NotFoundError') return null; throw err; }
    }
    try { fileHandle = await dir.getFileHandle(mdFileName); }
    catch (err) { if (err.name === 'NotFoundError') return null; throw err; }
  } else {
    // Bare name — search whole vault so notes in sub-folders are found
    fileHandle = await findFileHandleInDir(vaultHandle, mdFileName);
    if (!fileHandle) return null;
  }

  const file = await fileHandle.getFile();
  return { text: await file.text(), lastModified: new Date(file.lastModified).toISOString() };
}

/**
 * Write (create or overwrite) an arbitrary vault note by wikilink name.
 *
 * For bare names the vault is searched first so edits land in the file's
 * actual location; if not found the file is created in [newNotesFolder]
 * (relative to vault root) or at vault root when newNotesFolder is blank.
 *
 * @param newNotesFolder  Optional folder for newly created notes, e.g. "dayGLANCE"
 */
export async function writeWikiNote(vaultHandle, noteName, content, newNotesFolder = '') {
  const parts = noteName.split('/').filter(Boolean);
  for (const part of parts) {
    if (part === '..' || part === '.') {
      throw new Error(`Obsidian: unsafe path segment "${part}" in wiki note name`);
    }
  }
  const mdFileName = `${parts[parts.length - 1]}.md`;

  // ORDERING IS THE POINT: existence check BEFORE the portability gate.
  // The portability harm is entirely in bringing a NEW unportable name into
  // being — a file already sitting in the vault is already affecting sync
  // whether or not we write to it again, and refusing the write would strand
  // the task in a permanent error state whose only remedy breaks its link to
  // a note that visibly exists. So: exists → write, name notwithstanding;
  // missing → validate before creating (see utils/obsidianFilename.js — a
  // name like "plans?" is creatable here on macOS/Linux, and by Obsidian
  // itself there, but breaks the same vault on Windows/Android).
  let fileHandle = null;
  if (parts.length > 1) {
    // Explicit path — probe WITHOUT create
    let dir = vaultHandle;
    let dirsExist = true;
    for (const part of parts.slice(0, -1)) {
      try { dir = await dir.getDirectoryHandle(part); }
      catch (err) { if (err.name === 'NotFoundError') { dirsExist = false; break; } throw err; }
    }
    if (dirsExist) {
      try { fileHandle = await dir.getFileHandle(mdFileName); }
      catch (err) { if (err.name !== 'NotFoundError') throw err; }
    }
  } else {
    // Bare name — an existing note anywhere in the vault is written in place
    fileHandle = await findFileHandleInDir(vaultHandle, mdFileName);
  }

  if (!fileHandle) {
    // CREATION ONLY: the portability gate.
    const reason = validateWikiNoteName(noteName);
    if (reason) {
      const err = new Error(`Obsidian: cannot create note "${noteName}" — ${reason}`);
      err.code = 'unportable_name';
      err.reason = reason; // callers compose user-facing copy from the bare reason
      throw err;
    }
    if (parts.length > 1) {
      let dir = vaultHandle;
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      fileHandle = await dir.getFileHandle(mdFileName, { create: true });
    } else if (newNotesFolder) {
      const folderReason = validateVaultFolderSetting(newNotesFolder);
      if (folderReason) {
        const err = new Error(`Obsidian: new-notes folder "${newNotesFolder}" is unusable — ${folderReason}. Fix it in Settings → Obsidian.`);
        err.code = 'unportable_name';
        throw err;
      }
      let dir = vaultHandle;
      for (const segment of newNotesFolder.split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(segment, { create: true });
      }
      fileHandle = await dir.getFileHandle(mdFileName, { create: true });
    } else {
      fileHandle = await vaultHandle.getFileHandle(mdFileName, { create: true });
    }
  }

  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Scan the vault once and return everything the single traversal can tell us:
 *  - names: sorted bare note names (without .md), for wikilink autocomplete.
 *  - unportable: [{ path, reason }] of entries whose names may not sync to
 *    Windows or Android devices (issue #1358; rules in
 *    utils/vaultPortability.js). Computed during this scan precisely so the
 *    Settings -> Obsidian listing costs no traversal of its own.
 * Scans at most 8 levels deep and ignores hidden directories (starting with
 * '.'), both unchanged from the original wikilink-candidates scan.
 */
export async function scanVaultNotes(vaultHandle) {
  const names = [];
  const unportable = [];
  async function scan(dir, depth, prefix) {
    if (depth > 8) return;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file') {
        if (name.endsWith('.md')) names.push(name.slice(0, -3));
        const reason = unportableEntryReason(name, 'file');
        if (reason) unportable.push({ path: prefix + name, reason });
      } else if (handle.kind === 'directory' && !name.startsWith('.')) {
        const reason = unportableEntryReason(name, 'directory');
        if (reason) unportable.push({ path: prefix + name + '/', reason });
        await scan(handle, depth + 1, prefix + name + '/');
      }
    }
  }
  await scan(vaultHandle, 0, '');
  return {
    names: names.sort((a, b) => a.localeCompare(b)),
    unportable: unportable.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * Strip leading date / date+time / time prefixes from a raw task line body
 * (the text after `- [x] `) to get the bare title, mirroring
 * parseTasksFromMarkdown.  Returns { bareTitle, datePrefix } where datePrefix
 * is the "YYYY-MM-DD " string (with trailing space) if one was present, or ''.
 */
function stripLinePrefixes(text) {
  const trimmed = text.trim();
  // Regex that matches a single time or a duration range (HH:MM or HH:MM-HH:MM) with optional AM/PM
  const timeRe = /^(\d{1,2}):(\d{2})\s*(?:[AaPp][Mm])?(?:-\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?)?\s+(.+)$/;
  // 1) Leading date: "YYYY-MM-DD ..."
  const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (dateMatch) {
    const datePrefix = dateMatch[1] + ' ';
    const afterDate = dateMatch[2];
    // Date + time (or date + range)
    const tm = afterDate.match(timeRe);
    if (tm) return { bareTitle: tm[3], datePrefix };
    // Date only
    return { bareTitle: afterDate, datePrefix };
  }
  // 2) Time only (or range only)
  const tm = trimmed.match(timeRe);
  if (tm) return { bareTitle: tm[3], datePrefix: '' };
  // 3) Plain title
  return { bareTitle: trimmed, datePrefix: '' };
}

/**
 * Apply a task-state update to daily-note lines IN PLACE. Shared by the FSA
 * and Android-native writeback paths so ID-first matching cannot drift.
 *
 * Matching (Phase 2):
 *  1. ID-first — when the task carries a block id, lines whose trailing
 *     `^dg-<id>` equals it are updated (the id survives the rewrite even when
 *     the title now ends in a user block ref, so identity is never dropped).
 *  2. Fallback — when no line carried the id (line predates tagging, or the
 *     user removed the token), lines are matched by bare title exactly as
 *     before, SKIPPING lines tagged with some other task's id (those are
 *     different tasks now, per the duplicate rule). Fallback-matched lines are
 *     stamped with the task's block id when one is provided — this is the
 *     opportunistic migration moment: existing untagged tasks acquire ids as
 *     they get rewritten, never via a sweep.
 *
 * Updating all occurrences within a match pass mirrors the historical
 * title-dedup behavior.
 *
 * @returns {boolean} whether any line was updated
 */
export function updateTaskLines(lines, { obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, blockId = null, onTitleConflict = null }) {
  const timeStr = buildTimePrefix(startTime, duration);
  const writtenTitle = newRawTitle !== undefined ? newRawTitle : obsidianRawTitle;
  // When targetDate is provided (task rescheduled to a different day), write
  // an explicit inline date prefix so the task is attributed to the new date
  // while remaining in its original daily note file.
  const rewrite = (i, indent, datePrefix, idSuffix, title = writtenTitle) => {
    const effectiveDatePrefix = targetDate ? `${targetDate} ` : datePrefix;
    lines[i] = `${indent}- [${completed ? 'x' : ' '}] ${effectiveDatePrefix}${timeStr}${title}${idSuffix}`;
  };

  let updated = false;
  if (blockId) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)- \[([ xX])\]\s+(.+)$/);
      if (!m) continue;
      const { text: body, blockId: lineId } = splitBlockId(m[3]);
      if (lineId !== blockId) continue;
      const { bareTitle, datePrefix } = stripLinePrefixes(body);
      // WRITE-TIME TITLE GUARD (the two-sided retitle policy's funnel —
      // utils/obsidianTitleConflict.js). The line's CURRENT title is the
      // vault's truth; app state was built from obsidianRawTitle, our last
      // observation. When the line moved off that base, rebuilding it from
      // app state would silently revert an Obsidian edit — the one hostile
      // outcome — so the rewrite KEEPS THE LINE'S OWN TITLE while still
      // writing the state change. If we were also trying to RETITLE
      // (newRawTitle differs from the line too), that is a two-sided
      // conflict: signal it so the caller skips the titleUpdate commit,
      // obsidianRawTitle stays truthful as the merge base, and the next
      // scan resolves through the single scan-time policy.
      const lineDiverged = bareTitle !== obsidianRawTitle && bareTitle !== writtenTitle;
      if (lineDiverged && newRawTitle !== undefined) onTitleConflict?.({ lineTitle: bareTitle });
      // Forced suffix: a line that already carried this id keeps it
      // unconditionally — the foreign-block-ref guard only applies to
      // FIRST-TIME stamping, never to preserving established identity.
      rewrite(i, m[1], datePrefix, ` ^dg-${blockId}`, lineDiverged ? bareTitle : writtenTitle);
      updated = true;
    }
    if (updated) return true;
  }

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- \[([ xX])\]\s+(.+)$/);
    if (!m) continue;
    const { text: body, blockId: lineId } = splitBlockId(m[3]);
    if (lineId) continue; // tagged line — belongs to whichever task owns that id
    const { bareTitle, datePrefix } = stripLinePrefixes(body);
    if (bareTitle !== obsidianRawTitle) continue;
    rewrite(i, m[1], datePrefix, blockIdSuffix(blockId, writtenTitle));
    updated = true;
  }
  return updated;
}

/**
 * Write a task's completion and scheduling state back to its Obsidian file.
 * Line matching is ID-first with title fallback — see updateTaskLines.
 *
 * @param {string|null} [blockId]  the task's ^dg- block id (or a freshly
 *   assigned one to stamp on the matched line)
 * @returns {Promise<boolean>} whether a line was found and the file written —
 *   callers use this to commit a fresh id assignment only when it actually
 *   reached the vault.
 */
export async function writeTaskStateToFile(vaultHandle, dailyNotesPath, dateStr, obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, taskHeading = null, blockId = null, onTitleConflict = null) {
  assertSafeDateStr(dateStr);
  if (targetDate) assertSafeDateStr(targetDate);
  const dirHandle = await getDailyNotesDir(vaultHandle, dailyNotesPath);
  let fileHandle, text;
  try {
    fileHandle = await dirHandle.getFileHandle(`${dateStr}.md`);
    const file = await fileHandle.getFile();
    text = await file.text();
  } catch (err) {
    if (err.name === 'NotFoundError') return false; // file gone, nothing to update
    throw err;
  }

  const lines = text.split('\n');
  const updated = updateTaskLines(lines, { obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, blockId, onTitleConflict });

  if (updated) {
    const finalLines = taskHeading
      ? sortTaskLinesInSection(lines, taskHeading.trim(), dateStr)
      : lines;
    const writable = await fileHandle.createWritable();
    await writable.write(finalLines.join('\n'));
    await writable.close();
  }
  return updated;
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

// ---------------------------------------------------------------------------
// Block-ID identity (Obsidian build-out Phase 2)
//
// Task lines dayGLANCE writes carry a trailing `^dg-<id>` Obsidian block
// reference — native syntax, invisible in reading view, survives edits and
// reordering. The id is generated at write time, persisted on the task as
// `obsidianBlockId`, and embedded in the line itself, so every device that
// scans the vault derives the same durable identity from the file — unlike
// the legacy content-derived id (date + title hash), which changes whenever
// the title or date does. Matching is ID-first with fallback to the legacy
// text matching for lines that carry no id; existing untagged lines acquire
// ids opportunistically as they get rewritten. No sweep, no flag day.
// ---------------------------------------------------------------------------

/**
 * DERIVE a block id: 8 chars of lowercase base36, a pure function of the
 * line's stable identity — (daily-note date, raw title), the same inputs the
 * legacy content id hashes.
 *
 * WHY DERIVED, NOT RANDOM (the echo-stamp decision): with random minting, an
 * edit that reaches the fleet under the LEGACY id (it originated on a device
 * without vault access, or a vault device's write failed before its rename
 * committed) makes every vault-capable device mint its own token for the same
 * line — an N-way identity race that converges only through retirement
 * records, detector reaping, and Obsidian Sync settling the file, with one
 * no-heal corner (a mint whose device closes before ever scanning it lingers
 * as a permanent duplicate row). Deriving the token makes the race
 * semantically empty: every device mints the SAME token, so an N-way mint is
 * N devices writing an identical line — nothing to reconcile, nothing to
 * reap. One logical edit produces one token by UNANIMITY rather than
 * election.
 *
 * NORMALIZATION (pinned deliberately — a subtle cross-device difference here
 * silently restores the old race): the hash input is
 *     `${dateStr}\u0000${String(rawTitle).normalize('NFC').trim()}`
 *   • dateStr — the ISO `YYYY-MM-DD` the write targets (the daily note's
 *     date, exactly the string used in legacy ids and filenames);
 *   • rawTitle — the title AS IT WILL EXIST ON THE LINE (for a retitling
 *     write, the NEW raw title), NFC-normalized (macOS/iOS text input can
 *     produce decomposed forms) and trimmed; internal whitespace is
 *     PRESERVED (titles differing inside are different lines);
 *   • the display '#obsidian' tag never appears in rawTitle by construction;
 *   • NUL separator so ('2026-08-281', 'x') can't alias ('2026-08-28', '1x').
 *
 * ★ FROZEN ALGORITHM: FNV-1a 64-bit over the UTF-8 bytes, mod 36^8, base36,
 * zero-padded to 8. Tokens derived by different app VERSIONS must agree
 * forever — changing any detail here (hash, seed, input shape) reintroduces
 * cross-device divergence between updated and un-updated devices. The golden
 * values in obsidian.deterministicBlockIds.test.js pin it.
 *
 * Collision profile: same inputs as the legacy id, so colliding pairs are
 * exactly the pairs that already collide today, governed by the existing
 * first-occurrence-wins rule; 36^8 ≈ 2.8e12 makes unrelated collisions
 * vanishingly unlikely at vault scale.
 */
export function deriveBlockId(dateStr, rawTitle) {
  const input = `${dateStr}\u0000${String(rawTitle ?? '').normalize('NFC').trim()}`;
  let h = 0xcbf29ce484222325n; // FNV-1a 64-bit offset basis
  for (const byte of new TextEncoder().encode(input)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn; // FNV prime, mod 2^64
  }
  return (h % 2821109907456n).toString(36).padStart(8, '0'); // 36^8
}

/**
 * The app-level task id for a block-tagged line. Content-independent, so it is
 * identical on every device whenever the line was first scanned — the property
 * the legacy `obsidian-<date>-<hash>` id lacks (two devices that first import
 * before/after a retitle derive different ids and cloud merge duplicates).
 */
// Identity metadata for a NEW vault-bound task created in dayGLANCE — one of
// the two block-id EMIT sites (the other is the writeback's opportunistic
// stamp in useObsidianSync), both gated by the read/write release split
// (utils/obsidianWritePolicy.js).
//
// WRITE release: identity is a ^dg- block id generated HERE, at creation
// time, and persisted on the task — never derived from content at read time.
// The appended vault line carries the same id (blockIdSuffix via the append
// path), so the next scan parses it back to exactly this task id and the
// round trip converges without text matching.
//
// READ release: the pre-Phase-2 content-derived identity, so no device emits
// a token before the whole fleet can read one. The hash input is the same
// rawTitle a rescan of the (token-less) appended line will hash, so the round
// trip still converges — exactly as it did before Phase 2.
export function buildNewObsidianTaskMeta(rawTitle, todayStr) {
  const base = {
    importSource: 'obsidian',
    obsidianRawTitle: rawTitle,
    obsidianFileDate: todayStr,
  };
  if (!blockIdWritesEnabled()) {
    return { ...base, id: `obsidian-${todayStr}-${simpleHash(rawTitle)}` };
  }
  // Derived, not random — every device creating "the same" line derives the
  // same token (see deriveBlockId).
  const blockId = deriveBlockId(todayStr, rawTitle);
  return { ...base, id: appIdForBlockId(blockId), obsidianBlockId: blockId };
}

export function appIdForBlockId(blockId) {
  return `obsidian-dg-${blockId}`;
}

/** The legacy content-derived id for an untagged line (and pre-Phase-2 tasks). */
export function legacyObsidianId(taskDate, rawTitle) {
  return `obsidian-${taskDate}-${simpleHash(rawTitle)}`;
}

const DG_BLOCK_ID_RE = /\s+\^dg-([a-z0-9]+)\s*$/;

/**
 * Split a trailing ` ^dg-<id>` block reference off a task-line body.
 * Only dayGLANCE's own `^dg-` ids are recognised; a user's own block
 * reference (e.g. `^quote1`) stays part of the title, exactly as today.
 * A `^` anywhere else in the title is untouched.
 * @returns {{ text: string, blockId: string|null }}
 */
export function splitBlockId(text) {
  const m = DG_BLOCK_ID_RE.exec(text);
  if (!m) return { text, blockId: null };
  return { text: text.slice(0, m.index), blockId: m[1] };
}

// Obsidian allows exactly one block reference per line, at end of line. A line
// whose title already ends in a user-authored block id must never get a ^dg-
// suffix appended — the appended id would become the line's block id and break
// the user's existing block links.
const FOREIGN_BLOCK_ID_RE = /(^|\s)\^[A-Za-z0-9-]+$/;
export function hasForeignBlockId(text) {
  return FOREIGN_BLOCK_ID_RE.test(String(text).trimEnd());
}

/**
 * The ` ^dg-<id>` suffix for a written task line, or '' when there is no id to
 * write or the title carries a user-authored block reference (see above).
 */
export function blockIdSuffix(blockId, writtenTitle) {
  if (!blockId || hasForeignBlockId(writtenTitle)) return '';
  return ` ^dg-${blockId}`;
}

/**
 * Try to parse a time string from the beginning of text.
 * Supports single times ("09:00", "9:00 AM") and duration ranges ("09:00-10:00").
 * Returns { startTime, duration, rest } or null.  duration is null when no range.
 */
function parseLeadingTime(text) {
  // Try duration range first: HH:MM[-HH:MM] [AM/PM] Title
  const rangeMatch = text.match(
    /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?-(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(.+)$/
  );
  if (rangeMatch) {
    let startH = parseInt(rangeMatch[1], 10);
    const startM = parseInt(rangeMatch[2], 10);
    const startAmpm = rangeMatch[3];
    let endH = parseInt(rangeMatch[4], 10);
    const endM = parseInt(rangeMatch[5], 10);
    const endAmpm = rangeMatch[6];
    if (startAmpm) {
      const upper = startAmpm.toUpperCase();
      if (upper === 'PM' && startH < 12) startH += 12;
      if (upper === 'AM' && startH === 12) startH = 0;
    }
    if (endAmpm) {
      const upper = endAmpm.toUpperCase();
      if (upper === 'PM' && endH < 12) endH += 12;
      if (upper === 'AM' && endH === 12) endH = 0;
    }
    if (startH < 0 || startH > 23 || endH < 0 || endH > 23) return null;
    const startTime = `${startH.toString().padStart(2, '0')}:${rangeMatch[2]}`;
    const rawDuration = (endH * 60 + endM) - (startH * 60 + startM);
    const duration = rawDuration > 0 ? rawDuration : rawDuration + 1440; // handle midnight wrap
    return { startTime, duration, rest: rangeMatch[7] };
  }

  // Fall back to single time: HH:MM [AM/PM] Title
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
    duration: null,
    rest: timeMatch[4],
  };
}

/**
 * Build the time prefix string for writing back to a task line.
 * Produces "HH:MM-HH:MM " when duration is provided, otherwise "HH:MM ".
 */
function buildTimePrefix(startTime, duration) {
  if (!startTime) return '';
  if (!duration) return `${startTime} `;
  const [h, m] = startTime.split(':').map(Number);
  const endTotal = h * 60 + m + duration;
  const eh = Math.floor(endTotal / 60) % 24;
  const em = endTotal % 60;
  const endTime = `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}`;
  return `${startTime}-${endTime} `;
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
 *
 * @param {Set<string>} [seenBlockIds]  duplicate `^dg-` guard. First occurrence
 *   of an id wins; later lines carrying the same id (a copy-paste inside
 *   Obsidian) are parsed as if untagged, becoming ordinary content-derived
 *   tasks. The sync passes ONE set across every file in the scan so the rule
 *   holds vault-wide, not merely per file.
 */
export function parseTasksFromMarkdown(content, dateStr, seenBlockIds = new Set()) {
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

    // Strip a trailing ^dg-<id> block reference BEFORE any other parsing, so
    // rawTitle (and therefore the legacy hash) is identical to what an
    // untagged copy of the line would produce — that identity is what lets
    // ID-matching and text-matching fall back into each other cleanly.
    let blockId = null;
    const idSplit = splitBlockId(rawTitle);
    if (idSplit.blockId) {
      rawTitle = idSplit.text.trim();
      if (!seenBlockIds.has(idSplit.blockId)) {
        seenBlockIds.add(idSplit.blockId);
        blockId = idSplit.blockId;
      }
      // else: duplicate id — first occurrence won; this line falls through as
      // an untagged task (blockId stays null).
    }

    let taskDate = dateStr;
    let startTime = null;
    let isAllDay = false;
    let parsedDuration = null;

    // 1) Try inline date: "YYYY-MM-DD ..." at the beginning
    const dateMatch = rawTitle.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (dateMatch) {
      taskDate = dateMatch[1];
      const afterDate = dateMatch[2];

      // 1a) Try date + time/range: "YYYY-MM-DD HH:MM[-HH:MM][am/pm] Title"
      const timePart = parseLeadingTime(afterDate);
      if (timePart) {
        startTime = timePart.startTime;
        if (timePart.duration) parsedDuration = timePart.duration;
        rawTitle = timePart.rest;
      } else {
        // 1b) Date only → all-day task
        isAllDay = true;
        rawTitle = afterDate;
      }
    } else {
      // 2) Try time/range only: "HH:MM[-HH:MM][am/pm] Title"
      const timePart = parseLeadingTime(rawTitle);
      if (timePart) {
        startTime = timePart.startTime;
        if (timePart.duration) parsedDuration = timePart.duration;
        rawTitle = timePart.rest;
      }
    }

    // Add #obsidian tag if not already present
    const title = rawTitle.includes('#obsidian') ? rawTitle : `${rawTitle} #obsidian`;

    // ID-first: a ^dg- tagged line gets its durable block-derived id; an
    // untagged line keeps the legacy content-derived id (date + title hash).
    const legacyId = legacyObsidianId(taskDate, rawTitle);
    const id = blockId ? appIdForBlockId(blockId) : legacyId;
    // obsidianLegacyId is a PER-SCAN bridge hint, not an identity: it is what
    // this line's id would have been without the tag, recomputed from current
    // content each scan. The sync uses it to match a freshly-tagged line to
    // the task a device still holds under the old id, so app-side fields
    // survive the one-time legacy → block-id switch.
    const blockFields = blockId
      ? { obsidianBlockId: blockId, obsidianLegacyId: legacyId }
      : {};

    if (startTime) {
      // Timed task (with or without inline date)
      scheduled.push({
        id,
        title,
        date: taskDate,
        startTime,
        duration: parsedDuration || 30,
        color: 'bg-purple-600',
        completed,
        isAllDay: false,
        notes: '',
        subtasks: [],
        importSource: 'obsidian',
        obsidianRawTitle: rawTitle,
        obsidianFileDate: dateStr,
        ...blockFields,
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
        ...blockFields,
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
        ...blockFields,
      });
    }
  }

  return { scheduledTasks: scheduled, inboxTasks: inbox };
}

// ---------------------------------------------------------------------------
// Full vault sync
// ---------------------------------------------------------------------------

/**
 * Resolve which existing app task a scanned task corresponds to: by id first;
 * then, for a tagged line, by its legacy content-derived id — the one-time
 * bridge for a device that still holds the task under the pre-tagging id
 * (another device stamped the line since this device last synced).
 */
function resolveExistingObsidianTask(existingTaskMap, task) {
  return existingTaskMap[task.id]
    || (task.obsidianLegacyId ? existingTaskMap[task.obsidianLegacyId] : undefined);
}

/**
 * Title ownership for block-tagged tasks. Historically "DG owns the title"
 * was enforced by preserving existing.title — but it was also unreachable for
 * Obsidian-side retitles, because a retitle changed the content-derived id
 * and the task re-imported fresh (as a duplicate) instead. With a stable
 * block id the same line IS matched, so the rule must be explicit: when the
 * line's raw title differs from what dayGLANCE last knew the vault said
 * (obsidianRawTitle, which the writeback keeps current), the vault was edited
 * after our last write — the Obsidian retitle wins. When they are equal, the
 * vault is unchanged and any DG-side rename is preserved as before. Reverting
 * the user's Obsidian edit on the next writeback would be the one hostile
 * outcome, and is exactly the Phase 2 exit-criteria scenario.
 */
function vaultTitleWins(task, existing) {
  return !!task.obsidianBlockId
    && existing.obsidianRawTitle !== undefined
    && task.obsidianRawTitle !== existing.obsidianRawTitle;
}

/**
 * Title ownership at the merge boundary — the TWO-SIDED RETITLE POLICY
 * (utils/obsidianTitleConflict.js). One-sided cases are unchanged: DG-only
 * rename preserved, Obsidian-only retitle adopted (vaultTitleWins). When BOTH
 * sides moved off the base, the vault wins the title and the dayGLANCE rename
 * is appended to task.notes as a durable record (idempotently — N devices'
 * scans produce one line), with the conflict reported upward for the neutral
 * toast. task.notes here already carries existing.notes (the merge copies it
 * before title resolution at every call site), and notes are app-only — the
 * append can never trigger a vault write.
 */
function resolveTitleOwnership(task, existing, onTitleConflict) {
  if (existing.title === undefined) return;
  if (!vaultTitleWins(task, existing)) {
    task.title = existing.title;
    return;
  }
  // Vault wins: task.title stays the parsed line's title.
  const ours = stripObsidianDisplayTag(existing.title);
  if (detectTwoSidedRetitle({ base: existing.obsidianRawTitle, theirs: task.obsidianRawTitle, ours })) {
    task.notes = appendTitleConflictNote(task.notes, ours, new Date().toISOString().slice(0, 10));
    onTitleConflict?.({ dgTitle: ours, vaultTitle: task.obsidianRawTitle });
  }
}

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
  pattern,
  onTitleConflict = null,
) {
  const dirHandle = await getDailyNotesDir(vaultHandle, dailyNotesPath);

  // Cutoff date string; '0000-00-00' when the window is unlimited (reads everything).
  const cutoffStr = obsidianWindowCutoffDate(retentionDays) ?? '0000-00-00';

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
  // Obsidian sync fires before cloud-sync's applyEngineData has had a chance
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

  // Pre-build the filename parser for custom patterns (avoids re-compiling inside the loop)
  const isDefaultPattern = !pattern || pattern === 'yyyy-MM-dd';
  const dateParser = isDefaultPattern ? null : buildDateParser(pattern);

  // ONE duplicate-^dg-id guard across every file in this scan, so the
  // first-occurrence-wins rule holds vault-wide (a line copy-pasted into a
  // different daily note is still a duplicate).
  const seenBlockIds = new Set();

  // Iterate files in the daily notes directory
  for await (const [name, handle] of dirHandle) {
    if (handle.kind !== 'file' || !name.endsWith('.md')) continue;

    let dateStr;
    if (isDefaultPattern) {
      const stem = name.slice(0, -3);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stem)) continue;
      dateStr = stem;
    } else {
      dateStr = parseDateFromFilename(name, dateParser);
      if (!dateStr) continue;
    }
    // Apply cutoff
    if (dateStr < cutoffStr) continue;

    const file = await handle.getFile();
    const text = await file.text();
    const lastModified = new Date(file.lastModified).toISOString();

    // Store daily note
    dailyNotes[dateStr] = { text, lastModified, fromObsidian: true };

    // Parse tasks
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(text, dateStr, seenBlockIds);

    // Merge: once imported, DG owns scheduling, title, and app-controlled
    // properties.  Obsidian only controls task *existence* and initial values.
    // We also honour cross-array moves: if the user moved a vault-scheduled
    // task into the inbox (or vice versa), the task goes into the array the
    // user chose, not the one the vault dictates.
    for (const task of scheduledTasks) {
      const existing = resolveExistingObsidianTask(existingTaskMap, task);
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
        // overwrites moves/renames the user made inside the app — EXCEPT the
        // title of a tagged line Obsidian edited since our last write, which
        // the vault wins (see vaultTitleWins).
        if (existing.date !== undefined) task.date = existing.date;
        if (existing.startTime !== undefined) task.startTime = existing.startTime;
        if (existing.isAllDay !== undefined) task.isAllDay = existing.isAllDay;
        resolveTitleOwnership(task, existing, onTitleConflict);
        // Preserve lastModified so cloud merge keeps recognising the
        // version the user actually edited rather than treating re-imports
        // as brand-new tasks with a fresh timestamp.
        if (existing.lastModified) task.lastModified = existing.lastModified;

        // User moved this to inbox — respect the cross-array move (keyed by
        // the id the task holds IN STATE, which during the one-time block-id
        // switch is the legacy id, not the freshly parsed one)
        if (userInboxIds.has(String(existing.id))) {
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
      const existing = resolveExistingObsidianTask(existingTaskMap, task);
      if (existing) {
        if (existing.completed) task.completed = true;
        if (existing.priority !== undefined) task.priority = existing.priority;
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        resolveTitleOwnership(task, existing, onTitleConflict);
        if (existing.lastModified) task.lastModified = existing.lastModified;

        // User scheduled this from inbox — respect the cross-array move
        if (userScheduledIds.has(String(existing.id))) {
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
 * Append a task line to a daily note via the native bridge (Android).
 * Uses the same heading-insertion logic as appendTaskToDailyNote.
 *
 * @param task {{ title, startTime, duration, isAllDay, date }}
 */
// Native bridge write results are booleans on Android (@JavascriptInterface
// marshals Kotlin's Boolean) but STRINGS on iOS — the dgbridge:// XHR shim
// returns responseText, so a FAILED write comes back as the truthy string
// "false". Success is exactly these two values; anything else (false, "false",
// null, undefined) is a failed or unattempted write. Every native write site
// must go through this — a raw truthiness check silently converts every iOS
// failure into a success.
const nativeWriteOk = (v) => v === true || v === 'true';

export function appendTaskToDailyNoteNative(dateStr, task, heading, template) {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge?.getDailyNote || !bridge?.writeDailyNote) return false;

  // READ CONTRACT (both bridges): "" = determinately absent-or-empty note;
  // null = the read FAILED. A failed read must abort the append — falling
  // back to the template here would OVERWRITE the real note with template
  // plus one task line.
  const existing = bridge.getDailyNote(dateStr);
  if (existing === null || existing === undefined) {
    console.error('[Obsidian native] Daily note read failed; not appending (the note may have content we cannot see)');
    return false;
  }
  // "" (absent or empty note) keeps its longstanding native behavior: the
  // task line starts the note. (The template fallback used to trigger only on
  // a null read — which the failure contract above now correctly aborts.)
  let content = existing;

  const taskLine = buildObsidianTaskLine(task, dateStr);
  const lines = content.split('\n');

  if (heading && heading.trim()) {
    const headingStr = heading.trim();
    const headingLineIdx = lines.findIndex(l => l === headingStr);

    if (headingLineIdx !== -1) {
      lines.splice(headingLineIdx + 1, 0, taskLine);
    } else {
      if (lines[lines.length - 1] !== '') lines.push('');
      lines.push(headingStr, taskLine, '');
    }
  } else {
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(taskLine);
  }

  const sorted = heading && heading.trim()
    ? sortTaskLinesInSection(lines, heading.trim(), dateStr)
    : lines;
  try {
    // Honor the bridge's write result — mirrors the desktop caller, whose
    // append promise rejects on a failed write and lands in a console.error.
    if (!nativeWriteOk(bridge.writeDailyNote(dateStr, sorted.join('\n')))) {
      console.error('[Obsidian native] Failed to write task to daily note: bridge reported write failure');
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Obsidian native] Failed to write task to daily note:', err);
    return false;
  }
}

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
    return nativeWriteOk(bridge.writeDailyNote(date, content));
  } catch {
    return false;
  }
}

/**
 * Write a task's completion and scheduling state back to its Obsidian file
 * via the native bridge.
 *
 * Reads the note with getDailyNote, applies the same ID-first line matching
 * as writeTaskStateToFile (shared updateTaskLines), then writes the result
 * back with writeDailyNote.
 *
 * @returns {boolean} whether a line was found AND the bridge CONFIRMED the
 *   write — callers use this to commit id/rawTitle bookkeeping (including a
 *   fresh block-id assignment) only when it actually reached the vault. The
 *   bridge's own result is honored via nativeWriteOk: returning `updated`
 *   alone here once let a failed SAF write commit a block id no vault line
 *   carried — an id no scan could ever match or tombstone. This is the native
 *   half of the desktop contract, where the Electron shim's close() throws on
 *   a failed write and the .then(commit) never runs.
 */
export function writeTaskStateNative(date, obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, taskHeading = null, blockId = null, onWriteFailure = null, onTitleConflict = null) {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge?.getDailyNote || !bridge?.writeDailyNote) return false;

  try {
    const text = bridge.getDailyNote(date);
    // null = vault not configured OR the read FAILED (the bridges' read
    // contract) — either way, nothing can be safely rewritten. This IS a
    // failure worth surfacing: the caller asked to write and the vault
    // couldn't be reached.
    if (!text && text !== '') {
      onWriteFailure?.();
      return false;
    }

    const lines = text.split('\n');
    const updated = updateTaskLines(lines, { obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, blockId, onTitleConflict });

    if (updated) {
      const finalLines = taskHeading
        ? sortTaskLinesInSection(lines, taskHeading.trim(), date)
        : lines;
      if (!nativeWriteOk(bridge.writeDailyNote(date, finalLines.join('\n')))) {
        console.error('Obsidian native writeback: vault write failed, not committing');
        onWriteFailure?.();
        return false;
      }
    }
    // `updated` false without onWriteFailure is the BENIGN no-matching-line
    // case: the vault no longer carries the line, which is the vault's truth
    // and the next scan's job — not a write failure.
    return updated;
  } catch (err) {
    console.error('Obsidian native writeback error:', err);
    onWriteFailure?.();
    return false;
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
// Set up the async callback dispatcher once
if (typeof window !== 'undefined' && !window.__obsidianDispatch) {
  window.__obsidianDispatch = (id, result, error) => {
    const cb = window.__obsidianCbs?.[id];
    if (cb) {
      delete window.__obsidianCbs[id];
      cb(result, error);
    }
  };
}

/**
 * Resolve the lastModified for a native daily-note scan entry.
 *
 * The native scan (getAllDailyNotes) carries each file's REAL modification time in
 * `entry.lastModified` once the Kotlin bridge reports it (ObsidianRepository.kt).
 * Older app/bridge builds omit it — fall back to `nowIso` so a scan still works
 * during the rollout. Using the real mtime instead of a fresh "now" stops the native
 * side from stamping every note as just-modified on every sync — the false-LWW /
 * churn source the web (File System Access) path never had, since it always used the
 * file's real `file.lastModified`.
 *
 * @param {{lastModified?: string}} entry  one native note entry
 * @param {string} nowIso                  fallback timestamp (current time, ISO)
 * @returns {string}
 */
export function nativeNoteLastModified(entry, nowIso) {
  return (entry && entry.lastModified) || nowIso;
}

export async function syncObsidianVaultNative(folder, retentionDays, existingTasks, existingInbox, onTitleConflict = null) {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge) throw new Error('Obsidian bridge unavailable');

  // Cutoff date string; '0000-00-00' when the window is unlimited (reads everything).
  const cutoffStr = obsidianWindowCutoffDate(retentionDays) ?? '0000-00-00';

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

  // Prefer the batch getAllDailyNotesAsync method (non-blocking: SAF I/O runs on a
  // background thread and callbacks back via JS) over the synchronous alternatives.
  let noteEntries; // [{ date, text, lastModified? }] — lastModified present from getAllDailyNotes
  if (bridge.getAllDailyNotesAsync) {
    // Non-blocking path: runs SAF I/O on a background thread, callbacks via JS
    if (!window.__obsidianCbs) window.__obsidianCbs = {};
    const json = await new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2, 18).replace(/[^a-z0-9]/g, 'x');
      window.__obsidianCbs[id] = (result, error) => {
        if (error) reject(new Error(error));
        else resolve(result);
      };
      bridge.getAllDailyNotesAsync(folder, cutoffStr, id);
    });
    try {
      noteEntries = JSON.parse(json);
    } catch (err) {
      throw new Error(`Failed to parse daily notes from vault: ${err.message}`);
    }
  } else if (bridge.getAllDailyNotes) {
    try {
      noteEntries = JSON.parse(bridge.getAllDailyNotes(folder, cutoffStr));
    } catch (err) {
      throw new Error(`Failed to read daily notes from vault: ${err.message}`);
    }
  } else if (bridge.listNotes && bridge.getDailyNote) {
    // Fallback: legacy path used when running against an older app build
    let notePaths;
    try {
      notePaths = JSON.parse(bridge.listNotes(folder));
    } catch (err) {
      throw new Error(`Failed to list vault notes: ${err.message}`);
    }
    noteEntries = [];
    for (const notePath of notePaths) {
      const fileName = notePath.split('/').pop();
      if (!fileName?.endsWith('.md')) continue;
      const dateStr = fileName.replace('.md', '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || dateStr < cutoffStr) continue;
      // A LISTED note that cannot be read fails the WHOLE scan. Silently
      // skipping it (the old behavior) removed the note key AND its task keys
      // from the scan — feeding the deletion detector "these were deleted".
      const text = bridge.getDailyNote(dateStr);
      if (text === null || text === undefined) {
        throw new Error(`Could not read daily note ${dateStr} from the vault`);
      }
      noteEntries.push({ date: dateStr, text });
    }
  } else {
    throw new Error('Obsidian bridge is missing required methods (getAllDailyNotes or listNotes)');
  }

  // FAILED-READ GATE. The native bridges signal a failed batch read as a JSON
  // OBJECT `{"error":"…"}` where success is an ARRAY (iOS — its scheme handler
  // cannot throw across the XHR shim), or by throwing (Android — surfaced
  // above as a parse/dispatch error). This scan feeds the deletion detector:
  // an unreadable vault that came back empty-shaped would tombstone task keys
  // fleet-wide as user deletions. Failing here means the scan never happened —
  // performObsidianSync's catch keeps the baseline, the tombstones, and the
  // sync status untouched except for surfacing the error.
  if (!Array.isArray(noteEntries)) {
    throw new Error(noteEntries?.error || 'Vault read failed');
  }

  // Vault-wide duplicate-^dg-id guard, matching syncObsidianVault.
  const seenBlockIds = new Set();

  for (const entry of noteEntries) {
    const { date: dateStr, text } = entry;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (text === null || text === undefined) continue;

    // Use the file's REAL mtime from the native scan; fall back to now for older
    // bridge builds that don't report it yet. See nativeNoteLastModified.
    dailyNotes[dateStr] = { text, lastModified: nativeNoteLastModified(entry, new Date().toISOString()), fromObsidian: true };

    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(text, dateStr, seenBlockIds);

    // Same merge logic as syncObsidianVault
    for (const task of scheduledTasks) {
      const existing = resolveExistingObsidianTask(existingTaskMap, task);
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
        resolveTitleOwnership(task, existing, onTitleConflict);
        if (existing.lastModified) task.lastModified = existing.lastModified;
        if (userInboxIds.has(String(existing.id))) { allInbox.push(task); continue; }
      } else {
        task.lastModified = new Date(0).toISOString();
      }
      allScheduled.push(task);
    }

    for (const task of inboxTasks) {
      const existing = resolveExistingObsidianTask(existingTaskMap, task);
      if (existing) {
        if (existing.completed) task.completed = true;
        if (existing.priority !== undefined) task.priority = existing.priority;
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        resolveTitleOwnership(task, existing, onTitleConflict);
        if (existing.lastModified) task.lastModified = existing.lastModified;
        if (userScheduledIds.has(String(existing.id))) {
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
