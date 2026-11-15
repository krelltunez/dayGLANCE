import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleIntent, intentWriteStamp } from './handleIntent.js';
import { stampTimestamps } from '../utils/stampTimestamps.js';
import { mergeTaskArrays } from '../mergeSync.js';
import { shredState, applyRemoteEntity, getLocalEntity, getEntityLastModified } from '@glance-apps/dayglance-vault';

// A chore sent from lastGLANCE arrives as a CREATE intent that every device
// on the account drains, each when it gets to it. The task has a
// deterministic id, so the copies are one row to sync, and sync keeps the
// copy with the newer lastModified, whole.
//
// The field report: a chore arrives all-day, the user gives it a time, and
// later "some device shifts it back to all-day". That device was the one
// that drained the intent LAST: it had not pulled the task yet, built it as
// it was sent, and the save pass stamped it now, newer than the user's edit.
//
// These walk the path that failed: drain → save (stamp) → push → merge, on
// two devices, through the real handler, the real stamp pass and both tiers'
// real merges.

const at = (h, m = 0) => new Date(Date.UTC(2026, 10, 15, h, m, 0));
const iso = (h, m = 0) => at(h, m).toISOString();

/** A device: its lists, what it last saved, and the app's save pass. */
function device() {
  const d = {
    tasks: [], inbox: [], recurring: [], recycleBin: [],
    stored: { tasks: [], inbox: [], recurring: [] },
    ctx() {
      return {
        tasks: d.tasks, unscheduledTasks: d.inbox, recurringTasks: d.recurring, recycleBin: d.recycleBin,
        setTasks: (up) => { d.tasks = up(d.tasks); },
        setUnscheduledTasks: (up) => { d.inbox = up(d.inbox); },
        setRecurringTasks: (up) => { d.recurring = up(d.recurring); },
        deletedTaskIds: {},
      };
    },
    /** Drain one envelope, as the transports do (eventId and emittedAt from the envelope). */
    async drain(envelope) {
      return handleIntent('create', envelope.payload, {
        ...d.ctx(), eventId: envelope.event_id, ...(envelope.emitted_at ? { emittedAt: envelope.emitted_at } : {}),
      });
    },
    /** The save pass: stamp what changed since the stored copy, then store. */
    save() {
      const now = new Date().toISOString();
      d.tasks = stampTimestamps(d.tasks, d.stored.tasks, now);
      d.inbox = stampTimestamps(d.inbox, d.stored.inbox, now);
      d.recurring = stampTimestamps(d.recurring, d.stored.recurring, now);
      d.stored = { tasks: d.tasks, inbox: d.inbox, recurring: d.recurring };
    },
    /** The user gives the all-day task a time, as the app's edit does. */
    schedule(id, startTime, duration) {
      d.tasks = d.tasks.map((t) => (t.id === id ? { ...t, startTime, duration, isAllDay: false } : t));
    },
  };
  return d;
}

const CHORE = {
  event_id: '20261115T080000Z-chore', emitted_at: iso(8),
  payload: { title: 'Water the plants', due: '2026-11-15', source_app: 'app.lastglance', source_entity_id: 'chore-7' },
};

