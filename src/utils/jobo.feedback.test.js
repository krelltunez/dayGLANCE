import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as C from './jobo.js';
const task = (id, at = '09:00', date = '2026-09-16') => ({
  id,
  title: 'Report',
  date,
  startTime: at,
  duration: 30,
  color: 'bg-blue-500'
});
const now = +new Date('2026-09-16T10:00:00');
const base = t => C.capture(C.empty(), [t]);
const rec = (s, t, id = 'r', at = {}) => C.createRecord(s, t, {
  date: t.date,
  startTime: t.startTime,
  duration: t.duration,
  ...at
}, id);
test('wholly elapsed displayed plan without Do is notStarted', () => assert.deepEqual(C.labels(base(task('p')), 'p', now, task('p')), ['notStarted']));
test('future displayed block does not inherit elapsed-baseline warning', () => assert.deepEqual(C.labels(base(task('p')), 'p', now, task('p', '11:00')), []));
test('ongoing block crossing time line is not an elapsed block', () => assert.deepEqual(C.labels(base(task('p')), 'p', now, task('p', '09:45')), []));
test('time-line boundary at displayed end is elapsed', () => assert.deepEqual(C.labels(base(task('p')), 'p', now, task('p', '09:30')), ['notStarted']));
test('tomorrow no warning even with yesterday baseline', () => assert.deepEqual(C.labels(base(task('p', '09:00', '2026-09-15')), 'p', now, task('p', '09:00', '2026-09-17')), []));
test('previous date elapsed by date not minute only', () => assert.deepEqual(C.labels(base(task('p', '23:00', '2026-09-15')), 'p', now, task('p', '23:00', '2026-09-15')), ['notStarted']));
test('elapsed moved plan gives warning despite future baseline', () => assert.deepEqual(C.labels(base(task('p', '15:00')), 'p', now, task('p', '08:30')), ['notStarted']));
test('current plan gate leaves saved comparison baseline untouched', () => {
  let s = base(task('p'));
  C.labels(s, 'p', now, task('p', '11:00'));
  assert.equal(s.plans.p.startTime, '09:00');
});
test('rescheduled future source is absent from carry-forward', () => assert.equal(C.carryCandidates(base(task('p')), [task('p', '11:00')], [], now).length, 0));
test('moved elapsed source is a carry-forward candidate', () => assert.equal(C.carryCandidates(base(task('p', '15:00')), [task('p', '08:30')], [], now).length, 1));
test('two fragments are interrupted while each keeps its completion level', () => {
  let t = task('p'),
    s = rec(base(t), t);
  s = C.updateRecord(s, 'r', {
    progress: 'partial'
  });
  s = rec(s, t, 'r2', {
    startTime: '12:00',
    duration: 60
  });
  assert.deepEqual(C.labels(s, 'p', now, t), ['delayed', 'overrun', 'interrupted']);
  assert.deepEqual(s.records.map(r => r.progress), ['partial', 'complete']);
});
test('adjacent fragments remain interrupted not merged', () => {
  let t = task('p'),
    s = rec(base(t), t);
  s = rec(s, t, 'r2', {
    startTime: '09:30'
  });
  assert.equal(s.records.length, 2);
  assert.deepEqual(C.labels(s, 'p', now), ['delayed', 'overrun', 'interrupted']);
});
test('removing second fragment recalculates timing without dropping progress', () => {
  let t = task('p'),
    s = rec(base(t), t);
  s = rec(s, t, 'r2');
  s = C.removeRecord(s, 'r2');
  assert.deepEqual(C.labels(s, 'p', now), ['within']);
  assert.equal(s.records[0].progress, 'complete');
});
test('plan tag persists separately without touching native title', () => {
  let t = task('p'),
    s = base(t);
  s = C.addTag(s, 'plan', 'p', '#等待资料');
  assert.deepEqual(s.planTags.p, ['等待资料']);
  assert.equal(t.title, 'Report');
});
test('blank tag ignored with identity preserved', () => {
  let s = C.empty();
  assert.equal(C.addTag(s, 'plan', 'p', '  # '), s);
});
test('duplicate tag does not add another badge', () => {
  let s = C.addTag(C.empty(), 'plan', 'p', '资料');
  assert.equal(C.addTag(s, 'plan', 'p', '#资料'), s);
});
test('short multiword English tags retain their internal spacing', () => assert.deepEqual(C.normalizeTags([' #follow up ']), ['follow up']));
test('record tag changes only its own Do', () => {
  let t = task('p'),
    s = rec(base(t), t);
  s = rec(s, t, 'r2');
  s = C.addTag(s, 'do', 'r', '#review');
  assert.deepEqual(s.records[0].tags, ['review']);
  assert.deepEqual(s.records[1].tags, []);
});
test('malicious plan tag key rejected', () => assert.throws(() => C.addTag(C.empty(), 'plan', '__proto__', 'x')));
test('old v3 ledger loads with empty optional fields', () => {
  let s = base(task('p'));
  delete s.planTags;
  delete s.notePresence;
  assert.deepEqual(C.validate(s).planTags, {});
  assert.deepEqual(C.validate(s).notePresence, {});
});
test('blank note has explicit persistent presence, without fake spaces', () => {
  let s = C.noteVisibility(C.empty(), 'task:p', true);
  assert.equal(s.notePresence['task:p'], true);
  assert.equal(s.records.length, 0);
  assert.deepEqual(s.plans, {});
});
test('deleted daily note has explicit absence and can reopen', () => {
  let s = C.noteVisibility(C.empty(), 'daily:2026-09-16', false);
  assert.equal(C.validate(s).notePresence['daily:2026-09-16'], false);
  s = C.noteVisibility(s, 'daily:2026-09-16', true);
  assert.equal(s.notePresence['daily:2026-09-16'], true);
});
test('note deletion does not delete a task or record', () => {
  let t = task('p'),
    s = rec(base(t), t);
  s = C.noteVisibility(s, 'task:p', false);
  assert.equal(s.records.length, 1);
  assert.ok(s.plans.p);
});
test('backup round-trip keeps plan tags and blank note visibility', () => {
  let t = task('p'),
    s = rec(base(t), t);
  s = C.addTag(s, 'plan', 'p', '#项目');
  s = C.noteVisibility(s, 'task:p', true);
  s.noteHeights['task:p'] = 300;
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(s))), s);
});
test('custom tag length and count are bounded', () => {
  assert.equal(C.normalizeTags(['x'.repeat(1000)])[0].length, 80);
  assert.equal(C.normalizeTags(Array.from({
    length: 30
  }, (_, i) => String(i))).length, 20);
});
