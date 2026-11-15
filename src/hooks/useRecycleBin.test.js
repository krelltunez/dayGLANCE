import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Render-free: useState hands back a value and a spy setter; an effect runs
// at once, as the first commit would run it.
vi.mock('react', () => ({ useState: (init) => [init, vi.fn()], useEffect: (fn) => { fn(); } }));

const { default: useRecycleBin } = await import('./useRecycleBin.js');
const { resetWriteFailures, getWriteFailures } = await import('../utils/storageWrites.js');

const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });

describe('confirmEmptyBin when storage is full (#2139)', () => {
  let store;
  let deps;
  beforeEach(() => {
    resetWriteFailures();
    store = { 'day-planner-deleted-task-ids': '{}' };
    globalThis.localStorage = {
      getItem: vi.fn((k) => store[k] ?? null),
      setItem: vi.fn((k, v) => { store[k] = v; }),
    };
    globalThis.window = {};
    vi.spyOn(console, 'error').mockImplementation(() => {});
    deps = {
      recycleBin: [{ id: 'b1' }, { id: 'b2' }],
      setRecycleBin: vi.fn(),
      pushUndo: vi.fn(),
      setTasks: vi.fn(),
      setUnscheduledTasks: vi.fn(),
      playUISound: vi.fn(),
      onStorageFull: vi.fn(),
    };
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; vi.restoreAllMocks(); });

  it('empties the bin after writing its tombstones', () => {
    useRecycleBin(deps).confirmEmptyBin();
    expect(Object.keys(JSON.parse(store['day-planner-deleted-task-ids']))).toEqual(['b1', 'b2']);
    expect(deps.setRecycleBin).toHaveBeenCalledWith([]);
    expect(deps.pushUndo).toHaveBeenCalledWith({ key: 'binEmptied' });
  });

  it('stops before deleting anything when the tombstones cannot be written', () => {
    globalThis.localStorage.setItem = vi.fn(() => { throw quota(); });
    expect(() => useRecycleBin(deps).confirmEmptyBin()).not.toThrow();
    expect(deps.setRecycleBin).not.toHaveBeenCalled();
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.onStorageFull).toHaveBeenCalled();
    expect(getWriteFailures()).toEqual(['day-planner-deleted-task-ids']);
  });
});