/** What both devices hold after syncing, by each tier's own merge. */
const fileTier = (a, b) => mergeTaskArrays(a.tasks, b.tasks, {}).merged;
// The vault tier: the adapter's rows and accessors under the engine's rule
// (@glance-apps/sync dbEngine: a pulled row replaces the local one only when
// its stamp is strictly newer; otherwise local stays and is pushed back).
const stampMs = (entity) => Date.parse(getEntityLastModified(entity)) || 0;
const vaultTier = (local, remote) => {
  const data = { tasks: structuredClone(local.tasks), unscheduledTasks: [], recurringTasks: [], recycleBin: [] };
  for (const row of shredState({ tasks: remote.tasks })) {
    const pulled = JSON.parse(JSON.stringify(row.entity));
    const mine = getLocalEntity(data, row.entityId);
    if (mine == null || stampMs(pulled) > stampMs(mine)) applyRemoteEntity(data, pulled);
  }
  return data.tasks;
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('a chore sent as an intent, drained by two devices at different times', () => {
  it('the task the user scheduled stays scheduled when a second device drains the chore late', async () => {
    const phone = device();
    const desktop = device();

    vi.setSystemTime(at(8, 1));           // the phone drains it a minute after it was sent
    const made = await phone.drain(CHORE);
    phone.save();
    expect(phone.tasks[0]).toMatchObject({ isAllDay: true, startTime: '00:00', date: '2026-11-15' });

    vi.setSystemTime(at(9));              // the user gives it a time
    phone.schedule(made.task_id, '14:00', 45);
    phone.save();
    expect(phone.tasks[0].lastModified).toBe(iso(9));

    vi.setSystemTime(at(18));             // the desktop wakes, and drains the chore before it has pulled
    await desktop.drain(CHORE);
    desktop.save();
    expect(desktop.tasks).toHaveLength(1);
    expect(desktop.tasks[0].id).toBe(made.task_id);
    // Its copy is the chore as sent, stamped when it was SENT, not at 18:00.
    expect(desktop.tasks[0]).toMatchObject({ isAllDay: true, lastModified: iso(8) });

    // Whichever way the copies meet, on either tier, the user's schedule stands.
    const scheduled = { startTime: '14:00', duration: 45, isAllDay: false, lastModified: iso(9) };
    for (const [name, merged] of [
      ['file tier, phone merges desktop', fileTier(phone, desktop)],
      ['file tier, desktop merges phone', fileTier(desktop, phone)],
      ['vault tier, desktop pulls phone', vaultTier(desktop, phone)],
      ['vault tier, phone pulls desktop', vaultTier(phone, desktop)],
    ]) {
      expect(merged, name).toHaveLength(1);
      expect(merged[0], name).toMatchObject(scheduled);
    }
  });

  it('two devices that drain it at different times, with no edit between, build the same row', async () => {
    const a = device();
    const b = device();
    vi.setSystemTime(at(8, 1)); await a.drain(CHORE); a.save();
    vi.setSystemTime(at(21, 30)); await b.drain(CHORE); b.save();
    expect(b.tasks).toEqual(a.tasks);
    expect(a.tasks[0].lastModified).toBe(iso(8));
  });

  it('an inbox task and a repeating one are stamped the same way', async () => {
    const d = device();
    vi.setSystemTime(at(12));
    await d.drain({ event_id: 'e-inbox', emitted_at: iso(8), payload: { title: 'Call the bank', source_app: 'app.lastglance', source_entity_id: 'p-1' } });
    await d.drain({ event_id: 'e-rec', emitted_at: iso(8, 30), payload: { title: 'Stretch', recurring: 'daily', due: '2026-11-15', source_app: 'app.lastglance', source_entity_id: 'c-9' } });
    d.save();
    expect(d.inbox[0].lastModified).toBe(iso(8));
    expect(d.recurring[0].lastModified).toBe(iso(8, 30));
  });

  it('an emitter whose clock runs ahead cannot stamp the task later than now', async () => {
    const d = device();
    vi.setSystemTime(at(8));
    await d.drain({ ...CHORE, emitted_at: iso(8, 20) });
    d.save();
    expect(d.tasks[0].lastModified).toBe(iso(8));
    expect(intentWriteStamp(iso(8, 20))).toBe(iso(8));
  });
});

describe('the same create arriving where the task already exists', () => {
  const setup = async () => {
    const d = device();
    vi.setSystemTime(at(8, 1));
    const made = await d.drain(CHORE);
    d.save();
    return { d, id: made.task_id };
  };

  it('changes nothing after the user renamed the task and added a note', async () => {
    const { d, id } = await setup();
    vi.setSystemTime(at(9));
    d.tasks = d.tasks.map((t) => (t.id === id ? { ...t, title: 'Water the ferns only', notes: 'not the cactus' } : t));
    d.save();
    const edited = d.tasks[0];

    vi.setSystemTime(at(18));             // the transport presents the same intent again
    const r = await d.drain(CHORE);
    d.save();
    expect(r).toMatchObject({ success: true, task_id: id });
    expect(d.tasks[0]).toEqual(edited);   // title, notes and stamp as the user left them
  });

  it('changes nothing on an untouched task either, and restamps nothing', async () => {
    const { d } = await setup();
    const before = d.tasks[0];
    vi.setSystemTime(at(18));
    const r = await d.drain(CHORE);
    d.save();
    expect(d.tasks[0]).toEqual(before);
    // Not applied at all: an intent as old as the row is the one that made it.
    expect(r.warning).toMatch(/not newer/);
  });

  it('a create the source emits LATER (the chore renamed there) still updates the task', async () => {
    const { d, id } = await setup();
    vi.setSystemTime(at(9));
    d.schedule(id, '14:00', 45);
    d.save();
    vi.setSystemTime(at(10, 1));
    await d.drain({ event_id: 'later', emitted_at: iso(10), payload: { ...CHORE.payload, title: 'Water the plants and the herbs' } });
    d.save();
    // The new title, on the task as the user scheduled it.
    expect(d.tasks[0]).toMatchObject({ title: 'Water the plants and the herbs', startTime: '14:00', isAllDay: false });
  });
});

describe('a transport with no emit time (an Android broadcast, a URL action)', () => {
  const BARE = { event_id: undefined, payload: CHORE.payload };

  it('creates the task unstamped, and the save pass stamps it now, as before', async () => {
    const d = device();
    vi.setSystemTime(at(8, 1));
    await d.drain(BARE);
    expect(d.tasks[0]).not.toHaveProperty('lastModified');
    d.save();
    expect(d.tasks[0].lastModified).toBe(iso(8, 1));
  });

  it('still updates an existing task from a repeated create', async () => {
    const d = device();
    vi.setSystemTime(at(8, 1));
    await d.drain(BARE);
    d.save();
    vi.setSystemTime(at(9));
    const r = await d.drain({ ...BARE, payload: { ...CHORE.payload, title: 'Water everything' } });
    expect(r.warning).toBe('Updated existing task');
    expect(d.tasks[0].title).toBe('Water everything');
  });
});

describe('intentWriteStamp', () => {
  it('is the emit time as an ISO string, never later than now, and null without one', () => {
    vi.setSystemTime(at(12));
    expect(intentWriteStamp(iso(8))).toBe(iso(8));
    expect(intentWriteStamp('2026-11-15T09:00:00+01:00')).toBe(iso(8));
    expect(intentWriteStamp(iso(13))).toBe(iso(12));
    for (const none of [undefined, null, '', 'not a date', 1731657600000]) expect(intentWriteStamp(none), String(none)).toBeNull();
  });
});

// The stamp only works if the transport hands the handler the envelope's emit
// time. The vault transport is exercised in dbIntentsReceive.test.js; the
// WebDAV and iCloud pollers have no harness, so every drain of an envelope in
// this folder is held to the same call by its source.
describe('every transport that drains an envelope passes its emit time', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const sources = readdirSync(dir).filter((f) => f.endsWith('.js') && !f.includes('.test.'));
  const calls = sources.flatMap((file) => {
    const text = readFileSync(dir + file, 'utf8');
    return [...text.matchAll(/handleIntent\(envelope\.action,[^\n]*/g)].map((m) => ({ file, call: m[0] }));
  });

  it('finds the three drains: the vault transport and the two file pollers', () => {
    expect(calls.map((c) => c.file).sort()).toEqual(['dbIntentsTransport.js', 'useIntentPoller.js', 'useIntentPoller.js']);
  });

  it('each passes eventId and emittedAt from the envelope', () => {
    for (const { file, call } of calls) {
      expect(call, file).toContain('eventId: envelope.event_id');
      expect(call, file).toContain('emittedAt: envelope.emitted_at');
    }
  });
});
