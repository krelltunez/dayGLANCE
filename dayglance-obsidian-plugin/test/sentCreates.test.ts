// The waiting list (src/sentCreates.ts): what this copy sent and no app has
// picked up. Added on send, dropped once its row is gone, counted as
// waiting after an hour, checked a few at a time with a backoff by age.
import { describe, it, expect, vi } from 'vitest';
import {
  SentCreates, addSentCreate, dueForCheck, pruneSentCreates, waitingCount, waitingLine, checkIntervalMs,
  WAITING_AFTER_MS, SENT_CREATE_MAX_AGE_MS, CHECKS_PER_TICK, SENT_CREATES_CAP,
  type SentCreatesState, type SentCreate,
} from '../src/sentCreates';
import type { DeviceLocalStore } from '../src/localState';

const T0 = Date.parse('2026-11-06T12:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KEY = 'acc-1|gen-1';
const memoryStore = (): DeviceLocalStore<SentCreatesState> & { value: SentCreatesState | null } => {
  const s = { available: true, value: null as SentCreatesState | null, load: () => s.value, save: (v: SentCreatesState | null) => { s.value = v ? JSON.parse(JSON.stringify(v)) : null; } };
  return s;
};
const entry = (actionId: string, sentAt: number, checkedAt = sentAt): SentCreate => ({ actionId, title: `Task ${actionId}`, sentAt, checkedAt });

describe('the waiting list', () => {
  it('ADD: a send is remembered once per actionId, in the device-local store, and survives a reload', () => {
    const store = memoryStore();
    const list = new SentCreates(store);
    list.record(KEY, { actionId: 'a1', title: 'Call the plumber [[Note]]', sentAt: T0 });
    list.record(KEY, { actionId: 'a1', title: 'Call the plumber [[Note]]', sentAt: T0 });
    expect(list.entries(KEY)).toEqual([{ actionId: 'a1', title: 'Call the plumber [[Note]]', sentAt: T0, checkedAt: T0 }]);
    expect(new SentCreates(store).entries(KEY)).toHaveLength(1);
    // Another pairing (a re-pair, another account) starts empty.
    expect(new SentCreates(store).entries('acc-1|gen-2')).toEqual([]);
  });

  it('THE HOUR: an entry counts as waiting from exactly one hour after it was sent', () => {
    const store = memoryStore();
    const list = new SentCreates(store);
    list.record(KEY, { actionId: 'a1', title: 't', sentAt: T0 });
    expect(list.waiting(KEY, T0 + WAITING_AFTER_MS - 1)).toBe(0);
    expect(list.waiting(KEY, T0 + WAITING_AFTER_MS)).toBe(1);
    expect(WAITING_AFTER_MS).toBe(HOUR);
    expect(waitingLine(0)).toBe(null);
    expect(waitingLine(1)).toBe('1 task waiting for dayGLANCE. Open or update dayGLANCE on one of your devices to bring it in.');
    expect(waitingLine(3)).toMatch(/^3 tasks waiting for dayGLANCE\. .*bring them in\.$/);
  });

  it('DROP ON CONSUME: a gone row drops its entry; a present one stays, checked now', async () => {
    const store = memoryStore();
    const list = new SentCreates(store);
    list.record(KEY, { actionId: 'gone', title: 't', sentAt: T0 });
    list.record(KEY, { actionId: 'here', title: 't', sentAt: T0 });
    const now = T0 + HOUR;
    const changed = await list.checkSome(KEY, async (id) => (id === 'gone' ? 'gone' : 'present'), now);
    expect(changed).toBe(true);
    expect(list.entries(KEY).map((e) => [e.actionId, e.checkedAt])).toEqual([['here', now]]);
    expect(store.value?.entries.map((e) => e.actionId)).toEqual(['here']);
    expect(list.waiting(KEY, now)).toBe(1);
  });

  it('a read that throws (offline, braked) ends the tick: nothing is dropped, the rest wait', async () => {
    const list = new SentCreates(memoryStore());
    for (const id of ['a', 'b', 'c']) list.record(KEY, { actionId: id, title: 't', sentAt: T0 });
    const read = vi.fn(async () => { throw new Error('offline'); });
    expect(await list.checkSome(KEY, read, T0 + HOUR)).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(list.entries(KEY)).toHaveLength(3);
  });

  it('THE BOUND: at most CHECKS_PER_TICK reads a tick, the longest-unchecked first', async () => {
    const list = new SentCreates(memoryStore());
    for (let i = 0; i < 10; i++) list.record(KEY, { actionId: `a${i}`, title: 't', sentAt: T0 + i * 1000 });
    const read = vi.fn(async () => 'present' as const);
    await list.checkSome(KEY, read, T0 + HOUR);
    expect(read).toHaveBeenCalledTimes(CHECKS_PER_TICK);
    expect(read.mock.calls.map((c) => c[0])).toEqual(['a0', 'a1', 'a2']);
    // The next tick moves on to the ones not yet checked.
    read.mockClear();
    await list.checkSome(KEY, read, T0 + HOUR + 30_000);
    expect(read.mock.calls.map((c) => c[0])).toEqual(['a3', 'a4', 'a5']);
  });

  it('THE BACKOFF: young entries every few minutes, day-old ones hourly, week-old ones a few times a day', () => {
    expect(checkIntervalMs(10 * MIN)).toBe(5 * MIN);
    expect(checkIntervalMs(2 * DAY)).toBe(HOUR);
    expect(checkIntervalMs(10 * DAY)).toBe(6 * HOUR);
    const now = T0 + 2 * DAY;
    const old = entry('old', T0, now - 30 * MIN);
    expect(dueForCheck([old], now)).toEqual([]);
    expect(dueForCheck([old], now + 30 * MIN).map((e) => e.actionId)).toEqual(['old']);
    const young = entry('young', now - 10 * MIN, now - 5 * MIN);
    expect(dueForCheck([young], now).map((e) => e.actionId)).toEqual(['young']);
  });

  it('entries past the app\'s 60-day cutoff are dropped unread, and the list is capped', async () => {
    const list = new SentCreates(memoryStore());
    list.record(KEY, { actionId: 'ancient', title: 't', sentAt: T0 - SENT_CREATE_MAX_AGE_MS - 1 });
    list.record(KEY, { actionId: 'recent', title: 't', sentAt: T0 - DAY });
    const read = vi.fn(async () => 'present' as const);
    await list.checkSome(KEY, read, T0);
    expect(list.entries(KEY).map((e) => e.actionId)).toEqual(['recent']);
    expect(read.mock.calls.map((c) => c[0])).not.toContain('ancient');
    expect(pruneSentCreates([entry('x', T0 - SENT_CREATE_MAX_AGE_MS)], T0)).toHaveLength(1);
    let many: SentCreate[] = [];
    for (let i = 0; i < SENT_CREATES_CAP + 5; i++) many = addSentCreate(many, entry(`m${i}`, T0 + i));
    expect(many).toHaveLength(SENT_CREATES_CAP);
    expect(many[0].actionId).toBe('m5');
    expect(waitingCount(many, T0 + HOUR + SENT_CREATES_CAP + 5)).toBe(SENT_CREATES_CAP);
  });
});
