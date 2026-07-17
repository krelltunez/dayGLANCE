import StoreKit

/// Reports the App Store storefront country so the web layer can gate features that
/// are legally restricted on some storefronts — specifically suppressing generative-
/// AI on the China (CN) storefront per App Store Review Guideline 5 (Deep Synthesis /
/// MIIT).
///
/// Uses StoreKit's synchronous `SKPaymentQueue.storefront` (iOS 13+), which fits the
/// synchronous DayGlanceNative bridge. Unlike the macOS Electron build — which can
/// only read the OS region because a spawned helper isn't the App Store process —
/// this IS the App Store app, so the storefront resolves directly and reliably.
enum StorefrontBridge {

    /// The storefront country as an ISO 3166-1 alpha-3 code (e.g. "CHN"), or "" when
    /// StoreKit has not resolved a storefront yet.
    static func countryCode() -> String {
        SKPaymentQueue.default().storefront?.countryCode ?? ""
    }
}
