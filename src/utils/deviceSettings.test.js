import { describe, it, expect, beforeEach } from 'vitest';
import { collectDeviceSettings, applyDeviceSettings } from './deviceSettings.js';

// Minimal localStorage stand-in with the iteration surface the util uses.
function makeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    map,
  };
}

describe('collectDeviceSettings', () => {
  let storage;
  beforeEach(() => {
    storage = makeStorage({
      'day-planner-default-view': '"sched"',
      'day-planner-weather-zip': '80301',
      'day-planner-weather-enabled': 'true',
      'day-planner-daily-content-enabled': 'true',
      'day-planner-sched-filter-presets': '[{"id":"1"}]',
      'day-planner-daily-notes': '{"2026-07-22":{"text":"hi"}}',
      'day-planner-deleted-task-ids': '{"t1":"2026-07-01"}',
      // excluded: first-class payload fields
      'day-planner-tasks': '[{"id":"t1"}]',
      'day-planner-cloud-sync-config': '{"url":"x"}',
      // excluded: volatile cursors
      'day-planner-cloud-sync-last-synced': '2026-07-22T00:00:00Z',
      'day-planner-steps-cache': '{"big":"cache"}',
      // not ours
      'someOtherApp-key': 'nope',
      'dayglance-vault-hwm': '42',
    });
  });

  it('captures day-planner settings and device-local data stores', () => {
    const out = collectDeviceSettings(storage);
    expect(out['day-planner-default-view']).toBe('"sched"');
    expect(out['day-planner-weather-zip']).toBe('80301');
    expect(out['day-planner-sched-filter-presets']).toBe('[{"id":"1"}]');
    expect(out['day-planner-daily-notes']).toBe('{"2026-07-22":{"text":"hi"}}');
    expect(out['day-planner-deleted-task-ids']).toBe('{"t1":"2026-07-01"}');
  });

  it('skips payload-owned blobs, volatile cursors, and foreign keys', () => {
    const out = collectDeviceSettings(storage);
    expect(out['day-planner-tasks']).toBeUndefined();
    expect(out['day-planner-cloud-sync-config']).toBeUndefined();
    expect(out['day-planner-cloud-sync-last-synced']).toBeUndefined();
    expect(out['day-planner-steps-cache']).toBeUndefined();
    expect(out['someOtherApp-key']).toBeUndefined();
    expect(out['dayglance-vault-hwm']).toBeUndefined();
  });
});

describe('applyDeviceSettings', () => {
  it('round-trips a captured map', () => {
    const source = makeStorage({
      'day-planner-default-view': '"sched"',
      'day-planner-week-start-day': '1',
    });
    const target = makeStorage();
    const applied = applyDeviceSettings(collectDeviceSettings(source), target);
    expect(applied).toBe(2);
    expect(target.getItem('day-planner-default-view')).toBe('"sched"');
    expect(target.getItem('day-planner-week-start-day')).toBe('1');
  });

  it('refuses foreign keys, excluded keys, and non-string values', () => {
    const target = makeStorage();
    const applied = applyDeviceSettings({
      'evil-key': 'x',
      'day-planner-tasks': '[]',
      'day-planner-cloud-sync-last-synced': 'stale',
      'day-planner-weather-zip': 12345,
      'day-planner-weather-enabled': 'true',
    }, target);
    expect(applied).toBe(1);
    expect(target.getItem('day-planner-weather-enabled')).toBe('true');
    expect(target.getItem('evil-key')).toBeNull();
    expect(target.getItem('day-planner-tasks')).toBeNull();
    expect(target.getItem('day-planner-weather-zip')).toBeNull();
  });

  it('tolerates null/garbage input', () => {
    const target = makeStorage();
    expect(applyDeviceSettings(null, target)).toBe(0);
    expect(applyDeviceSettings('junk', target)).toBe(0);
  });
});
