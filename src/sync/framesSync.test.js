// GTD frames through both sync tiers, end to end.
//
// WHY THIS EXISTS. CLAUDE.md, "Testing it": assert the field is observable where
// the app actually reads it, not that the function that computes it returned it.
// `originalPlan` had unit tests on every boundary and still shipped in a state
// where it never survived one sync cycle, because nothing tested the path BETWEEN
// the modules. Frames were in that position: mergeSync.test.js covered the
// file-tier merge in isolation and dbAdapter.losslessness.test.js covered the
// collection's registration, and nothing walked an EDIT from one device to
// another through either tier.
//
// That gap cost real time. When frame edits made on a Mac reached five devices
// and neither Android one (v5.4.0 pre-release testing), the whole sync path had
// to be re-read by eye to rule it out, because no scenario could be run to do it.
// The cause turned out to be the stranded pull cursor #1861 fixes, not frames —
// but establishing that took hours it should not have.
//
// WHAT EACH SCENARIO WALKS. The vault tier drives the REAL dbAdapter callbacks
// through dbVaultSim (shredState / getLocalEntity / applyRemoteEntity), so a
// collection that is not registered, or whose timestamp field is wrong, fails
// here. The file tier runs the real mergeSyncData. The three edits are the ones
// from the incident: a recurring frame's days, a skip-this-day exception, and a
// per-date time adjust.
import { describe, it, expect } from 'vitest';
import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';
import { makeEntityId, COLLECTION_KINDS } from '@glance-apps/dayglance-vault';
import { mergeSyncData } from '../mergeSync.js';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const ALL_DAYS = [...WEEKDAYS, 'saturday', 'sunday'];
const T0 = '2026-09-26T09:00:00.000Z';
const T1 = '2026-09-27T10:00:00.000Z'; // the edit, later than T0
const DAY = '2026-09-27';

// A recurring frame, as the editor writes one.
const F = (id, label, over = {}) => ({
  id, label, days: [...WEEKDAYS], start: '18:00', end: '20:00',
  color: '#3b82f6', enabled: true, bufferMinutes: 5, lastModified: T0, ...over,
});

const EMPTY_VAULT_DATA = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], areas: [], gtdFrames: [], users: [], dailyNotes: {},
};

const emptyFileData = () => ({
  tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
  completedTaskUids: [], deletedTaskIds: {}, deletedRoutineChipIds: {},
  deletedFrameIds: {}, syncUrl: null, taskCalendarUrl: null,
  routineDefinitions: {}, todayRoutines: [], routinesDate: '',
  minimizedSections: {}, use24HourClock: false, gtdFrames: [],
});

const frameId = (id) => makeEntityId('gtdFrames', id);
const getFrame = (device, id) => device.data.gtdFrames.find((f) => f.id === id);

// The edits, written exactly as the app writes them (App.jsx saveFrame /
// skipFrameForDay / saveFrameAdjust, useDragDrop's frame resize): every one
// stamps lastModified, which is what makes the row diff as changed.
const editDays = (data, id, days) => {
  data.gtdFrames = data.gtdFrames.map((f) => (f.id === id ? { ...f, days, lastModified: T1 } : f));
  return [frameId(id)];
};
const skipForDay = (data, id, dateStr) => {
  data.gtdFrames = data.gtdFrames.map((f) => (f.id === id
    ? { ...f, lastModified: T1, exceptions: { ...(f.exceptions || {}), [dateStr]: { ...(f.exceptions?.[dateStr] || {}), deleted: true } } }
    : f));
  return [frameId(id)];
};
const adjustForDay = (data, id, dateStr, start, end) => {
  data.gtdFrames = data.gtdFrames.map((f) => (f.id === id
    ? { ...f, lastModified: T1, exceptions: { ...(f.exceptions || {}), [dateStr]: { ...(f.exceptions?.[dateStr] || {}), start, end, deleted: false } } }
    : f));
  return [frameId(id)];
};

