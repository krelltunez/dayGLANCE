import { ipcMain, inAppPurchase, net, app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Config ────────────────────────────────────────────────────────────────────

// Public RevenueCat SDK key for the "App Store" app. Under Apple Universal
// Purchase the iOS and macOS apps share a single RevenueCat App Store app, so
// this one key (and its App Store shared secret) covers the Mac build too —
// there is no separate macOS app or macOS-specific key.
const RC_API_KEY       = 'appl_uHejfwubTbYOTpEPNYFsjXAgnHw';
const RC_BASE          = 'https://api.revenuecat.com/v1';
const ENTITLEMENT_ID   = 'pro';
const PRODUCT_YEARLY   = 'com.dayglance.pro.yearly';
const PRODUCT_LIFETIME = 'com.dayglance.pro.lifetime';

// Cached StoreKit prices, populated once at startup. The renderer both receives a
// 'subscription:prices-ready' push AND can pull via 'subscription:prices'. The pull
// closes the race where the push fired before the paywall mounted its listener —
// Electron drops renderer-directed messages sent before a listener exists, which
// left the price stuck on "Loading…" even though the fetch succeeded.
let cachedPrices: { yearly: string | null; lifetime: string | null } = { yearly: null, lifetime: null };

// ── Anonymous app user ID ─────────────────────────────────────────────────────
// Derived from a hash of the userData path — stable per user+app installation,
// no file I/O required. Identity is validated against the MAS receipt rather than
// persisted separately, so RevenueCat derives the Apple ID from the receipt itself.

function getStableAnonymousId(): string {
  return crypto.createHash('sha256')
    .update(app.getPath('userData'))
    .digest('hex')
    .slice(0, 32);
}

// ── Lifetime latch ────────────────────────────────────────────────────────────
// A lifetime purchase is permanent: once Apple has confirmed one (StoreKit
// transaction) or RevenueCat has validated one, record it locally and never let
// any later server read re-lock this install. Server checks can fail or drift
// (identity aliasing, receipt validation issues); a one-time purchase must not
// be held hostage to them. Threat model is the same as the renderer's cached
// status — a local file, no worse than the existing localStorage cache.

function lifetimeLatchPath(): string {
  return path.join(app.getPath('userData'), 'lifetime-purchased.json');
}

function isLifetimeLatched(): boolean {
  try { return fs.existsSync(lifetimeLatchPath()); } catch { return false; }
}

function latchLifetime(source: string): void {
  try {
    if (isLifetimeLatched()) return;
    fs.writeFileSync(lifetimeLatchPath(), JSON.stringify({
      productId: PRODUCT_LIFETIME, latchedAt: new Date().toISOString(), source,
    }));
    console.info(`[subscription] lifetime purchase latched (${source})`);
  } catch {}
}

// ── Distribution channel detection ───────────────────────────────────────────
// The MAS receipt lives at [AppBundle]/Contents/_MASReceipt/receipt — inside
// the bundle itself, placed by StoreKit at install time. It cannot survive a
// switch to another distribution method: installing a Developer ID DMG replaces
// the entire bundle, stripping the receipt directory. Its presence is therefore
// a reliable structural signal that this specific binary came from the App Store.
//
// Developer ID (GitHub) builds have no receipt and are free by design.
// No env var or debug flag is needed — the signal is structural and permanent.

function isMASBuild(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    const receiptPath = inAppPurchase.getReceiptURL();
    return !!(receiptPath && fs.existsSync(receiptPath));
  } catch { return false; }
}

// ── Module state ──────────────────────────────────────────────────────────────

let mainWin: BrowserWindow | null = null;

function live(): BrowserWindow | null {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null;
}

function fireBillingEvent(payload: object): void {
  live()?.webContents.send('subscription:event', payload);
}

