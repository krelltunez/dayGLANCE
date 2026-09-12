import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Follow the existing hook capture harness: refs/state survive explicit
// re-renders; effects are not mounted, so automatic timers do not run here.
let states = [];
let refs = [];
let stateCursor = 0;
let refCursor = 0;
vi.mock('react', () => ({
  useCallback: fn => fn,
  useEffect: () => {},
  useRef: value => {
    const index = refCursor++;
    if (!refs[index]) refs[index] = { current: value };
    return refs[index];
  },
  useState: initial => {
    const index = stateCursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], next => {
      states[index] = typeof next === 'function' ? next(states[index]) : next;
    }];
  },
}));
vi.mock('../utils/resetAppData.js', () => ({ isResetInProgress: () => false }));
const request = vi.fn();
vi.mock('../todoist/client.js', async importOriginal => ({
  ...await importOriginal(),
  requestSync: (...args) => request(...args),
}));
const { default: useTodoistSync } = await import('./useTodoistSync.js');
const { ACCOUNT_KEY, TOKEN_KEY, CONFIG_KEY, stateKey } = await import('../todoist/client.js');
const { normalizeSettings, mergeResponse, importTask } = await import('../todoist/core.js');

const remote = patch => ({ id: 'task', content: 'Task', priority: 4, checked: false, is_deleted: false, ...patch });
const response = items => ({ full_sync: true, sync_token: 'cursor', user: { id: 'account' }, items, projects: [], labels: [] });
const memory = () => {
  const rows = new Map();
  return {
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: key => rows.delete(key),
  };
};
function serialLock() {
  let held = false;
  let tail = Promise.resolve();
  return vi.fn((name, options, callback) => {
    const fn = typeof options === 'function' ? options : callback;
    if (options?.ifAvailable && held) return Promise.resolve(fn(null));
    const run = tail.then(async () => {
      held = true;
      try { return await fn({ name }); }
      finally { held = false; }
    });
    tail = run.catch(() => {});
    return run;
  });
}
function harness(patch = {}) {
  const state = { tasks: [], inbox: [], bin: [], ...patch };
  const setTasks = next => { state.tasks = typeof next === 'function' ? next(state.tasks) : next; };
  const setUnscheduledTasks = next => { state.inbox = typeof next === 'function' ? next(state.inbox) : next; };
  const setRecycleBin = vi.fn();
  const useTestSync = () => {
    stateCursor = 0;
    refCursor = 0;
    return useTodoistSync({
      tasks: state.tasks, setTasks, unscheduledTasks: state.inbox, setUnscheduledTasks,
      recycleBin: state.bin, setRecycleBin, dataLoaded: true, isTrayMode: false, multiUserEnabled: false,
    });
  };
  return { state, render: useTestSync, setRecycleBin };
}

beforeEach(() => {
  states = []; refs = []; stateCursor = 0; refCursor = 0;
  request.mockReset();
  vi.stubGlobal('localStorage', memory());
  vi.stubGlobal('sessionStorage', memory());
  vi.stubGlobal('navigator', { locks: { request: serialLock() } });
  sessionStorage.setItem(TOKEN_KEY, 'test-token-not-a-credential');
  sessionStorage.setItem(ACCOUNT_KEY, 'account');
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalizeSettings({ mode: 'all' })));
});
afterEach(() => vi.unstubAllGlobals());

describe('Todoist review wiring', () => {
  it('prunes unlinked history but preserves completion evidence for linked tasks', async () => {
    const settings = normalizeSettings({ mode: 'all' });
    const source = mergeResponse({}, response([remote()]));
    const task = importTask(source.items.task, source, settings, '2026-09-12T01:00:00Z');
    const h = harness({ inbox: [task] });
    request.mockResolvedValue(response([remote({ checked: true }), remote({ id: 'unlinked', checked: true })]));
    expect(await h.render().syncNow()).toBe(true);
    const stored = JSON.parse(localStorage.getItem(stateKey('account')));
    expect(Object.keys(stored.cache.items)).toEqual(['task']);
    expect(h.state.inbox[0].completed).toBe(true);
    expect(h.setRecycleBin).not.toHaveBeenCalled();
  });
  it('retains inactive source rows needed by pending completion receipts', async () => {
    const queue = [{ uuid: 'original', accountId: 'account', localId: 'local', args: { id: 'queued' }, type: 'item_close' }];
    localStorage.setItem(stateKey('account'), JSON.stringify({ queue }));
    request.mockResolvedValue(response([remote({ id: 'queued', checked: true })]));
    const h = harness();
    expect(await h.render().preview()).toBe(true);
    const stored = JSON.parse(localStorage.getItem(stateKey('account')));
    expect(stored.cache.items.queued.checked).toBe(true);
    expect(stored.queue).toEqual(queue);
  });
  it('disconnect removes credentials and an idle cache, but keeps imported tasks', async () => {
    localStorage.setItem(stateKey('account'), JSON.stringify({ cache: {}, queue: [] }));
    const h = harness({ tasks: [{ id: 'keep-me' }] });
    await h.render().disconnect();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(null);
    expect(sessionStorage.getItem(ACCOUNT_KEY)).toBe(null);
    expect(localStorage.getItem(stateKey('account'))).toBe(null);
    expect(h.state.tasks).toEqual([{ id: 'keep-me' }]);
    expect(h.render().connected).toBe(false);
    expect(h.render().settings.enabled).toBe(false);
    expect(h.setRecycleBin).not.toHaveBeenCalled();
  });
  it('disconnect preserves pending receipts and leaves their count visible', async () => {
    const raw = JSON.stringify({ cache: {}, queue: [{ uuid: 'original', args: { id: 'pending' } }] });
    localStorage.setItem(stateKey('account'), raw);
    const h = harness();
    await h.render().disconnect();
    expect(localStorage.getItem(stateKey('account'))).toBe(raw);
    expect(h.render().pending).toBe(1);
    expect(h.render().connected).toBe(false);
  });
  it('cancels an in-flight read and does not recreate its cache after disconnect', async () => {
    let release;
    request.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    localStorage.setItem(stateKey('account'), JSON.stringify({ queue: [] }));
    const h = harness();
    const api = h.render();
    const syncing = api.syncNow();
    await Promise.resolve();
    expect(request).toHaveBeenCalledOnce();
    const disconnecting = api.disconnect();
    release(response([remote()]));
    await Promise.all([syncing, disconnecting]);
    expect(localStorage.getItem(stateKey('account'))).toBe(null);
    expect(h.state.inbox).toEqual([]);
    expect(h.render().status).toBe('idle');
  });
  it('surfaces cancelled rather than remapping it to a network error', async () => {
    request.mockRejectedValue(new Error('cancelled'));
    const h = harness();
    expect(await h.render().syncNow()).toBe(false);
    expect(h.render().error).toBe('cancelled');
  });
  it('fails closed when disconnect finds a corrupt pending queue', async () => {
    localStorage.setItem(stateKey('account'), '{"queue":{}}');
    const h = harness();
    await h.render().disconnect();
    expect(localStorage.getItem(stateKey('account'))).toBe('{"queue":{}}');
    expect(h.render().error).toBe('storageCorrupt');
  });
});
