// When a task was created and completed, for display (#2135).
//
// `createdAt` is stamped by the persist pass (utils/createdAt.js has the rules);
// `completedAt` by every completion path. This module only reads them, through
// parseStamp (@glance-apps/agenda-core). The MCP wire form of a stamp is
// wireStamp in @glance-apps/dayglance-mcp.

import { parseStamp } from '@glance-apps/agenda-core';

/**
 * When a task (or one occurrence of a recurring one) was created and
 * completed, as stored stamps, or null where not known.
 *
 * A recurring occurrence has no row of its own: the series was created once
 * (the template's `createdAt`), and each date's completion is kept on the
 * template (`completedDatesTimestamps`, the same local-offset stamp).
 *
 * @param {object} task  the task as shown (a concrete task, or an expanded occurrence)
 * @param {object} [opts]
 * @param {object[]} [opts.recurringTasks]  templates, to resolve an occurrence
 */
export function taskMoments(task, { recurringTasks = [] } = {}) {
  if (!task) return { createdAt: null, completedAt: null };
  if (task.isRecurring && task.recurringTemplateId != null) {
    const template = recurringTasks.find((r) => String(r.id) === String(task.recurringTemplateId));
    const date = task.date;
    const done = !!task.completed;
    return {
      createdAt: template?.createdAt || null,
      completedAt: done ? (template?.completedDatesTimestamps?.[date] || null) : null,
    };
  }
  return {
    createdAt: task.createdAt || null,
    completedAt: task.completed ? (task.completedAt || null) : null,
  };
}

/**
 * A stamp for display: "Oct 19, 2:05 PM", with the year when it is not this
 * year, and the date alone when the stamp has no time.
 *
 * @param {string} value  a stored stamp
 * @param {object} opts
 * @param {(hhmm: string) => string} opts.formatTime  the app's clock formatter
 * @param {Date} [opts.now]
 * @param {string} [opts.language]
 */
export function formatStamp(value, { formatTime = (s) => s, now = new Date(), language } = {}) {
  const parsed = parseStamp(value);
  if (!parsed) return null;
  const { date, hasTime } = parsed;
  const options = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  const day = new Intl.DateTimeFormat(language, options).format(date);
  if (!hasTime) return day;
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${day}, ${formatTime(hhmm)}`;
}
