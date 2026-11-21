import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import {
  BillingEngine,
  createIOSWebViewAdapter,
  BILLING_CODE_PENDING,
  BILLING_CODE_UNCONFIRMED,
} from '@glance-apps/billing';
import { loaders } from './locales.js';
import SubscriptionWall from './components/SubscriptionWall.jsx';

// iOS billing (billing Phase 3): RevenueCat's delegate, pushed into the page
// through a window global, and the reads that back it up.
//
// The transport is evaluateJavaScript into window.__billingStatus, not a
// Capacitor plugin. A push that finds no receiver (no web view yet, the page
// still loading or reloading, the engine stopped, the app in the background)
// is dropped, not queued. That is acceptable only because a read follows
// every one of those states and sees the same entitlement: the blocks below
// walk each state through the real engine and adapter, and the Swift checks
// hold SubscriptionBridge to the half that makes the read see it.

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const swift = read('dayglance-ios/DayGlance/Bridges/SubscriptionBridge.swift');
const code = swift.replace(/\/\/.*$/gm, '');

/** Functions of a Swift source by name, bodies brace-matched, comments stripped. */
function fn(name) {
  const re = new RegExp(`\\bfunc ${name}\\s*\\(`);
  const at = code.search(re);
  if (at < 0) throw new Error(`no func ${name}`);
  const open = code.indexOf('{', at);
  let depth = 0;
  let i = open;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) break;
  }
  return code.slice(open, i + 1);
}

