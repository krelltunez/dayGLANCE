import { describe, expect, it } from 'vitest';
import * as C from './jobo.js';
import { createLedgerStore, LEDGER_KEY } from '../jobo/store.js';
import { latestMobileAttempt, mobileRecordDraft, mobileRecordPatch, mobileScrollMinute, mobileTapTime, saveMobileRecord } from './joboMobile.js';

const date = '2026-09-16';
const source = Object.freeze({ id: 'task-1', title: 'English', date, startTime: '14:00', duration: 60, color: 'bg-blue-500', completed: false, notes: 'Shared note', todoist: { id: 'remote-id' } });
const draft = (extra = {}) => ({ date, title: 'English', startTime: '14:10', end: '14:50', color: 'bg-blue-500', progress: 'complete', notes: 'Shared note', tags: '#study study', ...extra });
function fixture() {
  const data = new Map();
  let fail = false, writes = 0;
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => {
    if (fail) throw new Error('QuotaExceededError');
    writes++; data.set(key, value);
  } };
  const store = createLedgerStore({ storage });
  return { store, storage, data, fail: value => { fail = value; }, writes: () => writes };
}

describe('mobile recording drafts', () => {
  it('prefills a linked attempt ending now, without changing the planned interval', () => {
    const form = mobileRecordDraft({ source, date, now: new Date(date + 'T16:20:45') });
    expect(form.startTime).toBe('15:20'); expect(form.end).toBe('16:20');
    expect(source.startTime).toBe('14:00'); expect(source.completed).toBe(false);
  });
  it('records on the previous day when a just-finished attempt crosses midnight', () => {
    const form = mobileRecordDraft({ source, date, now: new Date(date + 'T00:20:00') });
    expect(form.date).toBe('2026-09-15'); expect(form.startTime).toBe('23:20'); expect(form.end).toBe('00:20');
  });
  it('uses the selected historical date instead of silently writing today', () => {
    expect(mobileRecordDraft({ source, date: '2026-09-13', now: new Date(date + 'T16:20') })).toMatchObject({ date: '2026-09-13', startTime: '14:00', end: '15:00' });
  });
  it('uses the tapped slot, including 00:00', () => {
    expect(mobileRecordDraft({ date, initial: '00:00' })).toMatchObject({ startTime: '00:00', end: '00:30' });
  });
  it('keeps the original full interval when opening an overnight segment', () => {
    const record = { ...source, id: 'r', startTime: '23:45', duration: 45, progress: 'partial', tags: ['study'] };
    expect(mobileRecordDraft({ record, date: '2026-09-17' })).toMatchObject({ date, startTime: '23:45', end: '00:30', progress: 'partial', tags: 'study' });
  });
});

describe('mobile interval validation', () => {
  it('normalizes a valid form and de-duplicates tags', () => {
    expect(mobileRecordPatch(draft())).toMatchObject({ title: 'English', duration: 40, tags: ['study'] });
  });
  it('supports intentional overnight recordings', () => {
    expect(mobileRecordPatch(draft({ startTime: '23:50', end: '00:20' })).duration).toBe(30);
  });
  it.each([
    ['title', { title: '  ' }], ['date', { date: '2026-02-30' }],
    ['time', { startTime: '24:00' }], ['time', { startTime: '14:60' }],
    ['time', { end: 'banana' }], ['time', { end: '14:10' }],
    ['progress', { progress: 'sent-to-todoist' }],
  ])('rejects invalid %s without writing', (error, changes) => {
    const { store, writes } = fixture();
    expect(() => saveMobileRecord(store, { source, form: draft(changes) }, 'new')).toThrow(error);
    expect(writes()).toBe(0); expect(store.get().records).toHaveLength(0);
  });
});

