import * as C from '../utils/jobo.js';

// Independent local journal, not a derived cache or a Todoist command queue.
export const LEDGER_KEY = 'day-planner-jobo-v520';
export function createLedgerStore({
  storage,
  target,
  uuid = () => crypto.randomUUID()
}) {
  let state = C.empty(),
    error = '',
    hydrated = false,
    lastRaw = null;
  const listeners = new Set(),
    history = [];
  const emit = () => listeners.forEach(fn => fn());
  try {
    lastRaw = storage.getItem(LEDGER_KEY);
    if (lastRaw) state = C.validate(JSON.parse(lastRaw));
    hydrated = true;
  } catch (err) {
    error = String(err.message);
  }
  function commit(next, undo = true) {
    if (next === state) return;
    if (!hydrated) throw new Error('The existing ledger could not be read. Export it before replacing it.');
    // Fail on a stale tab, not a last-writer-wins overwrite. This check is not
    // an atomic cross-tab lock or a cross-device merge protocol.
    if (storage.getItem(LEDGER_KEY) !== lastRaw) throw new Error('Journal changed in another tab. Reload before editing.');
    const raw = JSON.stringify(next);
    storage.setItem(LEDGER_KEY, raw);
    if (undo) {
      history.push(state);
      if (history.length > 30) history.shift();
    }
    lastRaw = raw;
    state = next;
    error = '';
    emit();
  }
  const changed = event => {
    if (event.key !== LEDGER_KEY && event.key !== null) return;
    try {
      const raw = storage.getItem(LEDGER_KEY);
      state = raw ? C.validate(JSON.parse(raw)) : C.empty();
      lastRaw = raw;
      hydrated = true;
      error = '';
      history.length = 0;
      emit();
    } catch (err) {
      hydrated = false;
      error = String(err.message);
      emit();
    }
  };
  target?.addEventListener('storage', changed);
  return {
    key: LEDGER_KEY,
    get: () => state,
    error: () => error,
    subscribe: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose: () => {
      target?.removeEventListener('storage', changed);
      listeners.clear();
    },
    commit,
    capture: tasks => commit(C.capture(state, tasks), false),
    checkNow: (task, now = new Date(), id = uuid()) => {
      const next = C.recordChecked(state, task, id, now);
      if (next === state) return null;
      commit(next);
      return id;
    },
    syncNotes: tasks => commit(C.syncSourceNotes(state, tasks), false),
    create: (task, at, id = uuid()) => {
      commit(C.createRecord(state, task, at, id));
      return id;
    },
    addTag: (role, id, text) => commit(C.addTag(state, role, id, text)),
    noteVisibility: (id, visible) => commit(C.noteVisibility(state, id, visible)),
    update: (id, patch) => commit(C.updateRecord(state, id, patch)),
    remove: id => commit(C.removeRecord(state, id)),
    prefs: patch => commit({
      ...state,
      prefs: {
        ...state.prefs,
        ...patch
      }
    }, false),
    height: (id, height) => commit({
      ...state,
      noteHeights: {
        ...state.noteHeights,
        [id]: Math.min(1000, Math.max(80, height))
      }
    }, false),
    undo: () => {
      const prev = history.at(-1);
      if (prev) {
        commit(prev, false);
        history.pop();
      }
    },
    restore: value => {
      const next = C.validate(value),
        old = hydrated;
      hydrated = true;
      try {
        commit(next);
      } catch (err) {
        hydrated = old;
        throw err;
      }
    }
  };
}
let instance;
function getStore() {
  if (!instance) instance = createLedgerStore({
    storage: window.localStorage,
    target: window
  });
  return instance;
}
const store = Object.fromEntries(['get', 'error', 'subscribe', 'commit', 'capture', 'checkNow', 'syncNotes', 'create', 'addTag', 'noteVisibility', 'update', 'remove', 'prefs', 'height', 'undo', 'restore'].map(name => [name, (...args) => getStore()[name](...args)]));
export default store;