describe('SubscriptionBridge.swift', () => {
  it("is RevenueCat's delegate, set inside configure; the AppDelegate call is untouched", () => {
    expect(code).toMatch(/final class SubscriptionBridge: NSObject, PurchasesDelegate\b/);
    const configure = fn('configure');
    expect(configure.indexOf('Purchases.shared.delegate = self'))
      .toBeGreaterThan(configure.indexOf('Purchases.configure(withAPIKey: apiKey)'));
    expect(read('dayglance-ios/DayGlance/AppDelegate.swift'))
      .toMatch(/SubscriptionBridge\.shared\.configure\(apiKey: "appl_\w+"\)/);
  });

  it('the delegate records every report, and pushes only an ACTIVE entitlement', () => {
    const delegate = fn('purchases');
    const record = delegate.indexOf('lastReported = customerInfo');
    const guard = delegate.indexOf('guard let ent = customerInfo.entitlements[entitlementId], ent.isActive else { return }');
    const push = delegate.indexOf('pushActiveStatus(');
    expect(record).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(record); // recorded whatever it says, then filtered
    expect(push).toBeGreaterThan(guard);
  });

  it('the push has one send site, no inactive form, and is a no-op where the page has no receiver', () => {
    expect(code.match(/window\.__billingStatus\(/g)).toHaveLength(1);
    const push = fn('pushActiveStatus');
    expect(push).toContain('"{\\"active\\":true,');
    expect(push).not.toMatch(/\\"active\\":\\\(/); // never an interpolated value
    expect(push).toContain("if(typeof window.__billingStatus==='function'){window.__billingStatus(");
    expect(push).toContain('self?.webView?.evaluateJavaScript(');
  });

  it("status reads see everything the delegate has seen: the newer of the cache and the delegate's copy", () => {
    expect(fn('getStatus')).toContain('let info = currentCustomerInfo()');
    expect(fn('getStatus')).not.toContain('cachedCustomerInfo');
    const current = fn('currentCustomerInfo');
    expect(current).toContain('let cached = Purchases.shared.cachedCustomerInfo');
    expect(current).toContain('let reported = lastReported');
    expect(current).toContain('reported.requestDate > cached.requestDate ? reported : cached');
  });

  it("emits 'success' only when the returned entitlement includes ours; otherwise pending/unconfirmed", () => {
    const purchase = fn('purchase');
    const check = purchase.indexOf('result.customerInfo.entitlements[entitlementId]?.isActive == true');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(purchase.indexOf('fireBillingEvent(status: "success"'));
    expect(purchase.match(/fireBillingEvent\(status: "success"/g)).toHaveLength(1);
    expect(purchase).toContain('fireBillingEvent(status: "pending", code: Self.codeUnconfirmed');
  });

  it('reports a deferred payment as pending, not as an error', () => {
    const errors = fn('fireBillingError');
    const pending = errors.indexOf('if rcError == .paymentPendingError');
    expect(pending).toBeGreaterThan(-1);
    expect(errors.slice(pending)).toMatch(/fireBillingEvent\(status: "pending", code: Self\.codePending[^)]*\)\s*\n\s*return/);
  });

  it("uses the package's pending codes", () => {
    expect(code).toContain(`static let codePending = ${BILLING_CODE_PENDING}`);
    expect(code).toContain(`static let codeUnconfirmed = ${BILLING_CODE_UNCONFIRMED}`);
  });

  // Out of scope for Phase 3, and pinned so it stays that way: restore already
  // reports completion, and autoSyncRecover stays until its replacement ships.
  it('leaves restore and autoSyncRecover as they were', () => {
    const restore = fn('restorePurchases');
    expect(restore).toContain('try await Purchases.shared.restorePurchases()');
    expect(restore).toContain('message: active ? "restore_complete_active" : "restore_complete"');
    const recover = fn('autoSyncRecover');
    expect(recover).toContain('Purchases.shared.syncPurchases()');
    expect(recover).toContain('message: "restore_complete_active"');
  });
});

// ── The page side, through the real engine and adapter ──────────────────────

const INACTIVE = { active: false, productId: null };
const YEARLY = { active: true, productId: 'com.dayglance.pro.yearly' };
const PRODUCTS = { yearly: 'com.dayglance.pro.yearly', lifetime: 'com.dayglance.pro.lifetime' };
const GRACE = 12_000;

class MemStorage {
  map = new Map();
  getItem(k) { return this.map.get(k) ?? null; }
  setItem(k, v) { this.map.set(k, v); }
  removeItem(k) { this.map.delete(k); }
}

/**
 * The native side as SubscriptionBridge has it: `known` is RevenueCat's most
 * recent customer info (currentCustomerInfo, cache or delegate copy, whichever
 * is newer); `report` is RevenueCat calling the delegate, which records the
 * info and pushes it through the guarded global when ACTIVE; `autoSync` is
 * autoSyncRecover's event, sent through the billing-event global.
 */
function nativeShell(initial = INACTIVE) {
  let known = initial;
  const w = globalThis;
  const evaluate = (fnName, payload) => {
    if (typeof w[fnName] === 'function') w[fnName](payload); // the Swift guard
  };
  return {
    bridge: {
      getSubscriptionStatus: () => JSON.stringify(known),
      getProductPrices: () => '{"yearly":"$10","lifetime":"$30","yearlyTrialDays":7}',
      getTrialEligibility: () => '{"com.dayglance.pro.yearly":true}',
      purchase: () => {},
      restorePurchases: () => {},
    },
    report(status) {
      known = status;
      if (status.active) evaluate('__billingStatus', { active: true, productId: status.productId });
    },
    autoSyncEvent(productId) {
      evaluate('__billingEvent', { status: 'cancelled', code: 0, message: 'restore_complete_active', productId });
    },
  };
}

function engineFor(shell, storage = new MemStorage()) {
  const adapter = createIOSWebViewAdapter({ bridge: shell.bridge, products: PRODUCTS });
  const engine = new BillingEngine({ adapter, storage, products: PRODUCTS });
  const unlocks = [];
  engine.subscribe(() => {
    const u = engine.getSnapshot().isUnlocked;
    if (unlocks.at(-1) !== u) unlocks.push(u);
  });
  return { engine, unlocks, storage };
}

describe('a push with no receiver is dropped, and a read always recovers it', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__billingStatus;
    delete globalThis.__billingEvent;
  });

  it('with a receiver: the push unlocks at once, no read needed', () => {
    const shell = nativeShell();
    const { engine } = engineFor(shell);
    engine.start();
    shell.report(YEARLY);
    expect(engine.getSnapshot().isUnlocked).toBe(true);
  });

  it('before the page has bound the global (web view loading, no web view yet): dropped; the first read unlocks at first paint', () => {
    const shell = nativeShell();
    shell.report(YEARLY); // no receiver: nothing happens
    expect(globalThis.__billingStatus).toBeUndefined();
    const { engine } = engineFor(shell);
    // The engine's initial state is a synchronous read, before any timer.
    expect(engine.getSnapshot().isUnlocked).toBe(true);
    engine.start();
    expect(engine.getSnapshot().isUnlocked).toBe(true);
  });

  it('during a reload or after the engine stopped: dropped; the next page unlocks at first paint', () => {
    const shell = nativeShell();
    const first = engineFor(shell);
    first.engine.start();
    expect(first.engine.getSnapshot().isUnlocked).toBe(false);
    first.engine.stop(); // the page goes away: the global with it
    shell.report(YEARLY);
    expect(first.engine.getSnapshot().isUnlocked).toBe(false); // the push was lost
    const next = engineFor(shell);
    expect(next.engine.getSnapshot().isUnlocked).toBe(true);
  });

  it('in the background (the push lost on the way): the foreground read unlocks, 2 s after visibility', async () => {
    const shell = nativeShell();
    const { engine } = engineFor(shell);
    engine.start();
    await vi.advanceTimersByTimeAsync(5000); // mount reads: locked
    const receiver = globalThis.__billingStatus;
    delete globalThis.__billingStatus; // model the push not reaching the page
    shell.report(YEARLY);
    globalThis.__billingStatus = receiver;
    expect(engine.getSnapshot().isUnlocked).toBe(false);
    engine.refresh(); // visibilitychange → refresh
    await vi.advanceTimersByTimeAsync(1999);
    expect(engine.getSnapshot().isUnlocked).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.getSnapshot().isUnlocked).toBe(true);
  });
});

