import Foundation
import RevenueCat
import WebKit

/// Manages in-app subscription status via RevenueCat (StoreKit 2 backend).
///
/// Synchronous bridge calls return cached values so the JS thread never blocks.
/// Purchase and restore outcomes are delivered asynchronously via
/// `window.__billingEvent(JSON)` — the same callback pattern Android uses.
final class SubscriptionBridge {

    static let shared = SubscriptionBridge()

    /// Set by WebView.swift after the WKWebView is created so we can fire JS callbacks.
    weak var webView: WKWebView?

    private let entitlementId = "pro"

    // MARK: - RevenueCat configuration

    func configure(apiKey: String) {
        // Debug builds (Xcode Debug scheme) are always treated as Pro — no paywall
        // during local development. Absent from Release/Archive builds by design:
        // SWIFT_ACTIVE_COMPILATION_CONDITIONS does not include DEBUG in Release config.
        #if DEBUG
        return
        #endif
        Purchases.logLevel = .warn
        Purchases.configure(withAPIKey: apiKey)
        refreshStatusInBackground()
        fetchPricesInBackground()
        checkTrialEligibilityInBackground()
    }

    // MARK: - Synchronous bridge calls

    /// Returns `{"active":bool,"productId":string|null}` from RevenueCat's cached info.
    func getStatus() -> String {
        #if DEBUG
        return "{\"active\":true,\"productId\":null}"
        #endif
        let info = Purchases.shared.cachedCustomerInfo
        let active = info?.entitlements[entitlementId]?.isActive == true
        let productId = info?.entitlements[entitlementId]?.productIdentifier
        let productJson = productId.map { "\"\(esc($0))\"" } ?? "null"
        return "{\"active\":\(active),\"productId\":\(productJson)}"
    }

    /// Returns `{"com.dayglance.app.pro.yearly": bool}` from the cached eligibility check.
    /// Defaults to true when not yet determined — better to show trial copy and let Apple
    /// validate than to incorrectly hide it from eligible users.
    func getTrialEligibility() -> String {
        let eligible = UserDefaults.standard.object(forKey: "rc_trial_eligible_yearly") as? Bool ?? true
        return "{\"com.dayglance.app.pro.yearly\":\(eligible)}"
    }

    /// Returns `{"yearly":string|null,"lifetime":string|null}` from cached StoreKit prices.
    func getProductPrices() -> String {
        let yearly   = UserDefaults.standard.string(forKey: "rc_price_yearly")
        let lifetime = UserDefaults.standard.string(forKey: "rc_price_lifetime")
        let y = yearly.map   { "\"\(esc($0))\"" } ?? "null"
        let l = lifetime.map { "\"\(esc($0))\"" } ?? "null"
        return "{\"yearly\":\(y),\"lifetime\":\(l)}"
    }

    // MARK: - Async bridge calls (return null immediately, fire __billingEvent when done)

    func purchase(productId: String) {
        Task {
            do {
                let offerings = try await Purchases.shared.offerings()
                guard let package = offerings.current?.availablePackages.first(where: {
                    $0.storeProduct.productIdentifier == productId
                }) else {
                    fireBillingEvent(status: "error", code: 1, message: "Product not found", productId: productId)
                    return
                }
                let result = try await Purchases.shared.purchase(package: package)
                if result.userCancelled {
                    fireBillingEvent(status: "cancelled", code: -1, message: "User cancelled", productId: productId)
                } else {
                    fireBillingEvent(status: "success", code: 0, message: "ok", productId: productId)
                }
            } catch {
                let rcError = error as? RevenueCat.ErrorCode
                let code = rcError?.rawValue ?? 0
                fireBillingEvent(status: "error", code: code, message: error.localizedDescription, productId: productId)
            }
        }
    }

    func restorePurchases() {
        Task {
            do {
                let info = try await Purchases.shared.restorePurchases()
                let active = info.entitlements[entitlementId]?.isActive == true
                let productId = info.entitlements[entitlementId]?.productIdentifier ?? ""
                // Mirror Android's restore_complete pattern: status=cancelled so the
                // JS hook can close the spinner without treating it as a new purchase.
                fireBillingEvent(status: "cancelled", code: 0,
                                 message: active ? "restore_complete_active" : "restore_complete",
                                 productId: productId)
            } catch {
                fireBillingEvent(status: "error", code: 0, message: error.localizedDescription, productId: "")
            }
        }
    }

    // MARK: - Background refresh

    private func refreshStatusInBackground() {
        Task {
            _ = try? await Purchases.shared.customerInfo()
        }
    }

    private func fetchPricesInBackground() {
        Task {
            guard let offerings = try? await Purchases.shared.offerings(),
                  let packages = offerings.current?.availablePackages else { return }
            for pkg in packages {
                let id    = pkg.storeProduct.productIdentifier
                let price = pkg.storeProduct.localizedPriceString
                if id.contains("yearly") || id.contains("annual") {
                    UserDefaults.standard.set(price, forKey: "rc_price_yearly")
                } else if id.contains("lifetime") {
                    UserDefaults.standard.set(price, forKey: "rc_price_lifetime")
                }
            }
        }
    }

    private func checkTrialEligibilityInBackground() {
        Purchases.shared.checkTrialOrIntroDiscountEligibility(["com.dayglance.app.pro.yearly"]) { results in
            guard let status = results["com.dayglance.app.pro.yearly"]?.status else { return }
            switch status {
            case .eligible:
                UserDefaults.standard.set(true, forKey: "rc_trial_eligible_yearly")
            case .ineligible:
                UserDefaults.standard.set(false, forKey: "rc_trial_eligible_yearly")
            default:
                break // unknown — don't write, keep the default-true fallback in getTrialEligibility()
            }
        }
    }

    // MARK: - JS callback

    private func fireBillingEvent(status: String, code: Int, message: String, productId: String) {
        let json = "{\"status\":\"\(status)\",\"code\":\(code),\"message\":\"\(esc(message))\",\"productId\":\"\(esc(productId))\"}"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "if(typeof window.__billingEvent==='function'){window.__billingEvent(\(json));}",
                completionHandler: nil
            )
        }
    }

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
