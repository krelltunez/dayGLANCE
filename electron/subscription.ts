import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { registerElectronBilling } from '@glance-apps/billing/electron-main';

// dayGLANCE billing configuration for the Electron build.
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

// StoreKit billing is macOS-only. registerElectronBilling registers an
// inAppPurchase transaction observer unconditionally, and Electron's
// `inAppPurchase` module does not exist off macOS — so on Windows/Linux the
// `inAppPurchase.on(...)` call throws a TypeError. That throw runs inside the
// app's `whenReady` startup: it aborts every registrar after it (calendar,
// iCloud, Obsidian, global shortcuts) AND leaves the `subscription:*` IPC
// handlers unregistered, so the renderer's `subscriptionStatus()` invoke
// rejects with "No handler registered" instead of resolving. The result on
// Windows is an app that installs and launches its process but never paints a
// window (the DMG/Developer-ID Mac build is unaffected — inAppPurchase exists
// there). See preload.ts, which already documents the intended non-macOS
// contract ("always returns { active: false }" — really: a resolved value, not
// a rejection).
//
// GitHub-distributed builds (Developer-ID Mac DMG, Windows EXE, Linux AppImage)
// are free by design — there is no store to purchase through, exactly like the
// non-MAS macOS path where `subscription:status` returns `{ active: true }`. So
// off macOS we skip the StoreKit wiring entirely and register free-build no-op
// handlers that resolve cleanly, keeping the renderer's billing adapter happy.
function registerFreeBuildHandlers(window: BrowserWindow): void {
  const fireError = (productId: string) => {
    if (!window.isDestroyed()) {
      window.webContents.send('subscription:event', {
        status: 'error', code: 3, message: 'Billing not available', productId,
      });
    }
  };

  // Free build: unlocked, no store receipt. Mirrors the macOS Developer-ID
  // (non-MAS) path so GitHub Windows/Linux users get the same unwalled app.
  ipcMain.handle('subscription:status', () => ({ active: true, productId: null }));
  ipcMain.handle('subscription:prices', () => ({ yearly: null, lifetime: null, yearlyTrialDays: null }));
  ipcMain.handle('subscription:purchase', (_event, productId: string) => { fireError(productId ?? ''); });
  ipcMain.handle('subscription:restore', () => { fireError(''); });
}

export function registerSubscriptionHandlers(window: BrowserWindow): void {
  if (process.platform !== 'darwin') {
    registerFreeBuildHandlers(window);
    return;
  }

  registerElectronBilling(window, {
    rcApiKey: RC_API_KEY,
    entitlementId: 'pro',
    products: {
      yearly: 'com.dayglance.pro.yearly',
      lifetime: 'com.dayglance.pro.lifetime',
    },
  });
}
