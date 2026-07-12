import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndroidWebViewAdapter, type AndroidBillingBridge } from '../src/adapters/android-webview.js';
import { createElectronRendererAdapter, type ElectronBillingApi } from '../src/adapters/electron-renderer.js';
import type { ApplyCallbacks } from '../src/adapters/types.js';
import type { BillingEvent, Prices, StatusReading, StorageLike, TrialInfo } from '../src/types.js';

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

function recorder() {
  const applied: Array<StatusReading | null | undefined> = [];
  const prices: Prices[] = [];
  const trials: Array<Partial<TrialInfo>> = [];
  const loading: boolean[] = [];
  const events: Array<BillingEvent | string> = [];
  const apply: ApplyCallbacks = {
    applyStatus: (r) => applied.push(r),
    setPrices: (p) => prices.push(p),
    setTrial: (t) => trials.push(t),
    setLoading: (l) => loading.push(l),
    emitBillingEvent: (e) => events.push(e),
  };
  return { apply, applied, prices, trials, loading, events };
}

const PRODUCTS = { yearly: 'app_pro_annual', lifetime: 'app_pro_lifetime' };

function makeBridge(overrides: Partial<AndroidBillingBridge> = {}): AndroidBillingBridge {
  return {
    getStatus: () => '{"active":false,"productId":""}',
    getProductPrices: () => '{"annual":"£19.99","lifetime":"£49.99","annualTrialDays":14}',
    getTrialEligibility: () => '{"app_pro_annual":true}',
    refresh: () => {},
    purchase: () => {},
    ...overrides,
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('android-webview adapter', () => {
  it('remaps the bridge {annual,lifetime} price shape to {yearly,lifetime}', () => {
    const adapter = createAndroidWebViewAdapter({ bridge: makeBridge(), products: PRODUCTS });
    expect(adapter.readPrices()).toEqual({ yearly: '£19.99', lifetime: '£49.99' });
  });

  it('trial: only an explicit false means ineligible; days come from the store payload', () => {
    const eligible = createAndroidWebViewAdapter({ bridge: makeBridge(), products: PRODUCTS });
    expect(eligible.readTrial()).toEqual({ eligible: true, days: 14 });

    const ineligible = createAndroidWebViewAdapter({
      bridge: makeBridge({ getTrialEligibility: () => '{"app_pro_annual":false}' }),
      products: PRODUCTS,
    });
    expect(ineligible.readTrial().eligible).toBe(false);

    const broken = createAndroidWebViewAdapter({
      bridge: makeBridge({ getTrialEligibility: () => 'not-json', getProductPrices: () => 'not-json' }),
      products: PRODUCTS,
    });
    expect(broken.readTrial()).toEqual({ eligible: true, days: null }); // fail open, no fabricated length
  });

  it("restore settles as 'restore_complete_active' when the re-query shows an entitlement", () => {
    const bridge = makeBridge({ getStatus: () => '{"active":true,"productId":"app_pro_annual"}' });
    const adapter = createAndroidWebViewAdapter({ bridge, products: PRODUCTS });
    const r = recorder();

    adapter.restore(r.apply);
    expect(r.loading).toEqual([true]);
    vi.advanceTimersByTime(4000);

    expect(r.loading).toEqual([true, false]);
    expect(r.applied[0]).toMatchObject({ active: true });
    expect(r.events[0]).toMatchObject({
      status: 'cancelled',
      message: 'restore_complete_active',   // ← the cross-platform contract fix
      productId: 'app_pro_annual',
    });
  });

  it("restore settles as 'restore_complete' when nothing is owned", () => {
    const adapter = createAndroidWebViewAdapter({ bridge: makeBridge(), products: PRODUCTS });
    const r = recorder();
    adapter.restore(r.apply);
    vi.advanceTimersByTime(4000);
    expect(r.events[0]).toMatchObject({ status: 'cancelled', message: 'restore_complete', productId: '' });
  });

  it('binds and unbinds the shared window event global', () => {
    const adapter = createAndroidWebViewAdapter({ bridge: makeBridge(), products: PRODUCTS });
    const r = recorder();
    const unbind = adapter.bindEvents(r.apply);
    const g = globalThis as Record<string, unknown>;
    expect(typeof g['__billingEvent']).toBe('function');
    (g['__billingEvent'] as (e: string) => void)('{"status":"success","code":0,"message":"ok","productId":"x"}');
    expect(r.events).toHaveLength(1);
    unbind();
    expect(g['__billingEvent']).toBeUndefined();
  });
});

describe('electron-renderer adapter', () => {
  function makeApi(overrides: Partial<ElectronBillingApi> = {}): ElectronBillingApi {
    return {
      subscriptionStatus: async () => ({ active: false, productId: null, indeterminate: true }),
      subscriptionPurchase: async () => {},
      subscriptionRestore: async () => {},
      subscriptionPrices: async () => ({ yearly: '£17.99', lifetime: '£44.99', yearlyTrialDays: 14 }),
      onSubscriptionEvent: () => () => {},
      onSubscriptionPricesReady: () => () => {},
      ...overrides,
    };
  }

  it('cold launch reads the persisted mirror; the gate later persists applied readings back', () => {
    const storage = new MemStorage();
    storage.setItem('rc_test_status', JSON.stringify({ active: true, productId: 'y' }));
    const adapter = createElectronRendererAdapter({
      api: makeApi(), statusCacheKey: 'rc_test_status', storage,
    });
    expect(adapter.readCachedStatus()).toEqual({ active: true, productId: 'y' });

    adapter.persistStatusCache?.({ active: false, productId: null });
    expect(JSON.parse(storage.getItem('rc_test_status')!)).toEqual({ active: false, productId: null });
  });

  it('sync price read returns nulls (never clobbers async-delivered prices)', () => {
    const adapter = createElectronRendererAdapter({ api: makeApi(), storage: new MemStorage() });
    expect(adapter.readPrices()).toEqual({ yearly: null, lifetime: null });
  });

  it('onMount pulls cached prices (push-drop race) and routes status through the gate', async () => {
    vi.useRealTimers();
    const adapter = createElectronRendererAdapter({ api: makeApi(), storage: new MemStorage() });
    const r = recorder();
    adapter.onMount(r.apply);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.applied[0]).toMatchObject({ indeterminate: true }); // gate decides, adapter doesn't filter
    expect(r.prices[0]).toEqual({ yearly: '£17.99', lifetime: '£44.99' });
    expect(r.trials[0]).toEqual({ days: 14 });
  });

  it('does not apply prices from a pull that answered empty', async () => {
    vi.useRealTimers();
    const adapter = createElectronRendererAdapter({
      api: makeApi({ subscriptionPrices: async () => ({ yearly: null, lifetime: null }) }),
      storage: new MemStorage(),
    });
    const r = recorder();
    adapter.onMount(r.apply);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.prices).toHaveLength(0); // fetch still in flight → the push will deliver
  });
});
