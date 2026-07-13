// Tests for the paywall-billing-plan.md reconciliation additions:
// entitlementSource classification and the manage-subscription URL helpers.

import { describe, expect, it } from 'vitest';
import { BillingEngine } from '../src/engine.js';
import { playManageSubscriptionUrl, appleManageSubscriptionUrl } from '../src/urls.js';
import type { BillingAdapter } from '../src/adapters/types.js';
import type { StatusReading, StorageLike } from '../src/types.js';

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

function stubAdapter(cached: StatusReading): BillingAdapter {
  return {
    platform: 'android',
    cachedReads: true,
    readCachedStatus: () => cached,
    checkStatus: () => Promise.resolve(cached),
    readPrices: () => ({ yearly: null, lifetime: null }),
    readTrial: () => ({ eligible: true, days: null }),
    onMount: () => {},
    refresh: () => {},
    purchase: () => {},
    restore: () => {},
    bindEvents: () => () => {},
  };
}

const PRODUCTS = { yearly: 'pro_annual', lifetime: 'pro_lifetime' };

describe('entitlementSource (plan EntitlementState.source contract)', () => {
  it("ungated install → 'channel'", () => {
    const engine = new BillingEngine({ adapter: null, storage: new MemStorage() });
    expect(engine.getSnapshot().entitlementSource).toBe('channel');
  });

  it("gated + locked → 'none'", () => {
    const engine = new BillingEngine({
      adapter: stubAdapter({ active: false, productId: null }),
      storage: new MemStorage(),
      products: PRODUCTS,
    });
    expect(engine.getSnapshot().entitlementSource).toBe('none');
  });

  it("active yearly → 'subscription'; active lifetime → 'lifetime'", () => {
    const sub = new BillingEngine({
      adapter: stubAdapter({ active: true, productId: 'pro_annual' }),
      storage: new MemStorage(),
      products: PRODUCTS,
    });
    expect(sub.getSnapshot().entitlementSource).toBe('subscription');

    const life = new BillingEngine({
      adapter: stubAdapter({ active: true, productId: 'pro_lifetime' }),
      storage: new MemStorage(),
      products: PRODUCTS,
    });
    expect(life.getSnapshot().entitlementSource).toBe('lifetime');
  });

  it("without product hints, any active entitlement classifies as 'subscription'", () => {
    const engine = new BillingEngine({
      adapter: stubAdapter({ active: true, productId: 'pro_lifetime' }),
      storage: new MemStorage(),
    });
    expect(engine.getSnapshot().entitlementSource).toBe('subscription');
  });

  it("reviewer unlock on a locked install → 'reviewer'", async () => {
    const engine = new BillingEngine({
      adapter: stubAdapter({ active: false, productId: null }),
      storage: new MemStorage(),
      products: PRODUCTS,
      reviewerSecret: 'sekrit',
    });
    engine.start();
    const { deriveReviewerCode } = await import('../src/reviewer.js');
    await engine.setReviewerUnlocked(await deriveReviewerCode('sekrit'));
    expect(engine.getSnapshot().entitlementSource).toBe('reviewer');
    expect(engine.getSnapshot().isUnlocked).toBe(true);
  });
});

describe('manage-subscription URLs', () => {
  it('play deep link targets the sku + package', () => {
    expect(playManageSubscriptionUrl('com.acme.app', 'pro_annual')).toBe(
      'https://play.google.com/store/account/subscriptions?sku=pro_annual&package=com.acme.app',
    );
    expect(playManageSubscriptionUrl('com.acme.app')).toBe(
      'https://play.google.com/store/account/subscriptions',
    );
  });

  it('apple link is the account subscriptions page', () => {
    expect(appleManageSubscriptionUrl()).toBe('https://apps.apple.com/account/subscriptions');
  });
});
