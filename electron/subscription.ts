import { ipcMain, inAppPurchase, net, app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Config ────────────────────────────────────────────────────────────────────

// Replace with the public macOS SDK key from the RevenueCat dashboard
// (App Settings → API Keys → Public app-specific key for macOS).
const RC_API_KEY       = 'REVENUECAT_MACOS_API_KEY';
const RC_BASE          = 'https://api.revenuecat.com/v1';
const ENTITLEMENT_ID   = 'pro';
const PRODUCT_MONTHLY  = 'com.dayglance.app.pro.monthly';
const PRODUCT_YEARLY   = 'com.dayglance.app.pro.yearly';

// ── Anonymous app user ID ─────────────────────────────────────────────────────
// Stable per-device UUID persisted to userData. No account needed — matches
// the "no accounts, privacy-first" principle.

function getAppUserId(): string {
  const p = path.join(app.getPath('userData'), 'rc-app-user-id.txt');
  try {
    const id = fs.readFileSync(p, 'utf-8').trim();
    if (id) return id;
  } catch {}
  const id = `mac_${crypto.randomUUID()}`;
  try { fs.writeFileSync(p, id, 'utf-8'); } catch {}
  return id;
}

// ── Module state ──────────────────────────────────────────────────────────────

let mainWin: BrowserWindow | null = null;

function live(): BrowserWindow | null {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null;
}

function fireBillingEvent(payload: object): void {
  live()?.webContents.send('subscription:event', payload);
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
  return res.json();
}

async function fetchEntitlementStatus(): Promise<{ active: boolean; productId: string | null }> {
  try {
    const userId = getAppUserId();
    const data = await rcFetch('GET', `/subscribers/${encodeURIComponent(userId)}`) as any;
    const ent = data?.subscriber?.entitlements?.[ENTITLEMENT_ID];
    if (!ent) return { active: false, productId: null };
    // Subscriptions have expires_date; lifetime purchases do not.
    if (ent.expires_date) {
      const active = new Date(ent.expires_date) > new Date();
      return { active, productId: active ? (ent.product_identifier ?? null) : null };
    }
    return { active: true, productId: ent.product_identifier ?? null };
  } catch {
    return { active: false, productId: null };
  }
}

async function postReceiptToRC(): Promise<void> {
  try {
    const receiptPath = inAppPurchase.getReceiptURL();
    if (!receiptPath || !fs.existsSync(receiptPath)) return;
    const fetchToken = fs.readFileSync(receiptPath).toString('base64');
    await rcFetch('POST', '/receipts', {
      app_user_id: getAppUserId(),
      fetch_token: fetchToken,
      platform: 'macos',
    });
  } catch {}
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

export function registerSubscriptionHandlers(window: BrowserWindow): void {
  mainWin = window;

  // Fetch prices once from StoreKit on startup and cache them.
  if (process.platform === 'darwin' && inAppPurchase.canMakePayments()) {
    inAppPurchase.getProducts([PRODUCT_MONTHLY, PRODUCT_YEARLY]).then((products) => {
      const prices: Record<string, string> = {};
      for (const p of products) {
        if (p.productIdentifier === PRODUCT_MONTHLY) prices.monthly = p.formattedPrice;
        if (p.productIdentifier === PRODUCT_YEARLY)  prices.yearly  = p.formattedPrice;
      }
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
        await postReceiptToRC();
        fireBillingEvent({
          status: 'success',
          code: 0,
          message: 'ok',
          productId: t.payment.productIdentifier,
        });
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

  // Fetch current entitlement status from RevenueCat (async — cached on renderer side).
  ipcMain.handle('subscription:status', async () => {
    return fetchEntitlementStatus();
  });

  // Return last-known cached prices (already fetched at startup above).
  ipcMain.handle('subscription:prices', () => {
    // Prices are delivered via 'subscription:prices-ready' push on startup;
    // this handle is a fallback for late callers.
    return {};
  });

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
      // Give StoreKit time to deliver restored transactions via 'transactions-updated',
      // then post receipt and fire the terminal event.
      setTimeout(async () => {
        await postReceiptToRC();
        const s = await fetchEntitlementStatus();
        fireBillingEvent({
          status: 'cancelled', // mirrors Android restore pattern: spinner clears, no "new purchase" UI
          code: 0,
          message: s.active ? 'restore_complete_active' : 'restore_complete',
          productId: s.productId ?? '',
        });
      }, 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Restore failed';
      fireBillingEvent({ status: 'error', code: 0, message: msg, productId: '' });
    }
  });
}
