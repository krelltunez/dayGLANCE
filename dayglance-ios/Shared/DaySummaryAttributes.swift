import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// Live Activity attributes for the day-summary strip (Dynamic Island + lock
/// screen). Compiled into BOTH the app target (which starts/updates the
/// activity from the widget snapshot — see LiveActivityBridge) and the widget
/// extension (which renders it — see DaySummaryLiveActivity), so it lives in
/// Shared/.
///
/// Everything mutable is in ContentState: the numbers change all day, and the
/// activity's fixed attributes cannot. `date` is fixed — a new day is a NEW
/// activity (the bridge ends yesterday's and requests today's), which keeps
/// midnight semantics trivial.
///
/// The strings arrive PREFORMATTED from JS (formatMinutes), so the island's
/// wording is byte-identical to the in-app strip and the math is never
/// re-implemented in Swift: the projection is computeDaySummary, serialized in
/// the snapshot's `daySummary` key.
@available(iOS 16.1, *)
struct DaySummaryAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// "3h 20m" — the headline. Never "0m for an unmeasurable day": the
        /// bridge ends the activity instead when there is nothing to measure.
        var unblocked: String
        /// "5h 30m" effort / "2h 30m" restore — the energy split.
        var effort: String
        var restore: String
        /// "1h 30m/7h" — done/planned.
        var done: String
    }

    /// 'YYYY-MM-DD' this activity describes. Fixed for the activity's lifetime.
    var date: String
}
#endif
