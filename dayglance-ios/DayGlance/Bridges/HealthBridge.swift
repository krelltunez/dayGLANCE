import HealthKit

/// HealthKit bridge for the DayGlanceNative JS interface.
///
/// Query methods block synchronously via DispatchSemaphore so they can be
/// called from the WKURLSchemeHandler. HealthKit callbacks always fire on a
/// background queue, so waiting on the main thread does not deadlock.
final class HealthBridge {

    static let shared = HealthBridge()

    private let store = HKHealthStore()

    private let readTypes: Set<HKObjectType> = [
        HKQuantityType(.stepCount),
        HKCategoryType(.sleepAnalysis),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.restingHeartRate),
    ]

    // MARK: - Authorization (deferred)
    //
    // Authorization is NO LONGER requested at launch (guideline 5.1.1 — reviewers
    // dislike an unprompted HealthKit dialog in the startup cascade). Instead it is
    // requested lazily the first time the web layer actually reads health data
    // (getSteps / getSleep), i.e. only when a health-linked habit exists and its
    // count is being fetched.
    //
    // The request is fired asynchronously so it never blocks the synchronous bridge
    // thread (getSteps/getSleep hold the main thread on a semaphore while the query
    // runs; presenting the permission sheet from a blocked main thread would
    // deadlock). When the sheet closes we post .dayGlanceReloadWebView — the same
    // reload-after-permission mechanism the calendar flow uses — so the web layer
    // re-runs its health sync and the counts load with access granted.
    //
    // If the user already responded in a previous session, getRequestStatusForAuthorization
    // reports .unnecessary, no sheet is shown, and the query below runs immediately —
    // startup behaviour is unchanged for already-authorized users.

    private var authorizationRequested = false

    /// Requests HealthKit authorization once, lazily, the first time health data is
    /// read. No-op if health data is unavailable or a request has already been made
    /// this session. Non-blocking.
    private func ensureAuthorizationRequested() {
        guard HKHealthStore.isHealthDataAvailable(), !authorizationRequested else { return }
        authorizationRequested = true
        store.getRequestStatusForAuthorization(toShare: [], read: readTypes) { [weak self] status, error in
            guard let self, error == nil, status == .shouldRequest else { return }
            DispatchQueue.main.async {
                self.store.requestAuthorization(toShare: nil, read: self.readTypes) { _, _ in
                    // Sheet dismissed (granted or denied): reload so the web layer
                    // re-reads health data now that authorization is determined.
                    DispatchQueue.main.async {
                        NotificationCenter.default.post(name: .dayGlanceReloadWebView, object: nil)
                    }
                }
            }
        }
    }

    // MARK: - Steps
    // Returns: {"steps":<int>,"goal":10000}

    func getSteps(date: String) -> String {
        guard HKHealthStore.isHealthDataAvailable(),
              let day = parseDate(date) else {
            return #"{"steps":0,"goal":10000}"#
        }

        // Lazily request authorization on first actual read (see notes above).
        ensureAuthorizationRequested()

        let calendar = Calendar.current
        let start = calendar.startOfDay(for: day)
        let end   = calendar.date(byAdding: .day, value: 1, to: start)!

        let predicate = HKQuery.predicateForSamples(
            withStart: start, end: end, options: .strictStartDate
        )

        let semaphore = DispatchSemaphore(value: 0)
        var json = #"{"steps":0,"goal":10000}"#

        let query = HKStatisticsQuery(
            quantityType: HKQuantityType(.stepCount),
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { _, statistics, _ in
            let steps = Int(statistics?.sumQuantity()?.doubleValue(for: .count()) ?? 0)
            json = #"{"steps":\#(steps),"goal":10000}"#
            semaphore.signal()
        }

        store.execute(query)
        _ = semaphore.wait(timeout: .now() + 3)
        return json
    }

    // MARK: - Sleep
    // Returns: {"durationMinutes":<int>,"stages":[{"stage":<string>,"durationMinutes":<int>},...]}
    // Window: noon the day before 'date' → noon of 'date' (captures the preceding night).

    func getSleep(date: String) -> String {
        guard HKHealthStore.isHealthDataAvailable(),
              let day = parseDate(date) else {
            return #"{"durationMinutes":0,"stages":[]}"#
        }

        // Lazily request authorization on first actual read (see notes above).
        ensureAuthorizationRequested()

        let calendar    = Calendar.current
        let noon        = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: day)!
        let previousNoon = calendar.date(byAdding: .day, value: -1, to: noon)!

        let predicate = HKQuery.predicateForSamples(
            withStart: previousNoon, end: noon, options: .strictStartDate
        )

        let semaphore = DispatchSemaphore(value: 0)
        var json = #"{"durationMinutes":0,"stages":[]}"#

        let query = HKSampleQuery(
            sampleType: HKCategoryType(.sleepAnalysis),
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        ) { [weak self] _, samples, _ in
            defer { semaphore.signal() }
            guard let self,
                  let samples = samples as? [HKCategorySample],
                  !samples.isEmpty else { return }

            // Prefer specific stage samples over coarse .inBed records.
            // Many devices write both; using only specific stages avoids double-counting.
            let specific = samples.filter {
                $0.value != HKCategoryValueSleepAnalysis.inBed.rawValue
            }
            let usable = specific.isEmpty ? samples : specific

            var stageDurations: [String: Int] = [:]
            for sample in usable {
                let stage   = self.stageName(sample.value)
                let minutes = max(0, Int(sample.endDate.timeIntervalSince(sample.startDate) / 60))
                stageDurations[stage, default: 0] += minutes
            }

            let total      = stageDurations.values.reduce(0, +)
            let stagesJSON = stageDurations
                .sorted { $0.key < $1.key }
                .map { #"{"stage":"\#($0.key)","durationMinutes":\#($0.value)}"# }
                .joined(separator: ",")

            json = #"{"durationMinutes":\#(total),"stages":[\#(stagesJSON)]}"#
        }

        store.execute(query)
        _ = semaphore.wait(timeout: .now() + 3)
        return json
    }

    // MARK: - Helpers

    private func parseDate(_ string: String) -> Date? {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale   = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        return f.date(from: string)
    }

    private func stageName(_ value: Int) -> String {
        switch HKCategoryValueSleepAnalysis(rawValue: value) {
        case .inBed:             return "sleeping"
        case .asleepUnspecified: return "sleeping"
        case .awake:             return "awake"
        case .asleepCore:        return "light"
        case .asleepDeep:        return "deep"
        case .asleepREM:         return "rem"
        default:                 return "unknown"
        }
    }
}
