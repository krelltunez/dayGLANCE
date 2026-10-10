// Focus adds ordinary minute-resolution Do rows to the existing ledger.
// Raw seconds are retained only until settlement; they are not a second ledger.
import { createDoRecord, DO_PROGRESS, DO_TIMING } from './core.js';
import { attributeFocusCapture } from './focusCapture.js';

const civilFields = (minute) => {
  const iso = new Date(minute * 60000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
};

/** Round each civil boundary independently; half-minutes round forward. */
export function focusMinuteInterval(segment) {
  const { startedAt, endedAt, startOffset, endOffset } = segment;
  if (![startedAt, endedAt, startOffset, endOffset].every(Number.isSafeInteger)
    || endedAt <= startedAt) throw new TypeError('Invalid captured Focus interval');
  // A zone/DST change cannot be represented honestly as one civil interval.
  // Keep the existing JOBO coordinates rather than inventing an hour of work.
  if (startOffset !== endOffset) return null;
  const start = Math.round((startedAt - startOffset * 60000) / 60000);
  const end = Math.round((endedAt - endOffset * 60000) / 60000);
  if (end <= start) return null;
  const a = civilFields(start), b = civilFields(end);
  return { date: a.date, startTime: a.time, endDate: b.date, endTime: b.time, minutes: end - start };
}

export function summarizeFocusCapture(capture) {
  let workMilliseconds = 0, recordedMinutes = 0;
  let clockChanged = !!capture.clockChanged;
  for (const segment of capture.segments) {
    workMilliseconds += segment.endedAt - segment.startedAt;
    clockChanged ||= segment.startOffset !== segment.endOffset;
    recordedMinutes += focusMinuteInterval(segment)?.minutes ?? 0;
  }
  return {
    workMilliseconds, recordedMinutes, clockChanged,
    recordedDifferenceMilliseconds: recordedMinutes * 60000 - workMilliseconds,
  };
}

/** Ensure-present candidates; a retry never restamps edits or tombstones. */
export function buildFocusDoRecords(capture, actionId, existingRecords) {
  if (!Array.isArray(existingRecords)) throw new TypeError('The committed ledger must be loaded');
  const { candidate, segments } = attributeFocusCapture(capture, actionId);
  const present = new Set(existingRecords.map((record) => record?.id));
  return segments.flatMap((segment) => {
    const id = `${segment.id}:task:${encodeURIComponent(String(candidate.taskId))}`;
    if (present.has(id)) return [];
    const interval = focusMinuteInterval(segment);
    if (!interval) return [];
    const { minutes: _minutes, ...coordinates } = interval;
    const stamp = new Date(segment.endedAt).toISOString();
    return [createDoRecord({
      id, taskId: candidate.taskId, title: candidate.title,
      planSnapshot: candidate.planSnapshot,
      source: 'focus', timing: DO_TIMING.TIMED, progress: DO_PROGRESS.PARTIAL,
      ...coordinates,
      createdAt: stamp, updatedAt: stamp, observedAt: stamp,
    })];
  });
}
