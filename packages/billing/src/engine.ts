import type {
  BillingEvent,
  EntitlementSource,
  LastActiveHint,
  Prices,
  ProductIds,
  StatusReading,
  StorageLike,
  TrialInfo,
} from './types.js';
import type { ApplyCallbacks, BillingAdapter } from './adapters/types.js';
import {
  DEFAULT_STORAGE_KEYS,
  DEFAULT_TIMINGS,
  type EngineTimings,
  type StorageKeys,
} from './config.js';
import { SafeStorage } from './storage.js';
import { deriveReviewerCode, sha256Hex } from './reviewer.js';

export interface EngineConfig {
  /** Platform adapter, or null when the install is not gated (web/PWA/dev). */
  adapter: BillingAdapter | null;
  /** Defaults to localStorage (safe-wrapped). Inject for tests/headless. */
  storage?: StorageLike | null;
  /** Apps migrating an existing integration MUST pass their legacy keys. */
  storageKeys?: Partial<StorageKeys>;
  timings?: Partial<EngineTimings>;
  /**
   * App-specific reviewer-bypass secret. Omit to disable the reviewer unlock
   * entirely (an app hard-gated in a store build should NOT omit it — store
   * review needs a way in; see reviewer.ts).
   */
  reviewerSecret?: string | null;
  /**
   * OFFLINE-EXPIRY GRACE — the `graceDays` concept from
   * paywall-billing-plan.md. A different mechanism from the anti-flash
   * downgrade grace (timings.downgradeGraceMs), and disabled by default.
   *
   * Plan intent: "A paying user is never locked out offline — the grace
   * window absorbs airplane mode, dead zones, and Play outages." When set,
   * an install whose last DETERMINATE-ACTIVE reading is older than this many
   * days stops fail-open behavior: an expired last-active hint no longer
   * grants the provisional cold-launch unlock, and an indeterminate reading
   * on an unlocked install is escalated into the normal downgrade path
   * instead of being ignored. Within the window, behavior is unchanged:
   * indeterminate never re-locks.
   *
   * Two deliberate deltas from the plan's literal rule
   * (`unlocked = … || subExpiresAt + graceDays > now || …`):
   *
   * 1. ANCHOR: days since the last verified-active reading (lastVerifiedAt —
   *    which the plan's own EntitlementState also records), not days past
   *    subscription expiry. Play Billing does not expose a subscription's
   *    expiry client-side (an expired sub simply stops appearing in
   *    queryPurchases), so an expiry-anchored rule is not implementable on
   *    the plan's own primary platform without a backend. The
   *    last-verified anchor covers every backend uniformly.
   * 2. SCOPE: grace applies only while the truth is UNKNOWN (indeterminate
   *    readings / no reading). A DETERMINATE lapsed subscription still
   *    re-locks after the anti-flash hold, exactly as the proven integration
   *    behaves — the plan's literal rule would keep a knowingly-expired
   *    subscription unlocked for graceDays even online, which contradicts
   *    the authoritative shipped behavior this package preserves.
   */
  offlineGraceDays?: number;
  /**
   * Optional product-id hints, used ONLY to classify `entitlementSource`
   * ('lifetime' vs 'subscription') in the snapshot. Without them, any active
   * entitlement classifies as 'subscription'. No purchase/refresh behavior
   * depends on these.
   */
  products?: Partial<ProductIds>;
  /** Clock injection for tests. */
  now?: () => number;
}

export interface EngineState {
  status: StatusReading;
  prices: Prices;
  trial: TrialInfo;
  isLoading: boolean;
  billingEvent: BillingEvent | null;
  reviewerUnlocked: boolean;
}

export interface EngineSnapshot extends EngineState {
  /** True when this install is subject to the paywall at all. */
  gated: boolean;
  /** Entitlement only — does not include the reviewer bypass. */
  isPro: boolean;
  /** The gate the app UI should use: ungated, entitled, or reviewer-unlocked. */
  isUnlocked: boolean;
  /** Why the install is (or isn't) unlocked — see EntitlementSource. */
  entitlementSource: EntitlementSource;
  productId: string | null;
  canConsumeTestPurchase: boolean;
}

type Listener = () => void;

const INACTIVE: StatusReading = { active: false, productId: null };

