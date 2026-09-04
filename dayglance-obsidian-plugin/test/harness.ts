// The bridge scenario harness: one fake GLANCEvault, one stub Obsidian vault
// with the real plugin transport wired to it exactly as main.ts wires it,
// and any number of dayGLANCE "devices" running the real sync hook against
// the same stream. Time is the test's: install fake timers before calling
// createScenario and drive it with `advance`.
//
// What runs for real: the plugin's BridgeTransport (stamping, observations,
// scope, links, intent applies), the shared format package, dayGLANCE's
// bridge stream and inbound modules (sealing, outbox, observation fetch),
// and the sync hook's merge, deletion inference, withdrawal and writeback.
// What is faked: Obsidian (the stub), the vault server (in memory), and the
// app's direct vault access (off: the plugin is authoritative throughout).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import { App, TFile, __setRequestHandler } from 'obsidian';
import { FakeGlanceVault } from './fakeGlanceVault';
import { BridgeTransport, publishPairingMeta, type BridgeState } from '../src/bridge';
import type { BridgePairing } from '../src/pairing';
// The SAME specifier the app uses, so the root key lands in the module instance the app reads.
import { setupDbRootKey, hasDbRootKey } from '@glance-apps/sync';
import { getDbRootKey, hasDbRootKey as hasDbRootKeyDirect } from '@glance-apps/sync/src/dbCrypto.js';
import { deriveBridgeSubkey, exportBridgeSubkey, normalizeScope, normalizeProjectNoteSettings, type VaultScope } from '@glance-apps/obsidian-format';

export const VAULT_URL = 'https://vault.test';

// Captured at import time, BEFORE a test installs fake timers: real async
// work (Web Crypto runs on Node's threadpool) lands only on a real
// macrotask, and fake time must not race ahead of it. Every fake-time step
// first yields one real tick so pending crypto callbacks run.
const realSetTimeout = globalThis.setTimeout;
export const realTick = (): Promise<void> => new Promise((r) => realSetTimeout(r, 1));

/** Advance fake time by `ms` in steps, yielding real time between steps. */
export async function advanceFake(ms: number, step = 200): Promise<void> {
  let left = ms;
  while (left > 0) {
    await realTick();
    const d = Math.min(step, left);
    await vi.advanceTimersByTimeAsync(d);
    left -= d;
  }
}

/** Await a promise while fake time flows only when the promise is still pending after real work has had its turn. */
export async function until<T>(p: Promise<T>, maxMs = 300_000): Promise<T> {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  let elapsed = 0;
  while (!done && elapsed < maxMs) {
    await realTick();
    if (done) break;
    await vi.advanceTimersByTimeAsync(100);
    elapsed += 100;
  }
  return p;
}
export const ACCOUNT_ID = 'acc-1';
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
let generationCounter = 0;

export interface PluginSide {
  app: App;
  transport: BridgeTransport;
  data: { pairing?: BridgePairing; bridge?: BridgeState; scope?: VaultScope; saves: number };
  setScope(scope: Partial<VaultScope>): Promise<void>;
  /** Simulate a plugin reload: a fresh transport over the same data.json. */
  reload(): void;
  shutdown(): void;
}

export interface Scenario {
  vault: FakeGlanceVault;
  pairing: BridgePairing;
  plugin: PluginSide;
  /** Advance fake time, running every timer and microtask that falls due. */
  advance(ms: number): Promise<void>;
  /** The vault file's text, or null. */
  text(path: string): string | null;
  file(path: string): TFile;
  write(path: string, text: string): Promise<TFile>;
  /** Let the plugin settle a freshly created or edited note: debounce, stamp settle floor, re-arm, report. */
  settle(): Promise<void>;
}

function wireVaultEvents(app: App, transport: BridgeTransport): void {
  // Mirrors main.ts's onLayoutReady registrations, one for one.
  app.vault.on('modify', (f: unknown) => { if (f instanceof TFile) transport.scheduleObservation(f); });
  app.vault.on('create', (f: unknown) => { if (f instanceof TFile) transport.noteCreated(f); });
  app.vault.on('delete', (f: unknown) => { if (f instanceof TFile) transport.reportDeleted(f.path); });
  app.vault.on('rename', (f: unknown, oldPath: string) => { if (f instanceof TFile) transport.noteRenamed(oldPath, f); });
  app.metadataCache.on('changed', (f: unknown) => { if (f instanceof TFile) transport.noteMetaChanged(f.path); });
}

export async function createScenario(): Promise<Scenario> {
  const vault = new FakeGlanceVault();
  __setRequestHandler((req) => vault.handle(req.method, req.url, req.body, req.headers.Authorization ?? ''));
  vi.stubGlobal('fetch', vault.fetch);

  // One account root key for the whole harness (both sides derive from it).
  const rootSalt = new Uint8Array(16).fill(7);
  await setupDbRootKey('harness-passphrase', rootSalt, { nativeGetSyncKey: async () => null, nativeStoreSyncKey: () => {} });
  if (!hasDbRootKey() || !hasDbRootKeyDirect()) throw new Error(`harness: root key not visible (index ${hasDbRootKey()}, direct ${hasDbRootKeyDirect()})`);
  const pairingSalt = new Uint8Array(16).fill(3);
  const subkey = await deriveBridgeSubkey(getDbRootKey(), pairingSalt);
  const pairing: BridgePairing = {
    vaultUrl: VAULT_URL, accountId: ACCOUNT_ID, deviceToken: 'device-token',
    subkeyB64: await exportBridgeSubkey(subkey), pairingSalt: b64(pairingSalt),
    generation: `gen-${++generationCounter}`, pairedAt: new Date().toISOString(),
  };

  const app = new App();
  const data: PluginSide['data'] = { pairing, bridge: { appliedIds: [], hwm: 0 }, saves: 0 };
  let transport!: BridgeTransport;
  const host = () => ({
    app,
    getPairing: () => data.pairing,
    getBridgeState: () => data.bridge ?? { appliedIds: [], hwm: 0 },
    saveBridgeState: async (state: BridgeState) => { data.bridge = state; data.saves++; },
    getScope: () => (data.scope ? normalizeScope(data.scope) : null),
    getProjectNotes: () => normalizeProjectNoteSettings(null),
    getViewer: () => pairing.userSyncId ?? null,
  });
  const boot = () => { transport = new BridgeTransport(host()); wireVaultEvents(app, transport); };
  boot();

  const advance = async (ms: number) => { await advanceFake(ms); };
  const plugin: PluginSide = {
    app,
    get transport() { return transport; },
    data,
    setScope: async (scope) => {
      data.scope = normalizeScope(scope);
      await publishPairingMeta(pairing, undefined, pairing.userSyncId ?? null, data.scope);
      transport.scopeChanged();
      transport.adoptTick();
    },
    reload: () => { transport.shutdown(); boot(); },
    shutdown: () => transport.shutdown(),
  };

  return {
    vault, pairing, plugin, advance,
    text: (path) => app.vault.contents.get(path) ?? null,
    file: (path) => { const f = app.vault.getAbstractFileByPath(path); if (!(f instanceof TFile)) throw new Error(`no file ${path}`); return f; },
    write: async (path, text) => { const f = app.vault.getAbstractFileByPath(path); if (f instanceof TFile) { await app.vault.modify(f, text); return f; } return app.vault.create(path, text); },
    // Debounce (2s), the receiving-posture settle floor (10s) with its 2s
    // re-arm, the stamp write's own debounce, then the report: ~15s; 40s
    // leaves room for a retry tick without approaching the 30s backoff.
    settle: async () => { for (let i = 0; i < 40; i++) await advance(1000); },
  };
}
