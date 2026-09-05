import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  appendTaskDirect,
  writeDailyNoteDirect,
  directAppendFailureMessage,
  directDailyNoteFailureMessage,
} from './obsidianDirectWrites.js';

// AUDIT FIX M3 — direct-tier write failures are SURFACED, exactly as the
// plugin-mode branch of the same App.jsx callbacks already surfaces a dropped
// emit. Before: FSA/Electron failures landed in console.error only, and the
// native append's boolean was ignored outright.

const task = { title: 'Buy milk #obsidian', duration: 30 };
const args = { dailyNotesPath: 'Daily', dateStr: '2026-09-05', task, heading: '## Tasks', template: '', pattern: 'yyyy-MM-dd' };

let errSpy;
beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('appendTaskDirect', () => {
  it('NATIVE: the ignored boolean is honored — a false result reports the failure with the task named', async () => {
    const onFailure = vi.fn();
    const writers = { appendTaskToDailyNoteNative: vi.fn(() => false) };
    await expect(appendTaskDirect({ ...args, handle: 'native', onFailure }, writers)).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledWith(directAppendFailureMessage('Buy milk #obsidian'));
    expect(writers.appendTaskToDailyNoteNative).toHaveBeenCalledWith('2026-09-05', task, '## Tasks', '');
  });

  it('NATIVE: a throwing bridge is a failure too, not an unhandled exception', async () => {
    const onFailure = vi.fn();
    const writers = { appendTaskToDailyNoteNative: vi.fn(() => { throw new Error('SAF'); }) };
    await expect(appendTaskDirect({ ...args, handle: 'native', onFailure }, writers)).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
  });

  it('NATIVE: success is silent', async () => {
    const onFailure = vi.fn();
    const writers = { appendTaskToDailyNoteNative: vi.fn(() => true) };
    await expect(appendTaskDirect({ ...args, handle: 'native', onFailure }, writers)).resolves.toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('FSA/Electron: a rejected append reports the failure (it used to be console.error only)', async () => {
    const onFailure = vi.fn();
    const handle = { kind: 'directory' };
    const writers = { appendTaskToDailyNote: vi.fn(async () => { throw new Error('write failed'); }) };
    await expect(appendTaskDirect({ ...args, handle, onFailure }, writers)).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledWith(directAppendFailureMessage('Buy milk #obsidian'));
    expect(writers.appendTaskToDailyNote).toHaveBeenCalledWith(handle, 'Daily', '2026-09-05', task, '## Tasks', '', 'yyyy-MM-dd');
    expect(errSpy).toHaveBeenCalled();
  });

  it('FSA/Electron: success is silent', async () => {
    const onFailure = vi.fn();
    const writers = { appendTaskToDailyNote: vi.fn(async () => {}) };
    await expect(appendTaskDirect({ ...args, handle: {}, onFailure }, writers)).resolves.toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe('writeDailyNoteDirect', () => {
  it('NATIVE: still deferred one macrotask (the modal closes first), and the deferred result is now checked', async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    const writers = { writeDailyNoteNative: vi.fn(() => false) };
    const p = writeDailyNoteDirect({ handle: 'native', dailyNotesPath: '', dateStr: '2026-09-05', text: 'hello', pattern: 'yyyy-MM-dd', onFailure }, writers);
    expect(writers.writeDailyNoteNative).not.toHaveBeenCalled(); // not yet — deferred
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe(false);
    expect(writers.writeDailyNoteNative).toHaveBeenCalledWith('2026-09-05', 'hello');
    expect(onFailure).toHaveBeenCalledWith(directDailyNoteFailureMessage('2026-09-05'));
  });

  it('NATIVE: success is silent; an absent text writes the empty string', async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    const writers = { writeDailyNoteNative: vi.fn(() => true) };
    const p = writeDailyNoteDirect({ handle: 'native', dateStr: '2026-09-05', text: null, pattern: 'yyyy-MM-dd', onFailure }, writers);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe(true);
    expect(writers.writeDailyNoteNative).toHaveBeenCalledWith('2026-09-05', '');
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('FSA/Electron: a rejected write reports the failure; success is silent', async () => {
    const onFailure = vi.fn();
    const failing = { writeDailyNoteFile: vi.fn(async () => { throw new Error('nope'); }) };
    await expect(writeDailyNoteDirect({ handle: {}, dailyNotesPath: 'Daily', dateStr: '2026-09-05', text: 'x', pattern: 'yyyy-MM-dd', onFailure }, failing)).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledWith(directDailyNoteFailureMessage('2026-09-05'));
    expect(failing.writeDailyNoteFile).toHaveBeenCalledWith({}, 'Daily', '2026-09-05', 'x', 'yyyy-MM-dd');

    const ok = { writeDailyNoteFile: vi.fn(async () => {}) };
    const onFailure2 = vi.fn();
    await expect(writeDailyNoteDirect({ handle: {}, dateStr: '2026-09-05', text: 'x', pattern: 'yyyy-MM-dd', onFailure: onFailure2 }, ok)).resolves.toBe(true);
    expect(onFailure2).not.toHaveBeenCalled();
  });

  it('the messages carry no em dashes (user-facing copy rule)', () => {
    expect(directAppendFailureMessage('t')).not.toMatch(/—/);
    expect(directDailyNoteFailureMessage('2026-09-05')).not.toMatch(/—/);
  });
});
