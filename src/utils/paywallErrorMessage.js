/**
 * Chooses the paywall banner string for a terminal billing error event.
 *
 * Exists for one honest sentence: on Android, code -1 (Play Billing's
 * SERVICE_DISCONNECTED) means the billing connection is not up — most often
 * the `billing_not_ready` guard in launchPurchaseFlow firing during the
 * cold-start connection window or right after a transient service drop. The
 * package's generic fallback ("Something went wrong with the purchase...")
 * vaguely implicates a purchase that was never attempted and gives no sense
 * of whether retrying is worthwhile. It IS worthwhile: the native guard now
 * kicks a reconnect on this exact failure, so a retry lands on a connection
 * that is actually being established.
 *
 * Every other code passes through the shared mapper untouched — the five
 * specific strings (product not found, billing unavailable, subscription
 * unavailable, network error, already owned) and its own fallback are the
 * package's business, not ours.
 *
 * Android-only by design: -1 is a Play Billing response code. On iOS/macOS
 * the code space is StoreKit/RevenueCat's, where -1 has no such meaning.
 */
export const BILLING_NOT_READY_MESSAGE =
  'Still connecting to Google Play. Please try again in a moment.';

const PLAY_SERVICE_DISCONNECTED = -1;

export function paywallErrorMessage(event, { isAndroid = false, mapCode } = {}) {
  if (isAndroid && event?.code === PLAY_SERVICE_DISCONNECTED) {
    return BILLING_NOT_READY_MESSAGE;
  }
  return mapCode?.(event?.code) ?? 'Something went wrong. Please try again.';
}
