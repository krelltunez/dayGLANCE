// The state the read model answers from, assembled from the synced slices for
// one user at one moment. The desktop app builds it from live React state
// (App.jsx, the useMcpBridge call); a GLANCEvault-client host builds it from
// its own reassembled copy of the same slices. One function, so the two
// cannot scope or date anything differently (#2280, docs/mcp-vault-host.md
// "What the host must supply that the app derives from the device").
//
// OWNER SCOPING IS LOAD-BEARING. Routines and frames have ONE owner
// (`ownerSyncId`); tasks, goals and projects are broadcast unless assigned
// (`assignedUserSyncIds`). The read model filters every slice with
// isVisibleForUser, which tests only the second, so it would admit EVERY
// member's routines and frames. They are scoped here, by owner, before the
// read model sees them; skipping this leaks another member's routines and
// frames onto this user's read surface. The predicates are agenda-core's,
// the same ones the app's own UI scopes with.
//
// THE CLOCK. Routines exist only for today, and today's frames are clipped to
// the current minute, so the state carries `todayDate` and `nowMinutes`. They
// are the user's, not the machine's: without a `timeZone` they come from the
// local clock (the app, whose clock is the user's); with one they are read in
// that IANA zone (a host, which is often a server on UTC). The zone also
// rides the state, so stamps (created_at, completed_at) are reported in it.

import { agendaClock, isTaskVisibleForUser, isOwnedBy } from '@glance-apps/agenda-core';
// The dates module itself, not the kit's root: the root also carries the HTTP
// listener (node:http), which a browser bundle of the read model cannot load.
import { localDateOf, localMinutesOf } from '@glance-apps/mcp-host/src/dates.js';

/**
 * "Now" on the user's clock: `{ todayDate: 'YYYY-MM-DD', nowMinutes }`.
 *
 * @param {Date|number} now  the instant (a Date, or epoch milliseconds)
 * @param {string} [timeZone]  an IANA zone; omitted, this machine's local clock
 */
export function readClock(now, timeZone) {
  const ms = now instanceof Date ? now.getTime() : now;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    throw new TypeError(`readClock needs the current instant as a Date or epoch milliseconds, got ${String(now)}`);
  }
  if (timeZone) return { todayDate: localDateOf(ms, timeZone), nowMinutes: localMinutesOf(ms, timeZone) };
  const { today, nowMinutes } = agendaClock(now instanceof Date ? now : new Date(ms));
  return { todayDate: today, nowMinutes };
}

/**
 * The read model's state for one user.
 *
 * @param {object} data  the synced slices, under their sync-payload names:
 *   tasks, recurringTasks, unscheduledTasks, recycleBin, todayRoutines (every
 *   member's), routinesDate, routineCompletions, routinesEnabled, gtdFrames
 *   (every member's), goals, projects, areas, dailyNotes, bucketConfig,
 *   users, multiUserEnabled
 * @param {object} opts  what the device (or the host's configuration) supplies:
 * @param {Date|number} opts.now  the current instant
 * @param {string} [opts.timeZone]  the user's IANA zone; omit only where this
 *   machine's clock is the user's (the app)
 * @param {string|null} [opts.userSyncId]  the user this read surface answers
 *   as, in a multi-user account (the app's meUserSyncId)
 * @param {number} [opts.weekStartDay]  0=Sunday..6; a per-device setting
 */
export function buildMcpReadState(data, { now, timeZone, userSyncId, weekStartDay } = {}) {
  const d = data ?? {};
  const multiUserEnabled = d.multiUserEnabled;
  const isVisibleForUser = (item) => isTaskVisibleForUser(item, multiUserEnabled, userSyncId);
  const ownedByUser = (items) => (items ?? []).filter((item) => isOwnedBy(item, multiUserEnabled, userSyncId));
  const { todayDate, nowMinutes } = readClock(now, timeZone);
  return {
    tasks: d.tasks,
    recurringTasks: d.recurringTasks,
    unscheduledTasks: d.unscheduledTasks,
    // Owner-scoped: see the header. Never the unscoped list.
    routines: ownedByUser(d.todayRoutines),
    routinesDate: d.routinesDate,
    routineCompletions: d.routineCompletions,
    routinesEnabled: d.routinesEnabled,
    // Today on the user's clock, so the routine date guard (routineBlocks.js
    // in agenda-core) can require that routinesDate really is today.
    todayDate,
    // Owner-scoped, for the same reason as routines.
    frames: ownedByUser(d.gtdFrames),
    // Frame availability clips today's free slots to the present.
    nowMinutes,
    // Bulk undo (the app's write path) moves undone creates to the bin.
    recycleBin: d.recycleBin,
    goals: d.goals,
    projects: d.projects,
    areas: d.areas,
    dailyNotes: d.dailyNotes,
    bucketConfig: d.bucketConfig,
    isVisibleForUser,
    weekStartDay,
    users: d.users,
    multiUserEnabled,
    ...(timeZone ? { timeZone } : {}),
  };
}