/**
 * Framework-agnostic entitlement engine.
 *
 * Ported from a production three-platform integration; the semantics below
 * are load-bearing and were each added in response to a real field failure:
 *
 * - applyStatus is the single gate for every entitlement reading. Asymmetric
 *   on purpose: active applies INSTANTLY and cancels any pending downgrade;
 *   a determinate inactive on a currently-unlocked install is HELD for the
 *   grace window so native self-heal (receipt re-post, syncPurchases,
 *   purchase/restore events) can win without the wall ever mounting; and
 *   indeterminate readings are ignored outright.
 * - A persisted "this install has been entitled" hint starts a
 *   previously-entitled install provisionally unlocked at first paint even
 *   when the native cache is stale; the same grace window confirms or clears
 *   it. Fresh installs have no hint — the wall shows immediately.
 * - 'success' purchase events and 'restore_complete_active' restores are only
 *   emitted after the platform validates the entitlement, so they unlock
 *   immediately rather than waiting on a possibly-stale cache read (that lag
 *   previously left the paywall up after a completed purchase).
 * - reconcile() re-reads on short delays purely to fill in the accurate
 *   productId, and applies ONLY active results — a lagging store cache right
 *   after someone paid must not even start a downgrade countdown.
 */
export class BillingEngine {
  private readonly adapter: BillingAdapter | null;
  private readonly storage: SafeStorage;
  private readonly keys: StorageKeys;
  private readonly timings: EngineTimings;
  private readonly reviewerSecret: string | null;
  private readonly offlineGraceDays: number | undefined;
  private readonly products: Partial<ProductIds> | undefined;
  private readonly now: () => number;

  private state: EngineState;
  private snapshot: EngineSnapshot;
  private readonly listeners = new Set<Listener>();

  private downgradeTimer: ReturnType<typeof setTimeout> | null = null;
  private provisionalTimer: ReturnType<typeof setTimeout> | null = null;
  private purchaseTimer: ReturnType<typeof setTimeout> | null = null;
  private unbindEvents: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private stopped = true;
  private started = false;

  private readonly applyCallbacks: ApplyCallbacks;

  constructor(config: EngineConfig) {
    this.adapter = config.adapter;
    this.storage = new SafeStorage(config.storage ?? undefined);
    this.keys = { ...DEFAULT_STORAGE_KEYS, ...config.storageKeys };
    this.timings = { ...DEFAULT_TIMINGS, ...config.timings };
    this.reviewerSecret = config.reviewerSecret ?? null;
    this.offlineGraceDays = config.offlineGraceDays;
    this.products = config.products;
    this.now = config.now ?? Date.now;

    this.state = {
      status: this.initialStatus(),
      prices: this.adapter ? this.adapter.readPrices() : { yearly: null, lifetime: null },
      trial: this.adapter ? this.adapter.readTrial() : { eligible: true, days: null },
      isLoading: false,
      billingEvent: null,
      reviewerUnlocked: false,
    };
    this.snapshot = this.buildSnapshot();

    this.applyCallbacks = {
      applyStatus: (r) => this.applyStatus(r),
      setPrices: (p) => this.setState({ prices: p }),
      setTrial: (t) => this.setState({ trial: { ...this.state.trial, ...t } }),
      setLoading: (l) => this.setState({ isLoading: l }),
      emitBillingEvent: (ev) => this.handleBillingEvent(ev),
    };
  }

  // ── Initial state ──────────────────────────────────────────────────────────

  private initialStatus(): StatusReading {
    const s = this.adapter ? this.adapter.readCachedStatus() : INACTIVE;
    if (s.active) return s;
    // Native cache says inactive, but this install has been entitled before —
    // start provisionally unlocked; the grace confirmation below settles it.
    const hint = this.readLastActiveHint();
    if (hint && this.hintGrantsProvisionalUnlock(hint)) {
      return { active: true, productId: hint.productId ?? null, provisional: true };
    }
    return s;
  }

  private readLastActiveHint(): LastActiveHint | null {
    try {
      return JSON.parse(this.storage.getItem(this.keys.lastActive) || 'null');
    } catch {
      return null;
    }
  }

  private hintGrantsProvisionalUnlock(hint: LastActiveHint): boolean {
    if (this.offlineGraceDays === undefined) return true;
    // Hints written before verifiedAt existed count as fresh — an installed,
    // previously-entitled user must not lose their unlock across a migration.
    if (typeof hint.verifiedAt !== 'number') return true;
    return this.now() - hint.verifiedAt <= this.offlineGraceDays * 86_400_000;
  }

  // ── The gate ───────────────────────────────────────────────────────────────

