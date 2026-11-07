import { useMemo, useRef } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { todayEndedTasks } from '../jobo/pastDay.js';

/**
 * Today, split at the NOW line (docs/jobo-past-days.md, the addendum): the
 * ids of today's completed tasks whose plan block has given way to their Do
 * (jobo/pastDay.js, todayEndedTasks), for getDayDisplayForDate.
 *
 * Worked out from the clock on each tick, but returned as a set that keeps
 * its identity for as long as its contents do, so the views recompute only
 * when a block ends or a task is completed, never on the tick itself. While
 * `gestureActive` (a drag or a resize), the set is held as it was, so a block
 * never turns into its Do under the pointer; it catches up on the drop.
 *
 * `todayEnded` is null with no index (JOBO off, ledger not loaded), and
 * today then shows exactly as planned.
 *
 * @returns {{ todayStr: string, todayEnded: Set<string> | null }}
 */
export default function useTodayEnded({ pastDayIndex, currentTime, getTasksForDate, isVisibleForUser, gestureActive = false }) {
  const todayStr = dateToString(currentTime);
  const nowMinute = currentTime.getHours() * 60 + currentTime.getMinutes();
  const now = useMemo(() => (pastDayIndex ? todayEndedTasks({
    dateStr: todayStr,
    dayTasks: getTasksForDate(new Date(`${todayStr}T12:00:00`)),
    index: pastDayIndex,
    isVisibleForUser,
    nowMinute,
  }) : null), [pastDayIndex, todayStr, nowMinute, getTasksForDate, isVisibleForUser]);
  const heldRef = useRef(null);
  if (!gestureActive || !heldRef.current) heldRef.current = now;
  const held = heldRef.current;
  const key = held ? `${todayStr}#${held.key}` : null;
  // Rebuilt only when the key changes: the same ids keep the same set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const todayEnded = useMemo(() => held?.ids ?? null, [key]);
  return { todayStr, todayEnded };
}
