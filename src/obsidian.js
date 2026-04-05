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
 * Silently restore a previously-granted vault handle from IndexedDB.
 * Only succeeds if permission is already 'granted' — does NOT call
 * requestPermission, so it is safe to call on page load without a user gesture.
 * Returns the handle or null.
 */
export async function tryRestoreVaultAccess() {
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
  const fileHandle = await dirHandle.getFileHandle(dailyNoteFilename(dateStr, pattern), { create: true });
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
 * @param {{ title, startTime, duration, isAllDay, date }} task
 * @param {string} noteDate  The YYYY-MM-DD date of the note being written to
 */
function buildObsidianTaskLine(task, noteDate) {
  const datePrefix = task.date && task.date !== noteDate ? `${task.date} ` : '';
  const timePrefix = (!task.isAllDay && task.startTime) ? buildTimePrefix(task.startTime, task.duration || null) : '';
  return `- [ ] ${datePrefix}${timePrefix}${task.title}`;
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
  const fileHandle = await dirHandle.getFileHandle(dailyNoteFilename(dateStr, pattern), { create: true });
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

  let fileHandle;
  if (parts.length > 1) {
    // Explicit path — create dirs as needed
    let dir = vaultHandle;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    fileHandle = await dir.getFileHandle(mdFileName, { create: true });
  } else {
    // Bare name — write to existing location, or create in newNotesFolder (or vault root)
    fileHandle = await findFileHandleInDir(vaultHandle, mdFileName)
      ?? await (async () => {
        if (newNotesFolder) {
          let dir = vaultHandle;
          for (const segment of newNotesFolder.split('/').filter(Boolean)) {
            dir = await dir.getDirectoryHandle(segment, { create: true });
          }
          return dir.getFileHandle(mdFileName, { create: true });
        }
        return vaultHandle.getFileHandle(mdFileName, { create: true });
      })();
  }

  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Return a sorted array of all vault note names (bare, without .md extension).
 * Used to populate the wikilink autocomplete candidates list.
 * Scans at most 8 levels deep and ignores hidden directories (starting with '.').
 */
export async function listVaultNotes(vaultHandle) {
  const names = [];
  async function scan(dir, depth) {
    if (depth > 8) return;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && name.endsWith('.md')) {
        names.push(name.slice(0, -3));
      } else if (handle.kind === 'directory' && !name.startsWith('.')) {
        await scan(handle, depth + 1);
      }
    }
  }
  await scan(vaultHandle, 0);
  return names.sort((a, b) => a.localeCompare(b));
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
 * Write a task's completion and scheduling state back to its Obsidian file.
 *
 * Finds every line matching `obsidianRawTitle` (the title text as it originally
 * appeared, without #obsidian tag or time prefix) and updates all of them.
 * Updating all occurrences is correct because dayGLANCE deduplicates tasks by
 * title-hash at import time, so a single task object in the app corresponds to
 * every occurrence of that title in the file.
 */
export async function writeTaskStateToFile(vaultHandle, dailyNotesPath, dateStr, obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, taskHeading = null) {
  assertSafeDateStr(dateStr);
  if (targetDate) assertSafeDateStr(targetDate);
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
    const timeStr = buildTimePrefix(startTime, duration);
    const writtenTitle = newRawTitle !== undefined ? newRawTitle : obsidianRawTitle;
    // When targetDate is provided (task rescheduled to a different day), write
    // an explicit inline date prefix so the task is attributed to the new date
    // while remaining in its original daily note file.
    const effectiveDatePrefix = targetDate ? `${targetDate} ` : datePrefix;
    lines[i] = `${indent}- [${completed ? 'x' : ' '}] ${effectiveDatePrefix}${timeStr}${writtenTitle}`;
    updated = true;
    // Continue — update every occurrence, not just the first.
  }

  if (updated) {
    const finalLines = taskHeading
      ? sortTaskLinesInSection(lines, taskHeading.trim(), dateStr)
      : lines;
    const writable = await fileHandle.createWritable();
    await writable.write(finalLines.join('\n'));
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

    // Stable ID: based on task's effective date + hash of raw title
    const id = `obsidian-${taskDate}-${simpleHash(rawTitle)}`;

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
  pattern,
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

  // Pre-build the filename parser for custom patterns (avoids re-compiling inside the loop)
  const isDefaultPattern = !pattern || pattern === 'yyyy-MM-dd';
  const dateParser = isDefaultPattern ? null : buildDateParser(pattern);

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
 * Append a task line to a daily note via the native bridge (Android).
 * Uses the same heading-insertion logic as appendTaskToDailyNote.
 *
 * @param task {{ title, startTime, duration, isAllDay, date }}
 */
export function appendTaskToDailyNoteNative(dateStr, task, heading, template) {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge?.getDailyNote || !bridge?.writeDailyNote) return;

  const existing = bridge.getDailyNote(dateStr);
  let content = (existing !== null && existing !== undefined) ? existing : (template || '');

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
    bridge.writeDailyNote(dateStr, sorted.join('\n'));
  } catch (err) {
    console.error('[Obsidian native] Failed to write task to daily note:', err);
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
export function writeTaskStateNative(date, obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, taskHeading = null) {
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
      const timeStr = buildTimePrefix(startTime, duration);
      const writtenTitle = newRawTitle !== undefined ? newRawTitle : obsidianRawTitle;
      const effectiveDatePrefix = targetDate ? `${targetDate} ` : datePrefix;
      lines[i] = `${indent}- [${completed ? 'x' : ' '}] ${effectiveDatePrefix}${timeStr}${writtenTitle}`;
      updated = true;
      // Continue — update every occurrence, not just the first.
    }

    if (updated) {
      const finalLines = taskHeading
        ? sortTaskLinesInSection(lines, taskHeading.trim(), date)
        : lines;
      bridge.writeDailyNote(date, finalLines.join('\n'));
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
  if (!bridge) throw new Error('Obsidian bridge unavailable');

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
      try {
        const text = bridge.getDailyNote(dateStr);
        if (text !== null && text !== undefined) noteEntries.push({ date: dateStr, text });
      } catch { /* skip unreadable notes */ }
    }
  } else {
    throw new Error('Obsidian bridge is missing required methods (getAllDailyNotes or listNotes)');
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