describe('shared ledger and native-task boundaries', () => {
  it('persists a new linked attempt in a single durable write', () => {
    const { store, writes } = fixture();
    saveMobileRecord(store, { source, form: draft() }, 'r');
    expect(writes()).toBe(1);
    expect(store.get().records[0]).toMatchObject({ id: 'r', planId: source.id, sourceTaskId: source.id, duration: 40, notesOwn: false });
    expect(store.get().plans[source.id]).toMatchObject({ startTime: '14:00', duration: 60 });
    expect(store.get().records[0].todoist).toBeUndefined(); expect(source.completed).toBe(false);
  });
  it('retains first observed plan after later native rescheduling and Do edits', () => {
    const { store } = fixture(); store.capture([source]);
    const changed = { ...source, startTime: '17:00' };
    saveMobileRecord(store, { source: changed, form: draft() }, 'r');
    saveMobileRecord(store, { source: changed, record: store.get().records[0], form: draft({ end: '15:10' }) }, 'unused');
    expect(store.get().records).toHaveLength(1); expect(store.get().records[0].duration).toBe(60);
    expect(store.get().plans[source.id].startTime).toBe('14:00');
  });
  it('links all-day tasks without inventing a scheduled baseline', () => {
    const { store } = fixture(); const allDay = { ...source, isAllDay: true, startTime: undefined };
    saveMobileRecord(store, { source: allDay, form: draft() }, 'r');
    expect(store.get().records[0].planId).toBeNull();
    expect(latestMobileAttempt(store.get(), source.id).id).toBe('r');
    expect(store.get().plans).toEqual({});
  });
  it('creates an unplanned record without creating a native task', () => {
    const { store } = fixture(); saveMobileRecord(store, { form: draft({ title: 'Unexpected call' }) }, 'r');
    expect(store.get().records[0]).toMatchObject({ planId: null, sourceTaskId: null, notesOwn: true });
    expect(store.get().plans).toEqual({});
  });
  it('returns the most recently appended attempt, not the one with latest edited time', () => {
    const { store } = fixture();
    saveMobileRecord(store, { source, form: draft({ startTime: '21:00', end: '22:00' }) }, 'first');
    saveMobileRecord(store, { source, form: draft({ progress: 'partial' }) }, 'last');
    expect(latestMobileAttempt(store.get(), source.id)).toMatchObject({ id: 'last', progress: 'partial' });
  });
  it('survives reload using exactly the desktop ledger schema', () => {
    const { store, storage } = fixture(); saveMobileRecord(store, { source, form: draft() }, 'r');
    const reloaded = createLedgerStore({ storage });
    expect(reloaded.get()).toEqual(store.get()); expect(reloaded.error()).toBe('');
  });
  it('quota failure leaves no partial record or baseline, retry creates one', () => {
    const f = fixture(); f.fail(true);
    expect(() => saveMobileRecord(f.store, { source, form: draft() }, 'r')).toThrow('Quota');
    expect(f.store.get()).toEqual(C.empty()); expect(f.writes()).toBe(0);
    f.fail(false); saveMobileRecord(f.store, { source, form: draft() }, 'r');
    expect(f.store.get().records).toHaveLength(1); expect(f.writes()).toBe(1);
  });
  it('rejects saving a record removed while the editor was open', () => {
    const { store } = fixture(); saveMobileRecord(store, { source, form: draft() }, 'r');
    const record = store.get().records[0]; store.remove('r');
    expect(() => saveMobileRecord(store, { record, source, form: draft() })).toThrow('missing');
    expect(store.get().records).toHaveLength(0);
  });
  it('fails closed on stale cross-tab storage rather than overwriting another journal', () => {
    const { store, data } = fixture(); data.set(LEDGER_KEY, JSON.stringify(C.empty()));
    expect(() => saveMobileRecord(store, { source, form: draft() }, 'r')).toThrow('another tab');
    expect(store.get().records).toHaveLength(0);
  });
  it('delete and undo affect only the actual ledger', () => {
    const { store } = fixture(); saveMobileRecord(store, { source, form: draft() }, 'r');
    store.remove('r'); expect(store.get().records).toHaveLength(0);
    store.undo(); expect(store.get().records).toHaveLength(1); expect(source.completed).toBe(false);
  });
  it('projects overnight records into both days without duplicating storage', () => {
    const { store } = fixture(); saveMobileRecord(store, { source, form: draft({ startTime: '23:45', end: '00:30' }) }, 'r');
    expect(C.recordsOnDate(store.get(), date)[0].duration).toBe(15);
    expect(C.recordsOnDate(store.get(), '2026-09-17')[0]).toMatchObject({ id: 'r', startTime: '00:00', duration: 30 });
    expect(store.get().records).toHaveLength(1);
  });
});

describe('single mobile axis', () => {
  it('snaps and clamps slot positions to quarter hours', () => {
    expect(mobileTapTime(-100)).toBe('00:00'); expect(mobileTapTime(14.25 * 84)).toBe('14:15'); expect(mobileTapTime(10000)).toBe('23:45');
  });
  it('opens around earliest content and uses a historical empty-day default', () => {
    expect(mobileScrollMinute([source], date)).toBe(810);
    expect(mobileScrollMinute([], '2026-01-01', new Date(date + 'T16:00'))).toBe(510);
  });
  it('has separate overlap lanes without altering time coordinates', () => {
    const layout = C.lanes([source, { ...source, id: 'other', startTime: '14:10' }], 84, 36);
    expect(layout.every(item => item.width === 0.5)).toBe(true);
    expect(new Set(layout.map(item => item.left)).size).toBe(2);
  });
});
