import {
  activeLocale,
  defaultWeekStartDay,
  formatLocalizedDate,
  localizedWeekdays,
} from './localeFormatting.js';

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

// Completion timestamp: full ISO-8601 datetime WITH THE LOCAL UTC OFFSET
// (e.g. "2026-08-28T20:15:30-05:00"), stamped into task.completedAt when a
// task is completed. Local-offset rather than toISOString()'s UTC because
// slice(0, 10) of the stored string must be the user's LOCAL date at the
// moment of completion — it becomes the `✅ YYYY-MM-DD` the Obsidian
// completion marker shows, and an evening completion in the Americas must
// not read as tomorrow. Derivations from the STORED string (never
// recomputed later) keep marker emission byte-deterministic across devices.
// Consumers that compare or sort (`new Date(...)`, lexical `>=` against a
// YYYY-MM-DD cutoff) handle this form, bare dates, and UTC ISO alike.
export const completionTimestamp = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

// The tag alphabet, defined once. Obsidian's full set — a letter, then letters,
// digits, underscore, hyphen, and `/` for nested tags — so `#work/deep` filters
// as `work/deep` rather than truncating to `work`.
//
// `\p{L}` with the `u` flag means any script, not just ASCII: `#工作` and
// `#café` are tags as much as `#work` is.
//
// EXPORTED because suggestionParser.js builds the `#` autocomplete from the
// same source. extractTags decides what IS a tag; getPartialTag decides what
// can be COMPLETED. When those two disagreed, non-Latin tags stored and
// filtered correctly but their autocomplete never appeared, so an existing tag
// could only be retyped from memory.
const TAG_START = '\\p{L}';
const TAG_BODY = '[\\p{L}\\p{N}_/-]';

/** One character that may follow the first in a tag name. */
export const TAG_BODY_CHAR = new RegExp(`^${TAG_BODY}$`, 'u');
/** A whole tag name, without the leading `#`. */
export const TAG_NAME = new RegExp(`^${TAG_START}${TAG_BODY}*$`, 'u');
// Safe to hoist despite the `g` flag: String#match resets lastIndex itself.
const TAG_IN_TEXT = new RegExp(`#(${TAG_START}${TAG_BODY}*)`, 'gu');

