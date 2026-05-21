const LOG_KEY = 'dayglance-intent-activity-log';
const MAX_ENTRIES = 100;

/**
 * Append one activity entry to the log. Thread-safe at the JS single-thread
 * level; trimmed to MAX_ENTRIES on every write.
 */
export function logActivity(entry) {
  const existing = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  const updated = [{ ...entry, id: crypto.randomUUID() }, ...existing].slice(0, MAX_ENTRIES);
  localStorage.setItem(LOG_KEY, JSON.stringify(updated));
}

export function getActivityLog() {
  return JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
}

export function clearActivityLog() {
  localStorage.removeItem(LOG_KEY);
}
