// Frames on the MCP read surface (docs/mcp-server-spec.md §5.1).
//
// A frame is not a block. Blocks are things ON the day; a frame is a WINDOW
// the user set aside, and its point is the part that is still empty. So it
// rides alongside `blocks` rather than inside it, and carries its free slots
// rather than making the caller subtract one list from the other and get the
// buffer arithmetic wrong.
//
// FRAMES ARE RULE-BASED, unlike routines. A routine exists for exactly one
// date and is wiped at rollover; a frame is a template with a day-of-week
// rule, so it resolves for any date, past or future. There is no date guard
// here and nothing analogous to one is needed.
//
// TAG AFFINITY IS REPORTED, NOT APPLIED. The frame's affinity tags go out as
// data and the model matches tasks against the inbox itself. A
// suggest_tasks_for_frame tool was the alternative and would have been worse:
// it bakes one ranking rule into the wire protocol, and picking which of your
// open tasks suits a two-hour deep-work window is the thing a model is
// actually good at. filterFrameScheduleTasks stays the app's own rule for the
// app's own modal.
//
// READ-ONLY. There are no frame write tools. Frames are created and edited in
// the Frames modal, whose shape is nothing like a task mutation, so every
// frame reported here carries read_only: true, the same flag device calendar
// events and routines carry.

import { frameInstancesForDate, computeAvailableSlots } from '@glance-apps/agenda-core';

export const FRAME_ID_PREFIX = 'frame-';

/** The wire id for a frame instance on a date. */
export function frameWireId(frameId, dateStr) {
  return `${FRAME_ID_PREFIX}${frameId}-${dateStr}`;
}

/**
 * One frame instance as a §5.1 frame object.
 *
 * `availableSlots` is passed in rather than computed here so this stays a
 * pure shaping function and the occupancy model keeps its single home.
 */
export function toFrameObject(instance, availableSlots) {
  const minutes = availableSlots.reduce((sum, s) => sum + s.minutes, 0);
  return {
    id: frameWireId(instance.frameId, instance.date),
    type: 'frame',
    label: instance.label ?? '',
    date: instance.date,
    start: instance.start,
    end: instance.end,
    energy_level: instance.energyLevel,
    buffer_minutes: instance.bufferMinutes,
    // The tags this window is FOR. Emitted so the caller can pick work that
    // suits it; dayGLANCE does not filter anything on the caller's behalf.
    tag_affinity: instance.tagAffinity ?? [],
    // What is still free, after tasks, routines, and (today only) elapsed
    // time. The slots are the useful part; the total saves the caller from
    // summing them to answer "does this fit".
    available_minutes: minutes,
    available_slots: availableSlots,
    read_only: true,
  };
}

/**
 * Frames for one date, each with its free slots.
 *
 * THE TASK LIST IS UNFILTERED HERE, and that is the point of taking it as an
 * argument. In the app, frame availability is computed from getTasksForDate,
 * which applies the user's active TAG FILTER by default: hide a tag in the
 * sidebar and the app reports more free time than exists. That is dubious in
 * the UI and would be plainly wrong over MCP, where an assistant's view of
 * the day would silently depend on a view preference it cannot see and the
 * user has forgotten about. The renderer passes the whole day.
 *
 * `frames` must arrive already scoped to the current user: frames carry
 * ownerSyncId, which isVisibleForUser does not understand (see the ownership
 * tests in mcpFrames.test.js).
 */
export function buildFrames(state, date, { includeNative = false } = {}) {
  // There is no global frames toggle in dayGLANCE; `enabled` is per template
  // and frameInstancesForDate already honours it.
  const { frames = [] } = state ?? {};
  if (!date) return [];

  // Device calendar events follow the CONSENT TIER, not merely what would be
  // accurate. A _native event really does occupy the window, but when the
  // user has not shared their device calendar, counting it would leak the
  // shape of that calendar through the back door: available_minutes would
  // shrink around meetings the caller is not allowed to see, and a caller
  // comparing free time against the blocks it CAN see could infer both the
  // existence and the span of every hidden event. Availability therefore
  // describes exactly the data the tier permits, no more.
  const dayTasks = (state?.tasks ?? [])
    .filter((t) => t.date === date)
    .filter((t) => (includeNative ? true : !t._native));

  return frameInstancesForDate(frames, date).map((instance) => toFrameObject(
    instance,
    computeAvailableSlots(instance, {
      state,
      tasks: dayTasks,
      dateStr: date,
      todayStr: state?.todayDate ?? '',
      nowMinutes: typeof state?.nowMinutes === 'number' ? state.nowMinutes : 0,
    }),
  ));
}
