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

// How much of a dropped item has to stay on the column (#2278). A drop places
// the START at the cursor's quarter-hour. A timed task may run past midnight
// (the part after it is drawn on the next date), and past the end of a DAY
// column (the next column draws the rest), so a drop is no longer pushed
// earlier until the whole task fits: the start only has to leave one
// quarter-hour, or the item's own shorter length, before the column's end. On
// a full day that makes 23:45 the latest start, as the phone's drag has
// always allowed. Pass the result as the column helpers' `taskDuration`.
export const DROP_MIN_ON_COLUMN_MINUTES = 15;
export const dropClampMinutes = (duration) => (
  Number.isFinite(duration) && duration > 0 ? Math.min(DROP_MIN_ON_COLUMN_MINUTES, duration) : 0
);

// ── Drop block preview (#2277) ───────────────────────────────────────────────

// Drawn length of the preview for a dragged item with no duration of its own.
// The drop keeps whatever the item has; this is only how long the block looks.
export const DRAG_BLOCK_FALLBACK_MINUTES = 30;

// "HH:MM" for a minute of the day, with the end of the day (1440) read as
// midnight, so a block ending there is labelled 00:00 / 12:00 AM.
const clockAt = (minutes) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// The block a dragged item becomes if it is dropped now: it starts at the
// preview time (the cursor's time, which becomes the new start) and runs for
// the item's own duration.
//
// The start is clamped as the drop clamps it, to [minMinute, maxMinute -
// dropClampMinutes(duration)], so the block shows where the item actually
// lands. A preview time produced by the same handler as the drop is already
// clamped, and this is a no-op on it. The drawn end is clipped to maxMinute;
// `overflowMinutes` is how much runs on past it (into the next date, #2278),
// and the end label is the item's real end, `endsNextDay` when it is on the
// next date.
//
// Returns null for a start that is not a number (nothing to draw).
export const dragBlockRange = (startMinute, duration, { minMinute = 0, maxMinute = 24 * 60 } = {}) => {
  if (!Number.isFinite(startMinute)) return null;
  const own = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const start = Math.max(minMinute, Math.min(maxMinute - dropClampMinutes(own), startMinute));
  const realEnd = start + (own || DRAG_BLOCK_FALLBACK_MINUTES);
  const end = Math.min(maxMinute, realEnd);
  return {
    startMinute: start,
    endMinute: end,
    // Only an item's own length runs on; the fallback is just how it looks.
    overflowMinutes: own ? realEnd - end : 0,
    startTime: clockAt(start),
    endTime: clockAt(realEnd),
    // The end is on the next date (at or past midnight): the label carries
    // the next-day mark, as every card's range does (components/TimeRange.jsx).
    endsNextDay: realEnd >= 24 * 60,
  };
};

// ── What a drag holds a card by (#2277, #2419) ───────────────────────────────

// A block drawn on the time grid: its top edge is its start, and its height its
// length. An Inbox row, an all-day card and a routine chip are not; they have
// no time of their own for a grab point to be measured against.
export const isTimelineBlock = (task, source) => (
  source !== 'inbox' && !!task && !task.isAllDay && !!task.startTime
);

// Hold a dragged card's drag image, and say how far below the card's top edge
// the pointer is holding it (px).
//
// A drop reads the card's TOP EDGE as the new start (dragTopPoint), so the
// floating card always sits on the preview block.
//
// - `atGrabPoint` (a timeline block, #2419): the card stays under the pointer
//   where it was grabbed, and the offset is returned for the drop to subtract.
//   Jumping a long card up to its title moved it a long way before the drag
//   had gone anywhere. This is what the phone's drag has always done (it moves
//   the start by the finger's travel).
// - otherwise (#2277): the image is held by its top edge, at the horizontal
//   point where it was grabbed, and the offset is 0: the pointer's time is the
//   start, as the phone reads a drag out of the all-day row.
//
// Only when the card itself is what is being dragged: a link, image or nested
// draggable inside it keeps the image the browser gives it, and the pointer's
// time is the start (offset 0).
export const holdDragImage = (e, { atGrabPoint = false } = {}) => {
  const el = e?.currentTarget;
  const dt = e?.dataTransfer;
  if (!el || e.target !== el || typeof el.getBoundingClientRect !== 'function') return 0;
  const rect = el.getBoundingClientRect();
  const within = (v, max) => (Number.isFinite(v) && Number.isFinite(max) ? Math.max(0, Math.min(max, v)) : 0);
  const x = within(e.clientX - rect.left, rect.width);
  const y = atGrabPoint ? within(e.clientY - rect.top, rect.height) : 0;
  // Without setDragImage the browser's own image is the card held where it was
  // grabbed, so the offset is still the truth for a block.
  if (typeof dt?.setDragImage === 'function') dt.setDragImage(el, x, y);
  return y;
};

// The point a drag's time is read at: the dragged card's top edge, which is
// the pointer raised by the grab offset. Shaped like the event the time
// helpers read (columnTimeFromEvent, the MULTI grid's helper), so it is passed
// in the event's place. Which column, drop zone and auto-scroll edge the drag
// is over still come from the pointer itself.
export const dragTopPoint = (e, grabOffsetY = 0) => ({
  clientX: e.clientX,
  clientY: e.clientY - (Number.isFinite(grabOffsetY) ? grabOffsetY : 0),
});
