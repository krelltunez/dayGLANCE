# Testing Play Billing (Android)

How to test purchase / restore / trial flows on the Android app **without spending
real money and without touching your own account or entitlement**. Follow this for
any billing change (library upgrades, price changes, new products).

## Why this is fiddly

- Google Play entitlements are tied to the **Google account**, not the device or the
  installed APK. `queryPurchasesAsync` returns what the *currently active account*
  owns for this package — installation alone grants nothing.
- On your **main profile**, Play always bills your **primary** account. Merely adding
  a second account to the Play Store does *not* switch the billing context, so you
  can't test a fresh purchase there. You need a separate Play context where a test
  account is the primary one.
- Billing only runs on a **release `play` build** (see Build requirements below), so
  you can't test it with a normal debug install.

## One-time setup

1. **Create a throwaway Gmail** dedicated to testing.
2. **Add it as a License Tester:** Play Console → **Setup → License testing** → add
   the throwaway address. This is account-level and applies to dayGLANCE
   automatically. It is what makes purchases safe:
   - the purchase sheet shows **test cards** ("Test card, always approves") — no real
     charge, no real card required;
   - subscriptions renew on an **accelerated clock** (minutes, not a year), so you can
     watch renewal/expiry;
   - you can **cancel / refund / consume** freely to re-test.
3. *(Only if installing via the Play Store rather than sideloading)* add the account
   to an **internal testing track** and accept the tester opt-in link on that account.

> ⚠️ Set up license testing **before** the first purchase. A purchase made before the
> account is on the license-tester list is a **real charge**.

## Per-run: isolated environment

Use **Samsung Secure Folder** (or any separate Android user profile / a Google Play
emulator). Secure Folder is a separate user under the hood: its own Play Store, its
own signed-in account, its own app data — your main profile, primary account, and real
lifetime purchase are untouched.

1. In Secure Folder, sign in with the **throwaway Gmail** only.
2. Get the app in, either way:
   - **Sideload the signed release APK (simplest here):**
     ```bash
     ./build-and-install.sh --release      # produces outputs/dayglance.apk (play flavor)
     ```
     Move `outputs/dayglance.apk` into Secure Folder and install it. License-tester
     status makes billing run in test mode; no track needed.
   - **Or install from Play** inside Secure Folder (requires the internal-testing-track
     step above).
3. Launch it. Because the test account owns nothing, the **paywall appears**.

## What to check

Most of a billing migration is validated **before** any purchase completes:

| Check | Exercises |
|---|---|
| Paywall shows **annual + lifetime prices** | `queryProductPrices` (SUBS + INAPP paths); `oneTimePurchaseOfferDetailsList` |
| **Trial copy** shows (e.g. "14-day free trial") | trial-phase parse + eligibility |
| Tap a plan → **Play sheet opens** (you can dismiss it) | `launchPurchaseFlow` |
| Complete a **test purchase** (annual) → wall dismisses, app unlocks | `purchasesUpdatedListener`, acknowledge, status cache |
| **Restore:** reopen the app → still unlocked | `queryPurchases` |
| Buy **lifetime** → unlocks | INAPP purchase path |
| **Consume & re-buy lifetime:** 7 taps on the plan label → hidden dev menu → consume → wall reappears → buy again | `consumePurchase` |
| *(optional)* let a test sub renew/expire, or cancel it in Play → wall returns | subscription lifecycle |

If prices render and the Play sheet opens, the core migration is working; completing a
test purchase on the throwaway account is the belt-and-suspenders pass.

## Build requirements (why debug won't do)

Billing is deliberately inert outside a release `play` build, so test on the real thing:

- **`getStatus()` reports active** whenever `BuildConfig.DEBUG` is true **or**
  `BILLING_ENABLED` is false — so debug builds and the `github` flavor never show the
  paywall.
- The billing client only connects on **non-debug** builds (`MainActivity` gates
  `connect()` on `!DEBUG`).
- `consumeTestPurchase()` is a no-op unless `BILLING_ENABLED` is true (`play` flavor).

So: **release `play` build only.** The `github` flavor ships with `BILLING_ENABLED=false`
and is not for billing testing.

## Gotchas recap

- License-tester status **before** the first buy, or it's real money.
- Adding the test account next to your primary on your **main profile** does **not**
  work — use Secure Folder / a separate profile / an emulator.
- Debug or `github`-flavor builds bypass billing entirely — use a release `play` build.
- The consume/re-buy path only exists on release `play` builds.
