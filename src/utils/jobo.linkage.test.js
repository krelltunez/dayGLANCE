import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as C from './jobo.js';
const task = {
  id: 'p',
  title: 'Report',
  date: '2026-09-16',
  startTime: '09:00',
  duration: 60,
  color: 'bg-blue-500',
  notes: 'Source note',
  completed: false,
  todoist: {
    id: 'remote'
  }
};
const now = new Date('2026-09-16T14:20:45');
function base() {
  return C.capture(C.empty(), [task]);
}
function add(s, id, time = '09:00', duration = 30, created = '2026-09-16T02:00:00.000Z') {
  return C.createRecord(s, task, {
    date: task.date,
    startTime: time,
    duration
  }, id, created);
}
test('checkbox records just before now, not at planned schedule', () => {
  const s = C.recordChecked(base(), task, 'r', now);
  const r = s.records[0];
  assert.equal(r.date, '2026-09-16');
  assert.equal(r.startTime, '13:20');
  assert.equal(r.duration, 60);
  assert.equal(C.endEpoch(r), +new Date('2026-09-16T14:20:00'));
});
test('checkbox creation keeps the original baseline', () => {
  const s = C.recordChecked(base(), task, 'r', now);
  assert.equal(s.plans.p.startTime, '09:00');
});
test('checkbox creation never completes the Todoist source', () => {
  const s = C.recordChecked(base(), task, 'r', now);
  assert.equal(task.completed, false);
  assert.equal(s.records[0].todoist, undefined);
});
test('new checked interval defaults complete', () => {
  const s = C.recordChecked(base(), task, 'r', now);
  assert.equal(s.records[0].progress, 'complete');
  assert.equal(C.planChecked(s, 'p'), true);
});
test('a second event on an already checked plan is a no-op', () => {
  const s = C.recordChecked(base(), task, 'r', now);
  assert.equal(C.recordChecked(s, task, 'extra', now), s);
});
for (const progress of ['started', 'partial']) {
  test(progress + ' unchecks plan without deleting execution', () => {
    let s = C.recordChecked(base(), task, 'r', now);
    s = C.updateRecord(s, 'r', {
      progress
    });
    assert.equal(C.planChecked(s, 'p'), false);
    assert.equal(s.records.length, 1);
  });
  test(progress + ' then check adds an independent complete interval', () => {
    let s = C.recordChecked(base(), task, 'r', now);
    s = C.updateRecord(s, 'r', {
      progress
    });
    s = C.recordChecked(s, task, 'r2', new Date('2026-09-16T16:00'));
    assert.equal(s.records.length, 2);
    assert.equal(s.records[0].progress, progress);
    assert.equal(s.records[1].progress, 'complete');
    assert.equal(s.records[1].startTime, '15:00');
    assert.equal(C.planChecked(s, 'p'), true);
  });
}
for (const progress of ['mostly', 'complete']) test(progress + ' keeps the plan checked', () => {
  let s = C.recordChecked(base(), task, 'r', now);
  s = C.updateRecord(s, 'r', {
    progress
  });
  assert.equal(C.planChecked(s, 'p'), true);
});
test('single visible progress is latest-created, not a total', () => {
  let s = add(base(), 'first', '15:00', 30, '2026-09-16T01:00:00Z');
  s = C.updateRecord(s, 'first', {
    progress: 'started'
  });
  s = add(s, 'last', '08:00', 30, '2026-09-16T02:00:00Z');
  assert.equal(C.latestRecord(s, 'p').id, 'last');
  assert.equal(C.latestRecord(s, 'p').progress, 'complete');
  assert.equal(s.plans.p.progress, undefined);
});
test('same-timestamp fragments use stable creation order', () => {
  let s = add(add(base(), 'first'), 'second');
  assert.equal(C.latestRecord(s, 'p').id, 'second');
});
test('manually moving a historical interval does not replace current progress', () => {
  let s = add(add(base(), 'first'), 'second');
  s = C.updateRecord(s, 'first', {
    startTime: '23:00',
    progress: 'partial'
  });
  assert.equal(C.latestRecord(s, 'p').id, 'second');
  assert.equal(C.planChecked(s, 'p'), true);
});
test('deleting latest interval restores previous progress', () => {
  let s = add(base(), 'first');
  s = C.updateRecord(s, 'first', {
    progress: 'partial'
  });
  s = add(s, 'second');
  s = C.removeRecord(s, 'second');
  assert.equal(C.latestRecord(s, 'p').id, 'first');
  assert.equal(C.planChecked(s, 'p'), false);
});
test('progress and checkbox state survive backup restore', () => {
  let s = C.recordChecked(base(), task, 'r', now);
  s = C.updateRecord(s, 'r', {
    progress: 'partial'
  });
  s = C.validate(JSON.parse(JSON.stringify(s)));
  assert.equal(C.planChecked(s, 'p'), false);
});
test('within-plan and interrupted coexist', () => {
  let s = add(base(), 'a', '09:00', 20);
  s = add(s, 'b', '09:30', 20);
  assert.deepEqual(C.labels(s, 'p'), ['within', 'interrupted']);
});
test('delayed and interrupted coexist without overrun', () => {
  let s = add(base(), 'a', '09:30', 20);
  s = add(s, 'b', '11:00', 20);
  assert.deepEqual(C.labels(s, 'p'), ['delayed', 'interrupted']);
});
test('overrun and interrupted coexist without delay', () => {
  let s = add(base(), 'a', '08:00', 40);
  s = add(s, 'b', '09:00', 40);
  assert.deepEqual(C.labels(s, 'p'), ['overrun', 'interrupted']);
});
test('delayed, overrun and interrupted all coexist', () => {
  let s = add(base(), 'a', '09:30', 40);
  s = add(s, 'b', '11:00', 40);
  assert.deepEqual(C.labels(s, 'p'), ['delayed', 'overrun', 'interrupted']);
});
test('idle gaps do not count toward overrun', () => {
  let s = add(base(), 'a', '09:00', 10);
  s = add(s, 'b', '17:00', 10);
  assert.equal(C.labels(s, 'p').includes('overrun'), false);
});
test('adjacent intervals are still separate interruptions', () => {
  let s = add(base(), 'a', '09:00', 30);
  s = add(s, 'b', '09:30', 30);
  assert.equal(s.records.length, 2);
  assert.equal(C.labels(s, 'p').includes('interrupted'), true);
});
test('no record in a future visible plan has no labels', () => assert.deepEqual(C.labels(base(), 'p', +now, {
  ...task,
  startTime: '15:00'
}), []));
test('a current interval crossing the timeline is not not-started', () => assert.deepEqual(C.labels(base(), 'p', +now, {
  ...task,
  startTime: '14:00'
}), []));
test('elapsed current plan without execution is not-started', () => assert.deepEqual(C.labels(base(), 'p', +now, task), ['notStarted']));
test('unplanned remains unplanned', () => {
  const s = C.createRecord(base(), null, {
    date: task.date,
    startTime: '13:00',
    duration: 30,
    title: 'Call'
  }, 'u');
  assert.deepEqual(C.labelsForRecord(s, s.records[0]), ['unplanned']);
});
test('midnight check retains full duration in one record', () => {
  const s = C.recordChecked(base(), {
    ...task,
    duration: 30
  }, 'night', new Date('2026-09-16T00:10'));
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].date, '2026-09-15');
  assert.equal(s.records[0].startTime, '23:40');
  assert.equal(s.records[0].duration, 30);
  assert.equal(C.endEpoch(s.records[0]), +new Date('2026-09-16T00:10'));
});
test('midnight record renders per-day pieces without creating extra records', () => {
  const s = C.recordChecked(base(), {
    ...task,
    duration: 30
  }, 'night', new Date('2026-09-16T00:10'));
  assert.equal(C.recordsOnDate(s, '2026-09-15')[0].duration, 20);
  assert.equal(C.recordsOnDate(s, '2026-09-16')[0].duration, 10);
  assert.equal(s.records.length, 1);
  assert.equal(C.labels(s, 'p').includes('interrupted'), false);
});
test('midnight record validates and survives reload', () => {
  const s = C.recordChecked(base(), {
    ...task,
    duration: 30
  }, 'night', new Date('2026-09-16T00:10'));
  assert.equal(C.validate(JSON.parse(JSON.stringify(s))).records[0].duration, 30);
});
test('ordinary records project without mutations', () => {
  const s = add(base(), 'r');
  assert.equal(C.recordsOnDate(s, task.date)[0], s.records[0]);
  assert.equal(C.recordsOnDate(s, '2026-09-17').length, 0);
});
test('invalid time cannot be recorded', () => assert.throws(() => C.recordChecked(base(), task, 'r', 'not-a-date')));
test('native note updates propagate to linked snapshots', () => {
  let s = add(add(base(), 'a'), 'b');
  const n = C.syncSourceNotes(s, [{
    ...task,
    notes: 'Native edit'
  }]);
  assert.deepEqual(n.records.map(r => r.notes), ['Native edit', 'Native edit']);
  assert.equal(s.records[0].notes, 'Source note');
});
test('unchanged notes retain state identity', () => {
  let s = add(base(), 'a');
  assert.equal(C.syncSourceNotes(s, [task]), s);
});
test('unknown source keeps its local last-known note', () => {
  const s = add(base(), 'a');
  assert.equal(C.syncSourceNotes(s, []), s);
});
test('old separate notes are archived before canonical sharing', () => {
  let s = add(base(), 'a');
  s = C.updateRecord(s, 'a', {
    notes: 'Old separate note',
    notesOwn: true
  });
  s = C.syncSourceNotes(s, [task], '2026-09-16T00:00:00Z');
  assert.equal(s.records[0].notes, 'Source note');
  assert.equal(s.records[0].notesOwn, false);
  assert.equal(s.records[0].noteHistory[0].text, 'Old separate note');
});
test('same old separate note is not unnecessarily archived', () => {
  let s = add(base(), 'a');
  s = C.updateRecord(s, 'a', {
    notesOwn: true
  });
  s = C.syncSourceNotes(s, [task]);
  assert.equal(s.records[0].noteHistory, undefined);
});
test('deleting shared note clears all linked copies, not their time or progress', () => {
  let s = add(base(), 'a');
  s = C.updateRecord(s, 'a', {
    progress: 'partial'
  });
  s = C.syncSourceNotes(s, [{
    ...task,
    notes: ''
  }]);
  assert.equal(s.records[0].notes, '');
  assert.equal(s.records[0].duration, 30);
  assert.equal(s.records[0].progress, 'partial');
});
test('unplanned notes never get changed by task note syncing', () => {
  const s = C.createRecord(base(), null, {
    date: task.date,
    startTime: '13:00',
    duration: 30,
    title: 'Call',
    notes: 'Private'
  }, 'u');
  assert.equal(C.syncSourceNotes(s, [task]), s);
});
test('note archives and latest progress survive backup roundtrip', () => {
  let s = add(base(), 'a');
  s = C.updateRecord(s, 'a', {
    notes: 'Old',
    notesOwn: true,
    progress: 'partial'
  });
  s = C.syncSourceNotes(s, [task]);
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(s))), s);
});
test('clock rollback does not keep a plan stuck on older progress', () => {
  let s = add(base(), 'first', '09:00', 30, '2026-09-20T00:00:00Z');
  s = C.updateRecord(s, 'first', {
    progress: 'partial'
  });
  s = C.recordChecked(s, task, 'next', now);
  assert.equal(C.latestRecord(s, 'p').id, 'next');
  assert.equal(C.planChecked(s, 'p'), true);
});
test('cross-midnight end text preserves next-day minute', () => assert.equal(C.recordEndClock({
  startTime: '23:40',
  duration: 30
}), '00:10'));
test('exact midnight end displays 24:00', () => assert.equal(C.recordEndClock({
  startTime: '23:30',
  duration: 30
}), '24:00'));
test('cross-midnight trailing piece resize preserves earlier portion', () => {
  const r = {
    date: '2026-09-15',
    startTime: '23:40',
    duration: 30
  };
  const shown = {
    date: '2026-09-16',
    startTime: '00:00',
    duration: 10
  };
  assert.deepEqual(C.resizeRecord(r, shown, {
    startTime: '00:00',
    duration: 20
  }, 'bottom'), {
    date: '2026-09-15',
    startTime: '23:40',
    duration: 40
  });
});
test('cross-midnight leading piece resize preserves next day end', () => {
  const r = {
    date: '2026-09-15',
    startTime: '23:40',
    duration: 30
  };
  const shown = {
    date: '2026-09-15',
    startTime: '23:40',
    duration: 20
  };
  assert.deepEqual(C.resizeRecord(r, shown, {
    startTime: '23:30',
    duration: 30
  }, 'top'), {
    date: '2026-09-15',
    startTime: '23:30',
    duration: 40
  });
});
test('invalid projected resize cannot erase an interval', () => assert.throws(() => C.resizeRecord({
  date: '2026-09-15',
  startTime: '23:40',
  duration: 30
}, {
  date: '2026-09-16',
  startTime: '00:00',
  duration: 10
}, {
  startTime: '01:00',
  duration: 1
}, 'top')));
