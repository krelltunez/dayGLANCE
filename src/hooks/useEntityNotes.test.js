import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteTextHash } from '@glance-apps/obsidian-format';

// The hook run the way React runs it: state persists across renders, effects
// run after a render whose dependencies changed (cleanup first), and an
// unmount runs every cleanup.
const react = vi.hoisted(() => ({ slots: [], cursor: 0, pending: [], dirty: false }));
vi.mock('react', () => ({
  useState: (initial) => {
    const i = react.cursor++;
    const slot = react.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [slot.value, (v) => { slot.value = typeof v === 'function' ? v(slot.value) : v; react.dirty = true; }];
  },
  useRef: (initial) => {
    const i = react.cursor++;
    return react.slots[i] ??= { current: initial };
  },
  useEffect: (effect, deps) => {
    const i = react.cursor++;
    const slot = react.slots[i] ??= { effect: true };
    if (!slot.deps || !deps || deps.some((d, n) => d !== slot.deps[n])) {
      react.pending.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      slot.deps = deps;
    }
  },
}));
const sync = vi.hoisted(() => ({ value: {} }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => sync.value }));
import useEntityNotes from './useEntityNotes.js';

const runHook = useEntityNotes;
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

function mount(args) {
  react.slots = []; react.pending = [];
  let result;
  const render = () => {
    let turns = 0;
    do {
      if (++turns > 20) throw new Error('render loop');
      react.dirty = false; react.cursor = 0;
      result = runHook(args);
      const effects = react.pending.splice(0);
      for (const run of effects) run();
    } while (react.dirty);
  };
  render();
  return {
    get state() { return result; },
    render,
    act: async (fn) => { fn?.(result); await flushPromises(); render(); },
    unmount: () => { for (const slot of react.slots) if (slot?.effect) slot.cleanup?.(); },
  };
}

const LINKED = { id: 'g1', description: '', obsidianNotePath: 'Goals/Run.md' };

beforeEach(() => { sync.value = {}; });

describe('useEntityNotes — a record description', () => {
  it('saves the trimmed text through saveRecord, and only when it changed', async () => {
    const saveRecord = vi.fn();
    const h = mount({ kind: 'goal', entity: { id: 'g1', description: 'Old' }, saveRecord });
    expect(h.state.editing).toBe(false); // existing notes open as the preview
    await h.act((s) => s.save());
    expect(saveRecord).not.toHaveBeenCalled();
    await h.act((s) => s.setNotes('  New **bold**  '));
    await h.act((s) => s.save());
    expect(saveRecord).toHaveBeenCalledWith('New **bold**');
  });

  it('opens an empty box as the editor, unless asked for the quiet prompt', () => {
    expect(mount({ kind: 'project', entity: { id: 'p1' }, saveRecord: vi.fn() }).state.editing).toBe(true);
    expect(mount({ kind: 'goal', entity: { id: 'g1' }, saveRecord: vi.fn(), editWhenEmpty: false }).state.editing).toBe(false);
  });

  it('flushes unsaved text when it unmounts', async () => {
    const saveRecord = vi.fn();
    const h = mount({ kind: 'goal', entity: { id: 'g1', description: '' }, saveRecord });
    await h.act((s) => s.setNotes('typed, never blurred'));
    h.unmount();
    expect(saveRecord).toHaveBeenCalledWith('typed, never blurred');
  });
});

