/**
 * Maps a billing error code to a user-facing string.
 * Returns a generic message for unknown codes.
 * Code 2 = SKErrorPaymentCancelled (macOS) / user cancelled — should not
 * surface as an error message (handled as 'cancelled' status upstream).
 */
export function billingErrorMessage(code: number): string {
  switch (code) {
    case 1:  return 'Product not found. Please try again later.';
    case 3:  return 'Billing is not available on this device.';
    case 4:  return "This subscription isn't available right now. Please try again later.";
    case 6:  return 'Network error. Please check your connection and try again.';
    case 7:  return 'You already own this item.';
    default: return 'Something went wrong with the purchase. Please try again.';
  }
}