// #2141: the automatic empty removes items deleted more than N days ago,
// through the same tombstone path as the manual one.
describe('automatic emptying', () => {
  const DAY = 86400000;
  let store;
  let deps;
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
  beforeEach(() => {
    resetWriteFailures();
    store = { 'day-planner-deleted-task-ids': JSON.stringify({ older: 'x' }) };
    globalThis.localStorage = {
      getItem: vi.fn((k) => store[k] ?? null),
      setItem: vi.fn((k, v) => { store[k] = v; }),
    };
    globalThis.window = {};
    vi.spyOn(console, 'error').mockImplementation(() => {});
    deps = {
      recycleBin: [
        { id: 'old', deletedAt: at(40) },
        { id: 'recent', deletedAt: at(3) },
        { id: 'unstamped' },
      ],
      setRecycleBin: vi.fn(),
      pushUndo: vi.fn(),
      setTasks: vi.fn(),
      setUnscheduledTasks: vi.fn(),
      playUISound: vi.fn(),
      dataLoaded: true,
      autoEmptyDays: 30,
    };
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; vi.restoreAllMocks(); });

  const remaining = () => deps.setRecycleBin.mock.calls[0][0](deps.recycleBin).map(t => t.id);

  it('tombstones and removes only the expired items', () => {
    useRecycleBin(deps);
    const tombstones = JSON.parse(store['day-planner-deleted-task-ids']);
    expect(Object.keys(tombstones).sort()).toEqual(['old', 'older']);
    // an item without a deletedAt never expires
    expect(remaining()).toEqual(['recent', 'unstamped']);
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.playUISound).not.toHaveBeenCalled();
  });

  it('does nothing when off, before the data has loaded, or in the tray', () => {
    useRecycleBin({ ...deps, autoEmptyDays: 0 });
    useRecycleBin({ ...deps, dataLoaded: false });
    useRecycleBin({ ...deps, isTrayMode: true });
    expect(deps.setRecycleBin).not.toHaveBeenCalled();
    expect(globalThis.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('removes nothing when the tombstones cannot be written', () => {
    globalThis.localStorage.setItem = vi.fn(() => { throw Object.assign(new Error('q'), { name: 'QuotaExceededError' }); });
    useRecycleBin(deps);
    expect(deps.setRecycleBin).not.toHaveBeenCalled();
  });
});

// #2406: one task out of the bin for good, without emptying it.
describe('deleteFromBin', () => {
  let store;
  let deps;
  beforeEach(() => {
    resetWriteFailures();
    store = { 'day-planner-deleted-task-ids': JSON.stringify({ old: '2026-01-01T00:00:00.000Z' }) };
    globalThis.localStorage = {
      getItem: vi.fn((k) => store[k] ?? null),
      setItem: vi.fn((k, v) => { store[k] = v; }),
    };
    globalThis.window = { DayGlanceNative: { deindexSpotlight: vi.fn() } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    deps = {
      recycleBin: [{ id: 'b1', title: 'One' }, { id: 2, title: 'Two' }, { id: 'b3', title: 'Three' }],
      setRecycleBin: vi.fn(),
      pushUndo: vi.fn(),
      setTasks: vi.fn(),
      setUnscheduledTasks: vi.fn(),
      playUISound: vi.fn(),
      onStorageFull: vi.fn(),
      onDeleted: vi.fn(),
    };
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; vi.restoreAllMocks(); });

  const remaining = () => deps.setRecycleBin.mock.calls[0][0](deps.recycleBin).map(t => t.id);

  it('removes that task and no other, with a tombstone for it alone', () => {
    useRecycleBin(deps).deleteFromBin('b1');
    expect(remaining()).toEqual([2, 'b3']);
    // The tombstones already there stay; only the deleted task gains one.
    expect(Object.keys(JSON.parse(store['day-planner-deleted-task-ids'])).sort()).toEqual(['b1', 'old']);
  });

  it('is an undo step named for the task, pushed before the bin changes', () => {
    const order = [];
    deps.pushUndo.mockImplementation(() => order.push('undo'));
    deps.setRecycleBin.mockImplementation(() => order.push('remove'));
    useRecycleBin(deps).deleteFromBin('b3');
    expect(deps.pushUndo).toHaveBeenCalledWith({ key: 'binDeleted', taskId: 'b3' });
    expect(order).toEqual(['undo', 'remove']);
  });

  it('says what it did, so the caller can offer the undo', () => {
    deps.onDeleted = vi.fn();
    deps.pushUndo.mockReturnValue('Permanently deleted "Three"');
    useRecycleBin(deps).deleteFromBin('b3');
    expect(deps.onDeleted).toHaveBeenCalledWith('Permanently deleted "Three"');
  });

  it('matches an id whatever its type', () => {
    useRecycleBin(deps).deleteFromBin('2');
    expect(remaining()).toEqual(['b1', 'b3']);
    expect(JSON.parse(store['day-planner-deleted-task-ids'])).toHaveProperty('2');
  });

  it('takes the task out of Spotlight', () => {
    useRecycleBin(deps).deleteFromBin('b1');
    expect(globalThis.window.DayGlanceNative.deindexSpotlight).toHaveBeenCalledWith(JSON.stringify(['b1']));
  });

  it('removes nothing when the tombstone cannot be written', () => {
    globalThis.localStorage.setItem = vi.fn(() => { throw quota(); });
    expect(() => useRecycleBin(deps).deleteFromBin('b1')).not.toThrow();
    expect(deps.setRecycleBin).not.toHaveBeenCalled();
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.onStorageFull).toHaveBeenCalled();
    expect(deps.onDeleted).not.toHaveBeenCalled();
  });

  it('does nothing for a task the bin does not hold', () => {
    useRecycleBin(deps).deleteFromBin('nope');
    expect(deps.setRecycleBin).not.toHaveBeenCalled();
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(globalThis.localStorage.setItem).not.toHaveBeenCalled();
  });
});
