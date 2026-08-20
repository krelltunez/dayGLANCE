import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// Live Activity attributes for the day summary (Dynamic Island + lock
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
/// The island leads with SCHEDULE FACTS, not claims about "now": with no
/// server push, the activity only updates when the app's own process runs —
/// every foreground snapshot push, plus an opportunistic BGAppRefreshTask
/// that re-presents the stored snapshot (LiveActivityBridge
/// .refreshFromBackground) and is never guaranteed to fire. So "Deep work
/// until 2:00 PM" (still true when stale) beats "In progress" (false the
/// moment a boundary passes with the app closed). The live part is the
/// countdown interval, which SwiftUI's Text(timerInterval:) ticks with zero
/// updates.
/// All strings arrive PREFORMATTED from JS so wording matches the in-app
/// strip and the math is never re-implemented in Swift: the projection is
/// computeDaySummary + buildUpNextFact, serialized in the snapshot's
/// `daySummary` key.
@available(iOS 16.1, *)
struct DaySummaryAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Current-or-next block title (task or hyperGLANCE session), nil
        /// when nothing is left on today's schedule.
        var blockTitle: String?
        /// "until 2:00 PM" (in progress) / "at 3:30 PM" (upcoming) — phrased
        /// to stay factual when the activity goes stale.
        var blockTime: String?
        /// Interval for the OS-driven live countdown: the block itself when
        /// in progress (time remaining), push-time..start when upcoming.
        var countdownStart: Date?
        var countdownEnd: Date?
        /// Whether the block had started when this state was pushed — picks
        /// the caption ("remaining" vs "starts in"), nothing else.
        var inProgress: Bool
        /// "effort" | "restore" for the current-or-next block, resolved by JS
        /// (deriveBlockEnergy — per-block override, then #tag/title keywords).
        /// Tints the countdown ring and picks the glyph inside it. Optional and
        /// unvalidated on purpose: an old snapshot, or any value this build does
        /// not know, falls back to the neutral ring rather than asserting an
        /// energy the app never sent.
        var blockEnergy: String?
        /// "1h 30m/7h" — done/planned.
        var done: String
        /// "5h 30m" effort / "2h 30m" restore — the energy split. Unblocked
        /// time is deliberately NOT carried: no Live Activity surface renders
        /// it (in-app currency, not glance currency) — though the bridge still
        /// reads it from the snapshot as the empty-day end signal.
        var effort: String
        var restore: String
        /// The four words this extension renders itself, LOCALIZED BY JS and
        /// delivered in the snapshot's `labels` — the JS side owns all island
        /// wording, so the iOS project needs no localization infrastructure.
        /// The bridge falls back to English when an old snapshot lacks them.
        var doneLabel: String
        var remainingLabel: String
        var startsInLabel: String
        var noMoreBlocksLabel: String
    }

    /// 'YYYY-MM-DD' this activity describes. Fixed for the activity's lifetime.
    var date: String
}
#endif
