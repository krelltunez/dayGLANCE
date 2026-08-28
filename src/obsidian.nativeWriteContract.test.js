import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  writeTaskStateNative,
  appendTaskToDailyNoteNative,
  writeDailyNoteNative,
} from './obsidian.js';
import { nativeWriteNote, nativeAppendToNote, nativeWriteDailyNote } from './native.js';

// The native write-success contract: commit-gating callers must see `false`
// whenever the bridge did not CONFIRM the write. Two platform shapes feed the
// same JS: Android's @JavascriptInterface returns real booleans; iOS's
// dgbridge:// XHR shim returns responseText STRINGS — so a failed iOS write
// arrives as the truthy string "false", which a raw truthiness check reads as
// success. These tests pin the normalization at every native write site.

const NOTE = '## Tasks\n- [ ] Buy milk\n';

function installBridge(overrides = {}) {
  const bridge = {
    getDailyNote: vi.fn(() => NOTE),
    writeDailyNote: vi.fn(() => true),
    writeNote: vi.fn(() => true),
    appendToNote: vi.fn(() => true),
    ...overrides,
  };
  global.window = { DayGlanceObsidian: bridge };
  return bridge;
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => {
  delete global.window;
  vi.restoreAllMocks();
});

describe('writeTaskStateNative — the commit gate', () => {
  const args = ['2026-08-28', 'Buy milk', true, null, undefined, null, undefined, '## Tasks', 'k3x9q2mf'];

  it('returns true only when a line matched AND the bridge confirmed the write', () => {
    const bridge = installBridge();
    expect(writeTaskStateNative(...args)).toBe(true);
    expect(bridge.writeDailyNote).toHaveBeenCalledTimes(1);
  });

  it('iOS string results are honored: "true" is success, "false" is FAILURE', () => {
    installBridge({ writeDailyNote: vi.fn(() => 'true') });
    expect(writeTaskStateNative(...args)).toBe(true);
    installBridge({ writeDailyNote: vi.fn(() => 'false') });
    expect(writeTaskStateNative(...args)).toBe(false);
  });

  it('an Android false return is a failure — no commit despite a matched line', () => {
    installBridge({ writeDailyNote: vi.fn(() => false) });
    expect(writeTaskStateNative(...args)).toBe(false);
  });

  it('a bridge that throws is a failure', () => {
    installBridge({ writeDailyNote: vi.fn(() => { throw new Error('SAF says no'); }) });
    expect(writeTaskStateNative(...args)).toBe(false);
  });

  it('no matching line still returns false without attempting a write', () => {
    const bridge = installBridge({ getDailyNote: vi.fn(() => '## Tasks\n- [ ] Something else\n') });
    expect(writeTaskStateNative(...args)).toBe(false);
    expect(bridge.writeDailyNote).not.toHaveBeenCalled();
  });
});

describe('appendTaskToDailyNoteNative', () => {
  const task = { title: 'New task', importSource: 'obsidian', obsidianRawTitle: 'New task' };

  it('returns true on a confirmed write', () => {
    installBridge();
    expect(appendTaskToDailyNoteNative('2026-08-28', task, '## Tasks', '')).toBe(true);
  });

  it('returns false and logs when the bridge reports failure (boolean or iOS string)', () => {
    installBridge({ writeDailyNote: vi.fn(() => false) });
    expect(appendTaskToDailyNoteNative('2026-08-28', task, '## Tasks', '')).toBe(false);
    installBridge({ writeDailyNote: vi.fn(() => 'false') });
    expect(appendTaskToDailyNoteNative('2026-08-28', task, '## Tasks', '')).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('write wrappers normalize both platform shapes', () => {
  it.each([
    [true, true], ['true', true],
    [false, false], ['false', false],
    [null, false], [undefined, false], ['', false],
  ])('bridge result %j → %j', (bridgeResult, expected) => {
    installBridge({
      writeDailyNote: vi.fn(() => bridgeResult),
      writeNote: vi.fn(() => bridgeResult),
      appendToNote: vi.fn(() => bridgeResult),
    });
    expect(writeDailyNoteNative('2026-08-28', 'x')).toBe(expected);
    expect(nativeWriteDailyNote('2026-08-28', 'x')).toBe(expected);
    expect(nativeWriteNote('Note', 'x')).toBe(expected);
    expect(nativeAppendToNote('Note', 'x')).toBe(expected);
  });

  it('a throwing bridge yields false, never a thrown error', () => {
    const boom = vi.fn(() => { throw new Error('provider refused'); });
    installBridge({ writeDailyNote: boom, writeNote: boom, appendToNote: boom });
    expect(writeDailyNoteNative('2026-08-28', 'x')).toBe(false);
    expect(nativeWriteNote('Note', 'x')).toBe(false);
    expect(nativeAppendToNote('Note', 'x')).toBe(false);
  });
});
