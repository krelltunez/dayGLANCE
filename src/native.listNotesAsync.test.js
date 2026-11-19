import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeListNotesAsync } from './native.js';

// The vault listing for wikilink suggestions ran synchronously on every
// return to the app, holding the JS thread (taps, rendering) for the whole
// vault walk. On Android it now runs on a background thread and answers
// through window.__obsidianDispatch; elsewhere it falls back to the sync call.

const dispatch = (id, result, error) => {
  const cb = window.__obsidianCbs?.[id];
  if (cb) { delete window.__obsidianCbs[id]; cb(result, error); }
};

describe('nativeListNotesAsync', () => {
  beforeEach(() => {
    globalThis.window = { __obsidianDispatch: dispatch };
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.window;
    delete globalThis.requestAnimationFrame;
  });

  it('resolves null without a vault bridge', async () => {
    expect(await nativeListNotesAsync('')).toBe(null);
  });

  it('uses the background listing on Android and never the blocking one', async () => {
    window.DayGlanceNative = {};
    const listNotes = vi.fn(() => '[]');
    window.DayGlanceObsidian = {
      listNotes,
      listNotesAsync: (folder, id) => setTimeout(() => window.__obsidianDispatch(id, JSON.stringify([`${folder}a.md`, 'x/b.md']), null), 5),
    };
    const p = nativeListNotesAsync('');
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toEqual(['a.md', 'x/b.md']);
    expect(listNotes).not.toHaveBeenCalled();
  });

  it('resolves null on a bridge error', async () => {
    window.DayGlanceNative = {};
    window.DayGlanceObsidian = { listNotesAsync: (folder, id) => window.__obsidianDispatch(id, null, 'revoked') };
    expect(await nativeListNotesAsync('')).toBe(null);
  });

  it('gives up after the timeout when the bridge never answers', async () => {
    window.DayGlanceNative = {};
    window.DayGlanceObsidian = { listNotesAsync: () => {} };
    const p = nativeListNotesAsync('');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await p).toBe(null);
    expect(Object.keys(window.__obsidianCbs)).toEqual([]);
  });

  it('falls back to the sync listing on an older Android shell', async () => {
    window.DayGlanceNative = {};
    window.DayGlanceObsidian = { listNotes: () => '["n.md"]' };
    const p = nativeListNotesAsync('');
    await vi.advanceTimersByTimeAsync(50);
    expect(await p).toEqual(['n.md']);
  });

  it('never waits on iOS, whose bridge answers any method name', async () => {
    window.DayGlanceNative = {};
    window.DayGlanceIOS = true;
    const listNotesAsync = vi.fn();
    window.DayGlanceObsidian = { listNotes: () => '["i.md"]', listNotesAsync };
    const p = nativeListNotesAsync('');
    await vi.advanceTimersByTimeAsync(50);
    expect(await p).toEqual(['i.md']);
    expect(listNotesAsync).not.toHaveBeenCalled();
  });
});
