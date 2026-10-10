import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { buildEnvelope, buildEncryptedEnvelope, deriveIntentsRootKey, deriveEnvelopeKey } from '@glance-apps/intents';
import { RELAY_CONFIRM_MS } from '../sync/snapshotFileSync.js';
import {
  mergeEventSets, eventTime, isLive, eventSetKey, serializeEventSet, parseEventSetText, relativeEventsPath, retentionMsFrom,
  readLedger, ledgerAppend, ledgerLive, getCursor, setCursor,
  receiveEnvelope, runEventSetCycle, publishOwnEvent, withEventsLock,
  DIRECT_ACCESS_INTENT_CURSOR_KEY, DIRECT_ACCESS_INTENT_LEDGER_KEY, SELF,
} from './folderIntents.js';

// ─────────────────────────────────────────────────────────────────────────────
// Intents over Direct Access (docs/direct-access-sync.md, Phase 7): the
// event-set file. The real @glance-apps/intents codec builds the envelopes;
// the transport is a fake over one shared file, as the daemon would ferry it.
// ─────────────────────────────────────────────────────────────────────────────

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
beforeEach(() => { global.localStorage = memLocalStorage(); });
afterAll(() => { delete global.localStorage; });

const DAY = 24 * 60 * 60 * 1000;
const RETENTION = 30 * DAY;
const T0 = Date.parse('2026-10-10T12:00:00.000Z');

const payload = (title, over = {}) => ({
  event_id: 'evt', source_app: 'app.testglance', source_entity_id: 'se-1', event: 'completed',
  task_id: 'task-1', title, timestamp: '2026-10-01T00:00:00.000Z', entity_type: 'task', ...over,
});
/** A notify envelope from another app, emitted `ageMs` before T0. */
const foreign = (title, ageMs = 0, over = {}) =>
  buildEnvelope({ action: 'notify', payload: payload(title), emittedBy: 'app.testglance', emittedAt: new Date(T0 - ageMs), ...over });
const mine = (title, ageMs = 0) =>
  buildEnvelope({ action: 'notify', payload: payload(title), emittedBy: SELF, emittedAt: new Date(T0 - ageMs) });

/** A fake transport over one shared file; `folder.text` is what the daemon ferries. */
const fakeTransport = (folder, over = {}) => ({
  id: 'fake-da',
  writeThrottleMs: 0,
  eventsSupported: () => true,
  eventsRead: vi.fn(async () => folder.text),
  eventsWrite: vi.fn(async (rel, text) => { folder.text = text; folder.writes = (folder.writes ?? 0) + 1; return true; }),
  ...over,
});
const fileWith = (...events) => serializeEventSet(events);
const idsIn = (text) => JSON.parse(text).events.map((e) => e.event_id).sort();

