// Format a Date object as a YYYY-MM-DD string in local time.
// Defined here (not inline in App.jsx) so that useState initialisers that
// run before any in-component helpers can use it via import.
export const dateToString = (date) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Zero-arg variant: localDateStr() returns today's YYYY-MM-DD string.
// The original App.jsx defined this with a default parameter (d = new Date()),
// so callers throughout the codebase rely on being able to call it with no args.
export const localDateStr = (d = new Date()) => dateToString(d);

// Extract #hashtags from a task title (tags must start with a letter).
export const extractTags = (title) => {
  const matches = title.match(/#(\p{L}[\p{L}\p{N}_]*)/gu);
  return matches ? matches.map(tag => tag.slice(1).toLowerCase()) : [];
};

// Extract all [[wikilink]] note names from a title string.
export const extractWikilinks = (title) => {
  const matches = [...title.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];
  return matches.map(m => m[1]);
};

// Strip [[wikilinks]] — hashtags stay visible in the UI.
export const stripWikilinks = (title) =>
  title.replace(/\[\[[^\]]+\]\]/g, '').replace(/\s+/g, ' ').trim();

// Human-readable label for a recurrence rule object.
export const getRecurrenceLabel = (rec) => {
  if (!rec) return 'None';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th'];

  let label = 'Custom';
  if (rec.type === 'daily') label = 'Every day';
  else if (rec.type === 'weekly') {
    const days = rec.daysOfWeek && rec.daysOfWeek.length > 0
      ? rec.daysOfWeek.sort((a, b) => a - b).map(d => dayNames[d]).join(', ')
      : dayNames[new Date(rec.startDate + 'T12:00:00').getDay()];
    label = `Weekly on ${days}`;
  }
  else if (rec.type === 'biweekly') {
    const days = rec.daysOfWeek && rec.daysOfWeek.length > 0
      ? rec.daysOfWeek.sort((a, b) => a - b).map(d => dayNames[d]).join(', ')
      : dayNames[new Date(rec.startDate + 'T12:00:00').getDay()];
    label = `Every 2 weeks on ${days}`;
  }
  else if (rec.type === 'monthly') {
    if (rec.monthWeekday) {
      label = `Monthly on the ${ordinals[rec.monthWeekday.week]} ${fullDayNames[rec.monthWeekday.day]}`;
    } else {
      const d = rec.monthDay || new Date(rec.startDate + 'T12:00:00').getDate();
      const suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th';
      label = `Monthly on the ${d}${suffix}`;
    }
  }
  else if (rec.type === 'yearly') {
    const sd = new Date(rec.startDate + 'T12:00:00');
    label = `Yearly on ${monthNames[sd.getMonth()]} ${sd.getDate()}`;
  }

  if (rec.endDate) {
    const ed = new Date(rec.endDate + 'T12:00:00');
    label += ` until ${monthNames[ed.getMonth()].slice(0, 3)} ${ed.getDate()}`;
  } else if (rec.maxOccurrences) {
    label += ` (${rec.maxOccurrences} times)`;
  }
  return label;
};

// Format a Date object as "Monday, Jan 5".
export const formatDate = (date) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
};

