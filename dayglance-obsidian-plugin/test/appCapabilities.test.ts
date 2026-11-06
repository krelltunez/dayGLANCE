// The plugin's reader of the app's capability rows (src/appCapabilities.ts,
// companion spec 4.2.2): a positive answer is cached (memory and the
// device-local store, per pairing), a negative one is asked again every
// time, and a row that cannot be read is "unknown", never "yes".
import { describe, it, expect, vi } from 'vitest';
import { sealBridgeEnvelope, bridgeCapabilityPayload } from '@glance-apps/obsidian-format';
import { AppCapabilities, pairingKeyOf, type CapabilityCache } from '../src/appCapabilities';
import type { DeviceLocalStore } from '../src/localState';
import type { BridgePairing } from '../src/pairing';

const keyOf = (fill: number) => crypto.subtle.importKey('raw', new Uint8Array(32).fill(fill), 'AES-GCM', false, ['encrypt', 'decrypt']);
const pairing = (generation = 'gen-1', accountId = 'acc-1'): BridgePairing => ({
  vaultUrl: 'https://vault.test', accountId, deviceToken: 't', subkeyB64: generation, pairingSalt: 's', generation, pairedAt: '2026-11-01T00:00:00Z',
});
const memoryStore = (): DeviceLocalStore<CapabilityCache> & { value: CapabilityCache | null } => {
  const s = { available: true, value: null as CapabilityCache | null, load: () => s.value, save: (v: CapabilityCache | null) => { s.value = v ? JSON.parse(JSON.stringify(v)) : null; } };
  return s;
};

async function setup({ rows = {} as Record<string, unknown>, braked = false, store = memoryStore() } = {}) {
  let current = pairing();
  const keys: Record<string, CryptoKey> = { 'gen-1': await keyOf(1), 'gen-2': await keyOf(2) };
  const getRow = vi.fn(async (_p: BridgePairing, id: string) => {
    const r = rows[id];
    if (r instanceof Error) throw r;
    return r ?? null;
  });
  const gate = { braked, reportRateLimit: vi.fn(), reportRequestSuccess: vi.fn() };
  const caps = new AppCapabilities({
    getPairing: () => current,
    getRow,
    subkeyOf: async (p) => keys[p.generation],
    isRateLimited: () => gate.braked,
    reportRateLimit: gate.reportRateLimit,
    reportRequestSuccess: gate.reportRequestSuccess,
    store,
  });
  return { caps, getRow, gate, store, keys, setPairing: (p: BridgePairing) => { current = p; } };
}
const capRow = async (key: CryptoKey, name = 'task_create', gen = 'gen-1') => ({ entityId: `meta:cap:${name}`, envelope: await sealBridgeEnvelope(key, bridgeCapabilityPayload(name), gen) });