describe('the event set', () => {
  it('eventTime reads the stamp, falls back to the id, and gives up on neither', () => {
    const e = foreign('a', 5000);
    expect(eventTime(e)).toBe(T0 - 5000);
    expect(eventTime({ event_id: '20261010T110000Z-abc' })).toBe(Date.parse('2026-10-10T11:00:00Z'));
    expect(eventTime({ event_id: 'nope' })).toBeNull();
    expect(isLive(e, T0, RETENTION)).toBe(true);
    expect(isLive(foreign('old', RETENTION + 1), T0, RETENTION)).toBe(false);
  });

  it('merge is a union keyed by event_id, in id order, without expired envelopes: order-independent and idempotent', () => {
    const a = foreign('a', 3000), b = foreign('b', 2000), c = foreign('c', 1000), old = foreign('old', RETENTION + DAY);
    const opts = { now: T0, retentionMs: RETENTION };
    const ab = mergeEventSets([a, old], [b, c], opts);
    const ba = mergeEventSets([b, c], [a, old], opts);
    expect(eventSetKey(ab)).toBe(eventSetKey(ba));
    expect(ab.map((e) => e.event_id)).toEqual([a, b, c].map((e) => e.event_id).sort());
    expect(eventSetKey(mergeEventSets(ab, [b, c], opts))).toBe(eventSetKey(ab));      // idempotent
    expect(eventSetKey(mergeEventSets(ab, ab, opts))).toBe(eventSetKey(ab));
    // Garbage in the file (a sync tool's stray object) is dropped, not thrown on.
    expect(mergeEventSets([null, {}, { event_id: 7 }, a], [], opts)).toHaveLength(1);
  });

  it('merge repairs a lost append: a copy that lost an event gets it back from any copy that has it', () => {
    const a = foreign('a', 3000), b = foreign('b', 2000);
    const conflicted = [a];                         // last-writer-wins dropped b
    const ours = [a, b];
    expect(idsIn(serializeEventSet(mergeEventSets(conflicted, ours, { now: T0, retentionMs: RETENTION })))).toEqual([a, b].map((e) => e.event_id).sort());
  });

  it('parses the file through the snapshot classification, and names an object that is not a set', () => {
    expect(parseEventSetText(null)).toEqual({ kind: 'absent' });
    expect(parseEventSetText('{"downloading":true}')).toEqual({ kind: 'downloading' });
    expect(parseEventSetText('{"version":1,"ev')).toEqual({ kind: 'unparseable' });
    expect(parseEventSetText('{"error":"gone"}')).toEqual({ kind: 'error', error: 'gone' });
    expect(parseEventSetText('{"version":2,"data":{}}')).toEqual({ kind: 'no-data' });
    const e = foreign('a');
    expect(parseEventSetText(fileWith(e))).toEqual({ kind: 'set', events: [e], writtenBy: null });
    expect(parseEventSetText(serializeEventSet([e], 'mac-1'))).toEqual({ kind: 'set', events: [e], writtenBy: 'mac-1' });
    expect(relativeEventsPath(undefined)).toBe('GLANCE/events/glance-events.json');
    expect(relativeEventsPath('/Shared/ev/')).toBe('Shared/ev/glance-events.json');
  });

  it('retention comes from the shared intents config, default 30 days', () => {
    expect(retentionMsFrom(localStorage)).toBe(30 * DAY);
    localStorage.setItem('dayglance-intent-config', JSON.stringify({ gcRetentionDays: 7 }));
    expect(retentionMsFrom(localStorage)).toBe(7 * DAY);
    localStorage.setItem('dayglance-intent-config', '{bad');
    expect(retentionMsFrom(localStorage)).toBe(30 * DAY);
  });
});

describe('the ledger and the cursor', () => {
  it('appends idempotently, prunes expired entries on read, and survives a corrupt record', () => {
    const a = mine('a', 1000), old = mine('old', RETENTION + DAY);
    ledgerAppend(a, localStorage);
    ledgerAppend(a, localStorage);
    ledgerAppend(old, localStorage);
    ledgerAppend({ no: 'id' }, localStorage);
    expect(Object.keys(readLedger(localStorage))).toHaveLength(2);
    expect(ledgerLive(localStorage, T0, RETENTION).map((e) => e.event_id)).toEqual([a.event_id]);
    expect(Object.keys(readLedger(localStorage))).toEqual([a.event_id]);      // pruned
    localStorage.setItem(DIRECT_ACCESS_INTENT_LEDGER_KEY, '[1,2]');
    expect(readLedger(localStorage)).toEqual({});
    expect(getCursor(localStorage)).toBeNull();
    setCursor(localStorage, 'x');
    expect(localStorage.getItem(DIRECT_ACCESS_INTENT_CURSOR_KEY)).toBe('x');
  });
});

