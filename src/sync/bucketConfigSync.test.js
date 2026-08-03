import { describe, it, expect } from 'vitest';
import { applyRemoteEntity } from './dbAdapter.js';
import { mergeSyncData } from '../mergeSync.js';

// Cross-tier wiring for the bucketConfig slice (Bucket List headings /
// secondListHidden / notes), mirroring dayWindowSync.integration.test.js:
// before these merges existed, the vault tier fell to the default
// LWW-overwrite (the '[dbAdapter] bundle has no merge strategy' console
// warning observed in production) and the FILE tier silently DROPPED the
// slice — the upstream merge predates it and discards unknown keys, so
// heading edits never propagated and each re-upload removed them from the
// file. Resolution on both tiers: whole-object LWW by the embedded
// updatedAt (stamped on every setBucketConfig edit), remote wins ties.

const cfg = (b1, updatedAt) => ({
  headings: { b1, b2: 'Someday' }, secondListHidden: false, notes: '', updatedAt,
});

const emptyData = () => ({
  tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
  completedTaskUids: [], deletedTaskIds: {},
  syncUrl: null, taskCalendarUrl: null,
  routineDefinitions: {}, todayRoutines: [], routinesDate: '',
  minimizedSections: {}, use24HourClock: false,
});

describe('GLANCEvault tier — bucketConfig singleton bundle', () => {
  it('a newer pulled config wins', () => {
    const data = { ...emptyData(), bucketConfig: cfg('Anytime', '2026-08-01T10:00:00Z') };
    applyRemoteEntity(data, {
      _kind: 'singleton', _key: 'bucketConfig',
      value: cfg('Later', '2026-08-02T10:00:00Z'),
    });
    expect(data.bucketConfig.headings.b1).toBe('Later');
  });

  it('an older pulled config loses — the local edit survives the pull', () => {
    const data = { ...emptyData(), bucketConfig: cfg('Renamed', '2026-08-02T10:00:00Z') };
    applyRemoteEntity(data, {
      _kind: 'singleton', _key: 'bucketConfig',
      value: cfg('Anytime', '2026-08-01T10:00:00Z'),
    });
    expect(data.bucketConfig.headings.b1).toBe('Renamed');
  });
});

describe('file tier — mergeSyncData wrapper routes bucketConfig', () => {
  it('the slice SURVIVES the merge at all (the upstream merge drops unknown keys)', () => {
    const local = { ...emptyData(), bucketConfig: cfg('Anytime', '2026-08-01T10:00:00Z') };
    const { data, remoteChanged } = mergeSyncData(local, emptyData());
    expect(data.bucketConfig).toEqual(cfg('Anytime', '2026-08-01T10:00:00Z'));
    // Heals a remote file missing the slice (older client, or pre-fix uploads).
    expect(remoteChanged).toBe(true);
  });

  it('newer side wins in both directions', () => {
    const older = { ...emptyData(), bucketConfig: cfg('Anytime', '2026-08-01T10:00:00Z') };
    const newer = { ...emptyData(), bucketConfig: cfg('Renamed', '2026-08-02T10:00:00Z') };
    expect(mergeSyncData(older, newer).data.bucketConfig.headings.b1).toBe('Renamed');
    expect(mergeSyncData(newer, older).data.bucketConfig.headings.b1).toBe('Renamed');
  });

  it('a losing local edit flags localChanged so the apply actually runs', () => {
    const local = { ...emptyData(), bucketConfig: cfg('Stale', '2026-08-01T10:00:00Z') };
    const remote = { ...emptyData(), bucketConfig: cfg('Fresh', '2026-08-02T10:00:00Z') };
    const { localChanged } = mergeSyncData(local, remote);
    expect(localChanged).toBe(true);
  });
});
