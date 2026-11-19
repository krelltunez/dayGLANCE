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

// `currentWindow` is a getter, not a window, and has to be: the package sends
// every purchase and restore result to the window it is given, and a window it
// is handed once is the one it keeps for the life of the process. Closing only
// hides the main window on macOS, but main.ts destroys it and creates another
// after a renderer crash (render-process-gone, and tray:open-main on a zombie),
// and a purchase made in that one would then complete in StoreKit with the
// paywall never told: its spinner stayed up until the next launch. The getter
// is resolved on every push (billing 0.2.3).
export function registerSubscriptionHandlers(currentWindow: () => BrowserWindow | null): void {
  registerElectronBilling(currentWindow, {
    rcApiKey: RC_API_KEY,
    entitlementId: 'pro',
    products: {
      yearly: 'com.dayglance.pro.yearly',
      lifetime: 'com.dayglance.pro.lifetime',
    },
  });
}
