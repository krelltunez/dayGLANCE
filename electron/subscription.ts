import type { BrowserWindow } from 'electron';
import { registerElectronBilling } from '@glance-apps/billing/electron-main';

// dayGLANCE billing configuration for the Electron (macOS) build.
//
// All of the billing machinery — the RevenueCat REST trust rules, the
// indeterminate-vs-inactive distinction, the lifetime latch, MAS-receipt
// channel detection, dual-path restore settlement, and the prices push+pull
// race fix — lives in @glance-apps/billing/electron-main. Read that module
// (and its tests) before changing anything about how entitlement is decided;
// every guard in it exists because its absence shipped a real bug here.

// Public RevenueCat SDK key for the "App Store" app. Under Apple Universal
// Purchase the iOS and macOS apps share a single RevenueCat App Store app, so
// this one key (and its App Store shared secret) covers the Mac build too —
// there is no separate macOS app or macOS-specific key.
const RC_API_KEY = 'appl_uHejfwubTbYOTpEPNYFsjXAgnHw';

export function registerSubscriptionHandlers(window: BrowserWindow): void {
  registerElectronBilling(window, {
    rcApiKey: RC_API_KEY,
    entitlementId: 'pro',
    products: {
      yearly: 'com.dayglance.pro.yearly',
      lifetime: 'com.dayglance.pro.lifetime',
    },
  });
}
