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
// The vault line-format core now lives in @glance-apps/obsidian-format
// (packages/obsidian-format — format, never policy; see its README). This
// module keeps the TRANSPORTS and the SYNC/MERGE POLICY, imports the format
// core, and re-exports the names it always exported so no import site or
// test changed in the extraction.
import {
  assertSafeDateStr, formatDatePattern, buildDateParser, parseDateFromFilename, dailyNoteFilename,
  taskLineSortKey, sortTaskLinesInSection, buildObsidianTaskLine,
  updateTaskLines, parseTasksFromMarkdown,
  simpleHash, deriveBlockId, appIdForBlockId, legacyObsidianId,
  splitBlockId, hasForeignBlockId, blockIdSuffix,
  splitCompletionMarker, completionMarkerSuffix,
  splitTasksMetadata, reattachTasksMetadata,
  parseObsidianHeartbeat,
} from '@glance-apps/obsidian-format';
export {
  formatDatePattern, updateTaskLines, parseTasksFromMarkdown,
  simpleHash, deriveBlockId, appIdForBlockId, legacyObsidianId,
  splitBlockId, hasForeignBlockId, blockIdSuffix,
  splitCompletionMarker, completionMarkerSuffix,
} from '@glance-apps/obsidian-format';
import { withCreationFrontmatter } from './utils/obsidianFrontmatter.js';

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
  // Creation-from-template is the one daily-note path where dayGLANCE
  // genuinely instantiates the note, so it gets the creation frontmatter —
  // unless the user's template opens with its own `---` block, which wins
  // (utils/obsidianFrontmatter.js; the ownership rule). An existing note is
  // never decorated. (The native append has no template-instantiation path:
  // its read contract cannot distinguish absent from empty, so it starts
  // absent notes from the task line alone — pre-existing, unchanged.)
  let content = existing ? existing.text : withCreationFrontmatter(template || '', dateStr);

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

  const creating = !fileHandle;
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

  // Frontmatter on CREATION only (utils/obsidianFrontmatter.js): a note
  // dayGLANCE brings into being gets the minimal queryable block; a note
  // that already exists — whatever it contains — is never decorated.
  const finalContent = creating ? withCreationFrontmatter(content) : content;
  const writable = await fileHandle.createWritable();
  await writable.write(finalContent);
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

// ---------------------------------------------------------------------------
// Tasks-plugin detection (completion-marker format selection)
// ---------------------------------------------------------------------------

// The Obsidian Tasks plugin's registry id, as it appears in
// .obsidian/community-plugins.json (a flat JSON array of ENABLED plugin ids —
// Obsidian rewrites it on enable/disable, so presence in the file IS the
// enabled state).
export const OBSIDIAN_TASKS_PLUGIN_ID = 'obsidian-tasks-plugin';

/**
 * Vault-level detection: is the Tasks plugin enabled? Reads
 * .obsidian/community-plugins.json through the vault handle (File System
 * Access in the browser; the Electron shim's stat/readFile reach dot-paths
 * the same way).
 *
 * FAILURE DEFAULT (deliberate, from the gate review): missing, unreadable,
 * or malformed → false → the Dataview inline-field format. A vault with no
 * community plugins legitimately has no such file (the common case), and
 * when detection is wrong the cost is cosmetic in the safe direction — the
 * Tasks plugin ignores an unknown inline field, while Dataview still indexes
 * it. Detection failure never blocks or fails the task write itself.
 */
export async function vaultHasTasksPlugin(vaultHandle) {
  try {
    const text = await readVaultDotFile(vaultHandle, '.obsidian', 'community-plugins.json');
    if (text === null) return false;
    const arr = JSON.parse(text);
    return Array.isArray(arr) && arr.includes(OBSIDIAN_TASKS_PLUGIN_ID);
  } catch {
    return false;
  }
}

