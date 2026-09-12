// Month view day-cell layout engine. Pure: no React, no DOM, no rendering.
//
// A day cell is a miniature vertical timeline. Vertical position encodes time
// of day within the FIXED hour window from constants/monthView.js, so a band's
// position says when something is and the empty space says when the day is
// free. Events, tasks and routines all become bands, distinguished only by
// `kind` (the renderer picks the colour, and draws routines faintly). Items
// that overlap in time split the cell into lanes; a day with no overlaps uses
// one lane spanning the usable width. Items with a moment but no duration
// become point markers; items with no time at all are listed as all-day so
// the renderer can pin them under the date number. There is no text in a
// cell, so nothing here measures or truncates a title.
//
// Input items are the agenda shapes the app already has: AgendaItem from
// buildAgenda (tasks, recurring instances, imported and projected calendar
// events) and RoutineItem from routinesForDate. Routines have no `date` and
// nothing that marks them as routines, so the caller tags them (tagKind).
//
// Everything returned is in pixels relative to the cell's own origin.

import { isCalendarEvent } from '@glance-apps/agenda-core';
import { MONTH_CELL_LAYOUT } from '../constants/monthView.js';
import { assignLanes, maxLaneCount } from './intervalLanes.js';

// 'deadline' is a caller-built all-day item (a task's deadline falling on
// this date, tagged by the grid); it never has a time, so it can only ever
// reach the allDay collection, where the renderer draws it as its own mark.
export const DAY_CELL_KINDS = Object.freeze(['event', 'task', 'routine', 'deadline']);

/** Stamp a kind onto items that cannot be told apart by shape (routines). */
export const tagKind = (items, kind) => (items || []).map((item) => ({ ...item, kind }));

/**
 * The band kind for an item: an explicit `kind` wins; otherwise an imported
 * calendar event (agenda-core's own rule) is an event and everything else a
 * task.
 */
export function dayCellItemKind(item) {
  if (DAY_CELL_KINDS.includes(item?.kind)) return item.kind;
  return isCalendarEvent(item) ? 'event' : 'task';
}

const parseMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const xOverlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width;

/**
 * Keep bands that share horizontal space from touching or overlapping in
 * pixels. Overlap in TIME is already resolved by lanes; this handles the
 * pixel collisions the minimum band height introduces (and the zero gap
 * between back-to-back items). A pushed band keeps its end edge where it was
 * when it can, so time fidelity is lost only where the minimum height
 * demands it; a downward pass resolves from the top, an upward pass keeps
 * everything inside the cell, and if the cell simply cannot fit them all the
 * caller is told (`crowded`) instead of the bands silently piling up.
 */
function separateBands(bands, cellHeight, minBandHeight, bandGap) {
  const byY = [...bands].sort((a, b) => a.y - b.y || a.x - b.x);

  for (let i = 0; i < byY.length; i++) {
    const band = byY[i];
    let floor = -Infinity;
    for (let j = 0; j < i; j++) {
      const prev = byY[j];
      if (xOverlaps(prev, band)) floor = Math.max(floor, prev.y + prev.height + bandGap);
    }
    if (band.y < floor) {
      const bottom = band.y + band.height;
      band.y = floor;
      band.height = Math.max(minBandHeight, bottom - floor);
    }
  }

  for (let i = byY.length - 1; i >= 0; i--) {
    const band = byY[i];
    let ceiling = cellHeight;
    for (let j = byY.length - 1; j > i; j--) {
      const next = byY[j];
      if (xOverlaps(next, band)) ceiling = Math.min(ceiling, next.y - bandGap);
    }
    if (band.y + band.height > ceiling) {
      band.height = Math.max(minBandHeight, ceiling - band.y);
      band.y = ceiling - band.height;
    }
  }

  let crowded = false;
  for (let i = 0; i < byY.length; i++) {
    const band = byY[i];
    if (band.y < 0) { band.y = 0; crowded = true; }
    if (band.y + band.height > cellHeight) { band.y = Math.max(0, cellHeight - band.height); crowded = true; }
    for (let j = 0; j < i; j++) {
      const prev = byY[j];
      if (xOverlaps(prev, band) && band.y < prev.y + prev.height + bandGap) crowded = true;
    }
  }
  return crowded;
}

