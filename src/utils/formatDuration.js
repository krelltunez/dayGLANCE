// Renders a minute count as a compact translated duration ("2h 15m", "45m",
// "3h"), picking whichever of the three `common.duration*` keys has no
// zero-valued part so languages never have to translate a literal "0m"/"0h".
export function formatDuration(minutes, t) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return t('common.durationMinutes', { minutes: mins });
  if (mins === 0) return t('common.durationHours', { hours });
  return t('common.durationHoursMinutes', { hours, minutes: mins });
}

// A task's own length where it sits beside its start time: timeline cards,
// inbox rows, the recycle bin (#2388). Under an hour it stays the minute count
// those rows have always shown ("45 min"); from an hour up it is hours and
// minutes ("5h 8m"), as the task dialogs' duration menu already reads, since
// "308 min" leaves the division to the reader.
export function formatTaskDuration(minutes, t) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return t('common.minutesShort', { count: total, defaultValue: '{{count}} min' });
  return formatDuration(total, t);
}
