import { describe, it, expect } from 'vitest';
import { dropResurrectedTasks } from './dropResurrectedTasks.js';

const task = (id, lastModified) => ({ id, title: id, lastModified });

describe('dropResurrectedTasks', () => {
  it('keeps a task with no tombstone', () => {
    const out = dropResurrectedTasks([task('a', '2026-07-01T00:00:00Z')], {});
    expect(out.map((t) => t.id)).toEqual(['a']);
  });

  it('DROPS a task whose deletion is newer than the task (the resurrection fix)', () => {
    // The exact incident: task lingers in state with an old lastModified, but its
    // tombstone is newer → the deletion is the latest word → do not push it.
    const tasks = [task('dead', '2026-05-01T00:00:00Z')];
    const deleted = { dead: '2026-06-26T04:46:50.527Z' };
    expect(dropResurrectedTasks(tasks, deleted)).toEqual([]);
  });

  it('KEEPS a restored task whose lastModified is newer than the tombstone', () => {
    // User un-deleted it after the tombstone → it must sync normally.
    const tasks = [task('restored', '2026-07-05T00:00:00Z')];
    const deleted = { restored: '2026-06-01T00:00:00Z' };
    expect(dropResurrectedTasks(tasks, deleted).map((t) => t.id)).toEqual(['restored']);
  });

  it('keeps a task tombstoned at the SAME instant (tie → not older → kept)', () => {
    const ts = '2026-06-10T00:00:00.000Z';
    expect(dropResurrectedTasks([task('t', ts)], { t: ts }).map((x) => x.id)).toEqual(['t']);
  });

  it('mixes correctly: drops the dead one, keeps the live and the restored', () => {
    const tasks = [
      task('live', '2026-07-01T00:00:00Z'),           // no tombstone
      task('dead', '2026-05-01T00:00:00Z'),           // tombstone newer → drop
      task('restored', '2026-07-08T00:00:00Z'),       // tombstone older → keep
    ];
    const deleted = { dead: '2026-06-26T00:00:00Z', restored: '2026-06-01T00:00:00Z' };
    expect(dropResurrectedTasks(tasks, deleted).map((t) => t.id)).toEqual(['live', 'restored']);
  });

  it('keeps a task with an unparseable tombstone (fail-safe — never drop on bad data)', () => {
    expect(dropResurrectedTasks([task('t', '2026-05-01T00:00:00Z')], { t: 'not-a-date' }).map((x) => x.id)).toEqual(['t']);
  });

  it('treats a task with no lastModified as epoch → dropped if tombstoned', () => {
    expect(dropResurrectedTasks([{ id: 'x' }], { x: '2026-01-01T00:00:00Z' })).toEqual([]);
  });

  it('tolerates empty / null inputs', () => {
    expect(dropResurrectedTasks(null, {})).toEqual([]);
    expect(dropResurrectedTasks([], null)).toEqual([]);
    expect(dropResurrectedTasks([task('a', '2026-07-01T00:00:00Z')], null).map((t) => t.id)).toEqual(['a']);
  });
});
