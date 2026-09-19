// Routine blocks for the MCP read surface (docs/mcp-server-spec.md §5.1).
//
// WHY THIS IS A SEPARATE MODULE. A routine is not a task and is not a
// recurring task, and the differences are exactly the kind that vanish when
// you reuse a task-shaped helper:
//
//   - the title lives in `name`, not `title`
//   - there is no `date` field at all; the date is the sibling scalar
//     `routinesDate`
//   - completion is an EXTERNAL map (routineCompletions), not a row field
//   - ownership is single-owner `ownerSyncId`, not the broadcast-with-filter
//     `assignedUserSyncIds` that isVisibleForUser understands
//
// Feed a routine to mcpReadModel's toBlock and every one of those is silently
// wrong rather than loudly broken: blockType falls through to 'task', the
// title reads as '', the date reads as null, and a model is handed something
// it will try to complete. Hence a distinct type and a shaping function that
// knows the real shape.
//
// READ-ONLY BY DESIGN. Routines have a write surface (the dashboard, the
// drag-to-place gesture, the completion toggle), but its shape is nothing
// like a task mutation, so the MCP write tools do not expose it. Every block
// this module emits carries read_only: true, the same flag device calendar
// events carry, so a caller branches on the flag rather than on the type.

/**
 * Block ids are namespaced so a routine can never collide with a task id and
 * so the write path can recognise one without being handed routine state.
 * Mirrors the `recurring-<id>-<date>` convention, and matches the obstacle ids
 * App.jsx already builds when it treats routines as scheduling conflicts.
 */
export const ROUTINE_ID_PREFIX = 'routine-';

/** The wire id for a routine block. */
export function routineBlockId(routineId) {
  return `${ROUTINE_ID_PREFIX}${routineId}`;
}

/**
 * The routine id inside a block id, or null when this is not a routine block.
 * Pure and state-free on purpose: the write path needs to reject routine ids
 * without holding routine state (spec §3.7).
 */
export function parseRoutineBlockId(blockId) {
  if (typeof blockId !== 'string' || !blockId.startsWith(ROUTINE_ID_PREFIX)) return null;
  const routineId = blockId.slice(ROUTINE_ID_PREFIX.length);
  return routineId ? routineId : null;
}

/**
 * One routine as a §5.1 block. Field names are the snake_case wire names, and
 * the field SET matches toBlock so a caller can treat the three block types
 * uniformly where it wants to and branch where it must.
 *
 * An unplaced routine (selected in the dashboard but never given a time)
 * reports start_time and duration_minutes as null rather than echoing the
 * stored `duration: 15`. That 15 is the default handleRoutinesDone writes so a
 * later drag has something to size from; the timeline never draws it, and
 * reporting it would invent fifteen minutes of occupied time that does not
 * exist. all_day true with a null span is the honest reading: on the day, but
 * occupying no part of it.
 */
export function toRoutineBlock(routine, date, completed) {
  const allDay = !!routine.isAllDay || !routine.startTime;
  return {
    id: routineBlockId(routine.id),
    type: 'routine',
    title: routine.name ?? '',
    date,
    start_time: allDay ? null : routine.startTime,
    duration_minutes: allDay ? null : (typeof routine.duration === 'number' ? routine.duration : null),
    all_day: allDay,
    completed: !!completed,
    // Not "unsupported yet": routines are modified through the routines
    // dashboard, whose write shape is not a task mutation. Carried per item,
    // like the device calendar flag, so a caller never has to infer it.
    read_only: true,
  };
}

/**
 * Today's placed routines as blocks, or [] when they do not apply to `date`.
 *
 * THE DATE GUARD. Routines exist for exactly one date: `todayRoutines` is
 * wiped and tombstoned by the day-rollover effect in useRoutines.js, so there
 * is no such thing as a routine on a past or future day. Both halves of the
 * guard are load-bearing:
 *
 *   routinesDate === date   the routines really are for the date being asked
 *                           about, not a leftover from before a rollover
 *   todayDate === date      and that date is genuinely today
 *
 * Either alone leaves a hole. The app can sit open across midnight before the
 * rollover effect fires; in that window routinesDate still reads yesterday.
 * Checking only routinesDate would then answer a get_day for YESTERDAY with
 * routines the next rollover is about to erase. Checking only todayDate would
 * answer a get_day for TODAY with yesterday's routines. Requiring both makes
 * that window return nothing, which is the one answer that is never wrong.
 *
 * OWNERSHIP IS NOT FILTERED HERE, and that is deliberate. `routines` must
 * arrive already scoped to the current user. The caller cannot fall back on
 * isVisibleForUser: it tests assignedUserSyncIds, which a routine does not
 * have, so it returns true for EVERY member's routines. See the ownership
 * test in mcpRoutines.test.js.
 */
export function buildRoutineBlocks(state, date) {
  const {
    routines = [],
    routinesDate = '',
    routineCompletions = {},
    routinesEnabled = false,
    todayDate = '',
  } = state ?? {};

  if (!routinesEnabled) return [];
  if (!date || routinesDate !== date || todayDate !== date) return [];

  return routines.map((r) => toRoutineBlock(r, date, routineCompletions[r.id]));
}
