import { describe, it, expect } from 'vitest';
import {
  shredState,
  reassembleState,
  entityKind,
  isInsertOnly,
  getEntityLastModified,
  COLLECTION_KINDS,
  makeEntityId,
} from './dbAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 LOSSLESSNESS GATE
//
// Takes a representative full dayGLANCE sync payload `.data` (every synced
// entity type, in the shape buildSyncPayload emits at App.jsx:5382), shreds it
// to rows via the adapter, simulates the wire (per-entity JSON serialization,
// exactly what encryptEntity/decryptEntity do — dbCrypto.js:274/300), reassembles
// from those rows, and deep-diffs against the original. Must be value-identical
// modulo key ordering.
// ─────────────────────────────────────────────────────────────────────────────

// Key-order-independent deep equality that treats `undefined` and an absent key
// as the same (JSON drops undefined; the merge engine never distinguishes them).
function deepEqualUnordered(a, b, path = '$') {
  if (a === b) return { equal: true };
  if (typeof a !== typeof b) return { equal: false, path, a, b };
  if (a === null || b === null) return { equal: false, path, a, b };
  if (typeof a !== 'object') return a === b ? { equal: true } : { equal: false, path, a, b };

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return { equal: false, path, a, b };
    if (a.length !== b.length) return { equal: false, path: `${path}.length`, a: a.length, b: b.length };
    for (let i = 0; i < a.length; i++) {
      const r = deepEqualUnordered(a[i], b[i], `${path}[${i}]`);
      if (!r.equal) return r;
    }
    return { equal: true };
  }

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (av === undefined && bv === undefined) continue; // undefined ≡ absent
    const r = deepEqualUnordered(av, bv, `${path}.${k}`);
    if (!r.equal) return r;
  }
  return { equal: true };
}

const ts = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();

// A task-shaped item (the shared shape of tasks/unscheduledTasks/recurringTasks/
// recycleBin/todayRoutines). Mirrors the T() fixture in mergeSync.test.js plus
// the app-only fields buildSyncPayload preserves (subtasks, notes, projectId…).
const task = (id, title, lastModified, extra = {}) => ({
  id, title, duration: 30, color: 'bg-blue-500', completed: false,
  notes: '', subtasks: [], lastModified, ...extra,
});