/**
 * Read one file inside a dot-directory of the vault, through the FSA
 * surface (real FSA in the browser; the Electron shim's stat/readFile reach
 * dot-paths identically). Returns the text, or null for missing/unreadable —
 * the shared transport path for everything that lives outside note space:
 * Tasks-plugin detection (.obsidian/community-plugins.json, #1470) and the
 * bridge-plugin heartbeat (.dayglance/heartbeat, Phase 5). Never creates
 * anything: both callers are probes.
 */
async function readVaultDotFile(vaultHandle, dirName, fileName) {
  try {
    const dir = await vaultHandle.getDirectoryHandle(dirName);
    const fh = await dir.getFileHandle(fileName);
    const file = await fh.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

/**
 * Write one file inside a dot-directory of the vault, creating the directory
 * if needed (FSA and the Electron shim). The write half of readVaultDotFile,
 * added for Phase 6's pairing dead-drop (.dayglance/pairing). Throws on
 * failure — pairing is a foreground user action whose errors are shown, not
 * a probe. Native transports deliberately have no write half yet: pairing is
 * a once-per-vault act performed from a desktop/FSA device (recorded in the
 * spec's Phase 6 notes).
 */
export async function writeVaultDotFile(vaultHandle, dirName, fileName, content) {
  const dir = await vaultHandle.getDirectoryHandle(dirName, { create: true });
  const fh = await dir.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * The bridge-plugin heartbeat (.dayglance/heartbeat — utils/obsidianHeartbeat.js
 * documents the contract and consumers). Returns the parsed payload or null;
 * missing, unreadable, and malformed are one case by design.
 */
export async function readVaultHeartbeat(vaultHandle) {
  return parseObsidianHeartbeat(await readVaultDotFile(vaultHandle, '.dayglance', 'heartbeat'));
}

/**
 * Native (Android/iOS) heartbeat read via the bridge's getHeartbeat, under
 * the shared read contract — with the same legacy-shell guards as
 * detectTasksPluginNative: a missing method (old Android shell) and the
 * literal string "null" (old iOS dispatcher echo over HTTP 200) both mean
 * "no answer", which for a liveness probe is simply null.
 */
export function readVaultHeartbeatNative() {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge?.getHeartbeat) return null;
  try {
    const text = bridge.getHeartbeat();
    if (text === null || text === undefined || text === 'null') return null;
    return parseObsidianHeartbeat(text);
  } catch {
    return null;
  }
}

/**
 * Native (Android/iOS) detection via the bridge's getCommunityPlugins, which
 * follows the shared read contract: null = the read FAILED, "" = the file is
 * determinately absent. Returns:
 *   true / false — determinate answer;
 *   null — could not determine (older native shell without the method, or a
 *          failed read): the caller keeps its last known value rather than
 *          flapping the format on a transient failure.
 */
export function detectTasksPluginNative() {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceObsidian : null;
  if (!bridge?.getCommunityPlugins) return null;
  try {
    const text = bridge.getCommunityPlugins();
    if (text === null || text === undefined) return null; // read failed
    // The iOS shim is a Proxy (every method name "exists") and an OLD app
    // shell's dispatcher answers unknown methods with the literal STRING
    // "null" over HTTP 200 — the same string-transport trap as the write
    // contract. That echo means "this shell doesn't have the method", i.e.
    // undetermined — NOT "no plugins". A real vault answer is "" (absent
    // file) or a JSON array.
    if (text === 'null') return null;
    if (text === '') return false; // determinately absent → no plugins enabled
    const arr = JSON.parse(text);
    return Array.isArray(arr) && arr.includes(OBSIDIAN_TASKS_PLUGIN_ID);
  } catch {
    return false; // malformed → the safe default (Dataview field)
  }
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
export async function writeTaskStateToFile(vaultHandle, dailyNotesPath, dateStr, obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, taskHeading = null, blockId = null, onTitleConflict = null, completionMeta = null) {
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
  const updated = updateTaskLines(lines, {
    obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, blockId, onTitleConflict,
    completedAt: completionMeta?.completedAt ?? null,
    completionFormat: completionMeta?.format ?? null,
  });

  if (updated) {
    const finalLines = taskHeading
      ? sortTaskLinesInSection(lines, taskHeading.trim(), dateStr)
      : lines;
    // NO-OP WRITE SKIP (churn reducer, byte-identity only — never a change to
    // WHAT gets written). The cross-device echo write rewrites a line already
    // carrying the state; when the would-be output equals what we just read,
    // skip the disk write: no mtime churn, no Obsidian Sync churn, no
    // launch-on-write wake for a vacuous write. The FIRST echo after an
    // Obsidian-side edit is usually byte-DIFFERENT (the section sort
    // normalizes, e.g. dropping a trailing blank line) and correctly still
    // writes — the file converges to canonical form once, then steady-state
    // echoes skip. `updated` stays true either way: the vault line carries
    // exactly this state, so callers commit normally (needed when adopting a
    // deterministically-minted token another device already stamped).
    const finalText = finalLines.join('\n');
    if (finalText !== text) {
      const writable = await fileHandle.createWritable();
      await writable.write(finalText);
      await writable.close();
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Markdown task parser
// ---------------------------------------------------------------------------


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
    // DISPLAY-DERIVATION BRIDGE (Step 2's hazard 2): preserve existing.title
    // only when it is a GENUINE dayGLANCE rename. An underived old-style
    // title — display text equal to the raw line text, i.e. the user never
    // renamed — adopts the current parse's display derivation instead, so
    // pre-Step-2 tasks shed their in-title metadata without waiting for a
    // vault-side edit. (For an unrenamed new-style title the parsed title is
    // byte-identical to existing.title, so the adopt is a no-op.)
    if (stripObsidianDisplayTag(existing.title) !== existing.obsidianRawTitle) {
      task.title = existing.title;
    }
    return;
  }
  // Vault wins: task.title stays the parsed line's title.
  //
  // COMPARISON SPACE (Step 2's hazard 1, pinned by tests): base and theirs
  // are FULL line space (raw titles, metadata included); ours starts as the
  // app's DISPLAY title, which no longer contains the metadata run — so it
  // must be carried back to full space through reattachTasksMetadata, the
  // SAME helper the writeback's newRawTitle derivation uses. Compare display
  // against full and every metadata-carrying task reads as permanently
  // renamed, turning each vault edit into conflict-note spam.
  const oursDisplay = stripObsidianDisplayTag(existing.title);
  const ours = reattachTasksMetadata(oursDisplay, existing.obsidianRawTitle);
  if (detectTwoSidedRetitle({ base: existing.obsidianRawTitle, theirs: task.obsidianRawTitle, ours })) {
    task.notes = appendTitleConflictNote(task.notes, oursDisplay, new Date().toISOString().slice(0, 10));
    onTitleConflict?.({ dgTitle: oursDisplay, vaultTitle: splitTasksMetadata(task.obsidianRawTitle).text });
  }
}

/**
 * PER-FIELD VAULT-EDIT ADOPTION (Phase 4 Step 2 — the fourth ownership
 * ruling; docs/obsidian-buildout-spec.md, "The ownership model").
 *
 * Which mapped metadata fields did the VAULT demonstrably edit since our
 * last observation? Detected the same way vaultTitleWins detects a retitle —
 * the tagged line's raw text moved off the stored base — but resolved at
 * FIELD grain: extract the metadata from base and from theirs, and a field
 * is adopted ONLY when its serialized value actually changed in the line.
 * That is the narrow claim that makes this safe: an untouched ⏳ sitting in
 * an edited line never clobbers a dayGLANCE reschedule; a vault edit
 * overrides dayGLANCE only for the specific field the vault edited
 * (add, change, or REMOVE — a removed field adopts too). The same-field
 * two-sided race resolves vault-wins, consistent with the title policy;
 * deliberately WITHOUT a notes record (a lost priority is one of four
 * values, re-set with a tap, and the vault's version is still on the line —
 * unlike a lost sentence of prose).
 *
 * Returns null when nothing is adoptable (untagged, no honest base, or the
 * line hasn't changed) — the shipped existing-fields-win rule then applies
 * unchanged.
 */
function vaultMetadataEdits(task, existing) {
  if (!task.obsidianBlockId || existing.obsidianRawTitle === undefined) return null;
  if (task.obsidianRawTitle === existing.obsidianRawTitle) return null;
  const base = splitTasksMetadata(existing.obsidianRawTitle).fields;
  const theirs = splitTasksMetadata(task.obsidianRawTitle).fields;
  const edits = {
    due: base.due !== theirs.due,
    scheduled: base.scheduled !== theirs.scheduled,
    priority: base.priority !== theirs.priority,
  };
  return (edits.due || edits.scheduled || edits.priority) ? edits : null;
}

/**
 * Apply the adopted fields from the PARSED task's line-derived values
 * (captured before the existing-fields copy overwrote them). Using the
 * parsed values — not the extracted field directly — makes add, edit, and
 * remove uniform: the line's whole date semantics (inline-prefix precedence
 * included) reapply for `scheduled`, and a removed 📅 clears the deadline.
 */
function adoptVaultMetadataEdits(task, edits, lineVals) {
  if (!edits) return;
  if (edits.due) task.deadline = lineVals.deadline ?? null;
  if (edits.priority) task.priority = lineVals.priority ?? 0;
  if (edits.scheduled) {
    if (lineVals.date !== undefined) task.date = lineVals.date;
    if (lineVals.startTime !== undefined) task.startTime = lineVals.startTime;
    if (lineVals.isAllDay !== undefined) task.isAllDay = lineVals.isAllDay;
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
        // Line-derived values, captured BEFORE the existing-fields copies
        // overwrite them — the adoption below restores exactly the fields
        // the vault demonstrably edited (vaultMetadataEdits).
        const lineVals = { date: task.date, startTime: task.startTime, isAllDay: task.isAllDay, deadline: task.deadline, priority: task.priority };
        const edits = vaultMetadataEdits(task, existing);
        // Completed: OR logic — completed in DG OR in Obsidian → completed
        if (existing.completed) task.completed = true;
        // Preserve app-controlled properties the user may have changed in DG
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        if (existing.priority !== undefined) task.priority = existing.priority;
        if (existing.deadline !== undefined) task.deadline = existing.deadline;
        // Preserve scheduling & title changes made in DG so sync never
        // overwrites moves/renames the user made inside the app — EXCEPT the
        // title of a tagged line Obsidian edited since our last write, which
        // the vault wins (see vaultTitleWins), and metadata FIELDS the vault
        // demonstrably edited (adoptVaultMetadataEdits below).
        if (existing.date !== undefined) task.date = existing.date;
        if (existing.startTime !== undefined) task.startTime = existing.startTime;
        if (existing.isAllDay !== undefined) task.isAllDay = existing.isAllDay;
        resolveTitleOwnership(task, existing, onTitleConflict);
        adoptVaultMetadataEdits(task, edits, lineVals);
        // Preserve lastModified so cloud merge keeps recognising the
        // version the user actually edited rather than treating re-imports
        // as brand-new tasks with a fresh timestamp.
        if (existing.lastModified) task.lastModified = existing.lastModified;

        // User moved this to inbox — respect the cross-array move (keyed by
        // the id the task holds IN STATE, which during the one-time block-id
        // switch is the legacy id, not the freshly parsed one) — UNLESS the
        // vault itself just rescheduled the line (⏳ added/edited): the
        // vault's demonstrable edit wins the classification too.
        if (userInboxIds.has(String(existing.id)) && !edits?.scheduled) {
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
        const lineVals = { deadline: task.deadline, priority: task.priority };
        const edits = vaultMetadataEdits(task, existing);
        if (existing.completed) task.completed = true;
        if (existing.priority !== undefined) task.priority = existing.priority;
        if (existing.deadline !== undefined) task.deadline = existing.deadline;
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        resolveTitleOwnership(task, existing, onTitleConflict);
        adoptVaultMetadataEdits(task, edits, lineVals);
        if (existing.lastModified) task.lastModified = existing.lastModified;

        // User scheduled this from inbox — respect the cross-array move —
        // UNLESS the vault just unscheduled the line (⏳ removed, which is
        // why this parse classified it inbox): the vault's demonstrable
        // edit wins the classification.
        if (userScheduledIds.has(String(existing.id)) && !edits?.scheduled) {
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
export function writeTaskStateNative(date, obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, taskHeading = null, blockId = null, onWriteFailure = null, onTitleConflict = null, completionMeta = null) {
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
    const updated = updateTaskLines(lines, {
      obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, blockId, onTitleConflict,
      completedAt: completionMeta?.completedAt ?? null,
      completionFormat: completionMeta?.format ?? null,
    });

    if (updated) {
      const finalLines = taskHeading
        ? sortTaskLinesInSection(lines, taskHeading.trim(), date)
        : lines;
      // NO-OP WRITE SKIP — same churn reducer as writeTaskStateToFile: when
      // the would-be output equals what we just read, the vault already
      // carries this state; skip the write (and its Obsidian wake), keep the
      // confirmed-success semantics.
      const finalText = finalLines.join('\n');
      if (finalText !== text && !nativeWriteOk(bridge.writeDailyNote(date, finalText))) {
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

    // Same merge logic as syncObsidianVault — including the Step 2
    // per-field vault-edit adoption (vaultMetadataEdits) and its
    // classification override; see the FSA loops for the commentary.
    for (const task of scheduledTasks) {
      const existing = resolveExistingObsidianTask(existingTaskMap, task);
      if (existing) {
        const lineVals = { date: task.date, startTime: task.startTime, isAllDay: task.isAllDay, deadline: task.deadline, priority: task.priority };
        const edits = vaultMetadataEdits(task, existing);
        if (existing.completed) task.completed = true;
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        if (existing.priority !== undefined) task.priority = existing.priority;
        if (existing.deadline !== undefined) task.deadline = existing.deadline;
        if (existing.date !== undefined) task.date = existing.date;
        if (existing.startTime !== undefined) task.startTime = existing.startTime;
        if (existing.isAllDay !== undefined) task.isAllDay = existing.isAllDay;
        resolveTitleOwnership(task, existing, onTitleConflict);
        adoptVaultMetadataEdits(task, edits, lineVals);
        if (existing.lastModified) task.lastModified = existing.lastModified;
        if (userInboxIds.has(String(existing.id)) && !edits?.scheduled) { allInbox.push(task); continue; }
      } else {
        task.lastModified = new Date(0).toISOString();
      }
      allScheduled.push(task);
    }

    for (const task of inboxTasks) {
      const existing = resolveExistingObsidianTask(existingTaskMap, task);
      if (existing) {
        const lineVals = { deadline: task.deadline, priority: task.priority };
        const edits = vaultMetadataEdits(task, existing);
        if (existing.completed) task.completed = true;
        if (existing.priority !== undefined) task.priority = existing.priority;
        if (existing.deadline !== undefined) task.deadline = existing.deadline;
        if (existing.notes !== undefined) task.notes = existing.notes;
        if (existing.subtasks !== undefined) task.subtasks = existing.subtasks;
        if (existing.color !== undefined) task.color = existing.color;
        if (existing.duration !== undefined) task.duration = existing.duration;
        resolveTitleOwnership(task, existing, onTitleConflict);
        adoptVaultMetadataEdits(task, edits, lineVals);
        if (existing.lastModified) task.lastModified = existing.lastModified;
        if (userScheduledIds.has(String(existing.id)) && !edits?.scheduled) {
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
