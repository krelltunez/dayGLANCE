import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergeSyncData } from './mergeSync.js';

// ─────────────────────────────────────────────────────────────────────────────
// FILE-TIER SLICE-COVERAGE CANARY
//
// The upstream merge (@glance-apps/sync mergeSyncData) DROPS unknown keys, and
// unlike the vault tier (whose mergeBundle default case at least WARNS), the
// file tier has no tripwire: a payload key without merge handling silently
// vanishes from every merged file. That is exactly how bucketConfig shipped
// broken — heading edits never propagated and each re-upload removed the slice
// (fixed alongside this canary); dayWindows only avoided the same fate because
// its wrapper line was written up front.
//
// This test mechanizes the audit that found it, permanently:
//   1. The payload key list is parsed from buildSyncPayload's SOURCE
//     (src/App.jsx), so the canary cannot drift from what the app actually
//     uploads — a new payload key fails test 1 until it is added to the
//     fixture below, and then fails tests 2/3 until it actually survives the
//     merge (upstream, wrapper, or a documented device-local exemption).
//   2/3. Every fixture key must survive mergeSyncData in BOTH directions:
//     local-only (our data survives a merge against an empty remote — and gets
//     re-uploaded) and remote-only (another device's data reaches us).
// ─────────────────────────────────────────────────────────────────────────────

const APP_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8');

function payloadKeysFromSource() {
  const start = APP_SRC.indexOf('const buildSyncPayload');
  expect(start).toBeGreaterThan(-1);
  // The function is small; 200 lines comfortably covers it without reaching
  // the next `data: {` in the file.
  const slice = APP_SRC.slice(start).split('\n').slice(0, 200);
  const end = slice.findIndex((l) => l === '  };');
  const body = slice.slice(0, end === -1 ? undefined : end).join('\n');
  // Keys of the `data: { ... }` object sit at exactly 8-space indent
  // (version/lastModified/data are at 6): `key: expr,` OR shorthand `key,`.
  // Comments and deeper-indented call arguments never match.
  const keys = [...body.matchAll(/^ {8}([A-Za-z][A-Za-z0-9]*)[,:]/gm)].map((m) => m[1]);
  expect(keys.length).toBeGreaterThan(30); // parse sanity — the payload is big
  return keys;
}

// Keys the FILE tier deliberately does not carry: per-device values whose
// merged-file absence is the mechanism that keeps them local (see
// ALWAYS_DEVICE_LOCAL in dbAdapter.js — "weather not in merge output", and
// multiUserEnabled is per-device on BOTH tiers so one household member's
// toggle never flips everyone's).
const DEVICE_LOCAL_ON_FILE_TIER = new Set([
  'weatherZip', 'weatherTempUnit', 'multiUserEnabled', 'multiUserEnabledUpdatedAt',
]);

const ISO = '2026-08-01T10:00:00.000Z';

