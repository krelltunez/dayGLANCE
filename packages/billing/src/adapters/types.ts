import type {
  BillingEvent,
  BillingPlatform,
  Prices,
  StatusReading,
  TrialInfo,
} from '../types.js';

/**
 * Callbacks the engine hands to an adapter so platform-specific refresh
 * choreography can feed readings back through the engine's single gate.
 *
 * `applyStatus` is THE gate: active applies instantly and cancels any pending
 * downgrade; a determinate inactive on a currently-unlocked install is held
 * for the downgrade grace window; indeterminate readings are ignored. Adapters
 * must route every entitlement reading through it — never mutate state
 * directly.
 */
export interface ApplyCallbacks {
  applyStatus(reading: StatusReading | null | undefined): void;
  setPrices(prices: Prices): void;
  setTrial(trial: Partial<TrialInfo>): void;
  setLoading(loading: boolean): void;
  /** Route a terminal billing event into the engine (string payloads are parsed). */
  emitBillingEvent(event: BillingEvent | string): void;
}

/**
 * One platform's billing surface.
 *
 * The engine owns the invariant machinery (downgrade grace, provisional
 * cold-launch unlock, optimistic unlock, active-only reconcile, purchase
 * timeout, reviewer bypass, persistence). The adapter owns everything
 * platform-shaped: how to read the native cache, how purchases are launched,
 * and the exact refresh choreography each platform needs — including its
 * settle delays, which were tuned against real store latency.
 *
 * The three GLANCE platforms are structurally different — Play Billing direct
 * (no RevenueCat), RevenueCat SDK, and RevenueCat REST from the Electron main
 * process — so this interface deliberately assumes NO common backend, only a
 * common reading/event shape.
 */
export interface BillingAdapter {
  readonly platform: BillingPlatform;

  /**
   * True when readCachedStatus() reads a synchronously-available native cache
   * that refresh() updates in the background (Android/iOS webview bridges).
   * False when the authoritative check is itself async (Electron IPC,
   * Capacitor plugin). Gates the post-purchase price re-read: cached platforms
   * re-read prices from the bridge; async platforms would clobber real prices
   * with nulls.
   */
  readonly cachedReads: boolean;

  /**
   * Synchronous read of the locally cached entitlement. Used for the engine's
   * initial state and the provisional-unlock confirmation. Must never block
   * or hit the network. On platforms without a sync native read (Electron,
   * Capacitor) this reads the adapter's own persisted cache.
   */
  readCachedStatus(): StatusReading;

  /**
   * Possibly-async status check used by reconcile and refresh. For cached-read
   * platforms this resolves immediately with the same cache read; for Electron
   * it is the main-process entitlement check (which may return indeterminate).
   */
  checkStatus(): Promise<StatusReading>;

  /** Synchronous price read (null fields until the store answers). */
  readPrices(): Prices;

  /** Synchronous trial-info read (defaults eligible=true, days=null). */
  readTrial(): TrialInfo;

  /**
   * Platform-exact mount choreography: background refresh kicks plus the
   * delayed re-reads that give the native layer time to answer.
   */
  onMount(apply: ApplyCallbacks): void;

  /**
   * Platform-exact refresh choreography, used on visibilitychange and manual
   * refresh. Readings must flow through apply.applyStatus so backgrounding
   * the app can never flash the wall.
   */
  refresh(apply: ApplyCallbacks): void;

  /** Opens the platform purchase sheet. Outcome arrives via the event channel. */
  purchase(productId: string): void;

  /**
   * Platform restore flow. Platforms without a restore callback synthesize a
   * settle event; a restore that finds an active entitlement MUST emit
   * message 'restore_complete_active' so the engine can unlock optimistically.
   */
  restore(apply: ApplyCallbacks): void;

  /**
   * Register the platform's terminal-event channel (window.__billingEvent
   * global, Electron IPC push, Capacitor listener) plus any price-push
   * channels. Returns an unsubscribe function.
   */
  bindEvents(apply: ApplyCallbacks): () => void;

  /**
   * Optional: persist a determinate reading to the adapter's own status cache
   * (the Electron renderer keeps a localStorage mirror so the next cold launch
   * has a synchronous last-known-good state). Called by the engine's gate on
   * every applied reading — both unlocks and confirmed downgrades.
   */
  persistStatusCache?(reading: StatusReading): void;

  /** Debug-only (Android license-tester flow): consume the test purchase. */
  consumeTestPurchase?(): void;
}
