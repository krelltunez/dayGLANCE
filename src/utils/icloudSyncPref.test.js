import { describe, it, expect } from 'vitest';
import {
  ICLOUD_SYNC_PREF_KEY,
  getICloudSyncPref,
  isICloudSyncEnabled,
  setICloudSyncEnabled,
  shouldPromptFirstRun,
  payloadHasData,
} from './icloudSyncPref.js';

const store = (initial = {}) => {
  const map = { ...initial };
  return {
    map,
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
  };
};

const throwingStore = () => ({
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
});

describe('getICloudSyncPref', () => {
  it('is null before any decision', () => {
    expect(getICloudSyncPref(store())).toBeNull();
  });

  it('reads back both decisions', () => {
    expect(getICloudSyncPref(store({ [ICLOUD_SYNC_PREF_KEY]: 'true' }))).toBe('true');
    expect(getICloudSyncPref(store({ [ICLOUD_SYNC_PREF_KEY]: 'false' }))).toBe('false');
  });

  it('treats a junk value as undecided rather than trusting it', () => {
    expect(getICloudSyncPref(store({ [ICLOUD_SYNC_PREF_KEY]: 'yes' }))).toBeNull();
  });

  it('survives throwing storage', () => {
    expect(getICloudSyncPref(throwingStore())).toBeNull();
  });
});

describe('isICloudSyncEnabled', () => {
  // The compatibility guarantee: shipping this must not switch anyone's sync off.
  it('defaults to enabled when no decision has been made', () => {
    expect(isICloudSyncEnabled(store())).toBe(true);
  });

  it('is enabled after choosing restore', () => {
    expect(isICloudSyncEnabled(store({ [ICLOUD_SYNC_PREF_KEY]: 'true' }))).toBe(true);
  });

  it('is disabled only by an explicit false', () => {
    expect(isICloudSyncEnabled(store({ [ICLOUD_SYNC_PREF_KEY]: 'false' }))).toBe(false);
  });

  it('stays enabled when storage throws', () => {
    expect(isICloudSyncEnabled(throwingStore())).toBe(true);
  });
});

describe('setICloudSyncEnabled', () => {
  it('persists both decisions as strings', () => {
    const s = store();
    setICloudSyncEnabled(true, s);
    expect(s.map[ICLOUD_SYNC_PREF_KEY]).toBe('true');
    setICloudSyncEnabled(false, s);
    expect(s.map[ICLOUD_SYNC_PREF_KEY]).toBe('false');
  });

  // Persisting 'true' is what stops the prompt reappearing every launch.
  it('marks the prompt answered even when the answer is restore', () => {
    const s = store();
    setICloudSyncEnabled(true, s);
    expect(getICloudSyncPref(s)).not.toBeNull();
  });

  it('does not throw when storage refuses', () => {
    expect(() => setICloudSyncEnabled(true, throwingStore())).not.toThrow();
  });
});

describe('shouldPromptFirstRun', () => {
  const base = { decided: false, remoteHasData: true, localHasData: false, icloudAvailable: true };

  it('prompts on a fresh install facing populated cloud data', () => {
    expect(shouldPromptFirstRun(base)).toBe(true);
  });

  // The guard that matters most: existing users must never see this.
  it('does not prompt a device that already has its own data', () => {
    expect(shouldPromptFirstRun({ ...base, localHasData: true })).toBe(false);
  });

  it('does not prompt once a decision exists', () => {
    expect(shouldPromptFirstRun({ ...base, decided: true })).toBe(false);
  });

  it('does not prompt when the cloud copy is empty', () => {
    expect(shouldPromptFirstRun({ ...base, remoteHasData: false })).toBe(false);
  });

  it('does not prompt when iCloud is unreachable', () => {
    expect(shouldPromptFirstRun({ ...base, icloudAvailable: false })).toBe(false);
  });

  it('does not prompt with no arguments', () => {
    expect(shouldPromptFirstRun()).toBe(false);
    expect(shouldPromptFirstRun({})).toBe(false);
  });
});

describe('payloadHasData', () => {
  it('counts tasks and inbox items', () => {
    expect(payloadHasData({ tasks: [{ id: 1 }] })).toBe(true);
    expect(payloadHasData({ unscheduledTasks: [{ id: 1 }] })).toBe(true);
    expect(payloadHasData({ tasks: [{ id: 1 }], unscheduledTasks: [{ id: 2 }] })).toBe(true);
  });

  // A snapshot full of settings and tombstones but no content is not worth
  // interrupting a launch to offer.
  it('is false for a payload with no actual content', () => {
    expect(payloadHasData({ tasks: [], unscheduledTasks: [] })).toBe(false);
    expect(payloadHasData({ darkMode: true, deletedTaskIds: { a: '2026-01-01' } })).toBe(false);
    expect(payloadHasData({})).toBe(false);
  });

  it('is false for missing or non-object input', () => {
    expect(payloadHasData(null)).toBe(false);
    expect(payloadHasData(undefined)).toBe(false);
    expect(payloadHasData('nope')).toBe(false);
  });

  it('ignores non-array collections rather than throwing', () => {
    expect(payloadHasData({ tasks: 'lots' })).toBe(false);
  });
});
