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
    private let productYearly = "com.dayglance.pro.yearly"
    private let productLifetime = "com.dayglance.pro.lifetime"

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

    /// Set once this install has ever observed an active entitlement. Used to tell
    /// "was entitled, now reads inactive" (worth a silent recovery attempt) apart
    /// from "never purchased" (show the paywall immediately, no wasted network).
    private let wasActiveKey = "rc_was_active"

    /// Guards the silent recovery to one attempt per app launch.
    private var autoSyncAttempted = false

    /// Returns `{"active":bool,"productId":string|null}` from RevenueCat's cached info.
    func getStatus() -> String {
        #if DEBUG
        return "{\"active\":true,\"productId\":null}"
        #endif
        let info = Purchases.shared.cachedCustomerInfo
        let active = info?.entitlements[entitlementId]?.isActive == true
        if active {
            UserDefaults.standard.set(true, forKey: wasActiveKey)
        } else if UserDefaults.standard.bool(forKey: wasActiveKey) {
            autoSyncRecover()
        }
        let productId = info?.entitlements[entitlementId]?.productIdentifier
        let productJson = productId.map { "\"\(esc($0))\"" } ?? "null"
        return "{\"active\":\(active),\"productId\":\(productJson)}"
    }

    /// Silent entitlement recovery for RevenueCat's "Transfer to new App User ID"
    /// behavior. The Mac app posts its receipt on every entitlement check, which
    /// TRANSFERS the shared Apple-account entitlement to the Mac's anonymous
    /// customer — leaving this install's cache inactive even though the user has
    /// paid. Instead of showing a paywall the user must manually Restore through,
    /// sync the local receipt (which transfers the entitlement back) and, if it
    /// comes back active, fire the same restore_complete_active event the JS
    /// layer already handles by dismissing the wall. A genuinely lapsed
    /// subscription stays inactive — syncPurchases posts the receipt, so its
    /// answer is authoritative. At most one attempt per launch.
    private func autoSyncRecover() {
        guard !autoSyncAttempted else { return }
        autoSyncAttempted = true
        Task {
            guard let info = try? await Purchases.shared.syncPurchases() else { return }
            let ent = info.entitlements[entitlementId]
            if ent?.isActive == true {
                UserDefaults.standard.set(true, forKey: wasActiveKey)
                fireBillingEvent(status: "cancelled", code: 0,
                                 message: "restore_complete_active",
                                 productId: ent?.productIdentifier ?? "")
            }
        }
    }

    /// Returns `{"com.dayglance.pro.yearly": bool}` from the cached eligibility check.
    /// Defaults to true when not yet determined — better to show trial copy and let Apple
    /// validate than to incorrectly hide it from eligible users.
    func getTrialEligibility() -> String {
        let eligible = UserDefaults.standard.object(forKey: "rc_trial_eligible_yearly") as? Bool ?? true
        return "{\"com.dayglance.pro.yearly\":\(eligible)}"
    }

    /// Returns `{"yearly":string|null,"lifetime":string|null,"yearlyTrialDays":number|null}`
    /// from cached StoreKit prices. yearlyTrialDays is the free-trial length from
    /// the store's introductory offer (null until known) — the web layer renders
    /// trial copy from it instead of a hardcoded number.
    func getProductPrices() -> String {
        let yearly   = UserDefaults.standard.string(forKey: "rc_price_yearly")
        let lifetime = UserDefaults.standard.string(forKey: "rc_price_lifetime")
        let y = yearly.map   { "\"\(esc($0))\"" } ?? "null"
        let l = lifetime.map { "\"\(esc($0))\"" } ?? "null"
        let days = UserDefaults.standard.integer(forKey: "rc_trial_days_yearly")
        let d = days > 0 ? String(days) : "null"
        return "{\"yearly\":\(y),\"lifetime\":\(l),\"yearlyTrialDays\":\(d)}"
    }

    // MARK: - Async bridge calls (return null immediately, fire __billingEvent when done)

    func purchase(productId: String) {
        Task {
            do {
                let result: PurchaseResultData
                // Prefer the configured Offering package (preserves intro-offer
                // metadata for the annual free trial), but fall back to the bare
                // StoreKit product so a product that exists in App Store Connect but
                // isn't attached to the current RevenueCat Offering — the usual case
                // for the lifetime non-consumable — still purchases instead of
                // dead-ending on "Product not found" (which surfaced as an endless
                // spinner on the paywall: no StoreKit sheet, no login prompt).
                if let offerings = try? await Purchases.shared.offerings(),
                   let package = offerings.current?.availablePackages.first(where: {
                       $0.storeProduct.productIdentifier == productId
                   }) {
                    result = try await Purchases.shared.purchase(package: package)
                } else {
                    let products = await Purchases.shared.products([productId])
                    guard let product = products.first else {
                        fireBillingEvent(status: "error", code: 1, message: "Product not found", productId: productId)
                        return
                    }
                    result = try await Purchases.shared.purchase(product: product)
                }
                if result.userCancelled {
                    fireBillingEvent(status: "cancelled", code: -1, message: "User cancelled", productId: productId)
                } else {
                    fireBillingEvent(status: "success", code: 0, message: "ok", productId: productId)
                }
            } catch {
                fireBillingError(error, productId: productId)
            }
        }
    }

    /// Delivers a thrown purchase/restore error to JS in the shared billing-event
    /// code space (Play Billing response codes) that @glance-apps/billing's
    /// billingErrorMessage understands. RevenueCat's raw ErrorCode values collide
    /// with that vocabulary — e.g. productAlreadyPurchased is raw value 6, which
    /// the paywall would render as "Network error" — so translate instead of
    /// passing rawValue through.
    private func fireBillingError(_ error: Error, productId: String) {
        guard let rcError = error as? RevenueCat.ErrorCode else {
            fireBillingEvent(status: "error", code: 0, message: error.localizedDescription, productId: productId)
            return
        }
        // A dismissed StoreKit sheet can surface as a thrown purchaseCancelledError
        // rather than result.userCancelled — not an error the user should see.
        if rcError == .purchaseCancelledError {
            fireBillingEvent(status: "cancelled", code: -1, message: "User cancelled", productId: productId)
            return
        }
        let code: Int
        switch rcError {
        case .purchaseNotAllowedError:
            code = 3 // "Billing is not available on this device."
        case .storeProblemError, .productNotAvailableForPurchaseError:
            code = 4 // "This subscription isn't available right now. Please try again later."
        case .networkError, .offlineConnectionError, .productRequestTimedOut:
            code = 6 // "Network error. Please check your connection and try again."
        case .productAlreadyPurchasedError, .receiptAlreadyInUseError:
            code = 7 // "You already own this item."
        default:
            code = 0 // "Something went wrong with the purchase. Please try again."
        }
        fireBillingEvent(status: "error", code: code, message: error.localizedDescription, productId: productId)
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
                fireBillingError(error, productId: "")
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
            // Fetch prices by explicit product ID rather than only from the current
            // Offering, so the lifetime price still populates even when the lifetime
            // non-consumable isn't attached to the Offering in RevenueCat (otherwise
            // the Lifetime card shows "Loading…" forever).
            let products = await Purchases.shared.products([productYearly, productLifetime])
            for product in products {
                let price = product.localizedPriceString
                if product.productIdentifier == productYearly {
                    UserDefaults.standard.set(price, forKey: "rc_price_yearly")
                    // Trial LENGTH comes from the store's introductory offer so the
                    // paywall never hardcodes a number. Only a freeTrial payment mode
                    // counts — payUpFront/payAsYouGo intro discounts are paid offers.
                    if let intro = product.introductoryDiscount, intro.paymentMode == .freeTrial {
                        let days = Self.days(from: intro.subscriptionPeriod)
                        if days > 0 {
                            UserDefaults.standard.set(days, forKey: "rc_trial_days_yearly")
                        }
                    }
                } else if product.productIdentifier == productLifetime {
                    UserDefaults.standard.set(price, forKey: "rc_price_lifetime")
                }
            }
        }
    }

    /// Converts a StoreKit subscription period to whole days (weeks ×7, months
    /// ×30, years ×365 — trials are day/week periods in practice).
    private static func days(from period: RevenueCat.SubscriptionPeriod) -> Int {
        switch period.unit {
        case .day:   return period.value
        case .week:  return period.value * 7
        case .month: return period.value * 30
        case .year:  return period.value * 365
        @unknown default: return 0
        }
    }

    private func checkTrialEligibilityInBackground() {
        Purchases.shared.checkTrialOrIntroDiscountEligibility(productIdentifiers: ["com.dayglance.pro.yearly"]) { results in
            guard let status = results["com.dayglance.pro.yearly"]?.status else { return }
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