// A realistic full payload `.data`. Every synced key present, with edge cases:
// nested subtasks, a recurringTask.completedDates array, a deleted dailyNote
// tombstone, a same-id task in both `tasks` and `unscheduledTasks` (cross-list
// move state), claimed routine chips, and the keyed habitLogs/timestamps maps.
function buildFixture() {
  return {
    tasks: [
      task(1001, 'Standup', ts(120), { date: '2026-06-18', startTime: '09:00' }),
      task(1002, 'Write report', ts(30), {
        date: '2026-06-18', startTime: '14:00', projectId: 7001, deadline: '2026-06-20',
        notes: 'draft + review', subtasks: [
          { id: 'st1', title: 'outline', completed: true },
          { id: 'st2', title: 'prose', completed: false },
        ],
      }),
      // Same id 1003 also appears in unscheduledTasks below — a cross-list move
      // state the file-tier merge reconciles (merge.js:556). Both copies must
      // survive the roundtrip as distinct rows.
      task(1003, 'Ambiguous list item', ts(15), { date: '2026-06-18' }),
    ],
    unscheduledTasks: [
      task(2001, 'Buy milk', ts(40), { projectId: 7001 }),
      task(1003, 'Ambiguous list item', ts(10)),
    ],
    unscheduledOrderTimestamp: ts(10),
    recurringTasks: [
      {
        id: 3001, title: 'Water plants', duration: 10, color: 'bg-green-500',
        completed: false, lastModified: ts(200),
        recurrence: { type: 'weekly', days: ['mon', 'thu'] },
        startTime: '08:00',
        completedDates: ['2026-06-11', '2026-06-15', '2026-06-18'], // array stays inside the row
        completedDatesTimestamps: { '2026-06-11': ts(210), '2026-06-15': ts(160), '2026-06-18': ts(40) },
      },
    ],
    recycleBin: [
      { ...task(4001, 'Deleted thing', ts(500)), deletedAt: ts(60), _deletedFrom: 'calendar' },
    ],
    syncUrl: 'https://dav.example.com/cal/',
    taskCalendarUrl: 'https://dav.example.com/tasks/',
    completedTaskUids: ['uid-abc::2026-06-17', 'uid-def::2026-06-18'],
    routineDefinitions: {
      monday: [
        { id: 5001, name: 'Workout', lastModified: ts(300) },
        { id: 5002, name: 'Journal', ownerSyncId: 'user-jason', lastModified: ts(120) },
      ],
      thursday: [{ id: 5003, name: 'Review', lastModified: ts(90) }],
    },
    todayRoutines: [
      task(5001, 'Workout', ts(50), { isRoutine: true }),
    ],
    routinesDate: '2026-06-18',
    routineCompletions: { 5001: '2026-06-18' },
    routineCompletionTimestamps: { 5001: ts(40) },
    minimizedSections: { inbox: true, habits: false },
    use24HourClock: true,
    weatherZip: '60601',
    weatherTempUnit: 'F',
    deletedTaskIds: { 9001: ts(1000), 9002: ts(2000) },
    deletedRoutineChipIds: { 5099: ts(800) },
    deletedFrameIds: { 6099: ts(700) },
    removedTodayRoutineIds: { 5003: ts(600) },
    dailyNotes: {
      '2026-06-17': { text: 'shipped v3.4', lastModified: ts(400) },
      '2026-06-16': { text: '', lastModified: ts(900), deleted: true }, // tombstone entry
    },
    habits: [
      { id: 7101, name: 'Water', icon: '💧', createdAt: ts(5000), lastModified: ts(300), archived: false },
      { id: 7102, name: 'Read', createdAt: ts(6000), archived: true }, // no lastModified → createdAt fallback
    ],
    habitLogs: {
      '2026-06-18': { 7101: 4, 7102: 1 },
      '2026-06-17': { 7101: 6 },
    },
    habitLogTimestamps: {
      '2026-06-18:7101': ts(20), '2026-06-18:7102': ts(25), '2026-06-17:7101': ts(1500),
    },
    habitsEnabled: true,
    habitsEnabledUpdatedAt: ts(5000),
    deletedHabitIds: { 7199: ts(900) },
    routinesEnabled: true,
    routinesEnabledUpdatedAt: ts(5000),
    gtdFrames: [
      { id: 8001, title: 'Health', lastModified: ts(700), color: 'bg-red-500' },
      { id: 8002, title: 'Work', lastModified: ts(650) },
    ],
    goals: [
      { id: 9101, title: 'Run a marathon', updatedAt: ts(800), frameId: 8001, progress: 0.3, areaId: 6001, startDate: '2026-06-01' },
    ],
    deletedGoalIds: { 9199: ts(950) },
    projects: [
      { id: 7001, title: 'Q3 launch', updatedAt: ts(60), goalId: 9101, hyperglance: { enabled: false } },
    ],
    deletedProjectIds: { 7099: ts(990) },
    areas: [
      { id: 6001, name: 'Health & Fitness', color: 'bg-green-500', order: 0, updatedAt: ts(820) },
      { id: 6002, name: 'Work', color: 'bg-blue-500', order: 10, updatedAt: ts(810) },
    ],
    deletedAreaIds: { 6099: ts(940) },
    goalsProjectsEnabled: true,
    goalsProjectsEnabledUpdatedAt: ts(5000),
    obsidianConfig: { taskHeading: '## Tasks', dailyNoteTemplate: 'tpl', newNotesFolder: 'Notes' },
    obsidianConfigUpdatedAt: ts(5000),
    multiUserEnabled: true,
    multiUserEnabledUpdatedAt: ts(5000),
    users: [
      { id: 'u1', syncId: 'u1', name: 'Jason', updatedAt: ts(5000), color: 'bg-blue-500' },
      { id: 'u2', syncId: 'u2', name: 'Maggie', updatedAt: ts(4000) },
    ],
    tombstonePrunedBefore: ts(129600), // 90 days
  };
}

