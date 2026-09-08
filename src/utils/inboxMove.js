// The inbox copy of a scheduled task, shared by every "move to inbox" path
// (useTaskActions.moveToInbox, the harness's unschedule) so they cannot drift.
//
// THE CLEARED-TIME MARKER (§8 ruling, 2026-09-08). An Obsidian task moved to
// the inbox loses its time here at once, but its LINE keeps the old time
// until dayGLANCE's writeback lands in the vault. Any observation of the
// note in that window shows a timed line meeting an inbox copy, and the
// merge must not read that as the vault scheduling the task. Before the
// ruling every timed line meeting an inbox copy was treated that way, which
// also silently ignored a time the user typed by hand. The marker records
// the time this move removed: a line still carrying exactly that time is
// the stale read and stays in the inbox; a line carrying any OTHER time is
// the vault's own statement and schedules the task. The marker clears when
// the line is next observed without a time (the writeback landed), and is
// not a compared field (utils/stampTimestamps.js), so clearing it never
// re-stamps the copy.
export function toInboxCopy(task, now = new Date().toISOString()) {
  const clearedTime = task?.importSource === 'obsidian' && task.startTime ? String(task.startTime) : null;
  const { obsidianClearedTime: _prior, ...rest } = task || {};
  return {
    ...rest,
    startTime: null,
    date: null,
    isAllDay: false,
    priority: task?.priority || 0,
    lastModified: now,
    ...(clearedTime ? { obsidianClearedTime: clearedTime } : {}),
  };
}