describe('appSupports: the capability reader', () => {
  it('YES is read once: cached in memory and in the device-local store, so a reload does not ask again', async () => {
    const k1 = await keyOf(1);
    const t = await setup({ rows: { 'meta:cap:task_create': await capRow(k1) } });
    expect(t.caps.known('task_create')).toBe(false);
    expect(await t.caps.check('task_create')).toEqual({ state: 'yes' });
    expect(await t.caps.check('task_create')).toEqual({ state: 'yes' });
    expect(t.getRow).toHaveBeenCalledTimes(1);
    expect(t.caps.known('task_create')).toBe(true);
    expect(t.store.value).toMatchObject({ pairingKey: 'acc-1|gen-1', names: { task_create: expect.any(String) } });
    // A reload: a new reader over the same store knows it without the network.
    const again = await setup({ store: t.store });
    expect(again.caps.known('task_create')).toBe(true);
    expect(await again.caps.check('task_create')).toEqual({ state: 'yes' });
    expect(again.getRow).not.toHaveBeenCalled();
  });

  it('NO is never cached: every check asks again, and the answer turns yes once an app has announced', async () => {
    const rows: Record<string, unknown> = {};
    const t = await setup({ rows });
    expect(await t.caps.check('task_create')).toEqual({ state: 'no', reason: 'absent' });
    expect(await t.caps.check('task_create')).toEqual({ state: 'no', reason: 'absent' });
    expect(t.getRow).toHaveBeenCalledTimes(2);
    expect(t.store.value).toBe(null);
    rows['meta:cap:task_create'] = await capRow(t.keys['gen-1']);
    expect(await t.caps.check('task_create')).toEqual({ state: 'yes' });
  });

  it('a deleted row, a row for another name, and an unreadable row are all no', async () => {
    const k1 = await keyOf(1);
    const t = await setup({ rows: { 'meta:cap:task_create': { entityId: 'meta:cap:task_create', deleted: true, envelope: null } } });
    expect(await t.caps.check('task_create')).toEqual({ state: 'no', reason: 'absent' });
    const other = await setup({ rows: { 'meta:cap:task_create': { envelope: await sealBridgeEnvelope(k1, bridgeCapabilityPayload('something_else'), 'gen-1') } } });
    expect(await other.caps.check('task_create')).toEqual({ state: 'no', reason: 'absent' });
    const junk = await setup({ rows: { 'meta:cap:task_create': { envelope: 'not an envelope' } } });
    expect(await junk.caps.check('task_create')).toEqual({ state: 'no', reason: 'absent' });
  });

  it('a row sealed under ANOTHER pairing generation is "not yet seen this pairing", not "too old"', async () => {
    const t = await setup({ rows: { 'meta:cap:task_create': await capRow(await keyOf(1), 'task_create', 'gen-1') } });
    t.setPairing(pairing('gen-2'));
    expect(await t.caps.check('task_create')).toEqual({ state: 'no', reason: 'pairing' });
  });

  it('A RE-PAIR asks again: a yes cached under the old generation (or another account) is not a yes for the new one', async () => {
    const rows: Record<string, unknown> = {};
    const t = await setup({ rows });
    rows['meta:cap:task_create'] = await capRow(t.keys['gen-1']);
    expect(await t.caps.check('task_create')).toEqual({ state: 'yes' });
    t.setPairing(pairing('gen-2'));
    expect(t.caps.known('task_create')).toBe(false);
    expect(await t.caps.check('task_create')).toEqual({ state: 'no', reason: 'pairing' });
    rows['meta:cap:task_create'] = await capRow(t.keys['gen-2'], 'task_create', 'gen-2');
    expect(await t.caps.check('task_create')).toEqual({ state: 'yes' });
    expect(t.store.value?.pairingKey).toBe(pairingKeyOf(pairing('gen-2')));
    t.setPairing(pairing('gen-2', 'acc-other'));
    expect(t.caps.known('task_create')).toBe(false);
  });

  it('a read error is UNKNOWN, never yes: unreachable, a rejected credential, a 429 (which arms the brake), and the brake itself (no request at all)', async () => {
    const offline = await setup({ rows: { 'meta:cap:task_create': new TypeError('Failed to fetch') } });
    expect(await offline.caps.check('task_create')).toEqual({ state: 'unknown', reason: 'unreachable' });
    const rejected = await setup({ rows: { 'meta:cap:task_create': Object.assign(new Error('401'), { status: 401 }) } });
    expect(await rejected.caps.check('task_create')).toEqual({ state: 'unknown', reason: 'rejected' });
    const limited = await setup({ rows: { 'meta:cap:task_create': Object.assign(new Error('429'), { status: 429 }) } });
    expect(await limited.caps.check('task_create')).toEqual({ state: 'unknown', reason: 'rate-limited' });
    expect(limited.gate.reportRateLimit).toHaveBeenCalledTimes(1);
    const braked = await setup({ braked: true });
    expect(await braked.caps.check('task_create')).toEqual({ state: 'unknown', reason: 'rate-limited' });
    expect(braked.getRow).not.toHaveBeenCalled();
    for (const t of [offline, rejected, limited, braked]) expect(t.store.value).toBe(null);
  });

  it('a yes read for a pairing that changed while the read was out is not cached for the new one', async () => {
    const k1 = await keyOf(1);
    const t = await setup({ rows: { 'meta:cap:task_create': await capRow(k1) } });
    const p = t.caps.check('task_create');
    t.setPairing(pairing('gen-2'));
    expect(await p).toEqual({ state: 'yes' });
    expect(t.caps.known('task_create')).toBe(false);
  });

  it('checks running at once share one read', async () => {
    const t = await setup({ rows: { 'meta:cap:task_create': await capRow(await keyOf(1)) } });
    await Promise.all([t.caps.check('task_create'), t.caps.check('task_create'), t.caps.check('task_create')]);
    expect(t.getRow).toHaveBeenCalledTimes(1);
  });
});