// One non-empty, type-correct sentinel per payload key. Non-empty matters:
// several wrapper blocks route a slice only when a side HAS it, so an empty
// value could pass vacuously.
const REPRESENTATIVE = {
  tasks: [{ id: 't1', title: 'task', date: '2026-08-01', lastModified: ISO }],
  unscheduledTasks: [{ id: 'u1', title: 'inbox', lastModified: ISO }],
  unscheduledOrderTimestamp: ISO,
  recycleBin: [{ id: 'r1', title: 'binned', lastModified: ISO }],
  syncUrl: 'https://dav.example.com/cal',
  taskCalendarUrl: 'https://dav.example.com/tasks',
  calendarConfigByUser: { u1: { syncUrl: 'https://x', updatedAt: ISO } },
  completedTaskUids: ['uid-1::2026-08-01'],
  recurringTasks: [{ id: 'rec1', title: 'series', recurrence: { type: 'daily' }, completedDates: [], lastModified: ISO }],
  routineDefinitions: { morning: [{ id: 'chip1', name: 'stretch' }] },
  todayRoutines: [{ id: 'chip1', name: 'stretch', lastModified: ISO }],
  routinesDate: '2026-08-01',
  routineCompletions: { chip1: true },
  routineCompletionTimestamps: { chip1: ISO },
  minimizedSections: { inbox: true },
  use24HourClock: true,
  weatherZip: '60601',
  weatherTempUnit: 'F',
  deletedTaskIds: { gone1: ISO },
  deletedRoutineChipIds: { gonechip: ISO },
  deletedFrameIds: { goneframe: ISO },
  deletedObsidianKeys: { '2026-07-01': ISO },
  removedTodayRoutineIds: { removedchip: ISO },
  dailyNotes: { '2026-08-01': 'a note' },
  dayWindows: { defaults: { start: '08:00', stop: '22:00', lastModified: ISO } },
  habits: [{ id: 'h1', name: 'walk', lastModified: ISO }],
  habitLogs: { '2026-08-01': { h1: 1 } },
  habitLogTimestamps: { '2026-08-01:h1': ISO },
  habitsEnabled: true,
  habitsEnabledUpdatedAt: ISO,
  deletedHabitIds: { gonehabit: ISO },
  routinesEnabled: true,
  routinesEnabledUpdatedAt: ISO,
  gtdFrames: [{ id: 'f1', label: 'Deep', start: '09:00', end: '11:00', lastModified: ISO }],
  bucketConfig: { headings: { b1: 'Anytime', b2: 'Someday' }, secondListHidden: false, notes: '', updatedAt: ISO },
  goals: [{ id: 'g1', title: 'goal', status: 'active', updatedAt: ISO }],
  deletedGoalIds: { gonegoal: ISO },
  projects: [{ id: 'p1', title: 'project', status: 'active', updatedAt: ISO }],
  deletedProjectIds: { goneproject: ISO },
  areas: [{ id: 'a1', title: 'area', updatedAt: ISO }],
  deletedAreaIds: { gonearea: ISO },
  goalsProjectsEnabled: true,
  goalsProjectsEnabledUpdatedAt: ISO,
  obsidianConfig: { dailyNotesFolder: 'Daily' },
  obsidianConfigUpdatedAt: ISO,
  multiUserEnabled: false,
  multiUserEnabledUpdatedAt: ISO,
  users: [{ syncId: 'u1', name: 'Me', updatedAt: ISO }],
  tombstonePrunedBefore: ISO,
};

const emptyData = () => ({
  tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
  completedTaskUids: [], deletedTaskIds: {},
  syncUrl: null, taskCalendarUrl: null,
  routineDefinitions: {}, todayRoutines: [], routinesDate: '',
  minimizedSections: {}, use24HourClock: false,
});

describe('file-tier slice-coverage canary', () => {
  it('1. the fixture covers every key buildSyncPayload actually uploads (parsed from source)', () => {
    const sourceKeys = payloadKeysFromSource();
    const missing = sourceKeys.filter((k) => !(k in REPRESENTATIVE));
    // A new payload key lands here first: add a non-empty sentinel above AND
    // make sure the slice survives the merge (tests 2/3) — that means upstream
    // handling, a wrapper block in mergeSync.js, or a documented device-local
    // exemption. Do not just append to the fixture and move on.
    expect(missing).toEqual([]);
  });

  it('2. every slice survives a merge as the LOCAL side (against an empty remote)', () => {
    const { data } = mergeSyncData({ ...REPRESENTATIVE }, emptyData());
    const dropped = Object.keys(REPRESENTATIVE)
      .filter((k) => !DEVICE_LOCAL_ON_FILE_TIER.has(k))
      .filter((k) => data[k] === undefined);
    expect(dropped).toEqual([]);
  });

  it('3. every slice survives a merge as the REMOTE side (another device reaches us)', () => {
    const { data } = mergeSyncData(emptyData(), { ...REPRESENTATIVE });
    const dropped = Object.keys(REPRESENTATIVE)
      .filter((k) => !DEVICE_LOCAL_ON_FILE_TIER.has(k))
      .filter((k) => data[k] === undefined);
    expect(dropped).toEqual([]);
  });
});
