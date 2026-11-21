import Foundation
import XCTest
import EntitlementRead

/// Customer info, reduced to what the rule's property is about.
private struct Info: Equatable {
    var active: Bool
    /// Server time for server-verified info, the phone's clock for on-device.
    var requestDate: Date
}

private typealias Rule = (_ cached: Info?, _ reported: Info?) -> Info?

/// RevenueCat's sequencing, as purchases-ios 5.90.1 has it (see EntitlementRead):
/// server-verified info is cached then reported; on-device info clears the
/// cache then is reported. The report is delivered asynchronously, so a read
/// can fall between the cache write and the report.
private final class RevenueCatModel {
    private(set) var cache: Info?
    private(set) var reported: Info?
    private var inFlight: Info?

    func serverVerified(_ info: Info) {
        cache = info
        reported = info
    }

    func verifiedOnDevice(_ info: Info) {
        cache = nil
        reported = info
    }

    /// The cache write alone; the report follows with `deliverReport()`.
    func serverVerifiedNotYetReported(_ info: Info) {
        cache = info
        inFlight = info
    }

    func deliverReport() {
        reported = inFlight
        inFlight = nil
    }

    /// `invalidateCustomerInfoCache()`, or any other emptying of the cache
    /// that comes with no new customer info.
    func emptyCache() {
        cache = nil
    }

    func read(_ rule: Rule) -> Info? {
        rule(cache, reported)
    }
}

private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
private func at(_ seconds: TimeInterval) -> Date { t0.addingTimeInterval(seconds) }

/// Each scenario: RevenueCat's sequence of events, and what a read must say
/// at the end (nil: nothing known). The property the rule is held to is that
/// every scenario reads what it must.
private let scenarios: [(name: String, events: (RevenueCatModel) -> Void, expected: Bool?)] = [
    ("nothing known", { _ in }, nil),
    ("server-verified info", { rc in
        rc.serverVerified(Info(active: true, requestDate: at(0)))
    }, true),
    // The gap the rule closes: on-device info is never cached, so the read
    // has only the report to go on.
    ("on-device info that emptied the cache", { rc in
        rc.serverVerified(Info(active: false, requestDate: at(0)))
        rc.verifiedOnDevice(Info(active: true, requestDate: at(60)))
    }, true),
    // The required property: a later server-verified reading beats a retained
    // on-device one, including on-device ACTIVE against server INACTIVE.
    ("later server inactive over retained on-device active", { rc in
        rc.verifiedOnDevice(Info(active: true, requestDate: at(0)))
        rc.serverVerified(Info(active: false, requestDate: at(600)))
    }, false),
    ("later server active over retained on-device active", { rc in
        rc.verifiedOnDevice(Info(active: true, requestDate: at(0)))
        rc.serverVerified(Info(active: true, requestDate: at(600)))
    }, true),
    // The same, with the phone's clock a day ahead of the server's, so the
    // on-device copy carries the LATER requestDate. Once the server reading is
    // reported it replaces the delegate's copy, so here both copies agree.
    ("later server inactive, phone clock a day ahead", { rc in
        rc.verifiedOnDevice(Info(active: true, requestDate: at(86_400)))
        rc.serverVerified(Info(active: false, requestDate: at(600)))
    }, false),
    // RevenueCat writes the cache before it reports, and reports
    // asynchronously on the main thread; a status read from another thread
    // can fall in between, and must see the new cache.
    ("read between the cache write and its report", { rc in
        rc.verifiedOnDevice(Info(active: true, requestDate: at(0)))
        rc.serverVerifiedNotYetReported(Info(active: false, requestDate: at(600)))
    }, false),
    // ... with the phone's clock a day ahead: the only place the two copies
    // disagree while the on-device one carries the later requestDate.
    ("read between the cache write and its report, phone clock a day ahead", { rc in
        rc.verifiedOnDevice(Info(active: true, requestDate: at(86_400)))
        rc.serverVerifiedNotYetReported(Info(active: false, requestDate: at(600)))
    }, false),
    // The cache emptied with no new info (an explicit invalidation): the
    // retained report is read, stale or not; better than reading nothing.
    ("cache emptied without new info", { rc in
        rc.serverVerified(Info(active: true, requestDate: at(0)))
        rc.emptyCache()
    }, true),
    // ... and the next server reading replaces it.
    ("server reading after the cache was emptied", { rc in
        rc.serverVerified(Info(active: true, requestDate: at(0)))
        rc.emptyCache()
        rc.serverVerified(Info(active: false, requestDate: at(600)))
    }, false),
]

/// The scenarios a rule reads wrongly, by name.
private func violations(of rule: Rule) -> [String] {
    scenarios.compactMap { scenario in
        let rc = RevenueCatModel()
        scenario.events(rc)
        return rc.read(rule)?.active == scenario.expected ? nil : scenario.name
    }
}

final class EntitlementReadTests: XCTestCase {

    /// The rule as shipped reads every scenario rightly.
    func testTheRuleHoldsInEveryScenario() {
        XCTAssertEqual(violations(of: { EntitlementRead.newest(cached: $0, reported: $1) }), [])
    }

    /// The required property, on its own, against the rule as shipped.
    func testLaterServerReadingBeatsRetainedOnDeviceCopy() {
        for later in [false, true] {
            let rc = RevenueCatModel()
            rc.verifiedOnDevice(Info(active: true, requestDate: at(0)))
            rc.serverVerified(Info(active: later, requestDate: at(600)))
            XCTAssertEqual(rc.read { EntitlementRead.newest(cached: $0, reported: $1) }?.active, later)
        }
    }

    // Negative controls, run every time: plausible wrong rules, each caught by
    // a named scenario. If one of these passes, the scenarios no longer tell
    // that rule from the right one.

    /// The rule as first ruled: the later requestDate wins. Wrong only while
    /// the copies disagree, between RevenueCat's cache write and its report,
    /// and only with the phone's clock ahead; then a lapsed customer reads
    /// unlocked.
    func testComparingRequestDatesIsCaught() {
        let byRequestDate: Rule = { cached, reported in
            guard let reported else { return cached }
            guard let cached else { return reported }
            return reported.requestDate > cached.requestDate ? reported : cached
        }
        XCTAssertEqual(violations(of: byRequestDate),
                       ["read between the cache write and its report, phone clock a day ahead"])
    }

    /// The delegate's copy first: a read between RevenueCat's cache write and
    /// its report returns the older copy, whatever the clocks say.
    func testPreferringTheReportIsCaught() {
        XCTAssertEqual(violations(of: { cached, reported in reported ?? cached }),
                       ["read between the cache write and its report",
                        "read between the cache write and its report, phone clock a day ahead"])
    }

    /// The cache alone (the read before this rule): on-device info is never
    /// cached, so it is never read.
    func testReadingTheCacheAloneIsCaught() {
        XCTAssertEqual(violations(of: { cached, _ in cached }),
                       ["on-device info that emptied the cache", "cache emptied without new info"])
    }
}