  /**
   * The single gate through which every entitlement reading is applied.
   * See the class doc for why it is asymmetric. Do not add call sites that
   * bypass it.
   */
  applyStatus(next: StatusReading | null | undefined): void {
    if (this.stopped) return;
    if (!next || next.indeterminate) {
      this.onIndeterminate();
      return;
    }
    if (next.active) {
      if (this.downgradeTimer) {
        clearTimeout(this.downgradeTimer);
        this.downgradeTimer = null;
      }
      this.setState({ status: next });
      const hint: LastActiveHint = { productId: next.productId ?? null, verifiedAt: this.now() };
      this.storage.setItem(this.keys.lastActive, JSON.stringify(hint));
      this.adapter?.persistStatusCache?.(next);
      return;
    }
    if (!this.state.status.active) {
      // Already locked — apply freely.
      this.setState({ status: next });
      return;
    }
    if (this.downgradeTimer) return; // a downgrade is already pending confirmation
    this.downgradeTimer = setTimeout(() => {
      this.downgradeTimer = null;
      this.setState({ status: next });
      this.storage.removeItem(this.keys.lastActive);
      this.adapter?.persistStatusCache?.(next);
    }, this.timings.downgradeGraceMs);
  }

  /**
   * Indeterminate readings are ignored — with one config-gated exception:
   * when offlineGraceDays is set and the last verified-active timestamp has
   * expired, an indeterminate reading on an unlocked install escalates into
   * the normal downgrade path (still subject to the anti-flash hold, still
   * cancelled by any active reading that lands first).
   */
  private onIndeterminate(): void {
    if (this.offlineGraceDays === undefined) return;
    if (!this.state.status.active) return;
    const hint = this.readLastActiveHint();
    if (hint && this.hintGrantsProvisionalUnlock(hint)) return;
    if (this.downgradeTimer) return;
    this.downgradeTimer = setTimeout(() => {
      this.downgradeTimer = null;
      this.setState({ status: INACTIVE });
      this.storage.removeItem(this.keys.lastActive);
      this.adapter?.persistStatusCache?.(INACTIVE);
    }, this.timings.downgradeGraceMs);
  }

  // ── Reconcile ──────────────────────────────────────────────────────────────

  /**
   * Re-read entitlement from the authoritative platform source after a
   * CONFIRMED purchase or restore, purely to fill in the accurate productId.
   * Applies ONLY active results — never re-locks, never starts a countdown.
   */
  private reconcile(): void {
    const adapter = this.adapter;
    if (!adapter) return;
    const applyIfActive = (s: StatusReading | null | undefined) => {
      if (s && s.active) this.applyStatus(s);
    };
    for (const delay of this.timings.reconcileDelaysMs) {
      setTimeout(() => {
        adapter.checkStatus().then(applyIfActive).catch(() => {});
      }, delay);
    }
  }

  // ── Billing events ─────────────────────────────────────────────────────────