describe('useEntityNotes — a linked note\'s description section', () => {
  const vaultSync = (over = {}) => ({
    loadNoteDescription: vi.fn(async () => ({ text: 'From the vault', base: noteTextHash('From the vault') })),
    saveNoteDescription: vi.fn(async () => ({ ok: true })),
    ...over,
  });

  it('loads the section into the box and writes it back with its base, never to the record', async () => {
    sync.value = vaultSync();
    const saveRecord = vi.fn();
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord, editWhenEmpty: false });
    expect(h.state.vaultNotes).toBe(true);
    await h.act();
    expect(sync.value.loadNoteDescription).toHaveBeenCalledWith('Goals/Run.md');
    expect(h.state.notes).toBe('From the vault');
    expect(h.state.editing).toBe(false);

    await h.act((s) => s.setNotes('Edited'));
    await h.act((s) => s.save());
    expect(sync.value.saveNoteDescription).toHaveBeenCalledWith('goal', 'g1', 'Goals/Run.md', 'Edited', { base: noteTextHash('From the vault') });
    expect(saveRecord).not.toHaveBeenCalled();
    expect(h.state.vault.text).toBe('Edited');
  });

  it('keeps the unsaved text below a section that moved in Obsidian, and says so', async () => {
    sync.value = vaultSync({ saveNoteDescription: vi.fn(async () => ({ refused: true, text: 'Changed in Obsidian' })) });
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord: vi.fn() });
    await h.act();
    await h.act((s) => s.setNotes('Mine'));
    await h.act((s) => s.save());
    expect(h.state.notes).toBe('Changed in Obsidian\n\nMine');
    expect(h.state.vault.conflict).toBe(true);
    expect(h.state.editing).toBe(true);
  });

  it('says where the notes live when the note is missing, and writes nothing', async () => {
    sync.value = vaultSync({ loadNoteDescription: vi.fn(async () => ({ notFound: true })) });
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord: vi.fn() });
    await h.act();
    expect(h.state.vault).toMatchObject({ unavailable: true, error: 'not_found' });
    await h.act((s) => s.save());
    h.unmount();
    expect(sync.value.saveNoteDescription).not.toHaveBeenCalled();
  });

  it('flushes to the note, not the record, when it unmounts', async () => {
    sync.value = vaultSync();
    const saveRecord = vi.fn();
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord });
    await h.act();
    await h.act((s) => s.setNotes('Unsaved'));
    h.unmount();
    expect(sync.value.saveNoteDescription).toHaveBeenCalledWith('goal', 'g1', 'Goals/Run.md', 'Unsaved');
    expect(saveRecord).not.toHaveBeenCalled();
  });
});

describe('useEntityNotes — the section from the plugin\'s report (#2291)', () => {
  const reported = (text, observedAt) => ({ text, base: noteTextHash(text), source: 'report', observedAt, lastModified: '2026-11-05T09:00:00.000Z' });
  beforeEach(() => {
    globalThis.window = new EventTarget();
    globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  });
  afterEach(() => { delete globalThis.window; delete globalThis.document; });

  it('shows the reported text with when it was reported, edits it under its base, and drops the age once saved', async () => {
    sync.value = {
      loadNoteDescription: vi.fn(async () => reported('From Obsidian', '2026-11-05T10:00:00.000Z')),
      saveNoteDescription: vi.fn(async () => ({ ok: true, mode: 'queued' })),
    };
    const h = mount({ kind: 'project', entity: { ...LINKED, id: 'p1' }, saveRecord: vi.fn() });
    await h.act();
    expect(h.state.notes).toBe('From Obsidian');
    expect(h.state.vault).toMatchObject({ unavailable: false, reportedAt: '2026-11-05T10:00:00.000Z', base: noteTextHash('From Obsidian') });
    await h.act((s) => s.setNotes('Typed on the phone'));
    await h.act((s) => s.save());
    expect(sync.value.saveNoteDescription).toHaveBeenCalledWith('project', 'p1', 'Goals/Run.md', 'Typed on the phone', { base: noteTextHash('From Obsidian') });
    expect(h.state.vault.reportedAt).toBe(null);
  });

  it('a later report of the same text refreshes its age; a read from a file carries none', async () => {
    let next = reported('Same', '2026-11-05T10:00:00.000Z');
    sync.value = { loadNoteDescription: vi.fn(async () => next), saveNoteDescription: vi.fn() };
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord: vi.fn(), editWhenEmpty: false });
    await h.act();
    next = reported('Same', '2026-11-05T12:00:00.000Z');
    window.dispatchEvent(new Event('focus'));
    await h.act();
    expect(h.state.vault.reportedAt).toBe('2026-11-05T12:00:00.000Z');
    next = { text: 'Same', base: noteTextHash('Same'), lastModified: 'L' };
    window.dispatchEvent(new Event('focus'));
    await h.act();
    expect(h.state.vault.reportedAt).toBe(null);
  });

  it('a refusal against a newer report reloads it with its age', async () => {
    sync.value = {
      loadNoteDescription: vi.fn(async () => reported('First', '2026-11-05T10:00:00.000Z')),
      saveNoteDescription: vi.fn(async () => ({ refused: 'changed', text: 'Newer', source: 'report', observedAt: '2026-11-05T11:00:00.000Z' })),
    };
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord: vi.fn() });
    await h.act();
    await h.act((s) => s.setNotes('Mine'));
    await h.act((s) => s.save());
    expect(h.state.vault).toMatchObject({ conflict: true, text: 'Newer', reportedAt: '2026-11-05T11:00:00.000Z' });
    expect(h.state.notes).toBe('Newer\n\nMine');
  });
});

