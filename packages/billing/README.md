# @glance-apps/billing

Shared entitlement engine and store-billing adapters for the GLANCE family of
apps, across three structurally different backends:

| Platform | Backend | Adapter |
|---|---|---|
| Android (WebView shell) | **Google Play Billing, direct — no RevenueCat** | `createAndroidWebViewAdapter` |
| Android (Capacitor) | Google Play Billing via the bundled `BillingBridge` plugin | `createCapacitorAdapter` + `android/` |
| iOS (WKWebView shell) | RevenueCat SDK (StoreKit 2) | `createIOSWebViewAdapter` |
| macOS (Electron) | StoreKit (`electron.inAppPurchase`) + **RevenueCat REST from the main process** | `createElectronRendererAdapter` + `./electron-main` |

The core assumes **no common backend** — only a common reading shape
(`StatusReading`), a common event shape (`BillingEvent`), and a common
entitlement state machine (`BillingEngine`).

## The rules this package encodes

These were each learned from a shipped field bug in the production integration
this package was extracted from. The unit tests in `test/` lock them in.
**Do not "clean up" any of them.**

1. **Unknown ≠ inactive.** A reading with `indeterminate: true` means the check
   could not be completed (no App Store receipt materialized yet, network
   failure, cold store cache). It is ignored by the engine — it never re-locks.
2. **Asymmetric downgrade grace (anti-flash).** A paying user must never see
   the paywall, even for a second. `active` applies instantly and cancels any
   pending downgrade; a determinate `inactive` on an unlocked install is held
   for `downgradeGraceMs` (default 12 s) and applied only if no recovery lands
   first. A genuinely lapsed subscription still locks — just 12 s later.
3. **Provisional cold-launch unlock.** A persisted "this install has been
   entitled" hint starts a previously-entitled install unlocked at first paint
   even when the native cache is stale; the grace window confirms or clears it.
4. **Optimistic unlock on validated events.** `status: 'success'` and
   `message: 'restore_complete_active'` are only emitted after the platform
   validated the entitlement — the engine unlocks immediately instead of
   waiting on a possibly-stale cache read.
5. **Reconcile applies ACTIVE only.** The post-purchase re-reads
   (`[0, 1200, 3000]` ms) exist to fill in the accurate productId. A lagging
   cache right after someone paid must not even start a downgrade countdown.
6. **Electron trust rules.** Only a well-formed HTTP-200 receipt validation may
   re-lock. `GET /subscribers` auto-creates empty subscribers and is therefore
   unlock-only. HTTP errors, malformed bodies, and missing receipts are
   indeterminate. A latched lifetime purchase can never be re-locked by any
   server read.
7. **`platform` goes in the `X-Platform` header, never the `POST /receipts`
   body.** The body field is rejected with HTTP 400 code 7226, which silently
   breaks every receipt validation.
8. **No hardcoded prices or trial lengths.** Prices and trial days come from
   the store (`Prices`, `TrialInfo.days`). When a value isn't available yet,
   render a loading state or generic copy — never a hardcoded string.
9. **Reviewer bypass.** Play Console app-access policy and App Review
   Guideline 2.1 require a way past a hard gate. Configure `reviewerSecret`
   and surface a code input on your paywall; codes rotate monthly
   (`deriveReviewerCode`).
10. **Channel gating is structural.** MAS builds are detected by the presence
    of the `_MASReceipt` inside the bundle; Developer-ID/GitHub builds have no
    receipt and are free by design; web/PWA installs simply construct no
    adapter (`adapter: null` → ungated). No env vars, no debug flags in
    release artifacts.

There are **two different grace mechanisms** — don't conflate them:

- `timings.downgradeGraceMs` — the 12-second anti-flash hold above.
- `offlineGraceDays` — optional offline-expiry bound on fail-open behavior
  (how long an install stays unlocked with only indeterminate readings).
  **Disabled by default.** Its semantics are provisional pending product-spec
  reconciliation; don't enable it in a migrated app without deciding what you
  want.

## Usage

Platform detection and adapter construction belong in the app, at module
level. All IDs, keys, secrets, and legacy storage keys are injected — nothing
is baked in.

```js
// app/src/billing.js
import {
  createAndroidWebViewAdapter,
  createIOSWebViewAdapter,
  createElectronRendererAdapter,
} from '@glance-apps/billing';
import { useBilling } from '@glance-apps/billing/react';

const ANDROID_PRODUCTS = { yearly: 'acme_pro_annual', lifetime: 'acme_pro_lifetime' };
const APPLE_PRODUCTS   = { yearly: 'com.acme.pro.yearly', lifetime: 'com.acme.pro.lifetime' };

const BILLING  = typeof window !== 'undefined' ? window.AcmeBilling : null; // Android shell injects this
const IOS      = typeof window !== 'undefined' && !!window.AcmeIOS;          // iOS shell injects this
const ELECTRON = typeof window !== 'undefined' && !!window.electronAPI?.subscriptionStatus;

const adapter =
  BILLING  ? createAndroidWebViewAdapter({ bridge: BILLING, products: ANDROID_PRODUCTS }) :
  IOS      ? createIOSWebViewAdapter({ bridge: window.AcmeNative, products: APPLE_PRODUCTS }) :
  ELECTRON ? createElectronRendererAdapter({ api: window.electronAPI }) :
  null; // web/PWA → ungated

export function useSubscription() {
  return useBilling(() => ({
    adapter,
    reviewerSecret: ACME_REVIEWER_SECRET,
    // Migrating an existing integration? Pass your legacy keys so installed
    // users keep their cached entitlement and hints across the update:
    // storageKeys: { lastActive: '<legacy>', reviewerUnlock: '<legacy>' },
  }));
}
```