  private handleBillingEvent(ev: BillingEvent | string): void {
    if (this.stopped) return;
    try {
      const parsed: BillingEvent = typeof ev === 'string' ? JSON.parse(ev) : ev;
      // A 'success' purchase event and an active restore
      // ('restore_complete_active') are both only emitted AFTER the platform
      // validates the entitlement, so unlock immediately rather than waiting
      // on a possibly-stale cache read.
      const purchased = parsed.status === 'success';
      const restoredActive = parsed.message === 'restore_complete_active';
      // A successful test-consume is a validated, deliberate revocation — as
      // authoritative in the lock direction as a purchase is in the unlock
      // direction. Apply it immediately, bypassing the anti-flash hold (whose
      // whole purpose is protecting users from TRANSIENT inactive readings):
      // the tester tapped "reset" precisely to see the wall now, not in 12s.
      if (parsed.status === 'consumed') {
        if (this.downgradeTimer) {
          clearTimeout(this.downgradeTimer);
          this.downgradeTimer = null;
        }
        this.setState({ status: INACTIVE });
        this.storage.removeItem(this.keys.lastActive);
        this.adapter?.persistStatusCache?.(INACTIVE);
      }
      if (purchased || restoredActive) {
        // Optimistic unlock through the gate: applies instantly, cancels any
        // pending downgrade, and persists the unlock (last-active hint + the
        // adapter's status cache) so it survives relaunch.
        this.applyStatus({
          active: true,
          productId: parsed.productId || this.state.status.productId || null,
        });
        if (this.adapter?.cachedReads) {
          this.setState({ prices: this.adapter.readPrices() });
        }
        this.reconcile(); // fill accurate productId; never re-locks
      }
      this.setState({ billingEvent: { ...parsed, ts: this.now() } });
      if (this.purchaseTimer) {
        clearTimeout(this.purchaseTimer);
        this.purchaseTimer = null;
      }
    } catch {
      /* malformed event payload — ignore, matching the proven integration */
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;

    const adapter = this.adapter;
    if (!adapter) {
      void this.restoreReviewerUnlock();
      return;
    }

    this.unbindEvents = adapter.bindEvents(this.applyCallbacks);
    adapter.onMount(this.applyCallbacks);

    // Confirm or clear a provisional cold-launch unlock: re-read the platform
    // cache after the grace window; applyStatus locks it only if still
    // inactive then.
    if (this.state.status.provisional) {
      this.provisionalTimer = setTimeout(() => {
        this.provisionalTimer = null;
        this.applyStatus(adapter.readCachedStatus());
      }, this.timings.downgradeGraceMs);
    }

    // Re-read when the app regains visibility. Routed through applyStatus, so
    // backgrounding the app can never flash the wall.
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'visible') this.refresh();
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    void this.restoreReviewerUnlock();
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    if (this.downgradeTimer) { clearTimeout(this.downgradeTimer); this.downgradeTimer = null; }
    if (this.provisionalTimer) { clearTimeout(this.provisionalTimer); this.provisionalTimer = null; }
    if (this.purchaseTimer) { clearTimeout(this.purchaseTimer); this.purchaseTimer = null; }
    if (this.unbindEvents) { this.unbindEvents(); this.unbindEvents = null; }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  // ── Public actions ─────────────────────────────────────────────────────────

  refresh(): void {
    this.adapter?.refresh(this.applyCallbacks);
  }

  purchase(productId: string): void {
    const adapter = this.adapter;
    if (!adapter) return;
    this.setState({ billingEvent: null });
    adapter.purchase(productId);
    // Safety timeout — clears the spinner if the bridge never fires.
    if (this.purchaseTimer) clearTimeout(this.purchaseTimer);
    this.purchaseTimer = setTimeout(() => {
      this.purchaseTimer = null;
      if (this.state.billingEvent === null) {
        this.setState({
          billingEvent: {
            status: 'cancelled', code: -1, message: 'timeout', productId, ts: this.now(),
          },
        });
      }
    }, this.timings.purchaseTimeoutMs);
  }

  restore(): void {
    const adapter = this.adapter;
    if (!adapter) return;
    this.setState({ billingEvent: null });
    adapter.restore(this.applyCallbacks);
  }

  consumeTestPurchase(): void {
    if (!this.adapter?.consumeTestPurchase) return;
    this.setState({ billingEvent: null });
    this.adapter.consumeTestPurchase();
  }

  clearBillingEvent(): void {
    this.setState({ billingEvent: null });
  }

  // ── Reviewer bypass ────────────────────────────────────────────────────────

  private async restoreReviewerUnlock(): Promise<void> {
    if (!this.reviewerSecret) return;
    const stored = this.storage.getItem(this.keys.reviewerUnlock);
    if (!stored) return;
    try {
      const code = await deriveReviewerCode(this.reviewerSecret);
      const hash = await sha256Hex(code);
      if (stored === hash && !this.stopped) {
        this.setState({ reviewerUnlocked: true });
      }
    } catch {
      /* WebCrypto unavailable or storage failure — leave locked */
    }
  }

  /** Validates input against this month's code; stores its hash on success. */
  async setReviewerUnlocked(input: string): Promise<boolean> {
    if (!this.reviewerSecret) return false;
    try {
      const expected = await deriveReviewerCode(this.reviewerSecret);
      if (input !== expected) return false;
      const hash = await sha256Hex(input);
      this.storage.setItem(this.keys.reviewerUnlock, hash);
      this.setState({ reviewerUnlocked: true });
      return true;
    } catch {
      return false;
    }
  }

  // ── Store interface (useSyncExternalStore-compatible) ─────────────────────

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  private setState(patch: Partial<EngineState>): void {
    // Once stopped, late adapter timers (mount/refresh settle delays are
    // intentionally not tracked, matching the proven integration) must not
    // write state or notify unmounted listeners.
    if (this.stopped) return;
    this.state = { ...this.state, ...patch };
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  private buildSnapshot(): EngineSnapshot {
    const gated = this.adapter !== null;
    const isPro = this.state.status.active;
    const productId = this.state.status.productId;
    const entitlementSource: EntitlementSource =
      !gated ? 'channel'
      : isPro ? (this.products?.lifetime && productId === this.products.lifetime ? 'lifetime' : 'subscription')
      : this.state.reviewerUnlocked ? 'reviewer'
      : 'none';
    return {
      ...this.state,
      gated,
      isPro,
      isUnlocked: !gated || isPro || this.state.reviewerUnlocked,
      entitlementSource,
      productId,
      canConsumeTestPurchase: typeof this.adapter?.consumeTestPurchase === 'function',
    };
  }
}
