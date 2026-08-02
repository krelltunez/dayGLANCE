// GLANCEahead's "next alarm" line — the bedtime question is "when am I waking
// up?", so the device's next alarm clock is only relevant while it rings
// before the END OF TOMORROW (GLANCEahead is a tomorrow preview; an alarm set
// for next Saturday is not an answer). Android-only in practice: iOS has no
// API for reading the user's Clock alarms.

/**
 * @param {number} nowMs epoch ms "now"
 * @param {number|null} alarmMs epoch ms of the device's next alarm clock
 * @returns {number|null} alarmMs when it rings after now and before the end
 *   of tomorrow (local time), else null
 */
export function nextAlarmWithinTomorrow(nowMs, alarmMs) {
  if (!alarmMs || alarmMs <= nowMs) return null;
  const end = new Date(nowMs);
  end.setDate(end.getDate() + 1);
  end.setHours(23, 59, 59, 999);
  return alarmMs <= end.getTime() ? alarmMs : null;
}

/** 'HH:MM' of an epoch-ms instant, ready for the app's formatTime. */
export function alarmHHMM(alarmMs) {
  const d = new Date(alarmMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