// ── Restore settlement ────────────────────────────────────────────────────────
// StoreKit delivers restored purchases through 'transactions-updated', but
// Electron exposes no "restore finished" callback, so a restore that finds no
// purchases produces no event at all. Settlement is therefore dual-path: a
// restored transaction settles as soon as its receipt validates (regardless of
// network speed), and a fallback timer settles the nothing-to-restore case.
// Whichever runs first wins; the other becomes a no-op.

const RESTORE_FALLBACK_MS = 10_000;
let restorePending = false;
let restoreFallback: NodeJS.Timeout | null = null;

function settleRestore(active: boolean, productId: string | null): void {
  if (!restorePending) return;
  restorePending = false;
  if (restoreFallback) { clearTimeout(restoreFallback); restoreFallback = null; }
  fireBillingEvent({
    status: 'cancelled', // mirrors Android restore pattern: spinner clears, no "new purchase" UI
    code: 0,
    message: active ? 'restore_complete_active' : 'restore_complete',
    productId: productId ?? '',
  });
}

// ── RevenueCat REST API ───────────────────────────────────────────────────────

async function rcFetch(method: string, endpoint: string, body?: object): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${RC_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Platform': 'macos',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await net.fetch(`${RC_BASE}${endpoint}`, opts);
  const text = await res.text();
  // An HTTP error is NOT an answer about the subscription — it must never be
  // parsed into "no entitlement". Throw so callers treat it as indeterminate.
  // (Previously a 4xx error body parsed as JSON with no `subscriber`, which
  // downstream read as a definitive "not subscribed" and re-locked the paywall.)
  if (!res.ok) {
    throw new Error(`RevenueCat ${method} ${endpoint} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try { return JSON.parse(text); } catch {
    throw new Error(`RevenueCat ${method} ${endpoint} → HTTP ${res.status} with non-JSON body: ${text.slice(0, 120)}`);
  }
}

// Validates the MAS receipt with RevenueCat (POST /receipts) and returns entitlement
// status. Using POST /receipts rather than GET /subscribers means RevenueCat derives
// the customer identity from the Apple ID embedded in the receipt — no separate
// persisted user ID is needed, and cross-device restore just works via Apple ID.
// `indeterminate: true` means the check could NOT be completed — no App Store
// receipt on disk yet (very common on a COLD LAUNCH: macOS often doesn't
// materialize the receipt until a StoreKit refresh/restore runs, which is exactly
// why "Restore Purchase" recovers access when a fresh launch showed the paywall),
// or a network/RevenueCat failure. Callers MUST treat indeterminate as "unknown",
// never as "inactive": a paying user must not be downgraded and shown the paywall
// just because the receipt wasn't ready or the network hiccuped. A DEFINITIVE
// inactive (RC validated the receipt and the entitlement is absent or expired) is
// returned WITHOUT the flag, so a genuinely lapsed subscription still re-locks.
// Parse RevenueCat's subscriber.entitlements[pro] into our status shape.
// Returns a definitive { active } result, or null if the subscriber object itself
// was missing/unparseable (caller treats that as indeterminate).
function parseProEntitlement(subscriber: unknown): { active: boolean; productId: string | null } | null {
  const ent = (subscriber as any)?.entitlements?.[ENTITLEMENT_ID];
  if (subscriber == null) return null; // couldn't read a subscriber at all
  if (!ent) return { active: false, productId: null }; // subscriber exists, no pro entitlement
  // Subscriptions have expires_date; lifetime non-consumables do not.
  if (ent.expires_date) {
    const active = new Date(ent.expires_date) > new Date();
    return { active, productId: active ? (ent.product_identifier ?? null) : null };
  }
  return { active: true, productId: ent.product_identifier ?? null };
}

// Trust rules, learned the hard way:
//   - Only a well-formed HTTP-200 receipt validation may ever RE-LOCK (it is the
//     one response proving RevenueCat actually examined this install's receipt).
//   - The GET /subscribers fallback AUTO-CREATES an empty subscriber for unknown
//     ids, so "no entitlement" from it is meaningless — it may only UNLOCK.
//   - A latched lifetime purchase can never be re-locked by any server read.
//   - Everything else (HTTP errors, malformed bodies, no receipt) is
//     indeterminate: the renderer keeps its cached last-known-good state.
async function fetchEntitlementStatus(): Promise<{ active: boolean; productId: string | null; indeterminate?: boolean }> {
  const appUserId = getStableAnonymousId();
  const latched = isLifetimeLatched();

  let receiptPath: string | null = null;
  try { receiptPath = inAppPurchase.getReceiptURL(); } catch { receiptPath = null; }
  const hasReceipt = !!(receiptPath && fs.existsSync(receiptPath));
  console.info(`[subscription] check: app_user_id=${appUserId} receiptOnDisk=${hasReceipt} lifetimeLatched=${latched}`);

  // Path 1: validate the local App Store receipt. This also (re)establishes the
  // RevenueCat alias between this app_user_id and the receipt's Apple ID.
  if (hasReceipt) {
    try {
      const fetchToken = fs.readFileSync(receiptPath!).toString('base64');
      // Platform is conveyed via the X-Platform header (rcFetch). Putting it in the
      // body is rejected: HTTP 400 {"code":7226,"message":"platform: Extra inputs
      // are not permitted"} — which silently broke EVERY Mac receipt validation.
      const data = await rcFetch('POST', '/receipts', {
        app_user_id: appUserId, fetch_token: fetchToken,
      });
      const sub = (data as any)?.subscriber;
      console.info('[subscription] POST /receipts entitlements =',
        JSON.stringify(sub?.entitlements ?? null)?.slice(0, 400));
      if (sub && typeof sub.entitlements === 'object') {
        const parsed = parseProEntitlement(sub)!;
        if (parsed.active && parsed.productId === PRODUCT_LIFETIME) latchLifetime('rc-receipt-validation');
        if (!parsed.active && latched) return { active: true, productId: PRODUCT_LIFETIME };
        return parsed; // the ONLY response allowed to re-lock
      }
      console.warn('[subscription] 200 response without well-formed subscriber — indeterminate');
    } catch (err) {
      console.warn('[subscription] receipt validation failed (indeterminate):',
        err instanceof Error ? err.message : err);
    }
  }

  // Path 2: subscriber lookup by app user id — UNLOCK-ONLY (see trust rules).
  try {
    const data = await rcFetch('GET', `/subscribers/${encodeURIComponent(appUserId)}`);
    const parsed = parseProEntitlement((data as any)?.subscriber);
    console.info('[subscription] GET /subscribers pro active =', parsed?.active);
    if (parsed?.active) {
      if (parsed.productId === PRODUCT_LIFETIME) latchLifetime('rc-subscriber-lookup');
      return parsed;
    }
  } catch (err) {
    console.warn('[subscription] subscriber lookup failed:', err instanceof Error ? err.message : err);
  }

  if (latched) return { active: true, productId: PRODUCT_LIFETIME };
  return { active: false, productId: null, indeterminate: true };
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

export function registerSubscriptionHandlers(window: BrowserWindow): void {
  mainWin = window;

  // Fetch prices once from StoreKit on startup and cache them.
  if (process.platform === 'darwin' && inAppPurchase.canMakePayments()) {
    inAppPurchase.getProducts([PRODUCT_YEARLY, PRODUCT_LIFETIME]).then((products) => {
      const prices: { yearly: string | null; lifetime: string | null } = { yearly: null, lifetime: null };
      for (const p of products) {
        if (p.productIdentifier === PRODUCT_YEARLY)   prices.yearly   = p.formattedPrice;
        if (p.productIdentifier === PRODUCT_LIFETIME) prices.lifetime = p.formattedPrice;
      }
      cachedPrices = prices;
      live()?.webContents.send('subscription:prices-ready', prices);
    }).catch(() => {});
  }

  // StoreKit transaction observer — registered once for the lifetime of the process.
  // Cast needed because Electron's inAppPurchase typings declare the listener as () => void
  // but the runtime passes (event, transactions[]) matching the Electron docs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inAppPurchase.on('transactions-updated', (async (_event: any, transactions: Electron.Transaction[]) => {
    for (const t of transactions) {
      if (t.transactionState === 'purchased' || t.transactionState === 'restored') {
        // Apple itself confirmed this transaction — that is authoritative proof of
        // purchase for a lifetime product, independent of RevenueCat bookkeeping.
        if (t.payment.productIdentifier === PRODUCT_LIFETIME) latchLifetime('storekit-transaction');
        const s = await fetchEntitlementStatus(); // posts receipt to RC (bookkeeping/alias)
        fireBillingEvent({
          status: 'success',
          code: 0,
          message: 'ok',
          productId: t.payment.productIdentifier,
        });
        if (t.transactionState === 'restored') {
          // A restored transaction is proof the user owns something; don't let a
          // failed RC read turn a successful Apple restore into "nothing restored".
          settleRestore(s.active || isLifetimeLatched(), s.productId ?? t.payment.productIdentifier);
        }
        inAppPurchase.finishTransactionByDate(t.transactionDate);
      } else if (t.transactionState === 'failed') {
        const cancelled = t.errorCode === 2; // SKErrorPaymentCancelled
        fireBillingEvent({
          status: cancelled ? 'cancelled' : 'error',
          code: t.errorCode ?? 0,
          message: cancelled ? 'User cancelled' : (t.errorMessage ?? 'Transaction failed'),
          productId: t.payment.productIdentifier,
        });
        inAppPurchase.finishTransactionByDate(t.transactionDate);
      }
    }
  }) as unknown as () => void);

  // Fetch current entitlement status. Non-MAS builds (Developer ID / GitHub
  // distribution) have no App Store receipt and are free by design — skip RC.
  ipcMain.handle('subscription:status', async () => {
    if (!isMASBuild()) return { active: true, productId: null };
    return fetchEntitlementStatus();
  });

  // Return last-known cached prices. The renderer pulls this on mount so a paywall
  // that mounted after the startup 'subscription:prices-ready' push (dropped, since
  // no listener existed yet) still gets prices instead of showing "Loading…".
  ipcMain.handle('subscription:prices', () => cachedPrices);

  // Open the Mac App Store purchase sheet via StoreKit.
  ipcMain.handle('subscription:purchase', async (_event, productId: string) => {
    if (process.platform !== 'darwin' || !inAppPurchase.canMakePayments()) {
      fireBillingEvent({ status: 'error', code: 3, message: 'Billing not available', productId });
      return;
    }
    try {
      const queued = await inAppPurchase.purchaseProduct(productId, { quantity: 1 });
      if (!queued) {
        fireBillingEvent({ status: 'error', code: 0, message: 'Product not queued', productId });
      }
      // Completion arrives via 'transactions-updated' above.
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Purchase failed';
      fireBillingEvent({ status: 'error', code: 0, message: msg, productId });
    }
  });

  // Trigger StoreKit restore + post receipt to RevenueCat.
  ipcMain.handle('subscription:restore', async () => {
    if (process.platform !== 'darwin') {
      fireBillingEvent({ status: 'error', code: 3, message: 'Billing not available', productId: '' });
      return;
    }
    try {
      inAppPurchase.restoreCompletedTransactions();
      // Fast path: a restored transaction settles this via 'transactions-updated'
      // as soon as its receipt validates. The timer only covers the
      // nothing-to-restore case, which produces no StoreKit event at all.
      restorePending = true;
      if (restoreFallback) clearTimeout(restoreFallback);
      restoreFallback = setTimeout(async () => {
        restoreFallback = null;
        const s = await fetchEntitlementStatus();
        settleRestore(s.active, s.productId);
      }, RESTORE_FALLBACK_MS);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Restore failed';
      fireBillingEvent({ status: 'error', code: 0, message: msg, productId: '' });
    }
  });
}
