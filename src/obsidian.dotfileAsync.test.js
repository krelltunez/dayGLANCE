import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVaultHeartbeatNativeAsync, detectTasksPluginNativeAsync } from './obsidian.js';

// Every Obsidian cycle reads two vault dotfiles (.dayglance/heartbeat and
// .obsidian/community-plugins.json), and the Obsidian settings panel reads the
// heartbeat every 10 seconds. On a vault behind Google Drive's provider each
// synchronous read held the page for tens of seconds (a tester's Pixel, 36 s
// and 52 s freezes). On Android they now run on a background thread and
// answer through window.__obsidianDispatch; elsewhere the sync read stands.

const dispatch = (id, result, error) => {
  const cb = window.__obsidianCbs?.[id];
  if (cb) { delete window.__obsidianCbs[id]; cb(result, error); }
};
const beat = JSON.stringify({ ts: new Date().toISOString(), deviceId: 'dev-1', paired: true });
const answer = (text) => (id) => setTimeout(() => window.__obsidianDispatch(id, JSON.stringify(text), null), 5);

describe('the vault dotfile reads off the JS thread', () => {
  beforeEach(() => {
    globalThis.window = { __obsidianDispatch: dispatch };
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.window;
  });

  it('reads the heartbeat in the background on Android and never makes the blocking call', async () => {
    window.DayGlanceNative = {};
    const getHeartbeat = vi.fn(() => beat);
    window.DayGlanceObsidian = { getHeartbeat, getHeartbeatAsync: answer(beat) };
    const p = readVaultHeartbeatNativeAsync();
    await vi.advanceTimersByTimeAsync(10);
    expect((await p)?.deviceId).toBe('dev-1');
    expect(getHeartbeat).not.toHaveBeenCalled();
  });

  it('reads an absent or unreadable heartbeat as no heartbeat', async () => {
    window.DayGlanceNative = {};
    window.DayGlanceObsidian = { getHeartbeatAsync: answer('') };
    let p = readVaultHeartbeatNativeAsync();
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toBe(null);
    window.DayGlanceObsidian = { getHeartbeatAsync: answer(null) };
    p = readVaultHeartbeatNativeAsync();
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toBe(null);
    window.DayGlanceObsidian = { getHeartbeatAsync: (id) => window.__obsidianDispatch(id, null, 'provider error') };
    expect(await readVaultHeartbeatNativeAsync()).toBe(null);
  });

  it('gives up a read that never answers, and a caller during a read joins it', async () => {
    window.DayGlanceNative = {};
    const getHeartbeatAsync = vi.fn();
    window.DayGlanceObsidian = { getHeartbeatAsync };
    const a = readVaultHeartbeatNativeAsync();
    const b = readVaultHeartbeatNativeAsync();
    expect(getHeartbeatAsync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await a).toBe(null);
    expect(await b).toBe(null);
    expect(Object.keys(window.__obsidianCbs)).toEqual([]);
    readVaultHeartbeatNativeAsync();
    expect(getHeartbeatAsync).toHaveBeenCalledTimes(2);
  });

  it('detects the Tasks plugin in the background with the synchronous read\'s answers', async () => {
    window.DayGlanceNative = {};
    const getCommunityPlugins = vi.fn(() => '[]');
    const cases = [['["obsidian-tasks-plugin"]', true], ['["dataview"]', false], ['', false], [null, null], ['{oops', false]];
    for (const [text, want] of cases) {
      window.DayGlanceObsidian = { getCommunityPlugins, getCommunityPluginsAsync: answer(text) };
      const p = detectTasksPluginNativeAsync();
      await vi.advanceTimersByTimeAsync(10);
      expect(await p).toBe(want);
    }
    expect(getCommunityPlugins).not.toHaveBeenCalled();
  });

  it('keeps the synchronous reads on an older Android shell and on iOS', async () => {
    window.DayGlanceNative = {};
    window.DayGlanceObsidian = { getHeartbeat: () => beat, getCommunityPlugins: () => '["obsidian-tasks-plugin"]' };
    expect((await readVaultHeartbeatNativeAsync())?.deviceId).toBe('dev-1');
    expect(await detectTasksPluginNativeAsync()).toBe(true);
    // iOS: the bridge answers any method name, so the async one is never trusted.
    delete window.DayGlanceNative;
    window.DayGlanceIOS = {};
    const getHeartbeatAsync = vi.fn();
    window.DayGlanceObsidian = { getHeartbeat: () => beat, getHeartbeatAsync };
    expect((await readVaultHeartbeatNativeAsync())?.deviceId).toBe('dev-1');
    expect(getHeartbeatAsync).not.toHaveBeenCalled();
  });
});
