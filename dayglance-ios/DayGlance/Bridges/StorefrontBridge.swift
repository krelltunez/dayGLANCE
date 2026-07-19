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

    /// The storefront country (ISO alpha-3, e.g. "CHN"), or — if StoreKit hasn't
    /// resolved a storefront yet (it can be nil momentarily at cold launch) — the
    /// device region as a fallback (ISO alpha-2, e.g. "CN"). "" only if neither is
    /// available. The web layer checks both "CN" and "CHN", so either form gates
    /// correctly. This mirrors the macOS build's StoreKit-then-region approach and
    /// ensures a timing gap can never silently leave AI active on the CN storefront.
    static func countryCode() -> String {
        if let code = SKPaymentQueue.default().storefront?.countryCode, !code.isEmpty {
            return code
        }
        return Locale.current.region?.identifier ?? ""
    }
}
