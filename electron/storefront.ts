import { ipcMain, app } from 'electron';

// ── App Store region signal (macOS) ─────────────────────────────────────────
//
// Reports the region used to gate features that are legally restricted on some
// storefronts — specifically suppressing generative-AI on the China (CN)
// storefront per App Store Review Guideline 5 (Deep Synthesis / MIIT).
//
// Signal: the OS region via app.getLocaleCountryCode() (ISO alpha-2, e.g. "CN").
//
// Why not StoreKit's true storefront: it can only be read by the process that IS
// the App Store app (with its receipt/identity). Electron's main process exposes
// no StoreKit storefront API, and a spawned signed helper isn't "the app" to
// StoreKit — Storefront.current / SKPaymentQueue.storefront return nil there
// (verified in a shipped MAS build). A native addon could read it in-process, but
// the OS region is a reliable enough proxy: App Review tests the China storefront
// from a China-configured environment, so the region reads CN and the gate fires.
// `source` is kept in the payload so the renderer log makes the signal explicit.

export type StorefrontSource = 'locale' | 'none';
export interface StorefrontResult { country: string; source: StorefrontSource; }

export function registerStorefrontHandlers(): void {
  ipcMain.handle('storefront:country', (): StorefrontResult => {
    try {
      const country = (app.getLocaleCountryCode() || '').toUpperCase();
      return country ? { country, source: 'locale' } : { country: '', source: 'none' };
    } catch {
      return { country: '', source: 'none' };
    }
  });
}
