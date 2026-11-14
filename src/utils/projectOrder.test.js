import { describe, it, expect } from 'vitest';
import { sortByProjectOrder, applyProjectReorder, orderProjectTasks, sortProjectsByOrder, projectReorderIds, topProjectOrder, sendToBottomIds, sortProjectInbox, draggableProjectTasks, dragReorderIds, TASK_SORT_DEADLINE } from './projectOrder.js';
import { mergeTaskArrays } from '../mergeSync.js';

const t = (id, extra = {}) => ({ id, title: id, projectId: 'p1', lastModified: '2026-09-01T00:00:00.000Z', ...extra });

describe('sortByProjectOrder', () => {
  it('orders by the field, keeps unordered tasks after in array order, and is stable on ties', () => {
    const list = [t('c'), t('a', { projectOrder: 10 }), t('d'), t('b', { projectOrder: 0 }), t('e', { projectOrder: 10 })];
    expect(sortByProjectOrder(list).map((x) => x.id)).toEqual(['b', 'a', 'e', 'c', 'd']);
  });

  it('a list with no field at all keeps its order (the pre-field behavior)', () => {
    expect(sortByProjectOrder([t('x'), t('y')]).map((x) => x.id)).toEqual(['x', 'y']);
    expect(sortByProjectOrder(null)).toEqual([]);
  });
});