describe('receiveEnvelope', () => {
  const deps = () => ({ handleIntent: vi.fn(async () => ({ success: true })), logActivity: vi.fn(), loadKey: async () => null, storage: localStorage });

  it('handles a foreign plaintext envelope through handleIntent with the event id, and logs it', async () => {
    const d = deps();
    const e = foreign('Walk the dog');
    expect(await receiveEnvelope(e, { ctx: 1 }, d)).toEqual({ handled: true, success: true });
    expect(d.handleIntent).toHaveBeenCalledWith('notify', e.payload, { ctx: 1, eventId: e.event_id });
    expect(d.logActivity).toHaveBeenCalledWith(expect.objectContaining({ direction: 'in', action: 'notify', title: 'Walk the dog', status: 'ok' }));
  });

  it('never handles this app\'s own envelope, raw or parsed', async () => {
    const d = deps();
    expect(await receiveEnvelope(mine('me'), {}, d)).toEqual({ handled: false, skipped: 'own' });
    // Our own notify envelopes can use a shape parseEnvelope rejects (the
    // WebDAV loop's note): the raw check has to come first, or they would be
    // logged as malformed on every device of ours.
    expect(await receiveEnvelope({ emitted_by: SELF, action: 'dance', event_id: 'x' }, {}, d)).toEqual({ handled: false, skipped: 'own' });
    expect(d.handleIntent).not.toHaveBeenCalled();
    expect(d.logActivity).not.toHaveBeenCalled();
  });

  it('an encrypted envelope: opened with the WebDAV intents root key, skipped and logged without one, skipped with the wrong one', async () => {
    const right = await deriveIntentsRootKey('pw', new Uint8Array(16).fill(1));
    const wrong = await deriveIntentsRootKey('pw', new Uint8Array(16).fill(2));
    const sealed = await buildEncryptedEnvelope({ action: 'notify', payload: payload('Secret'), emittedBy: 'app.testglance' }, (salt) => deriveEnvelopeKey(right, salt));
    expect(sealed.encrypted).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const noKey = deps();
      expect(await receiveEnvelope(sealed, {}, noKey)).toEqual({ handled: false, skipped: 'no_root_key' });
      expect(noKey.logActivity).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: 'no_root_key' }));
      const wrongKey = { ...deps(), loadKey: async () => wrong };
      const r = await receiveEnvelope(sealed, {}, wrongKey);
      expect(r.handled).toBe(false);
      expect(wrongKey.handleIntent).not.toHaveBeenCalled();
      const withKey = { ...deps(), loadKey: async () => right };
      expect(await receiveEnvelope(sealed, {}, withKey)).toEqual({ handled: true, success: true });
      expect(withKey.handleIntent.mock.calls[0][1].title).toBe('Secret');
    } finally { warn.mockRestore(); }
  });

  it('a malformed envelope is logged and skipped, never thrown (schema errors as the WebDAV loop logs them)', async () => {
    const d = deps();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await receiveEnvelope({ ...foreign('x'), action: 'dance' }, {}, d);
      expect(r.handled).toBe(false);
      expect(r.skipped).toMatch(/Zod|parse_error/);
      expect(d.logActivity).toHaveBeenCalledWith(expect.objectContaining({ direction: 'in', action: 'unknown', status: 'error', error: r.skipped }));
      expect(d.handleIntent).not.toHaveBeenCalled();
      expect(await receiveEnvelope('not even an object', {}, d)).toMatchObject({ handled: false });
    } finally { warn.mockRestore(); }
  });

  it('multi-user: a CREATE assigned to other users is logged and not handled; one for me is', async () => {
    localStorage.setItem('dayglance-multi-user-enabled', 'true');
    localStorage.setItem('dayglance-multi-user-config', JSON.stringify({ meUserSyncId: 'me' }));
    const create = (assigned) => buildEnvelope({ action: 'create', emittedBy: 'app.testglance', emittedAt: new Date(T0), payload: { title: 'T', source_app: 'app.testglance', assigned_user_ids: assigned } });
    const d = deps();
    expect(await receiveEnvelope(create(['them']), {}, d)).toEqual({ handled: false, skipped: 'not-assigned' });
    expect(d.handleIntent).not.toHaveBeenCalled();
    expect(await receiveEnvelope(create(['me']), {}, d)).toMatchObject({ handled: true });
    expect(await receiveEnvelope(create([]), {}, d)).toMatchObject({ handled: true });
  });
});

