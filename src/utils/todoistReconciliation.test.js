import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { applyPlannedList } from './todoistReconciliation.js';

const row = (id, title = 'Original') => ({ id, title });
describe('applyPlannedList', () => {
  it('returns the planned array when the state has not moved', () => {
    const snapshot = [row('a')];
    const planned = [row('a', 'Remote')];
    assert.equal(applyPlannedList(snapshot, snapshot, planned), planned);
  });
  it('applies planned updates while preserving concurrent additions', () => {
    const a = row('a'); const added = row('new'); const remote = row('a', 'Remote');
    assert.deepEqual(applyPlannedList([a, added], [a], [remote]), [remote, added]);
  });
  it('preserves a concurrent edit instead of overwriting it', () => {
    const a = row('a'); const edited = row('a', 'Local edit');
    assert.deepEqual(applyPlannedList([edited], [a], [row('a', 'Remote')]), [edited]);
  });
  it('does not resurrect a task deleted while the request was in flight', () => {
    const a = row('a');
    assert.deepEqual(applyPlannedList([], [a], [row('a', 'Remote')]), []);
  });
  it('keeps concurrent edits when a planned list would remove that row', () => {
    const a = row('a'); const edited = row('a', 'Local edit');
    assert.deepEqual(applyPlannedList([edited], [a], []), [edited]);
  });
  it('removes untouched rows that are absent from the planned bucket', () => {
    const a = row('a');
    assert.deepEqual(applyPlannedList([a], [a], []), []);
  });
  it('adds a genuinely new row once without duplicating a concurrent copy', () => {
    const existing = row('new', 'Local');
    const planned = [row('new', 'Remote'), row('other')];
    assert.deepEqual(applyPlannedList([existing], [], planned), [existing, planned[1]]);
  });
  it('compares numeric and string task IDs consistently', () => {
    const original = row(1); const edited = row('1', 'Local');
    assert.deepEqual(applyPlannedList([edited], [original], [row('1', 'Remote')]), [edited]);
  });
  it('does not mutate any input arrays or task objects', () => {
    const a = Object.freeze(row('a'));
    const current = Object.freeze([a, Object.freeze(row('new'))]);
    const snapshot = Object.freeze([a]);
    const planned = Object.freeze([Object.freeze(row('a', 'Remote'))]);
    const result = applyPlannedList(current, snapshot, planned);
    assert.equal(result[0], planned[0]);
    assert.equal(result[1], current[1]);
  });
});
