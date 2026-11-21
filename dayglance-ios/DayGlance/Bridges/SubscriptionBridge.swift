import Foundation
import RevenueCat
import WebKit
import EntitlementRead

/// Manages in-app subscription status via RevenueCat (StoreKit 2 backend).
///
/// Synchronous bridge calls return cached values so the JS thread never blocks.
/// Purchase and restore outcomes are delivered asynchronously via
/// `window.__billingEvent(JSON)` — the same callback pattern Android uses.
///
/// Entitlements RevenueCat reports on its own (its PurchasesDelegate: a
/// purchase whose post was retried, an Ask to Buy approved later, an
/// entitlement synced back from another device) are pushed via
/// `window.__billingStatus(JSON)`, ACTIVE ONLY: a push can rescue an
/// entitlement and never revoke one (@glance-apps/billing 0.2.4's status
/// channel, which also drops anything inactive). An NSObject because
/// PurchasesDelegate is an Objective-C protocol.
final class SubscriptionBridge: NSObject, PurchasesDelegate {

    static let shared = SubscriptionBridge()

    /// Set by WebView.swift after the WKWebView is created so we can fire JS callbacks.
    weak var webView: WKWebView?

    private let entitlementId = "pro"
    private let productYearly = "com.dayglance.pro.yearly"
    private let productLifetime = "com.dayglance.pro.lifetime"

    /// The 'pending' outcome's codes, BILLING_CODE_PENDING and
    /// BILLING_CODE_UNCONFIRMED in @glance-apps/billing (src/iosBilling.test.js
    /// holds them equal). Pending: deferred, nothing charged yet (Ask to Buy,
    /// extra authentication). Unconfirmed: the store completed the purchase but
    /// the entitlement RevenueCat returned does not include ours.
    static let codePending = 100
    static let codeUnconfirmed = 101

    /// The last customer info RevenueCat reported to the delegate, whatever it
    /// said. Read by currentCustomerInfo(); see there for why.
    private var lastReported: CustomerInfo?
    private let reportLock = NSLock()

    private override init() { super.init() }

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
        // RevenueCat sends the cached customer info to a delegate as soon as it
        // is set. That push finds no web view yet and is dropped; the page's
        // first status read covers it (it is the cache).
        Purchases.shared.delegate = self
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
        let info = currentCustomerInfo()
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

    /// RevenueCat's most recent customer info: its cache, or, when the cache is
    /// empty, what it last reported to the delegate. The rule and why it is
    /// arrival order rather than a requestDate comparison are in the
    /// EntitlementRead package (Packages/EntitlementRead), which tests it.
    ///
    /// The cache alone is not enough. RevenueCat writes it BEFORE it tells the
    /// delegate, so for server-verified info a read after a push always sees
    /// what the push carried. But customer info verified ON DEVICE (RevenueCat
    /// computing entitlements from StoreKit while its servers are unreachable)
    /// is never cached, and the existing cache is cleared
    /// (CustomerInfoManager.cache(customerInfo:) in purchases-ios 5.90.1). A
    /// push of that info dropped for want of a receiver (no web view yet, a
    /// reload, the page not yet bound) would then be covered by no read at all.
    /// With the delegate's copy included, every status read sees everything
    /// the delegate has seen, so a dropped push is always recovered by the next
    /// read: the page's first read on (re)load, or the one after a foreground.
    private func currentCustomerInfo() -> CustomerInfo? {
        let cached = Purchases.shared.cachedCustomerInfo
        reportLock.lock()
        let reported = lastReported
        reportLock.unlock()
        return EntitlementRead.newest(cached: cached, reported: reported)
    }

    // MARK: - RevenueCat's delegate

    /// Customer info changed. Recorded whatever it says (currentCustomerInfo
    /// reads it, so revocations flow through the reads as before), and pushed
    /// to the page only when the entitlement is ACTIVE.
    func purchases(_ purchases: Purchases, receivedUpdated customerInfo: CustomerInfo) {
        reportLock.lock()
        lastReported = customerInfo
        reportLock.unlock()
        guard let ent = customerInfo.entitlements[entitlementId], ent.isActive else { return }
        pushActiveStatus(productId: ent.productIdentifier)
    }

    /// The 'billingStatus' push. `active` is the literal true: this is the only
    /// place the push is sent, and it has no inactive form. The guard makes a
    /// page that has not bound the global (still loading, reloading, engine
    /// stopped) a no-op; with no web view at all the push is dropped before it
    /// is sent. Either way the next status read sees the same entitlement (see
    /// currentCustomerInfo), so nothing is lost but the head start.
    private func pushActiveStatus(productId: String) {
        let json = "{\"active\":true,\"productId\":\"\(esc(productId))\"}"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "if(typeof window.__billingStatus==='function'){window.__billingStatus(\(json));}",
                completionHandler: nil
            )
        }
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
                } else if result.customerInfo.entitlements[entitlementId]?.isActive == true {
                    fireBillingEvent(status: "success", code: 0, message: "ok", productId: productId)
                } else {
                    // The store completed the purchase, but the customer info
                    // RevenueCat validated it into does not include our
                    // entitlement: the product is not attached to it, or the
                    // entitlement sits with another of the user's RevenueCat
                    // customers. 'success' would unlock now and lock again at
                    // the next read; an error would tell someone who may have
                    // paid that it failed. Neither: a pending outcome, and the
                    // unlock comes from the delegate if the entitlement appears.
                    fireBillingEvent(status: "pending", code: Self.codeUnconfirmed, message: "unconfirmed", productId: productId)
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
        // Deferred (Ask to Buy, extra authentication): nothing has failed and
        // nothing is charged yet. A pending outcome, not an error; if it is
        // approved later the delegate reports the entitlement.
        if rcError == .paymentPendingError {
            fireBillingEvent(status: "pending", code: Self.codePending, message: "deferred", productId: productId)
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
