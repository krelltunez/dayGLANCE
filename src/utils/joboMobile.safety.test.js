import { describe, expect, it } from 'vitest';
import * as C from './jobo.js';
import { createLedgerStore } from '../jobo/store.js';
import { mobileRecordDraft, mobileRecordSources, saveMobileRecord } from './joboMobile.js';

const date = '2026-09-16';
const task = { id: 'study', title: 'Study', date, startTime: '14:00', duration: 60, notes: 'Original note' };
const form = { date, title: 'Study', startTime: '14:10', end: '15:00', progress: 'complete', color: 'bg-blue-500', tags: '', notes: 'Original note' };
function fixture() {
  const data = new Map();
  const store = createLedgerStore({ storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } });
  saveMobileRecord(store, { source: task, form }, 'first');
  return store;
}

describe('mobile recording review safeguards', () => {
  it('rejects a stale open editor without overwriting a newer interval', () => {
    const store = fixture();
    const opened = store.get().records[0];
    store.update('first', { duration: 75 });
    const newer = store.get();
    expect(() => saveMobileRecord(store, { record: opened, source: task, form })).toThrow('conflict');
    expect(store.get()).toBe(newer);
  });
  it('also protects changes made in the same clock tick', () => {
    const store = fixture();
    const opened = store.get().records[0];
    store.commit({ ...store.get(), records: [{ ...opened, title: 'New title', updatedAt: opened.updatedAt }] });
    expect(() => saveMobileRecord(store, { record: opened, source: task, form })).toThrow('conflict');
    expect(store.get().records[0].title).toBe('New title');
  });
  it('does not mistake refreshed shared source notes for an interval conflict', () => {
    const store = fixture();
    const opened = store.get().records[0];
    const updatedTask = { ...task, notes: 'Updated in the native task editor' };
    store.syncNotes([updatedTask]);
    saveMobileRecord(store, { record: opened, source: updatedTask, form });
    expect(store.get().records[0]).toMatchObject({ notes: updatedTask.notes, notesOwn: false, duration: 50 });
  });
  it('protects independent record notes from stale writes', () => {
    const store = fixture();
    saveMobileRecord(store, { form }, 'unlinked');
    const opened = store.get().records[1];
    store.update('unlinked', { notes: 'New independent note', notesOwn: true });
    expect(() => saveMobileRecord(store, { record: opened, form })).toThrow('conflict');
    expect(store.get().records[1].notes).toBe('New independent note');
  });
  it('a repeat prefills its title but receives a fresh time interval and id', () => {
    const store = fixture();
    const first = store.get().records[0];
    const repeat = mobileRecordDraft({ source: task, seed: first, date, now: new Date(date + 'T17:00:00') });
    expect(repeat).toMatchObject({ title: 'Study', startTime: '16:00', end: '17:00' });
    saveMobileRecord(store, { source: task, form: repeat }, 'second');
    expect(store.get().records).toHaveLength(2);
    expect(store.get().records[0]).toEqual(first);
    expect(store.get().records[1].sourceTaskId).toBe(task.id);
    expect(task.startTime).toBe('14:00');
  });
  it('a repeat of an unplanned record keeps its title without fabricating a plan', () => {
    const store = fixture();
    const repeat = mobileRecordDraft({ seed: { title: 'Phone call', color: 'bg-green-500', notes: 'Context' }, date, now: new Date(date + 'T17:00:00') });
    saveMobileRecord(store, { form: repeat }, 'second');
    expect(store.get().records[1]).toMatchObject({ title: 'Phone call', planId: null, sourceTaskId: null, notesOwn: true, notes: 'Context' });
  });
  it('deduplicates source identities and excludes imported or example tasks', () => {
    expect(mobileRecordSources([task, { ...task }, null, { id: 7 }, { id: '7' }, { id: 'external', imported: true }, { id: 'example', isExample: true }])).toEqual([task, { id: 7 }]);
  });
  it('invalid input still never creates a partial record', () => {
    const store = fixture();
    const previous = store.get();
    expect(() => saveMobileRecord(store, { source: task, form: { ...form, title: ' ' } }, 'second')).toThrow('title');
    expect(store.get()).toBe(previous);
    expect(C.recordsOnDate(store.get(), date)).toHaveLength(1);
  });
});