describe('gtdFrames: the collection is declared to the vault tier', () => {
  // Two different mutations, and only one of them is behavioural.
  //
  // Removing gtdFrames from COLLECTION_KINDS breaks every vault-tier scenario
  // below: an unregistered kind is not shredded into rows at all.
  //
  // Setting the WRONG tsField breaks nothing observable, because
  // getEntityLastModified falls back through `?? value.lastModified ??
  // value.updatedAt ?? value.createdAt` (dbAdapter.js:155). So this assertion is
  // the only thing that catches it, and it is not redundant with the scenarios:
  // it pins the declaration a reader would otherwise have to trust.
  it('is registered with lastModified as its timestamp field', () => {
    expect(COLLECTION_KINDS.gtdFrames).toEqual({ idField: 'id', tsField: 'lastModified' });
  });
});

describe('GTD frames across two devices: vault tier', () => {
  const twoDevices = (frames) => {
    const vault = createVault();
    const mac = createDevice('mac', { ...EMPTY_VAULT_DATA, gtdFrames: frames });
    const android = createDevice('android', EMPTY_VAULT_DATA);
    // Seed: the Mac publishes, the phone takes them.
    mac.markDirty(frameId(frames[0].id));
    for (const f of frames.slice(1)) mac.markDirty(frameId(f.id));
    syncToConvergence(mac, android, vault);
    return { vault, mac, android };
  };

  it('a schedule change (weekdays to every day) reaches the other device', () => {
    const { vault, mac, android } = twoDevices([F('f1', 'Evening App Work')]);
    expect(getFrame(android, 'f1').days).toEqual(WEEKDAYS);

    mac.mutate((d) => editDays(d, 'f1', ALL_DAYS));
    syncToConvergence(mac, android, vault);

    expect(getFrame(android, 'f1').days).toEqual(ALL_DAYS);
    expect(getFrame(android, 'f1').lastModified).toBe(T1);
  });

  it('a skip-this-day exception reaches the other device', () => {
    const { vault, mac, android } = twoDevices([F('f1', 'Weekend Errands')]);

    mac.mutate((d) => skipForDay(d, 'f1', DAY));
    syncToConvergence(mac, android, vault);

    expect(getFrame(android, 'f1').exceptions[DAY]).toEqual({ deleted: true });
  });

  it('a per-date time adjust reaches the other device', () => {
    const { vault, mac, android } = twoDevices([F('f1', 'Weekend app work')]);

    mac.mutate((d) => adjustForDay(d, 'f1', DAY, '18:00', '23:00'));
    syncToConvergence(mac, android, vault);

    expect(getFrame(android, 'f1').exceptions[DAY]).toEqual({ start: '18:00', end: '23:00', deleted: false });
    // The frame's own times are untouched: an exception is per-date.
    expect(getFrame(android, 'f1').end).toBe('20:00');
  });

  it('an edit that does not stamp lastModified never propagates', () => {
    // This is what makes the stamp load-bearing rather than cosmetic, and why
    // saveFrame trusting its caller to stamp is a trap: the row still pushes,
    // and the receiving device's own copy wins on the tie, so the edit is
    // silently dropped with no error anywhere.
    const { vault, mac, android } = twoDevices([F('f1', 'Evening App Work')]);

    mac.mutate((d) => {
      d.gtdFrames = d.gtdFrames.map((f) => (f.id === 'f1' ? { ...f, days: ALL_DAYS } : f));
      return [frameId('f1')];
    });
    syncToConvergence(mac, android, vault);

    expect(getFrame(android, 'f1').days).toEqual(WEEKDAYS);
  });

  it('a device holding a stale copy takes the newer edit', () => {
    // The ordinary case for a device that was closed while the edit was made.
    const { vault, mac, android } = twoDevices([F('f1', 'Evening App Work')]);

    android.mutate((d) => editDays(d, 'f1', ALL_DAYS));
    syncToConvergence(mac, android, vault);

    expect(getFrame(mac, 'f1').days).toEqual(ALL_DAYS);
    expect(getFrame(android, 'f1').days).toEqual(ALL_DAYS);
  });

  it('a newer edit is not lost to an older copy arriving after it', () => {
    // The receiving side must keep its own newer copy. Only this direction is
    // asserted: a device whose CLOCK is behind can stamp a fresh edit in the
    // past, and last-writer-wins then cannot converge — that device keeps its
    // own row and the fleet keeps theirs, until the next edit breaks the tie.
    // That is a property of LWW with device clocks, not of frames, and every
    // collection here shares it, so it is out of this suite's scope.
    const { vault, mac, android } = twoDevices([F('f1', 'Evening App Work')]);

    android.mutate((d) => editDays(d, 'f1', ALL_DAYS));
    syncToConvergence(mac, android, vault);

    mac.mutate((d) => {
      d.gtdFrames = d.gtdFrames.map((f) => (f.id === 'f1'
        ? { ...f, days: ['monday'], lastModified: T0 } : f));
      return [frameId('f1')];
    });
    syncToConvergence(mac, android, vault);

    expect(getFrame(android, 'f1').days).toEqual(ALL_DAYS);
  });

  it('a frame deleted on one device does not resurrect from the other', () => {
    const { vault, mac, android } = twoDevices([F('f1', 'Deep Work'), F('f2', 'Admin')]);
    expect(android.data.gtdFrames).toHaveLength(2);

    mac.mutate((d) => {
      d.gtdFrames = d.gtdFrames.filter((f) => f.id !== 'f2');
      return [frameId('f2')];
    });
    syncToConvergence(mac, android, vault);

    expect(android.data.gtdFrames.map((f) => f.id)).toEqual(['f1']);
    expect(mac.data.gtdFrames.map((f) => f.id)).toEqual(['f1']);
  });
});

