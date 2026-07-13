// @glance-apps/billing — shared entitlement engine and store-billing adapters
// for the GLANCE family of apps.
//
// Entry points:
//   .               — engine, types, adapters, reviewer helpers (this file)
//   ./react         — useBilling React hook
//   ./electron-main — main-process StoreKit + RevenueCat REST module
//   ./capacitor     — Capacitor plugin adapter (pairs with android/ source)

export * from './types.js';
export { BillingEngine, type EngineConfig, type EngineState, type EngineSnapshot } from './engine.js';
export {
  DEFAULT_TIMINGS,
  DEFAULT_STORAGE_KEYS,
  type EngineTimings,
  type StorageKeys,
} from './config.js';
export { SafeStorage } from './storage.js';
export { deriveReviewerCode, sha256Hex } from './reviewer.js';
export { billingErrorMessage } from './errors.js';
export { playManageSubscriptionUrl, appleManageSubscriptionUrl } from './urls.js';

export type { BillingAdapter, ApplyCallbacks } from './adapters/types.js';
export {
  createAndroidWebViewAdapter,
  type AndroidBillingBridge,
  type AndroidWebViewAdapterOptions,
} from './adapters/android-webview.js';
export {
  createIOSWebViewAdapter,
  type IOSBillingBridge,
  type IOSWebViewAdapterOptions,
} from './adapters/ios-webview.js';
export {
  createElectronRendererAdapter,
  type ElectronBillingApi,
  type ElectronPricesPayload,
  type ElectronRendererAdapterOptions,
} from './adapters/electron-renderer.js';
