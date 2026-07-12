// Trust-rule tests for the Electron main-process module — the highest-risk
// port in this package. Every rule here traces to a shipped field bug in the
// integration this was ported from:
//   - `platform` in the POST /receipts body → HTTP 400 code 7226 → every Mac
//     receipt validation silently failed.
//   - HTTP errors parsed as "no subscriber" → paying users re-locked.
//   - GET /subscribers auto-creates empty subscribers → its "no entitlement"
//     manufactured determinate lock-outs.
//   - No receipt on disk at cold launch → must be indeterminate, not inactive.
//   - Lifetime latch → a one-time purchase can never be re-locked by a server.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const H = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  iapListeners: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
  fetchMock: vi.fn(),
  receiptURL: null as string | null,
  /** Per-call overrides consumed before receiptURL — lets a test model the
   * cold-launch race where isMASBuild() sees the receipt but the entitlement
   * check's later read finds it not yet materialized. */
  receiptQueue: [] as Array<string | null>,
  canMakePayments: false,
  products: [] as unknown[],
  userDataDir: '',
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      H.handlers.set(channel, fn);
    },
  },
  inAppPurchase: {
    getReceiptURL: () => (H.receiptQueue.length ? H.receiptQueue.shift()! : H.receiptURL),
    canMakePayments: () => H.canMakePayments,
    getProducts: async () => H.products,
    on: (ev: string, fn: (...args: unknown[]) => unknown) => H.iapListeners.set(ev, fn),
    purchaseProduct: async () => true,
    restoreCompletedTransactions: () => {},
    finishTransactionByDate: () => {},
  },
  net: { fetch: (...args: unknown[]) => H.fetchMock(...args) },
  app: { getPath: () => H.userDataDir },
  BrowserWindow: class {},
}));

const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: unknown) => H.sent.push({ channel, payload }),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const OPTS = {
  rcApiKey: 'appl_TESTKEY',
  entitlementId: 'pro',
  products: { yearly: 'com.test.pro.yearly', lifetime: 'com.test.pro.lifetime' },
};

function rcResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function activeSubscriber(productId: string, expiresInMs: number | null) {
  return {
    subscriber: {
      entitlements: {
        pro: {
          product_identifier: productId,
          ...(expiresInMs === null ? {} : { expires_date: new Date(Date.now() + expiresInMs).toISOString() }),
        },
      },
    },
  };
}

let originalPlatform: PropertyDescriptor;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function freshModule(): Promise<any> {
  vi.resetModules();
  return import('../src/electron-main/index.js');
}

beforeEach(() => {
  H.handlers.clear();
  H.iapListeners.clear();
  H.sent.length = 0;
  H.fetchMock.mockReset();
  H.canMakePayments = false;
  H.products = [];
  H.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-test-'));
  H.receiptURL = null;
  H.receiptQueue.length = 0;
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  fs.rmSync(H.userDataDir, { recursive: true, force: true });
  vi.useRealTimers();
});

function writeReceipt(): string {
  const p = path.join(H.userDataDir, 'receipt');
  fs.writeFileSync(p, 'FAKE-RECEIPT-BYTES');
  H.receiptURL = p;
  return p;
}

async function statusViaIpc(): Promise<{ active: boolean; productId: string | null; indeterminate?: boolean }> {
  const handler = H.handlers.get('subscription:status')!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handler({} as any) as any;
}

describe('parseEntitlement', () => {
  it('null subscriber → null (indeterminate upstream)', async () => {
    const m = await freshModule();
    expect(m.parseEntitlement(null, 'pro')).toBeNull();
  });

  it('subscriber without the entitlement → definitive inactive', async () => {
    const m = await freshModule();
    expect(m.parseEntitlement({ entitlements: {} }, 'pro')).toEqual({ active: false, productId: null });
  });

  it('subscription with future expires_date → active; past → inactive', async () => {
    const m = await freshModule();
    const future = { entitlements: { pro: { product_identifier: 'y', expires_date: new Date(Date.now() + 60_000).toISOString() } } };
    const past = { entitlements: { pro: { product_identifier: 'y', expires_date: new Date(Date.now() - 60_000).toISOString() } } };
    expect(m.parseEntitlement(future, 'pro')).toEqual({ active: true, productId: 'y' });
    expect(m.parseEntitlement(past, 'pro')).toEqual({ active: false, productId: null });
  });

  it('lifetime (no expires_date) → active', async () => {
    const m = await freshModule();
    const sub = { entitlements: { pro: { product_identifier: 'l' } } };
    expect(m.parseEntitlement(sub, 'pro')).toEqual({ active: true, productId: 'l' });
  });
});