describe('the foreground 2000 ms read no longer decides an unlock', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__billingStatus;
    delete globalThis.__billingEvent;
  });

  it('a locked install unlocks when RevenueCat learns, not at the next foreground', async () => {
    const shell = nativeShell();
    const { engine } = engineFor(shell);
    engine.start();
    await vi.advanceTimersByTimeAsync(5000);
    engine.refresh();
    await vi.advanceTimersByTimeAsync(2000); // the guessed read: RevenueCat has not learned yet
    expect(engine.getSnapshot().isUnlocked).toBe(false);
    await vi.advanceTimersByTimeAsync(4000);
    shell.report(YEARLY); // RevenueCat's fetch lands 6 s after the foreground
    expect(engine.getSnapshot().isUnlocked).toBe(true);
  });

  it('an unlocked install whose 2 s read is stale-inactive stays unlocked when RevenueCat confirms within the hold', async () => {
    const shell = nativeShell(YEARLY);
    const { engine, unlocks } = engineFor(shell);
    engine.start();
    await vi.advanceTimersByTimeAsync(5000);
    shell.report(INACTIVE); // a transient inactive (RevenueCat moved the entitlement to the Mac)
    engine.refresh();
    await vi.advanceTimersByTimeAsync(2000); // the read sees it: the 12 s hold starts
    await vi.advanceTimersByTimeAsync(4000);
    shell.report(YEARLY); // autoSyncRecover's sync brings it back
    await vi.advanceTimersByTimeAsync(GRACE * 2);
    expect(engine.getSnapshot().isUnlocked).toBe(true);
    expect(unlocks).toEqual([true]); // never locked
  });

  it('an inactive report never revokes by itself; a genuine lapse still locks through the read and the hold', async () => {
    const shell = nativeShell(YEARLY);
    const { engine } = engineFor(shell);
    engine.start();
    await vi.advanceTimersByTimeAsync(5000);
    shell.report(INACTIVE);
    await vi.advanceTimersByTimeAsync(GRACE * 2);
    expect(engine.getSnapshot().isUnlocked).toBe(true); // the push channel cannot lock
    engine.refresh();
    await vi.advanceTimersByTimeAsync(2000 + GRACE);
    expect(engine.getSnapshot().isUnlocked).toBe(false); // the read path still can
  });
});