/**
 * Lay out one day cell.
 *
 * @param {Array<object>} items   AgendaItem / RoutineItem shapes for this day
 *   (routines tagged with kind: 'routine' via tagKind). An item carrying a
 *   `date` that is not `date` is ignored, so a whole agenda may be passed.
 * @param {string} date           YYYY-MM-DD of the cell.
 * @param {number} cellWidth      Cell width in px.
 * @param {number} cellHeight     Cell height in px.
 * @param {object} [options]
 * @param {number} [options.gutterWidth=0]  Right-hand gutter reserved for
 *   point markers (desktop). Subtracted from the usable band width.
 * @param {{startHour:number,endHour:number}} [options.window]  The hour
 *   window. Defaults to the shared constant and MUST be the same for every
 *   cell in a grid; it exists as an option only for a user-level setting or
 *   a test, never to fit one day's contents.
 * @param {number} [options.minBandHeight]  See constants/monthView.js.
 * @param {number} [options.maxLanes]
 * @param {number} [options.laneGap]
 * @param {number} [options.bandGap]
 *
 * @returns {{
 *   date: string, cellWidth: number, cellHeight: number,
 *   gutterWidth: number, usableWidth: number,
 *   window: { startMinutes: number, endMinutes: number },
 *   laneCount: number,
 *   bands: Array<{ id: string, kind: string, completed: boolean,
 *                  lane: number, laneCount: number,
 *                  x: number, y: number, width: number, height: number,
 *                  clampedStart: boolean, clampedEnd: boolean }>,
 *   points: Array<{ id: string, kind: string, completed: boolean,
 *                   x: number, y: number, clamped: 'before'|'after'|null }>,
 *   allDay: Array<{ id: string, kind: string, completed: boolean }>,
 *   overflow: { lanesNeeded: number, hidden: string[], crowded: boolean },
 *   hasOverflow: boolean,
 * }}
 */
export function layoutDayCell(items, date, cellWidth, cellHeight, options = {}) {
  const {
    gutterWidth = 0,
    window: hourWindow = MONTH_CELL_LAYOUT.window,
    minBandHeight = MONTH_CELL_LAYOUT.minBandHeight,
    maxLanes = MONTH_CELL_LAYOUT.maxLanes,
    laneGap = MONTH_CELL_LAYOUT.laneGap,
    bandGap = MONTH_CELL_LAYOUT.bandGap,
  } = options;

  const startMinutes = hourWindow.startHour * 60;
  const endMinutes = hourWindow.endHour * 60;
  const span = Math.max(1, endMinutes - startMinutes);
  const usableWidth = Math.max(0, cellWidth - Math.max(0, gutterWidth));
  const yFor = (min) => {
    const t = Math.min(1, Math.max(0, (min - startMinutes) / span));
    return t * cellHeight;
  };

  const allDay = [];
  const points = [];
  const timed = [];

  for (const item of items || []) {
    if (!item || item.id == null) continue;
    if (item.date && date && item.date !== date) continue;
    const id = String(item.id);
    const kind = dayCellItemKind(item);
    const completed = !!item.completed;
    // Keyed on the flag first, never only on a missing startTime: an
    // Obsidian date-only line arrives as isAllDay with startTime '00:00'
    // (see computeDialModel), and drawing that at midnight invents an hour.
    const startMin = item.isAllDay ? null : parseMinutes(item.startTime);
    if (startMin === null) { allDay.push({ id, kind, completed }); continue; }
    const duration = Number(item.duration) > 0 ? Number(item.duration) : 0;
    if (duration === 0) {
      const clamped = startMin < startMinutes ? 'before' : startMin > endMinutes ? 'after' : null;
      const x = gutterWidth > 0 ? usableWidth + gutterWidth / 2 : usableWidth / 2;
      points.push({ id, kind, completed, x, y: yFor(startMin), clamped });
      continue;
    }
    timed.push({ id, kind, completed, startMin, endMin: startMin + duration });
  }

  // Earlier first; on a tie the longer item takes the lower lane; then id, so
  // the same day always packs the same way.
  timed.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.id.localeCompare(b.id));
  const packed = assignLanes(timed);
  const lanesNeeded = maxLaneCount(packed);

  const bands = [];
  const hidden = [];
  for (const p of packed) {
    if (p.lane >= maxLanes) { hidden.push(p.id); continue; }
    const laneCount = Math.min(p.laneCount, maxLanes);
    const laneWidth = Math.max(0, (usableWidth - laneGap * (laneCount - 1)) / laneCount);
    const y0 = yFor(p.startMin);
    const y1 = yFor(p.endMin);
    let height = Math.max(minBandHeight, y1 - y0);
    let y = y0;
    if (y + height > cellHeight) y = Math.max(0, cellHeight - height);
    if (height > cellHeight) height = cellHeight;
    bands.push({
      id: p.id,
      kind: p.kind,
      completed: p.completed,
      lane: p.lane,
      laneCount,
      x: p.lane * (laneWidth + laneGap),
      y,
      width: laneWidth,
      height,
      clampedStart: p.startMin < startMinutes,
      clampedEnd: p.endMin > endMinutes,
    });
  }

  const crowded = separateBands(bands, cellHeight, minBandHeight, bandGap);

  const overflow = { lanesNeeded, hidden, crowded };
  return {
    date,
    cellWidth,
    cellHeight,
    gutterWidth: Math.max(0, gutterWidth),
    usableWidth,
    window: { startMinutes, endMinutes },
    laneCount: Math.max(1, Math.min(lanesNeeded, maxLanes)),
    bands,
    points,
    allDay,
    overflow,
    hasOverflow: hidden.length > 0 || crowded,
  };
}