// Format an array of Date objects as a human-readable range string.
export const formatDateRange = (dates) => {
  if (dates.length === 1) {
    return formatDate(dates[0]);
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const first = dates[0];
  const last = dates[dates.length - 1];

  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return `${months[first.getMonth()]} ${first.getDate()} - ${last.getDate()}, ${first.getFullYear()}`;
  } else if (first.getFullYear() === last.getFullYear()) {
    return `${months[first.getMonth()]} ${first.getDate()} - ${months[last.getMonth()]} ${last.getDate()}, ${first.getFullYear()}`;
  } else {
    return `${months[first.getMonth()]} ${first.getDate()}, ${first.getFullYear()} - ${months[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;
  }
};

// Format a Date object as "Mon, Jan 5" (abbreviated day name).
export const formatShortDate = (date) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
};

// Format a deadline YYYY-MM-DD string as "Today", "Tomorrow", or "Jan 5".
export const formatDeadlineDate = (deadline) => {
  if (!deadline) return null;
  const todayStr = dateToString(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = dateToString(tomorrow);

  if (deadline === todayStr) return 'Today';
  if (deadline === tomorrowStr) return 'Tomorrow';

  const date = new Date(deadline + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Determine which previously-imported CalDAV task-calendar items have disappeared
// from the latest fetch and should be tombstoned so the deletion propagates via
// cloud sync (instead of being resurrected from the remote sync file).
//
// Scope: non-recurring task-calendar items only. Recurring series can't be diffed
// per-occurrence (normal advancement churns occurrence ids) — they are handled by
// computeRecurringSeriesTombstones below, which keys off master-UID presence.
//
// Safety: returns [] when the fresh feed is empty — an empty-but-valid calendar is
// far more likely a transient server/auth glitch than a real "everything deleted",
// and tombstoning on it would wipe the task calendar across all synced devices.
//
//   priorTasks      - tasks from the local snapshot before replacement (any shape)
//   freshTaskItems  - the full (pre-date-window) expansion of the latest fetch
//   cutoffDateStr   - YYYY-MM-DD retention cutoff; items dated before it are skipped
//                     (they won't re-import anyway). null = no window (keep all).
// Returns: array of task ids (strings) to tombstone.
export const computeTaskCalendarTombstones = (priorTasks, freshTaskItems, { cutoffDateStr = null } = {}) => {
  if (!Array.isArray(freshTaskItems) || freshTaskItems.length === 0) return [];
  if (!Array.isArray(priorTasks) || priorTasks.length === 0) return [];
  const freshIds = new Set(freshTaskItems.map(t => String(t.id)));
  return priorTasks
    .filter(t =>
      t.isTaskCalendar &&
      t.importSource !== 'file' &&
      !t.isRecurringSeries &&
      !freshIds.has(String(t.id)) &&
      (!cutoffDateStr || (t.date && t.date >= cutoffDateStr))
    )
    .map(t => String(t.id));
};

// Determine which previously-imported *recurring* CalDAV task-calendar series have
// been deleted on the server and should be tombstoned. Complements
// computeTaskCalendarTombstones, which deliberately skips recurring items.
//
// Why recurring needs a different signal than per-occurrence diffing:
//   1. Completing an occurrence rolls the master DUE/DTSTART forward (Nextcloud has
//      no per-instance RECURRENCE-ID overrides for VTODOs), so the expanded
//      occurrence ids legitimately change every cycle — a per-occurrence diff would
//      read that normal churn as a deletion.
//   2. Occurrence expansion is windowed (±1 year), so a *live* series whose next
//      occurrence is far out — or whose run already ended — can expand to zero
//      in-window occurrences while its master VTODO still exists on the server.
// So a series is "deleted" iff its master UID is absent from the raw feed, not iff
// its occurrences vanished. `presentMasterUids` must therefore be collected from the
// parsed feed *before* RRULE expansion (every VTODO/VEVENT uid), so a live but
// out-of-window series is correctly treated as still present and left alone.
//
// Safety: returns [] when presentMasterUids is empty/missing — an empty feed is far
// more likely a transient server/auth glitch than a real wipe (mirrors the
// non-recurring guard).
//
//   priorTasks        - tasks from the local snapshot before replacement
//   presentMasterUids - Set or array of icalUids present in the raw (pre-expansion) feed
//   cutoffDateStr     - YYYY-MM-DD retention cutoff; occurrences dated before it are
//                       skipped (they won't re-import anyway). null = keep all.
// Returns: array of task ids (strings) — every local occurrence of each deleted series.
export const computeRecurringSeriesTombstones = (priorTasks, presentMasterUids, { cutoffDateStr = null } = {}) => {
  const present = presentMasterUids instanceof Set
    ? presentMasterUids
    : new Set((presentMasterUids || []).map(String));
  if (present.size === 0) return [];
  if (!Array.isArray(priorTasks) || priorTasks.length === 0) return [];
  return priorTasks
    .filter(t =>
      t.isTaskCalendar &&
      t.importSource !== 'file' &&
      t.isRecurringSeries &&
      t.icalUid &&
      !present.has(String(t.icalUid)) &&
      (!cutoffDateStr || (t.date && t.date >= cutoffDateStr))
    )
    .map(t => String(t.id));
};
