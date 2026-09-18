import { describe, it, expect } from 'vitest';
import { createLedgerStore, LEDGER_KEY } from './store.js';
import * as C from '../utils/jobo.js';
function load(raw) {
  const map = new Map(raw === undefined ? [] : [[LEDGER_KEY, raw]]),
    events = new Map();
  let fail = false;
  const storage = {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw Error('quota');
      map.set(key, value);
    }
  };
  const target = {
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name)
  };
  return {
    S: createLedgerStore({
      storage,
      target,
      uuid: () => 'generated'
    }),
    map,
    events,
    quota: value => {
      fail = value;
    }
  };
}
const plan = {
  id: 'p',
  title: 'Report',
  date: '2026-09-16',
  startTime: '09:00',
  duration: 30
};
describe('Jobo local persistence', () => {
  it('reads lazily, without a write on store construction', () => {
    const {
      map,
      S
    } = load();
    expect(map.size).toBe(0);
    expect(S.get().records).toEqual([]);
  });
  it('persists before notifying subscribers', () => {
    const {
      map,
      S
    } = load();
    let present = false;
    S.subscribe(() => {
      present = JSON.parse(map.get(LEDGER_KEY)).records[0].id === 'a';
    });
    S.create(plan, plan, 'a');
    expect(present).toBe(true);
  });
  it('does not acknowledge a quota failure', () => {
    const {
      S,
      quota
    } = load();
    quota(true);
    expect(() => S.create(plan, plan, 'a')).toThrow('quota');
    expect(S.get().records).toHaveLength(0);
  });
  it('restores state on reload', () => {
    const {
      S,
      map
    } = load();
    S.create(plan, plan, 'a');
    expect(load(map.get(LEDGER_KEY)).S.get().records[0].id).toBe('a');
  });
  it('does not overwrite a corrupt ledger', () => {
    const {
      S,
      map
    } = load('broken');
    expect(() => S.create(plan, plan, 'a')).toThrow();
    expect(map.get(LEDGER_KEY)).toBe('broken');
  });
  it('permits an explicit validated recovery', () => {
    const {
      S
    } = load('broken');
    S.restore(C.empty());
    S.create(plan, plan, 'a');
    expect(S.get().records).toHaveLength(1);
  });
  it('undo preserves a failed write opportunity', () => {
    const {
      S,
      quota
    } = load();
    S.create(plan, plan, 'a');
    quota(true);
    expect(() => S.undo()).toThrow();
    expect(S.get().records).toHaveLength(1);
    quota(false);
    S.undo();
    expect(S.get().records).toHaveLength(0);
  });
  it('rejects a stale-tab edit and accepts a storage event without echo write', () => {
    const {
      S,
      map,
      events
    } = load();
    const remote = C.createRecord(C.empty(), plan, plan, 'remote');
    map.set(LEDGER_KEY, JSON.stringify(remote));
    expect(() => S.create(plan, plan, 'local')).toThrow('another tab');
    events.get('storage')({
      key: LEDGER_KEY
    });
    expect(S.get().records[0].id).toBe('remote');
    S.create(plan, plan, 'local');
    expect(S.get().records).toHaveLength(2);
  });
  it('handles clear from another tab', () => {
    const {
      S,
      map,
      events
    } = load();
    S.create(plan, plan, 'a');
    map.clear();
    events.get('storage')({
      key: null
    });
    expect(S.get().records).toHaveLength(0);
  });
  it('a corrupt remote event makes writes fail closed', () => {
    const {
      S,
      map,
      events
    } = load();
    map.set(LEDGER_KEY, 'broken');
    events.get('storage')({
      key: LEDGER_KEY
    });
    expect(() => S.create(plan, plan, 'a')).toThrow();
  });
  it('ignores unrelated storage events', () => {
    const {
      S,
      events
    } = load();
    events.get('storage')({
      key: 'other'
    });
    expect(S.error()).toBe('');
  });
  it('note height changes do not change elapsed time', () => {
    const {
      S
    } = load();
    S.create(plan, plan, 'a');
    S.height('task:p', 250);
    expect(S.get().records[0].duration).toBe(30);
    expect(S.get().noteHeights['task:p']).toBe(250);
  });
  it('partial progress arms a fresh checkbox interval without changing the source task', () => {
    const {
      S
    } = load();
    S.checkNow(plan, new Date('2026-09-16T12:00'), 'a');
    S.update('a', {
      progress: 'partial'
    });
    S.checkNow(plan, new Date('2026-09-16T13:00'), 'b');
    expect(S.get().records.map(r => r.startTime)).toEqual(['11:30', '12:30']);
    expect(plan.completed).toBeUndefined();
  });
  it('disposes the browser listener', () => {
    const {
      S,
      events
    } = load();
    S.dispose();
    expect(events.size).toBe(0);
  });
});
