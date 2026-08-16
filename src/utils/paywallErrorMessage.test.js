import { describe, it, expect } from 'vitest';
import { billingErrorMessage } from '@glance-apps/billing';
import {
  paywallErrorMessage,
  BILLING_NOT_READY_MESSAGE,
} from './paywallErrorMessage.js';

// The wall calls this with { isAndroid, mapCode: billingErrorMessage } — the
// tests use the real shared mapper so the pass-through assertions guard the
// actual strings users see, not a stub's.
const onAndroid = { isAndroid: true, mapCode: billingErrorMessage };
const onApple = { isAndroid: false, mapCode: billingErrorMessage };

describe('paywallErrorMessage', () => {
  it('maps Android code -1 (SERVICE_DISCONNECTED / billing_not_ready) to the honest connecting message', () => {
    const ev = { status: 'error', code: -1, message: 'billing_not_ready', productId: 'dayglance_pro_annual' };
    expect(paywallErrorMessage(ev, onAndroid)).toBe(BILLING_NOT_READY_MESSAGE);
  });

  it('also covers a mid-purchase SERVICE_DISCONNECTED, which carries a Play debugMessage instead', () => {
    // The purchasesUpdatedListener error branch forwards Play's own -1 with
    // whatever debugMessage Play attached; the condition is the same (the
    // connection to Play is not up) so the message is the same.
    const ev = { status: 'error', code: -1, message: 'Service connection is disconnected.', productId: '' };
    expect(paywallErrorMessage(ev, onAndroid)).toBe(BILLING_NOT_READY_MESSAGE);
  });

  it('leaves the five specifically-mapped codes untouched (regression guard)', () => {
    // These are the shared mapper's strings verbatim — if the package
    // rewords them, this test should fail so the pass-through is re-checked.
    for (const [code, expected] of [
      [1, 'Product not found. Please try again later.'],
      [3, 'Billing is not available on this device.'],
      [4, "This subscription isn't available right now. Please try again later."],
      [6, 'Network error. Please check your connection and try again.'],
      [7, 'You already own this item.'],
    ]) {
      expect(paywallErrorMessage({ status: 'error', code }, onAndroid)).toBe(expected);
    }
  });

  it('leaves unknown codes on the shared mapper fallback, not the not-ready message', () => {
    expect(paywallErrorMessage({ status: 'error', code: 5 }, onAndroid)).toBe(
      'Something went wrong with the purchase. Please try again.',
    );
  });

  it('does not apply the Android meaning of -1 on Apple platforms', () => {
    // -1 is a Play Billing response code; on iOS/macOS the code space is
    // StoreKit/RevenueCat's, so -1 must fall through to the shared mapper.
    const ev = { status: 'error', code: -1, message: '' };
    expect(paywallErrorMessage(ev, onApple)).toBe(
      'Something went wrong with the purchase. Please try again.',
    );
  });

  it('degrades to a generic message when no mapper is supplied', () => {
    expect(paywallErrorMessage({ status: 'error', code: 6 }, { isAndroid: false })).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