describe('channel gating', () => {
  it('non-MAS build (no receipt): active immediately, RevenueCat never called', async () => {
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    expect(await statusViaIpc()).toEqual({ active: true, productId: null });
    expect(H.fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /receipts — the only response allowed to re-lock', () => {
  it('sends platform ONLY via X-Platform header, never in the body (HTTP 400 code 7226 regression)', async () => {
    writeReceipt();
    H.fetchMock.mockResolvedValueOnce(rcResponse(200, activeSubscriber('com.test.pro.yearly', 60_000)));
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    await statusViaIpc();

    expect(H.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = H.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.revenuecat.com/v1/receipts');
    expect((init.headers as Record<string, string>)['X-Platform']).toBe('macos');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer appl_TESTKEY');
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty('platform');          // ← the regression guard
    expect(body.fetch_token).toBe(Buffer.from('FAKE-RECEIPT-BYTES').toString('base64'));
    expect(typeof body.app_user_id).toBe('string');
    expect(body.app_user_id).toHaveLength(32);            // sha256(userData path) sliced
  });

  it('HTTP-200 validation with active entitlement → active', async () => {
    writeReceipt();
    H.fetchMock.mockResolvedValueOnce(rcResponse(200, activeSubscriber('com.test.pro.yearly', 60_000)));
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    expect(await statusViaIpc()).toEqual({ active: true, productId: 'com.test.pro.yearly' });
  });

  it('HTTP-200 validation with NO entitlement → definitive inactive (re-lock allowed)', async () => {
    writeReceipt();
    H.fetchMock.mockResolvedValueOnce(rcResponse(200, { subscriber: { entitlements: {} } }));
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    const s = await statusViaIpc();
    expect(s).toEqual({ active: false, productId: null });
    expect(s.indeterminate).toBeUndefined();
  });

  it('HTTP error → NOT "no entitlement": falls through, ends indeterminate', async () => {
    writeReceipt();
    H.fetchMock
      .mockResolvedValueOnce(rcResponse(400, { code: 7226, message: 'platform: Extra inputs are not permitted' }))
      .mockResolvedValueOnce(rcResponse(200, { subscriber: { entitlements: {} } })); // GET fallback: empty auto-created subscriber
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    const s = await statusViaIpc();
    expect(s.active).toBe(false);
    expect(s.indeterminate).toBe(true); // renderer keeps last-known-good
  });

  it('HTTP-200 with non-JSON body → indeterminate, never inactive', async () => {
    writeReceipt();
    H.fetchMock
      .mockResolvedValueOnce(rcResponse(200, '<html>gateway error</html>'))
      .mockResolvedValueOnce(rcResponse(500, 'oops'));
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    const s = await statusViaIpc();
    expect(s.indeterminate).toBe(true);
  });
});

describe('GET /subscribers fallback — unlock-only', () => {
  it('no receipt on disk: an ACTIVE subscriber lookup unlocks', async () => {
    // Cold-launch race: isMASBuild() (first getReceiptURL call) sees the
    // receipt, but macOS hasn't materialized it by the time the entitlement
    // check reads it again — the exact sequence behind "Restore recovers it".
    const p = writeReceipt();
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    H.receiptQueue.push(p, null); // gate check: present; entitlement check: gone
    H.fetchMock.mockResolvedValueOnce(rcResponse(200, activeSubscriber('com.test.pro.yearly', 60_000)));

    const s = await statusViaIpc();
    expect(s).toEqual({ active: true, productId: 'com.test.pro.yearly' });
    const [url] = H.fetchMock.mock.calls[0] as [string];
    expect(url).toMatch(/\/v1\/subscribers\/[0-9a-f]{32}$/);
  });

  it('no receipt: an EMPTY subscriber lookup is meaningless → indeterminate, not inactive', async () => {
    const p = writeReceipt();
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    H.receiptQueue.push(p, null); // gate: present; entitlement check: not materialized
    // GET /subscribers auto-creates an empty subscriber for unknown ids.
    H.fetchMock.mockResolvedValueOnce(rcResponse(200, { subscriber: { entitlements: {} } }));

    const s = await statusViaIpc();
    expect(s.active).toBe(false);
    expect(s.indeterminate).toBe(true);
  });
});

describe('lifetime latch', () => {
  it('a validated lifetime purchase latches; later server reads can never re-lock', async () => {
    writeReceipt();
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);

    // First check: RC validates a lifetime entitlement → latch written.
    H.fetchMock.mockResolvedValueOnce(rcResponse(200, activeSubscriber('com.test.pro.lifetime', null)));
    expect((await statusViaIpc()).active).toBe(true);
    expect(fs.existsSync(path.join(H.userDataDir, 'lifetime-purchased.json'))).toBe(true);

    // Second check: RC now claims no entitlement (aliasing drift) → latch wins.
    H.fetchMock.mockResolvedValueOnce(rcResponse(200, { subscriber: { entitlements: {} } }));
    expect(await statusViaIpc()).toEqual({ active: true, productId: 'com.test.pro.lifetime' });
  });
});

describe('restore settlement — dual path', () => {
  it('nothing to restore: the fallback timer settles as restore_complete', async () => {
    vi.useFakeTimers();
    writeReceipt();
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    // Entitlement check during settle: indeterminate (RC down).
    H.fetchMock.mockResolvedValue(rcResponse(500, 'down'));

    const restoreHandler = H.handlers.get('subscription:restore')!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await restoreHandler({} as any);
    expect(H.sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(H.sent).toHaveLength(1);
    expect(H.sent[0].payload).toMatchObject({ status: 'cancelled', message: 'restore_complete' });
  });

  it('a restored transaction settles as active and the late fallback becomes a no-op', async () => {
    vi.useFakeTimers();
    writeReceipt();
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    H.fetchMock.mockResolvedValue(rcResponse(200, activeSubscriber('com.test.pro.yearly', 60_000)));

    const restoreHandler = H.handlers.get('subscription:restore')!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await restoreHandler({} as any);

    const txnListener = H.iapListeners.get('transactions-updated')!;
    await txnListener({}, [{
      transactionState: 'restored',
      transactionDate: 'now',
      payment: { productIdentifier: 'com.test.pro.yearly' },
    }]);

    const messages = H.sent.map(s => (s.payload as { message?: string; status?: string }));
    expect(messages).toContainEqual(expect.objectContaining({ status: 'success' }));
    expect(messages).toContainEqual(expect.objectContaining({ message: 'restore_complete_active' }));

    H.sent.length = 0;
    await vi.advanceTimersByTimeAsync(10_000); // fallback fires → must be a no-op
    expect(H.sent.filter(s => (s.payload as { message?: string }).message?.startsWith('restore_complete'))).toHaveLength(0);
  });

  it('a restored LIFETIME transaction latches even when the RC read fails', async () => {
    vi.useFakeTimers();
    writeReceipt();
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    H.fetchMock.mockResolvedValue(rcResponse(500, 'down')); // RC unusable throughout

    const restoreHandler = H.handlers.get('subscription:restore')!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await restoreHandler({} as any);
    const txnListener = H.iapListeners.get('transactions-updated')!;
    await txnListener({}, [{
      transactionState: 'restored',
      transactionDate: 'now',
      payment: { productIdentifier: 'com.test.pro.lifetime' },
    }]);

    // Apple's word is authoritative for a lifetime product: latched + settled
    // active despite RevenueCat being down.
    expect(fs.existsSync(path.join(H.userDataDir, 'lifetime-purchased.json'))).toBe(true);
    const messages = H.sent.map(s => s.payload as { message?: string });
    expect(messages).toContainEqual(expect.objectContaining({ message: 'restore_complete_active' }));
  });
});

describe('prices + trial length', () => {
  it('caches store prices and extracts freeTrial days; pull returns the same payload', async () => {
    H.canMakePayments = true;
    H.products = [
      {
        productIdentifier: 'com.test.pro.yearly',
        formattedPrice: '£17.99',
        introductoryPrice: {
          paymentMode: 'freeTrial',
          numberOfPeriods: 1,
          subscriptionPeriod: { numberOfUnits: 2, unit: 'week' },
        },
      },
      { productIdentifier: 'com.test.pro.lifetime', formattedPrice: '£44.99' },
    ];
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    await new Promise((r) => setTimeout(r, 0)); // let the getProducts promise settle

    const push = H.sent.find(s => s.channel === 'subscription:prices-ready');
    expect(push?.payload).toEqual({ yearly: '£17.99', lifetime: '£44.99', yearlyTrialDays: 14 });

    const pull = H.handlers.get('subscription:prices')!;
    expect(pull()).toEqual({ yearly: '£17.99', lifetime: '£44.99', yearlyTrialDays: 14 });
  });

  it('a payUpFront intro offer is NOT a trial', async () => {
    H.canMakePayments = true;
    H.products = [{
      productIdentifier: 'com.test.pro.yearly',
      formattedPrice: '£17.99',
      introductoryPrice: {
        paymentMode: 'payUpFront',
        numberOfPeriods: 1,
        subscriptionPeriod: { numberOfUnits: 2, unit: 'week' },
      },
    }];
    const m = await freshModule();
    m.registerElectronBilling(fakeWindow, OPTS);
    await new Promise((r) => setTimeout(r, 0));
    const pull = H.handlers.get('subscription:prices')!;
    expect((pull() as { yearlyTrialDays: number | null }).yearlyTrialDays).toBeNull();
  });
});
