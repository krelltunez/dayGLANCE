// Core types for the GLANCE billing/entitlement engine.
//
// The one type everything hinges on is StatusReading. Its `indeterminate` flag
// encodes the load-bearing distinction the whole engine is built around:
// "we could not find out" is NOT the same as "not entitled", and must never be
// allowed to lock a paying user out. See engine.ts for the trust rules.

export type BillingPlatform = 'android' | 'ios' | 'electron' | 'capacitor';

/**
 * A single entitlement reading from a platform source.
 *
 * - `{ active: true, productId }`          — determinate: entitled.
 * - `{ active: false, productId: null }`   — determinate: NOT entitled. Only a
 *   reading the platform layer considers authoritative may carry this shape
 *   (e.g. an HTTP-200 RevenueCat receipt validation, a completed Play
 *   queryPurchases). It is the only shape that can (eventually) re-lock.
 * - `{ active: false, indeterminate: true }` — the check could not be completed
 *   (no receipt on disk yet, network failure, store cache not warm). The engine
 *   ignores these outright: the current state is kept.
 */
export interface StatusReading {
  active: boolean;
  productId: string | null;
  /** Unknown ≠ inactive. Never treated as "not entitled"; never re-locks. */
  indeterminate?: boolean;
  /**
   * Cold-launch unlock granted from the persisted last-active hint before any
   * platform source confirmed it. Confirmed or cleared after the downgrade
   * grace window by re-reading the platform cache.
   */
  provisional?: boolean;
}

/** Localized, store-formatted price strings. Null until the store answers. */
export interface Prices {
  yearly: string | null;
  lifetime: string | null;
}

/**
 * Free-trial state for the yearly subscription.
 *
 * `eligible` defaults to true until the store says otherwise — better to show
 * trial copy and let the store sheet correct it than to hide a trial from an
 * eligible user. `days` comes from the store's intro-offer metadata (Play
 * pricing phases, StoreKit introductory discount); null means the platform
 * could not report a length, in which case UI must show generic trial copy —
 * NEVER a hardcoded number.
 */
export interface TrialInfo {
  eligible: boolean;
  days: number | null;
}

export type BillingEventStatus =
  | 'success'
  | 'cancelled'
  | 'error'
  | 'consumed'
  | 'consume_failed';

/**
 * Terminal billing event, shared shape across every platform bridge.
 *
 * Restore results arrive as status 'cancelled' with message 'restore_complete'
 * (nothing found) or 'restore_complete_active' (an entitlement was restored) —
 * 'cancelled' so UI clears its spinner without treating a restore like a new
 * purchase. 'success' and 'restore_complete_active' are only ever emitted AFTER
 * the platform has validated the entitlement, which is why the engine trusts
 * them enough to unlock optimistically.
 */
export interface BillingEvent {
  status: BillingEventStatus;
  code: number;
  message: string;
  productId: string;
  ts?: number;
}

/** Product identifiers as configured in the store, keyed by plan. */
export interface ProductIds {
  yearly: string;
  lifetime: string;
}

/**
 * Why the install is (or isn't) unlocked — the plan-contract classification
 * for settings surfaces ("entitlement state" rows) and analytics.
 *
 * 'channel'      — ungated distribution (web/PWA, GitHub sideload, dev build).
 * 'lifetime'     — entitled via the one-time purchase (requires the engine to
 *                  know the lifetime product id; see EngineConfig.products).
 * 'subscription' — entitled via the auto-renewing plan (also the fallback when
 *                  the engine has no product-id hints to tell the two apart).
 * 'reviewer'     — store-review bypass code.
 * 'none'         — gated and locked.
 */
export type EntitlementSource = 'lifetime' | 'subscription' | 'channel' | 'reviewer' | 'none';

/** Minimal storage interface (window.localStorage satisfies it). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Persisted "this install has been entitled" hint. */
export interface LastActiveHint {
  productId: string | null;
  /**
   * Epoch ms of the last determinate-active reading. Absent on hints written
   * by older integrations — treated as "fresh" so existing installs keep their
   * provisional cold-launch unlock across the migration.
   */
  verifiedAt?: number;
}
