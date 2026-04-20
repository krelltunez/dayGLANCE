// Shared utilities for drag / hover / click-to-add interactions in the
// day, multi, and week views. The multi view has its own time-from-cursor
// helper that goes through the TimeGrid DOM (because its hour rows have
// real DOM offsets); the day and week views use these column-local
// helpers, because their hour heights are derived from a CSS variable
// and not from measured DOM rows.

// Round a minute value to the nearest 15-minute increment.
export const snapMinutesToQuarter = (minutes) => Math.round(minutes / 15) * 15;

// Format a minute-of-day count (0..1439) as a "HH:MM" 24-hour string.
export const minutesToTimeStr = (minutes) => {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Given a pointer event, the DOM element that represents a column's
// content area, the column's starting minute (e.g. 08:00 -> 480), and the
// column's pixel-per-hour height, return the snapped 15-minute time
// string for the cursor's Y position within that column.
//
// minMinute / maxMinute clamp the result to the column's legal range so
// you can't drop beyond the displayed hours. taskDuration shrinks the max
// so a dragged task doesn't spill past the column's end.
export const columnTimeFromEvent = (e, colEl, {
  startMinute,
  hourHeight,
  minMinute = startMinute,
  maxMinute,
  taskDuration = 0,
}) => {
  if (!colEl || !hourHeight) return minutesToTimeStr(startMinute);
  const rect = colEl.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const raw = startMinute + (y / hourHeight) * 60;
  const snapped = snapMinutesToQuarter(raw);
  const hardMax = maxMinute - taskDuration;
  const clamped = Math.max(minMinute, Math.min(hardMax, snapped));
  return minutesToTimeStr(clamped);
};