describe('useEntityNotes — a linked note edited in Obsidian meanwhile', () => {
  let texts;
  const live = () => ({
    loadNoteDescription: vi.fn(async () => ({ text: texts.at(-1), base: noteTextHash(texts.at(-1)) })),
    saveNoteDescription: vi.fn(async () => ({ ok: true })),
  });
  beforeEach(() => {
    texts = ['First'];
    globalThis.window = new EventTarget();
    globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  });
  afterEach(() => { delete globalThis.window; delete globalThis.document; });

  const opened = async (over = {}) => {
    sync.value = { ...live(), obsidianLastSynced: 'T0', ...over };
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord: vi.fn(), editWhenEmpty: false });
    await h.act();
    expect(h.state.notes).toBe('First');
    return h;
  };
  const syncFinished = async (h, at) => { sync.value = { ...sync.value, obsidianLastSynced: at }; await h.act(); await h.act(); };

  it('shows the new text after an Obsidian cycle finishes', async () => {
    const h = await opened();
    texts.push('Changed in Obsidian');
    await syncFinished(h, 'T1');
    expect(h.state.notes).toBe('Changed in Obsidian');
    // The new read is the base a later save is checked against.
    expect(h.state.vault.base).toBe(noteTextHash('Changed in Obsidian'));
  });

  it('shows it on returning to the window, too', async () => {
    const h = await opened();
    texts.push('Edited while away');
    window.dispatchEvent(new Event('focus'));
    await h.act();
    expect(h.state.notes).toBe('Edited while away');
    texts.push('And again');
    document.dispatchEvent(new Event('visibilitychange'));
    await h.act();
    expect(h.state.notes).toBe('And again');
  });

  it('never replaces text the user is typing', async () => {
    const h = await opened();
    await h.act((s) => s.setEditing(true));
    await h.act((s) => s.setNotes('My draft'));
    texts.push('Changed in Obsidian');
    await syncFinished(h, 'T1');
    window.dispatchEvent(new Event('focus'));
    await h.act();
    expect(h.state.notes).toBe('My draft');
  });

  it('never replaces an edit the note does not have yet, even with the editor closed', async () => {
    const h = await opened();
    await h.act((s) => s.setNotes('Unsaved'));
    texts.push('Changed in Obsidian');
    await syncFinished(h, 'T1');
    expect(h.state.notes).toBe('Unsaved');
  });

  it('drops a read that lands after the user started typing', async () => {
    const h = await opened();
    let release;
    sync.value.loadNoteDescription.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    sync.value = { ...sync.value, obsidianLastSynced: 'T1' };
    h.render();
    await h.act((s) => s.setEditing(true));
    release({ text: 'Late', base: noteTextHash('Late') });
    await h.act();
    expect(h.state.notes).toBe('First');
  });

  it('stops listening when it goes away', async () => {
    const h = await opened();
    h.unmount();
    const calls = sync.value.loadNoteDescription.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(sync.value.loadNoteDescription.mock.calls.length).toBe(calls);
  });
});
