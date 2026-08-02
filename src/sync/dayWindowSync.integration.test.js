import { describe, it, expect } from 'vitest';
import { shredState, applyRemoteEntity } from './dbAdapter.js';
import { mergeSyncData } from '../mergeSync.js';
import { DEFAULTS_KEY } from './dayWindowSync.js';

// Cross-tier integration: the dayWindows slice through the two real transports.
// The pure merge is covered in dayWindowSync.test.js; these prove the WIRING —
// that the vault shreds/applies the slice at per-entry grain and the file-tier
// wrapper actually routes it (the upstream merge predates the slice and drops
// unknown keys, so a missing wrapper line would silently lose windows on every
// file sync).

const entry = (start, stop, lastModified) => ({ start, stop, lastModified });

// Minimal payload-data shape, mirroring mergeSync.test.js's emptyData.
const emptyData = () => ({
  tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
  completedTaskUids: [], deletedTaskIds: {},
  syncUrl: null, taskCalendarUrl: null,
  routineDefinitions: {}, todayRoutines: [], routinesDate: '',
  minimizedSections: {}, use24HourClock: false,
});

describe('GLANCEvault tier — dayWindows singleton bundle', () => {
  it('shreds the map as one singleton row', () => {
    const data = {
      ...emptyData(),
      dayWindows: {
        [DEFAULTS_KEY]: entry('08:00', '22:00', '2026-08-06T08:00:00Z'),
        '2026-08-06': entry('07:00', '21:00', '2026-08-06T09:00:00Z'),
      },
    };
    const rows = shredState(data);
    const windowRows = rows.filter((r) => r.entity._kind === 'singleton' && r.entity._key === 'dayWindows');
    expect(windowRows).toHaveLength(1);
    expect(windowRows[0].entity.value['2026-08-06']).toEqual(entry('07:00', '21:00', '2026-08-06T09:00:00Z'));
  });

  it('applies a pulled row at per-entry grain: different days both survive, newer entry wins', () => {
    const data = {
      ...emptyData(),
      dayWindows: {
        '2026-08-06': entry('07:00', '22:00', '2026-08-06T12:00:00Z'), // newer locally
        '2026-08-07': entry('09:00', '21:00', '2026-08-06T08:00:00Z'),
      },
    };
    applyRemoteEntity(data, {
      _kind: 'singleton',
      _key: 'dayWindows',
      value: {
        '2026-08-06': entry('01:00', '02:00', '2026-08-06T08:00:00Z'), // older — must lose
        '2026-08-08': entry('06:00', '20:00', '2026-08-06T10:00:00Z'), // new day — must land
      },
    });
    expect(data.dayWindows['2026-08-06']).toEqual(entry('07:00', '22:00', '2026-08-06T12:00:00Z'));
    expect(data.dayWindows['2026-08-07']).toEqual(entry('09:00', '21:00', '2026-08-06T08:00:00Z'));
    expect(data.dayWindows['2026-08-08']).toEqual(entry('06:00', '20:00', '2026-08-06T10:00:00Z'));
  });

  it('a newer explicit-off propagates through the vault (clears need no tombstones)', () => {
    const data = {
      ...emptyData(),
      dayWindows: { '2026-08-09': entry('08:00', '22:00', '2026-08-06T08:00:00Z') },
    };
    applyRemoteEntity(data, {
      _kind: 'singleton',
      _key: 'dayWindows',
      value: { '2026-08-09': entry(null, null, '2026-08-06T12:00:00Z') },
    });
    expect(data.dayWindows['2026-08-09']).toEqual(entry(null, null, '2026-08-06T12:00:00Z'));
  });
});

describe('file tier — mergeSyncData wrapper routes dayWindows', () => {
  it('merges per-entry across devices and flags both sides for the heal', () => {
    const deviceA = {
      ...emptyData(),
      dayWindows: {
        [DEFAULTS_KEY]: entry('08:00', '22:00', '2026-08-06T08:00:00Z'),
        '2026-08-06': entry('07:00', '21:00', '2026-08-06T09:00:00Z'),
      },
    };
    const deviceB = {
      ...emptyData(),
      dayWindows: {
        [DEFAULTS_KEY]: entry('09:00', '23:00', '2026-08-06T11:00:00Z'), // newer defaults
        '2026-08-07': entry('06:00', '20:00', '2026-08-06T10:00:00Z'),   // only on B
      },
    };
    const { data, localChanged, remoteChanged } = mergeSyncData(deviceA, deviceB);

    expect(data.dayWindows[DEFAULTS_KEY]).toEqual(entry('09:00', '23:00', '2026-08-06T11:00:00Z'));
    expect(data.dayWindows['2026-08-06']).toEqual(entry('07:00', '21:00', '2026-08-06T09:00:00Z'));
    expect(data.dayWindows['2026-08-07']).toEqual(entry('06:00', '20:00', '2026-08-06T10:00:00Z'));
    // A pulled newer defaults → local must apply; a local-only day missing
    // remotely → remote file must be healed by a re-upload.
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(true);
  });

  it('survives a remote file written by an old client (slice missing): local windows are kept and re-uploaded', () => {
    // The transitional caveat, pinned: an un-upgraded device's upload omits the
    // slice; the merge must treat that as "nothing remote", never as a delete.
    const local = {
      ...emptyData(),
      dayWindows: { [DEFAULTS_KEY]: entry('08:00', '22:00', '2026-08-06T08:00:00Z') },
    };
    const { data, remoteChanged } = mergeSyncData(local, emptyData());
    expect(data.dayWindows[DEFAULTS_KEY]).toEqual(entry('08:00', '22:00', '2026-08-06T08:00:00Z'));
    expect(remoteChanged).toBe(true); // heal the remote file
  });

  it('identical maps on both sides raise no change flags from this slice', () => {
    const map = { [DEFAULTS_KEY]: entry('08:00', '22:00', '2026-08-06T08:00:00Z') };
    const a = { ...emptyData(), dayWindows: { ...map } };
    const b = { ...emptyData(), dayWindows: { ...map } };
    const { localChanged, remoteChanged } = mergeSyncData(a, b);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });
});
