import { describe, it, expect } from 'vitest';
import { filterFrameScheduleTasks } from './frameScheduleTasks.js';

const DATE = '2026-07-10';

const task = (id, overrides = {}) => ({ id, title: `Task ${id}`, ...overrides });
const ids = (list) => list.map(t => t.id);

describe('filterFrameScheduleTasks', () => {
  describe('base rules (pre-existing behavior preserved)', () => {
    it('excludes completed and example tasks', () => {
      const tasks = [
        task('a'),
        task('b', { completed: true }),
        task('c', { isExample: true }),
      ];
      expect(ids(filterFrameScheduleTasks(tasks, { dateStr: DATE }))).toEqual(['a']);
    });

    it('keeps tasks with no deadline or a deadline on the frame date, drops others', () => {
      const tasks = [
        task('none'),
        task('today', { deadline: DATE }),
        task('other', { deadline: '2026-07-11' }),
      ];
      expect(ids(filterFrameScheduleTasks(tasks, { dateStr: DATE }))).toEqual(['today', 'none']);
    });

    it('sorts deadline tasks first, then by priority descending', () => {
      const tasks = [
        task('p1', { priority: 1 }),
        task('p2', { priority: 2 }),
        task('d0', { deadline: DATE }),
        task('d2', { deadline: DATE, priority: 2 }),
        task('p0'),
      ];
      expect(ids(filterFrameScheduleTasks(tasks, { dateStr: DATE }))).toEqual(['d2', 'd0', 'p2', 'p1', 'p0']);
    });

    it('tolerates null input', () => {
      expect(filterFrameScheduleTasks(null, { dateStr: DATE })).toEqual([]);
    });
  });

  describe('user visibility', () => {
    // Mirrors App.jsx isVisibleForUser: multi-user on, me = 'u1'
    const isVisibleForUser = (t) => {
      const assigned = t.assignedUserSyncIds ?? [];
      return assigned.length === 0 || assigned.includes('u1');
    };

    it('always applies isVisibleForUser: hides tasks assigned only to others', () => {
      const tasks = [
        task('mine', { assignedUserSyncIds: ['u1'] }),
        task('theirs', { assignedUserSyncIds: ['u2'] }),
        task('shared', { assignedUserSyncIds: ['u1', 'u2'] }),
      ];
      expect(ids(filterFrameScheduleTasks(tasks, { dateStr: DATE, isVisibleForUser })))
        .toEqual(['mine', 'shared']);
    });

    it('keeps unassigned tasks visible in multi-user mode', () => {
      const tasks = [task('unassigned'), task('theirs', { assignedUserSyncIds: ['u2'] })];
      expect(ids(filterFrameScheduleTasks(tasks, { dateStr: DATE, isVisibleForUser })))
        .toEqual(['unassigned']);
    });

    it('shows everything when visibility is not constrained (multi-user off)', () => {
      const tasks = [task('a', { assignedUserSyncIds: ['u2'] }), task('b')];
      expect(ids(filterFrameScheduleTasks(tasks, { dateStr: DATE }))).toEqual(['a', 'b']);
    });
  });

  describe('inbox filters', () => {
    const tasks = [
      task('work', { title: 'Ship it #work' }),
      task('home', { title: 'Laundry #home' }),
      task('plain', { title: 'No tags here' }),
      task('proj', { title: 'Project task', projectId: 'p1' }),
    ];

    it('applies the inbox tag filter when active (same any-match rule as the inbox list)', () => {
      const out = filterFrameScheduleTasks(tasks, {
        dateStr: DATE, applyInboxFilters: true, inboxTagFilter: ['work'],
      });
      expect(ids(out)).toEqual(['work']);
    });

    it('applies the inbox project filter when active (task must belong to a selected project)', () => {
      const out = filterFrameScheduleTasks(tasks, {
        dateStr: DATE, applyInboxFilters: true, inboxProjectFilter: ['p1'],
      });
      expect(ids(out)).toEqual(['proj']);
    });

    it('ignores inbox filters when applyInboxFilters is false (chip dismissed)', () => {
      const out = filterFrameScheduleTasks(tasks, {
        dateStr: DATE, applyInboxFilters: false, inboxTagFilter: ['work'], inboxProjectFilter: ['p1'],
      });
      expect(ids(out)).toEqual(['work', 'home', 'plain', 'proj']);
    });

    it('empty inbox filters do not restrict the list even when applied', () => {
      const out = filterFrameScheduleTasks(tasks, { dateStr: DATE, applyInboxFilters: true });
      expect(ids(out)).toEqual(['work', 'home', 'plain', 'proj']);
    });
  });

  describe('frame tag affinity', () => {
    const tasks = [
      task('deep', { title: 'Write spec #deep' }),
      task('both', { title: 'Review #deep #admin' }),
      task('admin', { title: 'Expenses #admin' }),
      task('plain', { title: 'Untagged task' }),
    ];

    it('affinityOnly keeps only tasks whose tags match the frame affinity', () => {
      const out = filterFrameScheduleTasks(tasks, {
        dateStr: DATE, tagAffinity: ['deep'], affinityOnly: true,
      });
      expect(ids(out)).toEqual(['deep', 'both']);
    });

    it('matches any affinity tag (exact-tag any-match, like auto-fill)', () => {
      const out = filterFrameScheduleTasks(tasks, {
        dateStr: DATE, tagAffinity: ['deep', 'admin'], affinityOnly: true,
      });
      expect(ids(out)).toEqual(['deep', 'both', 'admin']);
    });

    it('affinity matching is case-insensitive on task titles (tags are extracted lowercased)', () => {
      const out = filterFrameScheduleTasks([task('caps', { title: 'Focus #Deep' })], {
        dateStr: DATE, tagAffinity: ['deep'], affinityOnly: true,
      });
      expect(ids(out)).toEqual(['caps']);
    });

    it('toggle off ("All tasks") shows everything regardless of affinity', () => {
      const out = filterFrameScheduleTasks(tasks, {
        dateStr: DATE, tagAffinity: ['deep'], affinityOnly: false,
      });
      expect(ids(out)).toEqual(['deep', 'both', 'admin', 'plain']);
    });

    it('affinityOnly with an empty affinity is a no-op', () => {
      const out = filterFrameScheduleTasks(tasks, {
        dateStr: DATE, tagAffinity: [], affinityOnly: true,
      });
      expect(ids(out)).toEqual(['deep', 'both', 'admin', 'plain']);
    });
  });

  it('composes all filters: visibility, inbox filters, affinity, deadline, sort', () => {
    const isVisibleForUser = (t) => {
      const assigned = t.assignedUserSyncIds ?? [];
      return assigned.length === 0 || assigned.includes('u1');
    };
    const tasks = [
      task('keep-deadline', { title: 'A #work', deadline: DATE, priority: 1 }),
      task('keep-priority', { title: 'B #work', priority: 2 }),
      task('keep-low', { title: 'C #work' }),
      task('wrong-user', { title: 'D #work', assignedUserSyncIds: ['u2'] }),
      task('wrong-tag', { title: 'E #home' }),
      task('no-affinity', { title: 'F #work #other' }),
      task('wrong-deadline', { title: 'G #work', deadline: '2026-08-01' }),
      task('done', { title: 'H #work', completed: true }),
    ];
    const out = filterFrameScheduleTasks(tasks, {
      dateStr: DATE,
      isVisibleForUser,
      applyInboxFilters: true,
      inboxTagFilter: ['work', 'home'],
      tagAffinity: ['work'],
      affinityOnly: true,
    });
    expect(ids(out)).toEqual(['keep-deadline', 'keep-priority', 'keep-low', 'no-affinity']);
  });
});