describe('runEventSetCycle', () => {
  const io = (over = {}) => ({ storage: localStorage, now: () => T0, retentionMs: RETENTION, receive: vi.fn(async () => {}), log: { warn: vi.fn(), error: vi.fn() }, ...over });
  const fresh = () => ({ lastWriteAt: 0, pendingWrite: null });

  it('a receiver reads, handles what is above its cursor and not its own, advances the cursor, and never writes for what it read', async () => {
    const a = foreign('a', 3000), b = foreign('b', 2000), me = mine('me', 1000);
    const folder = { text: fileWith(a, b, me) };
    const t = fakeTransport(folder);
    const i = io();
    const { outcome } = await runEventSetCycle({ transport: t, io: i, state: fresh() });
    expect(outcome).toMatchObject({ kind: 'merged', received: 2, wrote: false, deferred: false, own: false });
    expect(i.receive.mock.calls.map((c) => c[0].event_id)).toEqual([a.event_id, b.event_id]);
    expect(getCursor(localStorage)).toBe([a, b, me].map((e) => e.event_id).sort().pop());
    expect(t.eventsWrite).not.toHaveBeenCalled();
    // The next cycle finds nothing new.
    const again = await runEventSetCycle({ transport: t, io: i, state: fresh() });
    expect(again.outcome.received).toBe(0);
    expect(i.receive).toHaveBeenCalledTimes(2);
  });

  it('an absent file with nothing of our own is left absent: a receiver never seeds', async () => {
    const folder = { text: null };
    const t = fakeTransport(folder);
    const { outcome } = await runEventSetCycle({ transport: t, io: io(), state: fresh() });
    expect(outcome).toMatchObject({ kind: 'merged', received: 0, wrote: false });
    expect(folder.text).toBeNull();
  });

  it('a sender writes its own events at once (seeding an absent file, or adding to one), carrying any pending drops', async () => {
    const me = mine('me', 1000);
    ledgerAppend(me, localStorage);
    const folder = { text: null };
    const t = fakeTransport(folder);
    expect((await runEventSetCycle({ transport: t, io: io(), state: fresh() })).outcome).toMatchObject({ wrote: true, own: true, confirmed: [] });
    expect(idsIn(folder.text)).toEqual([me.event_id]);
    // Another device's copy lost it (a conflict took the write) and holds an expired one: both repaired by one write.
    const old = foreign('old', RETENTION + DAY), a = foreign('a', 500);
    folder.text = fileWith(old, a);
    const r = await runEventSetCycle({ transport: t, io: io(), state: fresh() });
    expect(r.outcome).toMatchObject({ wrote: true, own: true, dropped: 1 });
    expect(idsIn(folder.text)).toEqual([me.event_id, a.event_id].sort());
    // Now the file holds it: confirmed, nothing to write.
    expect((await runEventSetCycle({ transport: t, io: io(), state: fresh() })).outcome).toMatchObject({ wrote: false, own: false, confirmed: [me.event_id] });
  });

  it('guard: a drop alone is a relay, written only after the file has sat unchanged for RELAY_CONFIRM_MS', async () => {
    const old = foreign('old', RETENTION + DAY), a = foreign('a', 500);
    const folder = { text: fileWith(old, a) };
    const t = fakeTransport(folder);
    let clock = T0;
    const i = io({ now: () => clock });
    let state = fresh();
    let r = await runEventSetCycle({ transport: t, io: i, state });
    expect(r.outcome).toMatchObject({ wrote: false, deferred: true, dropped: 1 });
    state = r.state;
    clock += RELAY_CONFIRM_MS - 1;
    r = await runEventSetCycle({ transport: t, io: i, state });
    expect(r.outcome.wrote).toBe(false);
    state = r.state;
    clock += 1;
    r = await runEventSetCycle({ transport: t, io: i, state });
    expect(r.outcome.wrote).toBe(true);
    expect(idsIn(folder.text)).toEqual([a.event_id]);
    // A file that changed in between starts the relay over.
    const b = foreign('b', 100), old2 = foreign('old2', RETENTION + 2 * DAY);
    folder.text = fileWith(a, b, old2);
    state = fresh();
    clock += 10;
    state = (await runEventSetCycle({ transport: t, io: i, state })).state;
    folder.text = fileWith(a, b, old2, foreign('c', 50));
    clock += RELAY_CONFIRM_MS;
    r = await runEventSetCycle({ transport: t, io: i, state });
    expect(r.outcome).toMatchObject({ wrote: false, deferred: true });
  });

  it('the write throttle holds an own write inside the window; the next cycle writes it', async () => {
    ledgerAppend(mine('me'), localStorage);
    const folder = { text: null };
    const t = fakeTransport(folder, { writeThrottleMs: 15_000 });
    let clock = T0;
    const i = io({ now: () => clock });
    let r = await runEventSetCycle({ transport: t, io: i, state: { lastWriteAt: T0 - 1000, pendingWrite: null } });
    expect(r.outcome).toMatchObject({ wrote: false, own: true });
    clock += 15_000;
    r = await runEventSetCycle({ transport: t, io: i, state: r.state });
    expect(r.outcome.wrote).toBe(true);
  });

  it('maps the file states: unsupported, downloading, unparseable, not a set, unavailable; nothing written, cursor untouched', async () => {
    const t = fakeTransport({ text: null }, { eventsSupported: () => false });
    expect((await runEventSetCycle({ transport: t, io: io(), state: fresh() })).outcome).toEqual({ kind: 'skipped', reason: 'unsupported' });
    for (const [text, reason] of [['{"downloading":true}', 'downloading'], ['{"ver', 'unparseable'], ['{"version":2,"data":{}}', 'no-data']]) {
      const tt = fakeTransport({ text });
      expect((await runEventSetCycle({ transport: tt, io: io(), state: fresh() })).outcome).toEqual({ kind: 'skipped', reason });
      expect(tt.eventsWrite).not.toHaveBeenCalled();
    }
    const err = fakeTransport({ text: '{"error":"folder gone"}' });
    expect((await runEventSetCycle({ transport: err, io: io(), state: fresh() })).outcome).toEqual({ kind: 'error', reason: 'unavailable', error: 'folder gone' });
    expect(getCursor(localStorage)).toBeNull();
  });

  it('a handler that throws is logged, the cursor still moves past the envelope, and the rest are handled', async () => {
    const a = foreign('a', 3000), b = foreign('b', 2000);
    const t = fakeTransport({ text: fileWith(a, b) });
    const i = io({ receive: vi.fn(async (e) => { if (e.event_id === a.event_id) throw new Error('boom'); }) });
    const { outcome } = await runEventSetCycle({ transport: t, io: i, state: fresh() });
    expect(outcome.received).toBe(1);
    expect(i.log.warn).toHaveBeenCalled();
    expect(getCursor(localStorage)).toBe(b.event_id);
  });

  it('a sender-only cycle (no receive) moves no cursor', async () => {
    const t = fakeTransport({ text: fileWith(foreign('a')) });
    await runEventSetCycle({ transport: t, io: io({ receive: undefined }), state: fresh() });
    expect(getCursor(localStorage)).toBeNull();
  });
});

