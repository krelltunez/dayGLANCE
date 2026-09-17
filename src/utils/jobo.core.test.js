import { test } from 'vitest';
import a from 'node:assert/strict';
import * as C from './jobo.js';
const p = {
  id: 'p1',
  title: 'Report #work',
  date: '2026-09-16',
  startTime: '09:00',
  duration: 60,
  color: 'bg-blue-500',
  notes: 'Original',
  completed: false,
  todoist: {
    id: 'remote'
  }
};
const start = () => C.capture(C.empty(), [p], '2026-09-16T00:00:00Z');
const record = (s, at = {}, id = 'r1') => C.createRecord(s, p, {
  date: p.date,
  startTime: p.startTime,
  duration: p.duration,
  ...at
}, id, '2026-09-16T03:00:00Z');
test('strict date validation', () => {
  a.equal(C.validDate('2026-02-29'), false);
  a.equal(C.validDate('2024-02-29'), true);
  a.equal(C.validDate('2026-13-10'), false);
});
test('24:00 boundary and malformed time', () => {
  a.equal(C.minutes('24:00'), 1440);
  a.ok(Number.isNaN(C.minutes('24:01')));
  a.ok(Number.isNaN(C.minutes('12:60')));
});
test('clock round trip', () => {
  for (let i = 0; i <= 1440; i++) a.equal(C.minutes(C.clock(i)), i);
});
test('baseline captured once before changes', () => {
  const s = start(),
    n = C.capture(s, [{
      ...p,
      startTime: '16:00',
      duration: 90
    }]);
  a.equal(n, s);
  a.equal(n.plans.p1.startTime, '09:00');
});
test('capture ignores all-day plans', () => a.deepEqual(C.capture(C.empty(), [{
  ...p,
  isAllDay: true
}]).plans, {}));
test('invalid plan is not invented', () => a.deepEqual(C.capture(C.empty(), [{
  ...p,
  date: 'bad'
}]).plans, {}));
test('numeric task ID normalized', () => a.ok(C.capture(C.empty(), [{
  ...p,
  id: 1
}]).plans['1']));
test('prototype pollution plan rejected', () => a.deepEqual(C.capture(C.empty(), [{
  ...p,
  id: '__proto__'
}]).plans, {}));
test('record auto-captures baseline', () => a.ok(record(C.empty()).plans.p1));
test('record defaults completed without changing source checkbox', () => {
  const s = record(start());
  a.equal(s.records[0].progress, 'complete');
  a.equal(p.completed, false);
});
test('Do does not copy remote writeback mapping', () => {
  const r = record(start()).records[0];
  a.equal(r.todoist, undefined);
  a.equal(r.imported, undefined);
});
test('repeat commands with same UUID idempotent', () => {
  const s = record(start());
  a.equal(record(s), s);
});
test('two drags are two independent records', () => {
  const s = record(record(start()), {
    startTime: '10:00'
  }, 'r2');
  a.equal(s.records.length, 2);
});
test('adjacent segments stay independent and signify interruption', () => {
  const s = record(record(start(), {
    duration: 30
  }), {
    startTime: '09:30',
    duration: 30
  }, 'r2');
  a.equal(s.records.length, 2);
  a.deepEqual(C.labels(s, 'p1'), ['within', 'interrupted']);
});
test('interrupted coexists with delayed and overrun', () => {
  const s = record(record(start(), {
    startTime: '11:00',
    duration: 90
  }), {
    startTime: '15:00',
    duration: 120
  }, 'r2');
  a.deepEqual(C.labels(s, 'p1'), ['delayed', 'overrun', 'interrupted']);
});
test('single segment delayed and overrun simultaneous', () => a.deepEqual(C.labels(record(start(), {
  startTime: '09:30',
  duration: 90
}), 'p1'), ['delayed', 'overrun']));
test('single delayed but not overrun', () => a.deepEqual(C.labels(record(start(), {
  startTime: '09:30',
  duration: 30
}), 'p1'), ['delayed']));
test('early long segment overrun only', () => a.deepEqual(C.labels(record(start(), {
  startTime: '08:00',
  duration: 90
}), 'p1'), ['overrun']));
test('within plan does not mean completing source task', () => a.deepEqual(C.labels(record(start(), {
  duration: 20
}), 'p1'), ['within']));
test('future plan not prematurely not-started', () => a.deepEqual(C.labels(start(), 'p1', +new Date('2026-09-16T08:00:00')), []));
test('no record after planned end is not-started', () => a.deepEqual(C.labels(start(), 'p1', +new Date('2026-09-16T10:00:00')), ['notStarted']));
test('unplanned activity directly accepted', () => {
  const s = C.createRecord(C.empty(), null, {
    ...p,
    title: 'Conversation'
  }, 'u1');
  a.deepEqual(C.labelsForRecord(s, s.records[0]), ['unplanned']);
  a.equal(s.records[0].planId, null);
});
test('only selected segment progress changes', () => {
  let s = record(record(start()), {}, 'r2');
  s = C.updateRecord(s, 'r1', {
    progress: 'partial'
  });
  a.equal(s.records[0].progress, 'partial');
  a.equal(s.records[1].progress, 'complete');
  a.equal(s.plans.p1.progress, undefined);
});
test('invalid progress rejected', () => a.throws(() => C.updateRecord(record(start()), 'r1', {
  progress: 'banana'
})));
test('record identity cannot be edited', () => {
  const s = C.updateRecord(record(start()), 'r1', {
    id: 'changed',
    planId: 'other',
    sourceTaskId: 'other'
  });
  a.equal(s.records[0].id, 'r1');
  a.equal(s.records[0].planId, 'p1');
});
test('custom tags sanitized and deduplicated', () => {
  const r = C.updateRecord(record(start()), 'r1', {
    tags: ['#foo', 'foo', '##工作', '']
  }).records[0];
  a.deepEqual(r.tags, ['foo', '工作']);
});
test('native title tags support Unicode', () => a.deepEqual(C.tags('Test #工作 #café #x/y'), ['工作', 'café', 'x/y']));
test('moving a Do never changes plan baseline', () => {
  const s = C.updateRecord(record(start()), 'r1', {
    date: '2026-09-17',
    startTime: '15:00'
  });
  a.equal(s.plans.p1.date, p.date);
  a.equal(s.plans.p1.startTime, p.startTime);
});
test('removing Do keeps plan', () => {
  const s = C.removeRecord(record(start()), 'r1');
  a.equal(s.records.length, 0);
  a.ok(s.plans.p1);
});
test('immutable updates', () => {
  const s = record(start());
  const before = JSON.stringify(s);
  C.updateRecord(s, 'r1', {
    progress: 'started'
  });
  a.equal(JSON.stringify(s), before);
});
test('backup round trip complete data', () => {
  const s = record(start());
  s.noteHeights['task:p1'] = 160;
  a.deepEqual(C.validate(JSON.parse(JSON.stringify(s))), s);
});
test('broken baseline reference rejected on restore', () => {
  const s = record(start());
  delete s.plans.p1;
  a.throws(() => C.validate(s));
});
test('duplicate IDs rejected on restore', () => {
  const s = record(start());
  s.records.push({
    ...s.records[0]
  });
  a.throws(() => C.validate(s));
});
test('future backup schema rejected', () => a.throws(() => C.validate({
  ...start(),
  version: 99
})));
test('note height does not change record duration', () => {
  const s = record(start());
  s.noteHeights['task:p1'] = 222;
  const v = C.validate(s);
  a.equal(v.records[0].duration, 60);
});
test('note height bounds', () => {
  const s = start();
  s.noteHeights = {
    a: 5,
    b: 9000
  };
  a.deepEqual(C.validate(s).noteHeights, {
    a: 80,
    b: 1000
  });
});
test('zoom bounded during restore', () => {
  const s = start();
  s.prefs = {
    weekScale: 500,
    dayScale: 2
  };
  const v = C.validate(s);
  a.equal(v.prefs.weekScale, 4);
  a.equal(v.prefs.dayScale, 44);
});
test('carry candidate is per record not aggregate', () => {
  let s = record(record(start()), {}, 'r2');
  s = C.updateRecord(s, 'r1', {
    progress: 'partial'
  });
  const cs = C.carryCandidates(s, [p], []);
  a.equal(cs.length, 1);
  a.equal(cs[0].token, 'do:r1');
});
test('mostly completed excluded from carry', () => {
  const s = C.updateRecord(record(start()), 'r1', {
    progress: 'mostly'
  });
  a.equal(C.carryCandidates(s, [p], []).length, 0);
});
test('not-started plan is carry candidate after end', () => a.equal(C.carryCandidates(start(), [p], [], +new Date('2026-09-17')).length, 1));
test('carry copy no remote mapping or scheduled date', () => {
  const x = C.carryTask({
    task: p,
    token: 'plan:p1'
  }, 'new');
  a.equal(x.completed, false);
  a.equal(x.todoist, undefined);
  a.equal(x.date, undefined);
  a.equal(x.startTime, undefined);
  a.equal(x.joboCarrySource, 'plan:p1');
});
test('carry deduplicates inbox and scheduled copies', () => {
  const s = start(),
    now = +new Date('2026-09-17');
  a.equal(C.carryCandidates(s, [p], [{
    joboCarrySource: 'plan:p1'
  }], now).length, 0);
  a.equal(C.carryCandidates(s, [p, {
    joboCarrySource: 'plan:p1'
  }], [], now).length, 0);
});
test('adjacent normal cards keep full width', () => {
  const l = C.lanes([{
    ...p,
    duration: 30
  }, {
    ...p,
    id: '2',
    startTime: '09:30',
    duration: 30
  }], 84, 40);
  a.ok(l.every(x => x.width === 1));
});
test('overlapping rectangles allocated distinct lanes', () => {
  const l = C.lanes([p, {
    ...p,
    id: '2',
    startTime: '09:30'
  }], 84, 40);
  a.equal(l[0].width, .5);
  a.notEqual(l[0].left, l[1].left);
});
test('note heights reject unsafe keys', () => {
  const s = start();
  s.noteHeights = JSON.parse('{"__proto__":100,"safe":123}');
  a.deepEqual(C.validate(s).noteHeights, {
    safe: 123
  });
});
