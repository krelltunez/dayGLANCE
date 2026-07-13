// Manage-subscription deep links for settings surfaces. Pure helpers — the
// app decides where and whether to show them.

/**
 * Google Play subscription-management deep link. With a productId it opens
 * that subscription's management screen directly; without, the account's
 * subscription list.
 */
export function playManageSubscriptionUrl(packageName: string, productId?: string): string {
  if (productId) {
    return `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(productId)}&package=${encodeURIComponent(packageName)}`;
  }
  return 'https://play.google.com/store/account/subscriptions';
}

/** Apple subscription-management page (App Store / Mac App Store accounts). */
export function appleManageSubscriptionUrl(): string {
  return 'https://apps.apple.com/account/subscriptions';
}