describe('publishOwnEvent (the deliverer\'s half)', () => {
  it('records the envelope, writes, and reports true once the file reads back with it; false when the write fails', async () => {
    const folder = { text: fileWith(foreign('a')) };
    const t = fakeTransport(folder);
    const me = mine('me');
    expect(await publishOwnEvent(t, me, { storage: localStorage, now: () => T0, retentionMs: RETENTION })).toBe(true);
    expect(idsIn(folder.text)).toContain(me.event_id);
    expect(Object.keys(readLedger(localStorage))).toEqual([me.event_id]);
    // Already in the file: confirmed without a write.
    t.eventsWrite.mockClear();
    expect(await publishOwnEvent(t, me, { storage: localStorage, now: () => T0, retentionMs: RETENTION })).toBe(true);
    expect(t.eventsWrite).not.toHaveBeenCalled();
    // A failing write: not delivered, but the ledger keeps it for the next cycle.
    const broken = fakeTransport({ text: null }, { eventsWrite: vi.fn(async () => false) });
    const other = mine('other');
    expect(await publishOwnEvent(broken, other, { storage: localStorage, now: () => T0, retentionMs: RETENTION })).toBe(false);
    expect(readLedger(localStorage)[other.event_id]).toBeTruthy();
    // A file that the daemon has not delivered yet: not delivered either.
    const down = fakeTransport({ text: '{"downloading":true}' });
    expect(await publishOwnEvent(down, mine('x'), { storage: localStorage, now: () => T0, retentionMs: RETENTION })).toBe(false);
  });

  it('withEventsLock serialises overlapping cycles', async () => {
    const order = [];
    const slow = withEventsLock(async () => { await new Promise((r) => setTimeout(r, 5)); order.push('slow'); return 1; });
    const fast = withEventsLock(async () => { order.push('fast'); return 2; });
    expect(await Promise.all([slow, fast])).toEqual([1, 2]);
    expect(order).toEqual(['slow', 'fast']);
    await expect(withEventsLock(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await withEventsLock(async () => 3)).toBe(3);            // a rejection does not jam the lock
  });
});

describe('SCENARIO: two devices on one file', () => {
  it('an intent emitted on one is handled once on the other, survives a conflicted copy, and falls out after retention', async () => {
    const folder = { text: null };
    const device = (name) => {
      const storage = memLocalStorage();
      const dev = { name, storage, clock: T0, handled: [], state: { lastWriteAt: 0, pendingWrite: null } };
      dev.transport = fakeTransport(folder, { id: name });
      dev.run = async () => {
        const r = await runEventSetCycle({
          transport: dev.transport,
          io: { storage, now: () => dev.clock, retentionMs: RETENTION, receive: async (e) => { dev.handled.push(e.event_id); }, log: { warn: vi.fn(), error: vi.fn() } },
          state: dev.state,
        });
        dev.state = r.state;
        return r.outcome;
      };
      dev.emit = (envelope) => publishOwnEvent(dev.transport, envelope, { storage, now: () => dev.clock, retentionMs: RETENTION });
      return dev;
    };
    const mac = device('mac'), phone = device('phone');
    // The phone has already looked at an empty folder: its cursor is unset, nothing to do.
    expect(await phone.run()).toMatchObject({ received: 0, wrote: false });
    // The Mac emits: written at once, read back.
    const e1 = buildEnvelope({ action: 'notify', payload: payload('From the Mac'), emittedBy: 'app.lastglance', emittedAt: new Date(T0 - 5000) });
    expect(await mac.emit(e1)).toBe(true);
    // The phone handles it once, and once only.
    expect(await phone.run()).toMatchObject({ received: 1 });
    expect(await phone.run()).toMatchObject({ received: 0 });
    expect(phone.handled).toEqual([e1.event_id]);
    // The Mac itself never handles its own (the ledger copy is its own emitted_by), and does not touch the cursor on it.
    // (e1 is foreign-named here, so the Mac WOULD handle it: this transport hands the sender's own
    // events back only when emitted_by is this app. Check that path with a SELF envelope.)
    const e2 = mine('Self', -1000);                                     // a second after e1
    expect(await mac.emit(e2)).toBe(true);
    expect(await mac.run()).toMatchObject({ received: 1 });            // e1 is foreign to this app's name
    expect(mac.handled).toEqual([e1.event_id]);                         // e2 is its own: never handled
    // The syncing tool loses the Mac's events in a conflict (the phone's older copy wins).
    folder.text = fileWith();
    expect(await phone.run()).toMatchObject({ received: 0, wrote: false });   // the phone re-adds nothing: not its events
    expect(await mac.run()).toMatchObject({ wrote: true, own: true });        // the Mac's ledger restores them
    expect(idsIn(folder.text)).toEqual([e1.event_id, e2.event_id].sort());
    expect(await phone.run()).toMatchObject({ received: 0 });                 // the phone does not handle e1 twice
    // After retention they fall out: the dropping device relays the drop, the ledger lets go.
    mac.clock += RETENTION + DAY; phone.clock += RETENTION + DAY;
    expect(await mac.run()).toMatchObject({ deferred: true, dropped: 2 });
    mac.clock += RELAY_CONFIRM_MS;
    expect(await mac.run()).toMatchObject({ wrote: true });
    expect(idsIn(folder.text)).toEqual([]);
    expect(readLedger(mac.storage)).toEqual({});
    expect(await mac.run()).toMatchObject({ wrote: false, deferred: false });
  });
});

describe('staggered relays across devices (2026-10-10)', () => {
  it('a write carries writtenBy, a reader learns the writers it sees, and a drop relays a minute later per rank', async () => {
    const old = foreign('old', RETENTION + DAY), a = foreign('a', 500);
    const folder = { text: serializeEventSet([old, a], 'mac-a') };
    const t = fakeTransport(folder);
    const mem = memLocalStorage();
    let clock = T0;
    const io = { storage: mem, now: () => clock, retentionMs: RETENTION, deviceId: 'mac-b', log: { warn: vi.fn(), error: vi.fn() } };
    let state = { lastWriteAt: 0, pendingWrite: null };
    state = (await runEventSetCycle({ transport: t, io, state })).state;          // sees mac-a: rank 1 of [mac-a, mac-b]
    clock += RELAY_CONFIRM_MS;
    let r = await runEventSetCycle({ transport: t, io, state });
    expect(r.outcome.wrote).toBe(false);                                          // mac-a's minute first
    state = r.state;
    clock += 60_000;
    r = await runEventSetCycle({ transport: t, io, state });
    expect(r.outcome.wrote).toBe(true);
    expect(JSON.parse(folder.text).writtenBy).toBe('mac-b');
  });
});