// Extract #hashtags from a task title (tags must start with a letter).
export const extractTags = (title) => {
  const matches = title.match(TAG_IN_TEXT);
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

const translateOrDefault = (translate, key, values, fallback) => typeof translate === 'function'
  ? translate(key, { ...values, defaultValue: fallback })
  : fallback;

// Human-readable label for a recurrence rule object.
export const getRecurrenceLabel = (rec, translate, language = 'en') => {
  if (!rec) return translateOrDefault(translate, 'task.noRepeat', {}, 'None');

  const shortDayNames = localizedWeekdays('short', language);
  const fullDayNames = localizedWeekdays('long', language);
  const englishShortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const englishFullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const englishMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th'];
  const firstDay = defaultWeekStartDay(language);
  const selectedDayIndexes = rec.daysOfWeek?.length
    ? [...rec.daysOfWeek].sort((a, b) => ((a - firstDay + 7) % 7) - ((b - firstDay + 7) % 7))
    : rec.startDate ? [new Date(`${rec.startDate}T12:00:00`).getDay()] : [];
  const localizedDays = new Intl.ListFormat(language, { style: 'short', type: 'conjunction' })
    .format(selectedDayIndexes.map(day => shortDayNames[day]));
  const fallbackDays = selectedDayIndexes.map(day => englishShortDays[day]).join(', ');

  let label = translateOrDefault(translate, 'recurrence.custom', {}, 'Custom');
  if (rec.type === 'daily') {
    label = translateOrDefault(translate, 'recurrence.everyDay', {}, 'Every day');
  } else if (rec.type === 'weekly') {
    label = localizedDays
      ? translateOrDefault(translate, 'recurrence.weeklyOnDays', { days: localizedDays }, `Weekly on ${fallbackDays}`)
      : translateOrDefault(translate, 'recurrence.everyWeek', {}, 'Every week');
  } else if (rec.type === 'biweekly') {
    label = localizedDays
      ? translateOrDefault(translate, 'recurrence.everyTwoWeeksOnDays', { days: localizedDays }, `Every 2 weeks on ${fallbackDays}`)
      : translateOrDefault(translate, 'recurrence.everyTwoWeeks', {}, 'Every 2 weeks');
  } else if (rec.type === 'monthly') {
    if (rec.monthWeekday) {
      const { week, day } = rec.monthWeekday;
      label = translateOrDefault(
        translate,
        'recurrence.monthlyOnOrdinalWeekday',
        { ordinal: translateOrDefault(translate, 'recurrence.ordinal', { count: week, ordinal: true }, ordinals[week]), day: fullDayNames[day] },
        `Monthly on the ${ordinals[week]} ${englishFullDays[day]}`,
      );
    } else {
      const day = rec.monthDay || (rec.startDate ? new Date(`${rec.startDate}T12:00:00`).getDate() : null);
      if (day) {
        const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th';
        const localizedDay = translateOrDefault(translate, 'recurrence.ordinal', { count: day, ordinal: true }, `${day}${suffix}`);
        label = translateOrDefault(translate, 'recurrence.monthlyOnDate', { day: localizedDay }, `Monthly on the ${day}${suffix}`);
      } else {
        label = translateOrDefault(translate, 'recurrence.everyMonth', {}, 'Every month');
      }
    }
  } else if (rec.type === 'yearly') {
    if (rec.startDate) {
      const startDate = new Date(`${rec.startDate}T12:00:00`);
      const date = formatLocalizedDate(startDate, { month: 'long', day: 'numeric' }, language);
      label = translateOrDefault(
        translate,
        'recurrence.yearlyOn',
        { date },
        `Yearly on ${englishMonths[startDate.getMonth()]} ${startDate.getDate()}`,
      );
    } else {
      label = translateOrDefault(translate, 'recurrence.everyYear', {}, 'Every year');
    }
  }

  if (rec.endDate) {
    const endDate = new Date(`${rec.endDate}T12:00:00`);
    const date = formatLocalizedDate(endDate, { month: 'short', day: 'numeric' }, language);
    label = translateOrDefault(
      translate,
      'recurrence.withEndDate',
      { label, date },
      `${label} until ${englishMonths[endDate.getMonth()].slice(0, 3)} ${endDate.getDate()}`,
    );
  } else if (rec.maxOccurrences) {
    label = translateOrDefault(
      translate,
      'recurrence.withCount',
      { label, count: rec.maxOccurrences },
      `${label} (${rec.maxOccurrences} times)`,
    );
  }
  return label;
};

// Format a Date object as "Monday, Jan 5".
export const formatDate = (date, language = activeLocale()) =>
  formatLocalizedDate(date, { weekday: 'long', month: 'short', day: 'numeric' }, language);

// Format an array of Date objects as a human-readable range string.
export const formatDateRange = (dates, translate, language = 'en') => {
  if (dates.length === 1) {
    return formatDate(dates[0], language);
  }
  const first = dates[0];
  const last = dates[dates.length - 1];

  const formatter = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric' });
  const fallback = typeof formatter.formatRange === 'function'
    ? formatter.formatRange(first, last)
    : `${formatter.format(first)} – ${formatter.format(last)}`;
  const month = (date) => formatLocalizedDate(date, { month: 'short' }, language);
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    return translateOrDefault(translate, 'dateRange.sameMonth', {
      year: first.getFullYear(),
      month: month(first),
      startDay: first.getDate(),
      endDay: last.getDate(),
    }, fallback);
  }
  if (first.getFullYear() === last.getFullYear()) {
    return translateOrDefault(translate, 'dateRange.sameYear', {
      year: first.getFullYear(),
      startMonth: month(first),
      startDay: first.getDate(),
      endMonth: month(last),
      endDay: last.getDate(),
    }, fallback);
  }
  return translateOrDefault(translate, 'dateRange.differentYears', {
    startYear: first.getFullYear(),
    startMonth: month(first),
    startDay: first.getDate(),
    endYear: last.getFullYear(),
    endMonth: month(last),
    endDay: last.getDate(),
  }, fallback);
};

// Format a Date object as "Mon, Jan 5" (abbreviated day name).
export const formatShortDate = (date, language = activeLocale()) =>
  formatLocalizedDate(date, { weekday: 'short', month: 'short', day: 'numeric' }, language);

// Format a deadline YYYY-MM-DD string as "Today", "Tomorrow", or "Jan 5".
export const formatDeadlineDate = (deadline, language = activeLocale()) => {
  if (!deadline) return null;
  const todayStr = dateToString(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = dateToString(tomorrow);

  const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (deadline === todayStr) {
    const label = relative.format(0, 'day');
    return label.charAt(0).toLocaleUpperCase(language) + label.slice(1);
  }
  if (deadline === tomorrowStr) {
    const label = relative.format(1, 'day');
    return label.charAt(0).toLocaleUpperCase(language) + label.slice(1);
  }

  const date = new Date(deadline + 'T12:00:00');
  return formatLocalizedDate(date, { month: 'short', day: 'numeric' }, language);
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
