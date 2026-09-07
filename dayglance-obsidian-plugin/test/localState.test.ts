import { describe, it, expect } from 'vitest';
import { localStateStoreFor, migrateToLocalState, splitBridgeState, joinBridgeState, LOCAL_STATE_KEY } from '../src/localState';
import type { BridgeState } from '../src/bridge';

// DEVICE-LOCAL PLUGIN STATE (localState.ts): the pure halves — the split
// between the per-copy bookkeeping and the shared config cache, and the
// one-time migration out of data.json.

const config = { dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks', blockIdWrites: true };
const bridge: BridgeState = {
  appliedIds: ['i1', 'i2'], hwm: 42, config,
  adoptedScope: ['Projects/House.md'], linkedNotes: { 'Projects/Plan.md': 'p1' },
  pendingObservations: ['Daily/2026-09-05.md'], unsupportedIds: ['i9'],
};

describe('splitBridgeState / joinBridgeState', () => {
  it('splits the config cache off the per-copy state and rejoins losslessly', () => {
    const { local, config: cfg } = splitBridgeState(bridge);
    expect(cfg).toEqual(config);
    expect('config' in local).toBe(false);
    expect(joinBridgeState(local, cfg)).toEqual(bridge);
    expect(joinBridgeState(undefined, undefined)).toEqual({ appliedIds: [], hwm: 0 });
  });
});

describe('migrateToLocalState', () => {
  it('first load: seeds the local store from data.json, lifts the config cache, strips the per-copy fields', () => {
    const data = { deviceId: 'dev-shared', pairing: { x: 1 }, bridge, viewer: { userSyncId: 'u' } } as any;
    const out = migrateToLocalState(data, null);
    expect(out.dataChanged).toBe(true);
    expect(out.local).toEqual({ deviceId: 'dev-shared', bridge: splitBridgeState(bridge).local });
    expect(out.data.bridge).toBeUndefined();
    expect(out.data.deviceId).toBeUndefined();
    expect(out.data.bridgeConfig).toEqual(config);
    expect(out.data.pairing).toEqual({ x: 1 });   // shared fields untouched
    expect(out.data.viewer).toEqual({ userSyncId: 'u' });
  });

  it('later loads: an existing local store is never overwritten by stale data.json fields (an older copy wrote them back), but they are stripped again', () => {
    const local = { deviceId: 'dev-mine', bridge: { appliedIds: ['a'], hwm: 100 } };
    const data = { deviceId: 'dev-other', bridge: { appliedIds: ['b'], hwm: 7, config }, bridgeConfig: config } as any;
    const out = migrateToLocalState(data, local);
    expect(out.local).toEqual(local);
    expect(out.data.bridge).toBeUndefined();
    expect(out.data.deviceId).toBeUndefined();
    expect(out.dataChanged).toBe(true);
  });

  it('a clean data.json is a no-op', () => {
    const local = { deviceId: 'dev-mine', bridge: { appliedIds: [], hwm: 3 } };
    const out = migrateToLocalState({ pairing: { x: 1 }, bridgeConfig: config } as any, local);
    expect(out.dataChanged).toBe(false);
    expect(out.local).toEqual(local);
  });
});

describe('localStateStoreFor', () => {
  it('rides App.loadLocalStorage / saveLocalStorage when present, and reports unavailable otherwise', () => {
    const backing = new Map<string, unknown>();
    const app = {
      loadLocalStorage: (k: string) => backing.get(k) ?? null,
      saveLocalStorage: (k: string, v: unknown) => { if (v === null) backing.delete(k); else backing.set(k, v); },
    } as any;
    const store = localStateStoreFor(app);
    expect(store.available).toBe(true);
    expect(store.load()).toBeNull();
    store.save({ deviceId: 'd', bridge: { appliedIds: [], hwm: 1 } });
    expect(backing.get(LOCAL_STATE_KEY)).toEqual({ deviceId: 'd', bridge: { appliedIds: [], hwm: 1 } });
    expect(store.load()).toEqual({ deviceId: 'd', bridge: { appliedIds: [], hwm: 1 } });

    const old = localStateStoreFor({} as any);
    expect(old.available).toBe(false);
    expect(old.load()).toBeNull();
    expect(() => old.save({})).not.toThrow();
  });
});