// Simulate the GLANCEvault wire: each entity is JSON-serialized into the
// ciphertext on push and JSON-parsed on pull (dbCrypto.js encryptEntity/
// decryptEntity). Running the rows through JSON proves nested structures and
// keyed maps survive serialization, not just object-reference passthrough.
function throughWire(rows) {
  return rows.map(r => ({ ...r, entity: JSON.parse(JSON.stringify(r.entity)) }));
}

describe('dbAdapter losslessness gate', () => {
  it('round-trips a full payload value-identically (modulo key order)', () => {
    const original = buildFixture();
    const rows = shredState(original);
    const wired = throughWire(rows);
    const rebuilt = reassembleState(wired);

    const diff = deepEqualUnordered(original, rebuilt);
    if (!diff.equal) {
      // Surface the exact non-round-tripping field for the report.
      // eslint-disable-next-line no-console
      console.error('LOSSLESSNESS FAIL at', diff.path, 'original=', diff.a, 'rebuilt=', diff.b);
    }
    expect(diff).toEqual({ equal: true });
  });

  it('produces a unique entityId for every row (zero collisions)', () => {
    const rows = shredState(buildFixture());
    const ids = rows.map(r => r.entityId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps a cross-list same-id task as two distinct rows', () => {
    const rows = shredState(buildFixture());
    expect(rows.some(r => r.entityId === makeEntityId('tasks', 1003))).toBe(true);
    expect(rows.some(r => r.entityId === makeEntityId('unscheduledTasks', 1003))).toBe(true);
  });

  it('keeps recurringTasks.completedDates as an array inside the row (rule 4)', () => {
    const rows = shredState(buildFixture());
    const row = rows.find(r => r.entityId === makeEntityId('recurringTasks', 3001));
    expect(Array.isArray(row.entity.value.completedDates)).toBe(true);
    expect(row.entity.value.completedDates).toEqual(['2026-06-11', '2026-06-15', '2026-06-18']);
  });

  it('keeps habitLogs as a single keyed-map row (rule 4, not per-completion rows)', () => {
    const rows = shredState(buildFixture());
    const logRows = rows.filter(r => r.entity._kind === 'singleton' && r.entity._key === 'habitLogs');
    expect(logRows).toHaveLength(1);
    expect(logRows[0].entity.value['2026-06-18']).toEqual({ 7101: 4, 7102: 1 });
  });

  it('routes every row by explicit _kind; bundles + recurringTasks are insert-only, other collections are LWW', () => {
    const rows = shredState(buildFixture());
    for (const r of rows) {
      expect(entityKind(r.entity)).toBe(r.kind);
      // Stage 2: singleton bundles are insert-only (always merged on pull) so a
      // concurrent edit to a different bundle entry is never lost. recurringTasks
      // are too, so each series' completedDates UNION across devices instead of a
      // completion being clobbered by a concurrent series edit. Other per-item
      // collections and per-date dailyNotes stay on entity-grain LWW.
      expect(isInsertOnly(r.entity)).toBe(r.kind === 'singleton' || r.kind === 'recurringTasks');
    }
  });

  it('surfaces the per-kind LWW tiebreaker for collection rows', () => {
    const rows = shredState(buildFixture());
    const taskRow = rows.find(r => r.entityId === makeEntityId('tasks', 1001));
    expect(getEntityLastModified(taskRow.entity)).toBe(taskRow.entity.value.lastModified);
    const goalRow = rows.find(r => r.entityId === makeEntityId('goals', 9101));
    expect(getEntityLastModified(goalRow.entity)).toBe(goalRow.entity.value.updatedAt);
    const userRow = rows.find(r => r.entityId === makeEntityId('users', 'u1'));
    expect(getEntityLastModified(userRow.entity)).toBe(userRow.entity.value.updatedAt);
    // habit with no lastModified falls back to createdAt.
    const habitRow = rows.find(r => r.entityId === makeEntityId('habits', 7102));
    expect(getEntityLastModified(habitRow.entity)).toBe(habitRow.entity.value.createdAt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DISCRIMINATION PROOF
//
// Demonstrates WHY an explicit `_kind` is required: a reference-style structural
// sniff (field-name inspection) cannot separate dayGLANCE's five task-shaped
// collections, but `_kind` resolves all of them with zero collisions.
// ─────────────────────────────────────────────────────────────────────────────
describe('discrimination: structural sniff vs explicit _kind', () => {
  // A best-effort structural sniff in the spirit of the reference's entityKind.
  // It can only see field names, so the five task-shaped kinds are invisible to it.
  function structuralSniff(item) {
    if (!item || typeof item !== 'object') return null;
    if ('completedDates' in item) return 'recurringTasks'; // distinguishable
    if ('deletedAt' in item) return 'recycleBin';          // distinguishable
    if ('goalId' in item) return 'projects';
    if ('frameId' in item && 'progress' in item) return 'goals';
    if ('syncId' in item && 'name' in item) return 'users';
    // tasks / unscheduledTasks / todayRoutines share { id,title,duration,color,
    // completed,lastModified } — no field tells them apart.
    if ('title' in item && 'duration' in item) return 'task-shaped (AMBIGUOUS)';
    return null;
  }

  it('structural sniff CANNOT separate tasks / unscheduledTasks / todayRoutines', () => {
    const fx = buildFixture();
    const scheduled = fx.tasks[0];
    const inbox = fx.unscheduledTasks[0];
    const todayRoutine = fx.todayRoutines[0];
    // All three collapse to the same ambiguous bucket — a fragile sniff would
    // misroute them on apply.
    expect(structuralSniff(scheduled)).toBe('task-shaped (AMBIGUOUS)');
    expect(structuralSniff(inbox)).toBe('task-shaped (AMBIGUOUS)');
    expect(structuralSniff(todayRoutine)).toBe('task-shaped (AMBIGUOUS)');
  });

  it('explicit _kind resolves ALL kinds with zero collisions', () => {
    const rows = shredState(buildFixture());
    const kinds = new Set(rows.map(r => entityKind(r.entity)));
    // Every collection kind that has data, plus dailyNotes + singleton, is present
    // and unambiguous; reassemble routes 100% of rows (asserted by the gate test
    // above succeeding). Here we assert the five task-shaped kinds are all
    // distinctly represented despite identical structure.
    for (const k of ['tasks', 'unscheduledTasks', 'recurringTasks', 'recycleBin', 'todayRoutines']) {
      expect(kinds.has(k)).toBe(true);
    }
    // No row is ever the ambiguous bucket the structural sniff produced.
    expect([...kinds].every(k => k === 'singleton' || k === 'dailyNotes' || k in COLLECTION_KINDS)).toBe(true);
  });
});

// ─── Areas: registered as a per-row collection (LWW on updatedAt) with a
// singleton tombstone bundle, mirroring goals/projects. ───────────────────────
describe('areas (GLANCEvault adapter)', () => {
  it('is a registered collection keyed by id on updatedAt', () => {
    expect(COLLECTION_KINDS.areas).toEqual({ idField: 'id', tsField: 'updatedAt' });
  });

  it('shreds each area to its own row and reassembles losslessly', () => {
    const data = {
      areas: [
        { id: 'a1', name: 'Finance', color: 'bg-blue-500', order: 0, updatedAt: '2026-06-01T00:00:00Z' },
        { id: 'a2', name: 'Dev', color: 'bg-green-500', order: 10, updatedAt: '2026-06-02T00:00:00Z' },
      ],
      deletedAreaIds: { a9: '2026-05-01T00:00:00Z' },
    };
    const rows = shredState(data);
    const areaRows = rows.filter(r => entityKind(r.entity) === 'areas');
    expect(areaRows).toHaveLength(2);
    expect(areaRows[0].entityId).toBe(makeEntityId('areas', 'a1'));

    const back = reassembleState(rows);
    expect(back.areas).toEqual(data.areas);
    expect(back.deletedAreaIds).toEqual(data.deletedAreaIds);
  });

  it('surfaces updatedAt as the entity-grain LWW timestamp', () => {
    const rows = shredState({ areas: [{ id: 'a1', name: 'X', updatedAt: '2026-06-03T00:00:00Z' }] });
    const areaRow = rows.find(r => entityKind(r.entity) === 'areas');
    expect(getEntityLastModified(areaRow.entity)).toBe('2026-06-03T00:00:00Z');
  });
});
