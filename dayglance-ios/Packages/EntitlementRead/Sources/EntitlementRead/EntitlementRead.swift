/// Which copy of RevenueCat's customer info a billing status read uses.
///
/// A read has two candidates: RevenueCat's cache (`cachedCustomerInfo`) and
/// the last customer info RevenueCat reported to the app's delegate
/// (`purchases(_:receivedUpdated:)`). RevenueCat orders them itself. In
/// purchases-ios 5.90.1 the only path to the delegate is
/// `CustomerInfoManager.cache(customerInfo:)`, which:
///
/// - for server-verified info, WRITES the cache, then reports;
/// - for info verified on the device (entitlements computed from StoreKit
///   while RevenueCat's servers are unreachable), never caches it: it CLEARS
///   the cache, then reports.
///
/// So a cache that holds something is at least as new as every report (a
/// later report would have overwritten or cleared it), and an empty cache
/// means the last report, if any, is the newest. The rule reads in that order
/// of arrival.
///
/// It does not compare `requestDate`s. Server info carries the server's clock
/// and on-device info the phone's (`Date()`), so with the phone's clock
/// running ahead a retained on-device copy would outrank a later server
/// reading: on-device entitlements are computed generously, and that would
/// keep someone unlocked past a genuine lapse.
///
/// The cache can also be empty for reasons other than on-device info: an
/// explicit `invalidateCustomerInfoCache()`, an identity change (log in or out,
/// which these apps never do), or a cache an SDK upgrade can no longer decode.
/// The rule then returns the retained report, which may be stale. That is no
/// worse than before (an empty read locked a paying customer out), and it
/// corrects itself: RevenueCat refetches into an empty cache, and the next
/// server reading is written and reported, and read; an inactive one locks
/// through the app's 12 s downgrade hold. Time alone does not empty the cache:
/// staleness only makes RevenueCat refetch.
public enum EntitlementRead {

    /// The newer of the two, by RevenueCat's order of arrival: the cache when
    /// it holds something, otherwise the last report.
    public static func newest<Info>(cached: Info?, reported: Info?) -> Info? {
        cached ?? reported
    }
}
