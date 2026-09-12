// Compute localStorage usage with per-key breakdown.
//
// This measures localStorage ONLY, which is deliberate: it is the tier with a
// real ceiling (~5 MiB per origin, and synchronous so it never grows with the
// machine). Bulk and derived data now lives in IndexedDB, where the quota is a
// share of free disk. See getIndexedDbUsage below for that half.
export const getStorageUsage = () => {
  const entries = [];
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key) || '';
      const bytes = (key.length + val.length) * 2; // UTF-16
      // Split day-planner-tasks into user tasks vs imported calendar events
      if (key === 'day-planner-tasks') {
        try {
          const tasks = JSON.parse(val);
          const userTasks = tasks.filter(t => !t.imported);
          const importedTasks = tasks.filter(t => t.imported);
          const userBytes = (key.length + JSON.stringify(userTasks).length) * 2;
          const importedBytes = bytes - userBytes;
          if (userTasks.length > 0) entries.push({ key: 'day-planner-tasks:user', bytes: userBytes, count: userTasks.length });
          if (importedTasks.length > 0) entries.push({ key: 'day-planner-tasks:imported', bytes: importedBytes, count: importedTasks.length });
        } catch {
          entries.push({ key, bytes });
        }
      } else {
        entries.push({ key, bytes });
      }
      totalBytes += bytes;
    }
  } catch {}
  entries.sort((a, b) => b.bytes - a.bytes);
  return { totalBytes, entries };
};

export const formatBytes = (bytes) => {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

/**
 * Bytes IndexedDB is using, or null where the browser will not break it out.
 *
 * `navigator.storage.estimate()` reports usage across ALL storage buckets, and
 * for dayGLANCE that total is dominated by the service worker precache: roughly
 * 4 MB of application bundle. Showing that figure as app data would be worse
 * than showing nothing, so this reads the `usageDetails` breakdown instead and
 * returns null when it is missing.
 *
 * `usageDetails` is a Chromium extension. Safari and Firefox return nothing, and
 * callers are expected to omit the line entirely rather than substitute the
 * misleading total. Those are also the platforms where localStorage is tightest,
 * so the meter that matters is unaffected.
 *
 * null therefore means "unknown", never "zero".
 */
export const getIndexedDbUsage = async () => {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    const bytes = estimate?.usageDetails?.indexedDB;
    return typeof bytes === 'number' ? bytes : null;
  } catch {
    return null;
  }
};
