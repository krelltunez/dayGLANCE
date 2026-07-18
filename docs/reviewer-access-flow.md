# Reviewer Access & the "back to paywall" banner

How a hard-gated (paywalled-on-launch) GLANCE app lets **App Review** get past the
paywall to use the app, *and* always get **back** to the paywall to review the
in-app purchases. Written for dayGLANCE; the "Porting" section at the end is the
checklist for lifeGLANCE / lastGLANCE.

## The problem this solves

The app is fully gated: on first launch a full-screen `SubscriptionWall` covers
everything, and that wall is the **only** place the IAPs are shown. App Review
needs two things that pull in opposite directions:

- **Guideline 2.1 (app completeness / demo access):** the reviewer must be able to
  use the whole app without paying → we give them a **reviewer bypass code**.
- **Guideline 2.1(b):** the reviewer must be able to **locate and test the IAPs**.

The trap we hit: the reviewer entered the bypass code, the paywall vanished, and
there was **no way back to it** — so they "could not locate the In-App Purchases"
and rejected the app. The fix is a persistent **ReviewerBanner** with an
**"Exit & view plans"** button that returns to the paywall on demand.

## Moving parts

| Piece | Where | Role |
|---|---|---|
| Reviewer secret | `src/config/reviewerAccess.js` | App-specific HMAC key for the code |
| Code derivation | `@glance-apps/billing` `deriveReviewerCode()` | HMAC-SHA256 over the UTC month → 12-hex code, **rotates monthly** |
| Code preview CLI | `scripts/reviewer-code.js` | `npm run reviewer-code [-- YYYY-MM]` prints the code |
| Billing hook | `src/hooks/useSubscription.js` | Wires `reviewerSecret` + storage keys; exposes `isReviewerUnlocked` / `setReviewerUnlocked` |
| Paywall + code input | `src/components/SubscriptionWall.jsx` | "Reviewer access" field → `onReviewerUnlock(code)` |
| Banner | `src/components/ReviewerBanner.jsx` | Shown while unlocked; "Exit & view plans" |
| Wiring | `src/App.jsx` | Renders banner vs. wall; `exitReviewerMode` |

## How it flows

```
Launch (not entitled)                → SubscriptionWall covers the app
  ├─ tap a plan (Annual / Lifetime)  → StoreKit/Play purchase  → entitled → wall gone
  └─ tap "Reviewer access", enter code
        → setReviewerUnlocked(code)  → billing engine validates via deriveReviewerCode
        → isReviewerUnlocked = true  → wall hidden, ReviewerBanner shown
             └─ tap "Exit & view plans"
                   → exitReviewerMode(): clear the unlock key + reload
                   → isReviewerUnlocked = false → wall (and IAPs) return
```

`isReviewerUnlocked` is persisted (localStorage) by the billing engine, so it
survives reloads until explicitly cleared. The engine exposes no "revoke", so
`exitReviewerMode` clears the key directly and reloads.

## The code

### 1. Billing hook config (`useSubscription.js`)

```js
const billing = useBilling(() => ({
  adapter,
  reviewerSecret: REVIEWER_SECRET,          // from src/config/reviewerAccess.js
  products: APPLE_PRODUCTS,                  // entitlementSource hints
  storageKeys: {
    lastActive:     'day-planner-entitlement-last-active',
    reviewerUnlock: 'day-planner-reviewer-unlock',   // ← the key exitReviewerMode clears
  },
}));
// expose: billing.isReviewerUnlocked, billing.setReviewerUnlocked
```

### 2. The banner (`ReviewerBanner.jsx`)

```jsx
import React from 'react';
import { ShieldCheck } from 'lucide-react';

export default function ReviewerBanner({ darkMode, onExit }) {
  return (
    <div
      role="status"
      className={`fixed top-0 inset-x-0 z-[10000] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-xs ${
        darkMode
          ? 'bg-amber-500/15 text-amber-200 border-b border-amber-500/30'
          : 'bg-amber-100 text-amber-900 border-b border-amber-300'
      }`}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <ShieldCheck size={14} className="flex-shrink-0" />
        Reviewer access active — the app is unlocked without a purchase.
      </span>
      <button
        onClick={onExit}
        className={`rounded-full px-3 py-1 font-semibold transition-colors ${
          darkMode
            ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
            : 'bg-amber-600 text-white hover:bg-amber-700'
        }`}
      >
        Exit &amp; view plans
      </button>
    </div>
  );
}
```