describe('GTD frames across two devices: file tier', () => {
  it('carries a schedule change, a skip and an adjust', () => {
    const edited = F('f1', 'Evening App Work', {
      days: ALL_DAYS,
      lastModified: T1,
      exceptions: {
        [DAY]: { deleted: true },
        '2026-09-28': { start: '18:00', end: '23:00', deleted: false },
      },
    });
    const mac = { ...emptyFileData(), gtdFrames: [edited] };
    const android = { ...emptyFileData(), gtdFrames: [F('f1', 'Evening App Work')] };

    const { data } = mergeSyncData(android, mac);
    const f = data.gtdFrames.find((x) => x.id === 'f1');

    expect(f.days).toEqual(ALL_DAYS);
    expect(f.exceptions[DAY]).toEqual({ deleted: true });
    expect(f.exceptions['2026-09-28']).toEqual({ start: '18:00', end: '23:00', deleted: false });
  });

  it('keeps the newer copy when both sides edited', () => {
    const mac = { ...emptyFileData(), gtdFrames: [F('f1', 'Evening App Work', { days: ALL_DAYS, lastModified: T1 })] };
    const android = { ...emptyFileData(), gtdFrames: [F('f1', 'Evening App Work', { days: ['monday'], lastModified: T0 })] };

    expect(mergeSyncData(android, mac).data.gtdFrames[0].days).toEqual(ALL_DAYS);
    // Order-independent: the same verdict whichever side is "local".
    expect(mergeSyncData(mac, android).data.gtdFrames[0].days).toEqual(ALL_DAYS);
  });

  it('honours a frame tombstone newer than the surviving copy', () => {
    const mac = { ...emptyFileData(), gtdFrames: [], deletedFrameIds: { f1: T1 } };
    const android = { ...emptyFileData(), gtdFrames: [F('f1', 'Deep Work')] };

    expect(mergeSyncData(android, mac).data.gtdFrames).toEqual([]);
  });
});