describe('autoSyncRecover and the delegate firing for the same recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__billingStatus;
    delete globalThis.__billingEvent;
  });

  // syncPurchases changes RevenueCat's customer info, so the delegate pushes
  // on the status channel; autoSyncRecover then sends restore_complete_active
  // on the event channel. Both, in either order.
  it.each([
    ['delegate first', (shell) => { shell.report(YEARLY); shell.autoSyncEvent(YEARLY.productId); }],
    ['event first', (shell) => { shell.autoSyncEvent(YEARLY.productId); shell.report(YEARLY); }],
  ])('%s: one unlock, one hint write, the event recorded once', async (_order, fire) => {
    const shell = nativeShell();
    const storage = new MemStorage();
    const { engine, unlocks } = engineFor(shell, storage);
    engine.start();
    await vi.advanceTimersByTimeAsync(5000);
    let hintWrites = 0;
    const set = storage.setItem.bind(storage);
    storage.setItem = (k, v) => { if (k.includes('last-active')) hintWrites++; set(k, v); };
    const events = [];
    engine.subscribe(() => {
      const ev = engine.getSnapshot().billingEvent;
      if (ev && events.at(-1) !== ev) events.push(ev);
    });

    fire(shell);
    await vi.advanceTimersByTimeAsync(5000); // and the re-reads the event schedules

    expect(unlocks).toEqual([false, true]);
    expect(hintWrites).toBe(1);
    expect(events.map((e) => e.message)).toEqual(['restore_complete_active']);
  });
});

// ── The wall's copy for a pending outcome ───────────────────────────────────

describe('SubscriptionWall: something to show for every pending outcome', () => {
  let i18n;
  beforeAll(async () => {
    const bundle = await loaders.en();
    i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  });

  function render(billingEvent) {
    let tree;
    act(() => {
      tree = create(React.createElement(I18nextProvider, { i18n },
        React.createElement(SubscriptionWall, {
          isIOSApp: true,
          isLoading: false,
          prices: { yearly: '$10', lifetime: '$30' },
          billingEvent,
          clearBillingEvent: () => {},
          billingErrorMessage: () => 'error text',
        })));
    });
    const status = tree.root.findAll((n) => n.props.role === 'status' && typeof n.type === 'string');
    return { tree, status: status.map((n) => n.findByType('p').children.join('')) };
  }

  const ev = (status, code, message = '') => ({ status, code, message, productId: 'com.dayglance.pro.yearly', ts: 1 });

  it('deferred: waiting for approval', () => {
    const { status } = render(ev('pending', BILLING_CODE_PENDING, 'deferred'));
    expect(status).toEqual(['Your purchase is waiting for approval. dayGLANCE will unlock on its own as soon as it is approved.']);
  });

  it('unconfirmed: being confirmed, with the support address, and nothing about Restore', () => {
    const { status } = render(ev('pending', BILLING_CODE_UNCONFIRMED, 'unconfirmed'));
    expect(status).toHaveLength(1);
    expect(status[0]).toContain('Your purchase went through and is still being confirmed.');
    expect(status[0]).toContain('support@glance-apps.com');
    for (const text of status) expect(text).not.toMatch(/restore/i);
  });

  it('every other outcome shows no notice, as before', () => {
    for (const e of [ev('error', 6), ev('cancelled', -1, 'User cancelled'), ev('cancelled', 0, 'restore_complete'), ev('success', 0, 'ok')]) {
      expect(render(e).status).toEqual([]);
    }
  });
});