### 3. App wiring (`App.jsx`)

```jsx
const { /* … */ isReviewerUnlocked, setReviewerUnlocked, isPro, isLoading: subLoading,
        isAndroidApp, isIOSApp, isElectronApp } = useSubscription();

// Leave reviewer mode: clear the stored unlock and reload so the engine re-reads a
// now-absent key (there is no revoke method), which brings the paywall back.
const exitReviewerMode = () => {
  try { localStorage.removeItem('day-planner-reviewer-unlock'); } catch { /* storage unavailable */ }
  location.reload();
};

// …in render, as sibling overlays at the app root:
{isReviewerUnlocked && (
  <ReviewerBanner darkMode={darkMode} onExit={exitReviewerMode} />
)}

{(import.meta.env.DEV && new URLSearchParams(location.search).has('wall')
   || (isAndroidApp || isIOSApp || isElectronApp))
 && (subLoading || !isPro) && !isReviewerUnlocked && (
  <SubscriptionWall
    /* …prices, onSubscribeYearly, onSubscribeLifetime, onRestore… */
    onReviewerUnlock={setReviewerUnlocked}
  />
)}
```

**Gate logic:** the wall renders on native platforms (or in a dev build with
`?wall`) when the subscription is loading/inactive **and** not reviewer-unlocked.
The banner renders whenever `isReviewerUnlocked`. They are never visible at once —
exiting reviewer mode reloads, and with no entitlement the wall reappears.

### 4. Getting the monthly code

```
npm run reviewer-code            # current UTC month
npm run reviewer-code -- 2026-08 # preview a specific month
```

Paste the current month's code (and, near a month boundary, next month's too) into
the **App Review Notes**. The code rotates on the 1st (UTC), so a review that spans
the boundary needs both.

## App Review Notes snippet

```
To access the full app for review without purchasing:
1. On the paywall, tap "Reviewer access" at the bottom.
2. Enter a code: <MONTH1>: <code1> · <MONTH2>: <code2>
The app unlocks immediately; no account, email, or sign-in is required. A banner
stays at the top until you tap "Exit & view plans," which returns you to the
paywall and the in-app purchases.
```

## Porting checklist (lifeGLANCE / lastGLANCE)

1. **Copy** `ReviewerBanner.jsx` verbatim (change the label text if you want).
2. **`src/config/reviewerAccess.js`** — give each app its **own** `REVIEWER_SECRET`.
   Different secret → different codes per app. Never share secrets across apps.
3. **`useSubscription.js`** — set `reviewerSecret` and the two `storageKeys`. These
   keys are app-local; pick any stable strings, but they must be consistent within
   the app.
4. **`exitReviewerMode`** — the `localStorage.removeItem('…')` key **must exactly
   match** `storageKeys.reviewerUnlock` for that app. This is the #1 porting bug:
   if they differ, "Exit & view plans" won't clear the unlock and the paywall won't
   come back.
5. **`SubscriptionWall`** — confirm it has the "Reviewer access" field calling
   `onReviewerUnlock`, wired to `setReviewerUnlocked`, and update the product IDs.
6. **Render** the banner (`{isReviewerUnlocked && …}`) and pass `onExit=exitReviewerMode`.
7. **`npm run reviewer-code`** to generate that app's codes for the review notes.

## Why it's built this way (lessons)

- **The launch paywall is the only IAP surface.** If a reviewer leaves it (via the
  code) with no way back, that alone triggers 2.1(b). The banner is the way back.
- **Codes rotate monthly.** Always put the current *and* next month's code in the
  notes if a review might cross the 1st.
- **The banner is reviewer-only** (`isReviewerUnlocked`) — genuine purchasers never
  see it, because they're entitled via StoreKit/Play, not the bypass code.
- **Lead the review notes with the IAPs**, then the bypass code — so the reviewer
  tests the purchases before (or instead of) using the code.
