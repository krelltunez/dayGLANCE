import HealthKit

/// HealthKit bridge for the DayGlanceNative JS interface.
///
/// Query methods block synchronously via DispatchSemaphore so they can be
/// called from the WKURLSchemeHandler. HealthKit callbacks always fire on a
/// background queue, so waiting on the main thread does not deadlock.
final class HealthBridge {

    static let shared = HealthBridge()

    private let store = HKHealthStore()

    // Only the two types the app actually reads. Heart-rate-variability and
    // resting-heart-rate were previously declared here but never queried; unused
    // HealthKit type references draw Guideline 2.5.1 scrutiny, so they are removed.
    private let readTypes: Set<HKObjectType> = [
        HKQuantityType(.stepCount),
        HKCategoryType(.sleepAnalysis),
    ]

    // MARK: - Authorization (explicit)
    //
    // Authorization is requested only when the user taps "Continue" on a health-
    // habit tile — never at launch (guideline 5.1.1). requestAuthorization() presents
    // the sheet from a clean, user-initiated context (not from inside a semaphore-
    // blocked read, which is fragile), then posts .dayGlanceReloadWebView — the same
    // reload-after-permission mechanism the calendar flow uses — so the web layer
    // re-reads permission state and health counts once access is determined.
    //
    // permissionAsked() is the UI gate. HealthKit deliberately does NOT reveal
    // whether READ access was granted — only whether the app has already prompted:
    // getRequestStatusForAuthorization reports .unnecessary once the user has
    // responded (granted OR denied) and .shouldRequest before that. So "granted"
    // here means "the user has answered the prompt", which is enough to enable the
    // "Add" button. If they denied, reads simply return 0 (iOS exposes no way to
    // detect a read denial or re-prompt; the user re-enables in Settings › Health).

    /// Presents the HealthKit authorization sheet (user-initiated, from the Continue
    /// button). Non-blocking. Posts .dayGlanceReloadWebView when the sheet is
    /// dismissed so the web layer re-reads permission state and health data.
    func requestAuthorization() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        DispatchQueue.main.async {
            self.store.requestAuthorization(toShare: nil, read: self.readTypes) { _, _ in
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: .dayGlanceReloadWebView, object: nil)
                }
            }
        }
    }

    /// "granted" once the user has responded to the authorization prompt (the only
    /// signal HealthKit exposes for read types), "notDetermined" before that.
    /// Synchronous: blocks on a semaphore while the status callback runs on its
    /// background queue (bounded by a 3s timeout).
    func permissionAsked() -> String {
        guard HKHealthStore.isHealthDataAvailable() else { return "notDetermined" }
        let semaphore = DispatchSemaphore(value: 0)
        var result = "notDetermined"
        store.getRequestStatusForAuthorization(toShare: [], read: readTypes) { status, _ in
            if status == .unnecessary { result = "granted" }
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 3)
        return result
    }

    // MARK: - Steps
    // Returns: {"steps":<int>,"goal":10000}

    func getSteps(date: String) -> String {
        guard HKHealthStore.isHealthDataAvailable(),
              let day = parseDate(date) else {
            return #"{"steps":0,"goal":10000}"#
        }

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