The hook returns `{ isPro, gated, isUnlocked, productId, prices, trialEligible,
trialDays, isLoading, billingEvent, subscribe, restore, refresh, ... }`.
Gate UI on **`isUnlocked`** (ungated ∨ entitled ∨ reviewer-unlocked).

### Electron main process

```ts
import { registerElectronBilling } from '@glance-apps/billing/electron-main';

registerElectronBilling(mainWindow, {
  rcApiKey: 'appl_XXXX',          // the iOS RevenueCat App Store key — shared under Universal Purchase
  entitlementId: 'pro',
  products: { yearly: 'com.acme.pro.yearly', lifetime: 'com.acme.pro.lifetime' },
});
```

IPC channels are fixed protocol: `subscription:status`, `subscription:prices`,
`subscription:purchase`, `subscription:restore`, plus the `subscription:event`
and `subscription:prices-ready` pushes. Your preload must expose them under
the `ElectronBillingApi` shape (see `adapters/electron-renderer.ts`).

### Capacitor apps (Play-gated, no WebView shell of their own)

1. Add the plugin project from `node_modules/@glance-apps/billing/android` to
   your Capacitor Android build (settings.gradle include + register the
   `BillingBridgePlugin` in your `MainActivity`).
2. Construct the adapter:

```ts
import { registerPlugin } from '@capacitor/core';
import { createCapacitorAdapter } from '@glance-apps/billing/capacitor';

const BillingBridge = registerPlugin('BillingBridge');
const adapter = Capacitor.isNativePlatform()
  ? createCapacitorAdapter({
      plugin: BillingBridge,
      products: { yearly: 'acme_pro_annual', lifetime: 'acme_pro_lifetime' },
    })
  : null;
```

3. Gate your app on `isUnlocked`, render your paywall from `prices` /
   `trialEligible` / `trialDays`, and wire `subscribe` / `restore` /
   the reviewer-code input.

iOS and Electron come "for free" later: when those shells exist, construct the
matching adapter instead — the engine, paywall gating, and event handling are
identical.

### Native bridge contract (WebView shells)

The WebView adapters expect the shell to inject a bridge with these JSON
shapes (see `AndroidBillingBridge` / `IOSBillingBridge`):

- `getStatus()` / `getSubscriptionStatus()` → `{"active":bool,"productId":string|null}`
- `getProductPrices()` → Android `{"annual","lifetime","annualTrialDays"}`,
  iOS `{"yearly","lifetime","yearlyTrialDays"}` (trial days from the store's
  intro-offer metadata; null/absent when unknown)
- `getTrialEligibility()` → `{"<yearlyProductId>": bool}`
- terminal events → `window.__billingEvent({status, code, message, productId})`

## Reconciliation with `paywall-billing-plan.md`

This package implements the plan's contract with these mappings and two
documented deltas (the plan was a proposal; the shipped, field-proven behavior
was authoritative where they conflicted):

| Plan concept | Here |
|---|---|
| `PaywallConfig.channel` / `unlockedChannels` | Structural: the app constructs an adapter only on gated channels (`VITE_BUILD_CHANNEL`-style flag decides at composition time); `adapter: null` → ungated, `gated`/`isUnlocked` expose it. |
| `EntitlementState.source` | `entitlementSource` on the snapshot/hook (`'lifetime' | 'subscription' | 'channel' | 'reviewer' | 'none'`); pass `EngineConfig.products` to distinguish lifetime from subscription. |
| `EntitlementState.lastVerifiedAt` | Persisted in the last-active hint (`verifiedAt`). |
| `storageKey` (sync startup evaluation) | `storageKeys` + the provisional cold-launch unlock; entitlement is evaluated synchronously at startup from the cache, exactly per the plan's local-first constraint. |
| `graceDays` | `offlineGraceDays` — see the two documented deltas in `EngineConfig`: anchored to last-verified (Play Billing exposes no client-side expiry, and the anchor works on every backend) and scoped to indeterminate readings only (a DETERMINATE lapsed subscription still locks; the plan's literal `subExpiresAt + graceDays > now` would keep a knowingly-expired sub unlocked even online, contradicting the proven behavior). Still disabled by default — enabling it and choosing the day count is a product decision. |
| `manageSubscriptionUrl()` | `playManageSubscriptionUrl(pkg, sku?)` / `appleManageSubscriptionUrl()` pure helpers. |
| `getProducts()` | `prices` + `trialEligible`/`trialDays` (the gate UI's actual needs). |
| Headless core, per-app gate UI | Yes — no UI ships in this package. |
| No RevenueCat on Android | Preserved: the Android/Capacitor path is Play Billing direct; purchase data stays between the app and Google Play. |
| Pinned exact versions in consumers | Consumers depend on `"0.1.0"` exact, per family convention. |

Still app-side per the plan (lastGLANCE/lifeGLANCE sessions): the
`VITE_BUILD_CHANNEL` flag, the split build pipeline (github-APK ungated /
play-AAB gated), the `PaywallModal` gate UI, the settings entitlement surface,
Play Console product creation, and final product ids/prices.

## Provenance & verification status

- Engine, WebView adapters, Electron renderer adapter, and the Electron
  main-process module are **ports of production code** that shipped on three
  platforms, with the field-debugged guards preserved verbatim and locked in
  by the unit tests (`npm test`).
- The Capacitor adapter and the `android/` plugin are **new scaffolding
  following the same ported logic** — they compile-verify only inside a
  consuming Capacitor app and have not shipped yet. Treat the first
  integration as their verification pass.
