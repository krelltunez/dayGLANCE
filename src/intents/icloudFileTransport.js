/**
 * Platform adapter for iCloud Drive file operations.
 *
 * Provides a uniform async API over two native bridges:
 *   - iOS WKWebView:   window.DayGlanceNative.iCloudListFiles(path) etc. (synchronous bridge calls)
 *   - macOS Electron:  window.electronAPI.listICloudFiles(path) etc. (IPC → Promises)
 *
 * Android and web are unsupported — isAvailable() returns false and all ops
 * return safe defaults so callers can guard with a single availability check.
 *
 * All relativePath params are relative to the Documents/ folder inside the
 * iCloud container (e.g. "GLANCE/events/", "GLANCE/users/glance-users.json").
 * Leading "/" is tolerated but stripped by callers before passing here.
 */

const isIOS = typeof window !== 'undefined' && !!window.DayGlanceIOS;
const isMacOS =
  typeof window !== 'undefined' &&
  !!window.electronAPI &&
  typeof window.electronAPI.listICloudFiles === 'function';

/**
 * Returns true if iCloud file ops are available on this platform.
 * iOS and macOS only; Android/web return false.
 */
export function isAvailable() {
  return isIOS || isMacOS;
}

/**
 * Lists filenames (not full paths) in the given directory.
 * Returns an array of filename strings, or [] if the directory doesn't exist.
 */
export async function listFiles(relativePath) {
  if (isIOS) {
    try {
      const raw = window.DayGlanceNative.iCloudListFiles(relativePath);
      const parsed = JSON.parse(raw);
      // Error object from Swift — treat as empty
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }
  if (isMacOS) {
    try {
      return await window.electronAPI.listICloudFiles(relativePath);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Reads a file. Returns the content string, null if not found, or the raw
 * JSON string {"downloading":true} if the file is being downloaded from iCloud.
 * Throws on hard errors.
 */
export async function readFile(relativePath) {
  if (isIOS) {
    const raw = window.DayGlanceNative.iCloudReadFile(relativePath);
    return raw === undefined ? null : raw;
  }
  if (isMacOS) {
    return window.electronAPI.readICloudFile(relativePath);
  }
  return null;
}

/**
 * Writes content to the file, creating parent directories as needed.
 * Returns true on success.
 */
export async function writeFile(relativePath, content) {
  if (isIOS) {
    try {
      const raw = window.DayGlanceNative.iCloudWriteFile(relativePath, content);
      return JSON.parse(raw)?.ok === true;
    } catch {
      return false;
    }
  }
  if (isMacOS) {
    try {
      return await window.electronAPI.writeICloudFile(relativePath, content);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Deletes the file. Idempotent — returns true even if the file didn't exist.
 */
export async function deleteFile(relativePath) {
  if (isIOS) {
    try {
      const raw = window.DayGlanceNative.iCloudDeleteFile(relativePath);
      return JSON.parse(raw)?.ok === true;
    } catch {
      return false;
    }
  }
  if (isMacOS) {
    try {
      return await window.electronAPI.deleteICloudFile(relativePath);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Creates a directory (with intermediates). Returns true on success.
 */
export async function makeDir(relativePath) {
  if (isIOS) {
    try {
      const raw = window.DayGlanceNative.iCloudMakeDir(relativePath);
      return JSON.parse(raw)?.ok === true;
    } catch {
      return false;
    }
  }
  if (isMacOS) {
    try {
      return await window.electronAPI.makeICloudDir(relativePath);
    } catch {
      return false;
    }
  }
  return false;
}