describe('applyProjectReorder', () => {
  const NOW = '2026-09-08T20:00:00.000Z';
  const inbox = [t('other1', { projectId: 'p2' }), t('a'), t('b'), t('other2', { projectId: 'p2' }), t('c')];

  it('renumbers the moved group, stamps the changed rows, and moves the array positions', () => {
    const out = applyProjectReorder(inbox, ['c', 'a', 'b'], NOW);
    expect(out.map((x) => x.id)).toEqual(['other1', 'c', 'a', 'other2', 'b']);   // the group's slots, new order
    expect(out.find((x) => x.id === 'c')).toMatchObject({ projectOrder: 0, lastModified: NOW });
    expect(out.find((x) => x.id === 'a')).toMatchObject({ projectOrder: 10, lastModified: NOW });
    expect(out.find((x) => x.id === 'b')).toMatchObject({ projectOrder: 20, lastModified: NOW });
    expect(out.find((x) => x.id === 'other1')).toBe(inbox[0]);                    // untouched rows are the same objects
    expect(sortByProjectOrder(out.filter((x) => x.projectId === 'p1')).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('a drop that changes nothing is a no-op: no stamp, no push', () => {
    const first = applyProjectReorder(inbox, ['a', 'b', 'c'], NOW);
    const again = applyProjectReorder(first, ['a', 'b', 'c'], '2026-09-08T21:00:00.000Z');
    expect(again).toBe(first);
  });

  it('any change stamps the WHOLE group, not only the rows whose number moved', () => {
    const first = applyProjectReorder(inbox, ['a', 'b', 'c'], NOW);
    const later = '2026-09-08T21:00:00.000Z';
    // Swapping b and c leaves a at 0, and it is stamped anyway.
    const out = applyProjectReorder(first, ['a', 'c', 'b'], later);
    for (const id of ['a', 'b', 'c']) expect(out.find((x) => x.id === id).lastModified).toBe(later);
    expect(out.find((x) => x.id === 'other1')).toBe(first[0]);
  });

  it('ids not in the inbox are ignored; the rest still renumber', () => {
    const out = applyProjectReorder(inbox, ['ghost', 'b', 'a', 'c'], NOW);
    expect(out.find((x) => x.id === 'b').projectOrder).toBe(10);
    expect(out.find((x) => x.id === 'a').projectOrder).toBe(20);
    expect(out).toHaveLength(inbox.length);
  });
});

describe('reorders on two devices converge (the order held on one device, reshuffled on the next)', () => {
  // Each device keeps its own copy; sync keeps the newer copy of each task
  // (mergeTaskArrays, the file tier's rule, and the vault tier's per-row pick).
  const start = [t('a', { projectOrder: 0 }), t('b', { projectOrder: 10 }), t('c', { projectOrder: 20 })];
  const merge = (x, y) => mergeTaskArrays(x, y, {}).merged;
  const order = (list) => sortByProjectOrder(list).map((x) => x.id);

  it('two stale reorders resolve to the newer one as a whole, with no tied numbers', () => {
    const onX = applyProjectReorder(start, ['b', 'a', 'c'], '2026-09-08T20:00:00.000Z');   // X: b first
    const onY = applyProjectReorder(start, ['a', 'c', 'b'], '2026-09-08T21:00:00.000Z');   // Y, later, never saw X: b last
    const both = [merge(onX, onY), merge(onY, onX)];
    for (const merged of both) {
      expect(order(merged)).toEqual(['a', 'c', 'b']);
      expect(new Set(merged.map((x) => x.projectOrder)).size).toBe(3);
    }
  });

  it('completed tasks keep a number after the open ones, so un-completing one cannot collide', () => {
    const inbox = [t('a', { projectOrder: 0 }), t('done', { projectOrder: 10, completed: true }), t('b', { projectOrder: 20 })];
    const ids = projectReorderIds(['b', 'a'], inbox);
    expect(ids).toEqual(['b', 'a', 'done']);
    const out = applyProjectReorder(inbox, ids, '2026-09-08T20:00:00.000Z');
    const reopened = out.map((x) => (x.id === 'done' ? { ...x, completed: false } : x));
    expect(order(reopened)).toEqual(['b', 'a', 'done']);
  });
});

describe('orderProjectTasks', () => {
  it('lists open scheduled by date, open inbox by projectOrder, then the completed in the same groups', () => {
    const scheduled = [
      { id: 's-late', date: '2026-10-05' },
      { id: 's-done', date: '2026-09-01', completed: true },
      { id: 's-early', date: '2026-09-28' },
    ];
    const unscheduled = [
      { id: 'u-none' },
      { id: 'u-20', projectOrder: 20 },
      { id: 'u-done', projectOrder: 0, completed: true },
      { id: 'u-10', projectOrder: 10 },
    ];
    expect(orderProjectTasks(scheduled, unscheduled).map((t) => t.id))
      .toEqual(['s-early', 's-late', 'u-10', 'u-20', 'u-none', 's-done', 'u-done']);
  });

  it('tolerates missing lists and does not mutate its input', () => {
    const scheduled = [{ id: 'b', date: '2026-10-02' }, { id: 'a', date: '2026-10-01' }];
    expect(orderProjectTasks(scheduled, undefined).map((t) => t.id)).toEqual(['a', 'b']);
    expect(scheduled.map((t) => t.id)).toEqual(['b', 'a']);
    expect(orderProjectTasks(null, null)).toEqual([]);
  });
});

describe('sortProjectsByOrder', () => {
  it('orders by sortOrder with unordered projects after, in array order', () => {
    const projects = [{ id: 'x' }, { id: 'b', sortOrder: 2 }, { id: 'y' }, { id: 'a', sortOrder: 1 }];
    expect(sortProjectsByOrder(projects).map((p) => p.id)).toEqual(['a', 'b', 'x', 'y']);
  });
});

describe('topProjectOrder', () => {
  it('puts a new task above the lowest number, so it sorts first', () => {
    const inbox = [t('a', { projectOrder: 0 }), t('b', { projectOrder: 10 }), t('c')];
    const order = topProjectOrder(inbox);
    expect(order).toBe(-10);
    expect(sortByProjectOrder([...inbox, t('new', { projectOrder: order })]).map((x) => x.id)).toEqual(['new', 'a', 'b', 'c']);
  });

  it('tops a list with no numbers, and an empty one', () => {
    const inbox = [t('a'), t('b')];
    expect(sortByProjectOrder([...inbox, t('new', { projectOrder: topProjectOrder(inbox) })]).map((x) => x.id)).toEqual(['new', 'a', 'b']);
    expect(topProjectOrder([])).toBe(0);
  });
});

describe('sendToBottomIds', () => {
  it('moves the task below the other open tasks, completed ones still last', () => {
    const inbox = [t('a', { projectOrder: 10 }), t('new', { projectOrder: 0 }), t('b'), t('done', { completed: true, projectOrder: 20 })];
    const ids = sendToBottomIds(inbox, 'new');
    expect(ids).toEqual(['a', 'b', 'new', 'done']);
    expect(sortByProjectOrder(applyProjectReorder(inbox, ids, 'now')).map((x) => x.id)).toEqual(['a', 'b', 'new', 'done']);
  });

  it('does nothing for a task that is no longer open in this inbox', () => {
    expect(sendToBottomIds([t('a'), t('x', { completed: true })], 'x')).toBeNull();
    expect(sendToBottomIds([t('a')], 'gone')).toBeNull();
  });

  it('follows the id through the retired-id record (an Obsidian-linked add re-ids the task on writeback)', () => {
    const inbox = [t('obsidian-dg-x', { projectOrder: -10 }), t('a', { projectOrder: 0 }), t('b', { projectOrder: 10 })];
    const retired = { 'uuid-1': { retiredAt: '2026-09-08T20:00:00.000Z', successor: 'obsidian-dg-x' } };
    expect(sendToBottomIds(inbox, 'uuid-1')).toBeNull();
    expect(sendToBottomIds(inbox, 'uuid-1', retired)).toEqual(['a', 'b', 'obsidian-dg-x']);
    // An id the record does not name resolves to itself.
    expect(sendToBottomIds(inbox, 'a', retired)).toEqual(['obsidian-dg-x', 'b', 'a']);
  });
});

// #2394: a project can list its unscheduled tasks deadlines first. It is a
// view over projectOrder: the undated tasks keep the manual order and are
// still dragged, and turning it off shows the manual order as it was left.
describe('a project ordered by deadline', () => {
  const ids = (list) => list.map((x) => x.id);
  // Manual order: a, b, c, d, e, f. b, d and e have deadlines; f is done.
  const inbox = () => [
    t('c', { projectOrder: 20 }),
    t('a', { projectOrder: 0 }),
    t('e', { projectOrder: 40, deadline: '2026-11-15' }),
    t('b', { projectOrder: 10, deadline: '2027-01-10' }),
    t('d', { projectOrder: 30, deadline: '2026-11-15' }),
    t('f', { projectOrder: 50, completed: true }),
  ];

  describe('sortProjectInbox', () => {
    it('without the setting, and with any other value, is the manual order', () => {
      expect(ids(sortProjectInbox(inbox()))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
      expect(ids(sortProjectInbox(inbox(), 'title'))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });

    it('puts dated tasks first, soonest first, two on one date in manual order; then the undated in manual order', () => {
      expect(ids(sortProjectInbox(inbox(), TASK_SORT_DEADLINE))).toEqual(['d', 'e', 'b', 'a', 'c', 'f']);
    });

    it('an empty deadline is no deadline, and the input is not mutated', () => {
      const list = [t('x', { projectOrder: 0, deadline: '' }), t('y', { projectOrder: 10, deadline: '2026-12-01' }), t('z', { projectOrder: 20, deadline: null })];
      const before = ids(list);
      expect(ids(sortProjectInbox(list, TASK_SORT_DEADLINE))).toEqual(['y', 'x', 'z']);
      expect(ids(list)).toEqual(before);
      expect(sortProjectInbox(null, TASK_SORT_DEADLINE)).toEqual([]);
    });
  });

  describe('orderProjectTasks', () => {
    it('applies the project order to the unscheduled group only: scheduled still lead by date, completed still trail', () => {
      const scheduled = [{ id: 's2', date: '2026-12-02' }, { id: 's1', date: '2026-12-01' }];
      expect(ids(orderProjectTasks(scheduled, inbox(), TASK_SORT_DEADLINE))).toEqual(['s1', 's2', 'd', 'e', 'b', 'a', 'c', 'f']);
      expect(ids(orderProjectTasks(scheduled, inbox()))).toEqual(['s1', 's2', 'a', 'b', 'c', 'd', 'e', 'f']);
    });
  });

  describe('draggableProjectTasks', () => {
    it('manual: every open task; by deadline: the undated open ones, in manual order', () => {
      expect(ids(draggableProjectTasks(inbox()))).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(ids(draggableProjectTasks(inbox(), TASK_SORT_DEADLINE))).toEqual(['a', 'c']);
      expect(draggableProjectTasks(null, TASK_SORT_DEADLINE)).toEqual([]);
    });
  });

  describe('dragReorderIds', () => {
    it('manual: the dragged order, completed after, as before', () => {
      expect(dragReorderIds(inbox(), undefined, 0, 2)).toEqual(['b', 'c', 'a', 'd', 'e', 'f']);
    });

    it('by deadline: the undated tasks swap among the manual places they hold; the dated ones do not move', () => {
      // Draggable: a, c. Dragging c above a.
      expect(dragReorderIds(inbox(), TASK_SORT_DEADLINE, 1, 0)).toEqual(['c', 'b', 'a', 'd', 'e', 'f']);
    });

    it('an index that is not a draggable task is no reorder', () => {
      expect(dragReorderIds(inbox(), TASK_SORT_DEADLINE, 0, 2)).toBeNull();
      expect(dragReorderIds(inbox(), TASK_SORT_DEADLINE, 5, 0)).toBeNull();
      expect(dragReorderIds([], undefined, 0, 1)).toBeNull();
    });

    it('a drag under the deadline order shows at once, and the manual order underneath keeps the dated tasks where they were', () => {
      const NOW = '2026-11-14T10:00:00.000Z';
      const after = applyProjectReorder(inbox(), dragReorderIds(inbox(), TASK_SORT_DEADLINE, 1, 0), NOW);
      expect(ids(sortProjectInbox(after, TASK_SORT_DEADLINE))).toEqual(['d', 'e', 'b', 'c', 'a', 'f']);
      // Turned off again: b, d and e sit exactly where the manual order had them.
      expect(ids(sortProjectInbox(after))).toEqual(['c', 'b', 'a', 'd', 'e', 'f']);
    });

    it('a deadline given and then cleared returns the task to its manual place', () => {
      const withDeadline = inbox().map((x) => (x.id === 'a' ? { ...x, deadline: '2026-11-01' } : x));
      expect(ids(sortProjectInbox(withDeadline, TASK_SORT_DEADLINE))).toEqual(['a', 'd', 'e', 'b', 'c', 'f']);
      const cleared = withDeadline.map((x) => (x.id === 'a' ? { ...x, deadline: undefined } : x));
      expect(ids(sortProjectInbox(cleared, TASK_SORT_DEADLINE))).toEqual(['d', 'e', 'b', 'a', 'c', 'f']);
    });
  });
});
