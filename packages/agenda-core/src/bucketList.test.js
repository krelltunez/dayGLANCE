import { describe, it, expect } from 'vitest';
import {
  BUCKET_LIST_IDS,
  DEFAULT_BUCKET_CONFIG,
  isBucketTask,
  notBucketed,
  demoteToBucket,
  promoteToInbox,
  stripBucketId,
  normalizeBucketConfig,
} from './bucketList.js';

describe('predicates', () => {
  it('isBucketTask / notBucketed split on bucketId', () => {
    expect(isBucketTask({ bucketId: 'b1' })).toBe(true);
    expect(isBucketTask({ bucketId: 'b2' })).toBe(true);
    expect(isBucketTask({})).toBe(false);
    expect(isBucketTask(null)).toBe(false);
    expect(notBucketed({ bucketId: 'b1' })).toBe(false);
    expect(notBucketed({ title: 'x' })).toBe(true);
  });
});

describe('demoteToBucket', () => {
  const inboxTask = {
    id: 't1', title: 'Learn woodworking', duration: 30,
    priority: 3, deadline: '2026-01-01', notes: 'someday', subtasks: [],
  };

  it('strips deadline and priority and lands in the first list by default', () => {
    const bucketed = demoteToBucket(inboxTask);
    expect(bucketed.bucketId).toBe('b1');
    expect(bucketed).not.toHaveProperty('deadline');
    expect(bucketed).not.toHaveProperty('priority');
    expect(bucketed.title).toBe('Learn woodworking');
    expect(bucketed.notes).toBe('someday');
    expect(bucketed.lastModified).toBeTruthy();
  });

  it('accepts an explicit target list and rejects unknown ids', () => {
    expect(demoteToBucket(inboxTask, 'b2').bucketId).toBe('b2');
    expect(demoteToBucket(inboxTask, 'b9').bucketId).toBe('b1');
  });

  it('does not mutate the original', () => {
    demoteToBucket(inboxTask);
    expect(inboxTask.priority).toBe(3);
    expect(inboxTask.deadline).toBe('2026-01-01');
  });
});

describe('promoteToInbox', () => {
  it('drops bucketId and starts fresh (priority 0, no deadline)', () => {
    const promoted = promoteToInbox({ id: 't2', title: 'x', bucketId: 'b2' });
    expect(promoted).not.toHaveProperty('bucketId');
    expect(promoted.priority).toBe(0);
    expect(promoted).not.toHaveProperty('deadline');
    expect(promoted.lastModified).toBeTruthy();
  });

  it('clears stale deadline/priority from older clients', () => {
    const promoted = promoteToInbox({ id: 't3', title: 'x', bucketId: 'b1', deadline: '2020-01-01', priority: 2 });
    expect(promoted).not.toHaveProperty('deadline');
    expect(promoted.priority).toBe(0);
  });
});

describe('stripBucketId', () => {
  it('removes only bucketId', () => {
    const out = stripBucketId({ id: 't4', bucketId: 'b1', title: 'x', duration: 45 });
    expect(out).toEqual({ id: 't4', title: 'x', duration: 45 });
  });
});

describe('normalizeBucketConfig', () => {
  it('returns defaults for missing/garbage input', () => {
    expect(normalizeBucketConfig(null)).toEqual(DEFAULT_BUCKET_CONFIG);
    expect(normalizeBucketConfig('nope')).toEqual(DEFAULT_BUCKET_CONFIG);
  });

  it('keeps valid values and fills gaps', () => {
    const cfg = normalizeBucketConfig({ headings: { b1: 'Dreams' }, secondListHidden: true });
    expect(cfg.headings.b1).toBe('Dreams');
    expect(cfg.headings.b2).toBe('Someday');
    expect(cfg.secondListHidden).toBe(true);
    expect(cfg.notes).toBe('');
  });

  it('rejects blank headings', () => {
    expect(normalizeBucketConfig({ headings: { b1: '   ' } }).headings.b1).toBe('Anytime');
  });

  it('preserves updatedAt for sync merges', () => {
    expect(normalizeBucketConfig({ updatedAt: '2026-01-01T00:00:00Z' }).updatedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('there are exactly two lists', () => {
    expect(BUCKET_LIST_IDS).toHaveLength(2);
  });
});
