import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// Drives the day-summary Live Activity from the widget snapshot.
///
/// Two entry points, zero new JS surface, one source of truth:
///  - `sync(fromSnapshotJSON:)` — the foreground path. WidgetBridge.updateSnapshot
///    already receives the full snapshot JSON on every renderer push, and this
///    bridge just decodes the `daySummary` key out of the same string.
///  - `refreshFromBackground(snapshotJSON:)` — the BGAppRefreshTask path. Reads
///    the SAME stored snapshot and only ever ENDS or UPDATES an existing
///    activity, never creates one: Activity.request is foreground-only and
///    throws from the background. This path re-presents provably still-correct
///    state with a fresh staleness window; it never computes new state.
///
/// The math never lives here — the JS side precomputes everything
/// (computeDaySummary for the numbers, buildUpNextFact for the island's
/// schedule facts), so the island always agrees with the in-app strip.
///
/// Lifecycle, on record:
///  - `liveActivityEnabled` false or absent: END. The Live Activity is
///    OPT-IN (in-app toggle, default off) — the compact island hides the
///    cellular/wifi status icons, so it must be the user's choice. The
///    system-level Settings toggle is honored separately via
///    ActivityAuthorizationInfo.
///  - No `daySummary`, or `unblocked` null (empty day, no declared window):
///    END. The strip renders nothing in that state; so do we.
///  - The date rolled over: yesterday's activity ends, today's is requested —
///    an activity's fixed attributes can't change, so a new day is a new
///    activity by construction. The foreground path keys this on the
///    snapshot's date (the snapshot is fresh by definition there); the
///    background path keys it on the CURRENT date, because its snapshot may
///    itself be from yesterday and would otherwise match — and refresh — a
///    stale activity past midnight.
///  - Otherwise: update in place, or (foreground only) request if none is
///    live. iOS ends Live Activities after ~8h on its own — background
///    updates do not extend that lifetime; because a request happens on any
///    foreground snapshot push with none live, the next app foreground
///    re-establishes it without dedicated plumbing.
///  - staleDate is ~45 min out on every foreground update: with no server
///    push (privacy-first, no backend), state only refreshes while the app's
///    own process runs, and the island dims rather than presenting stale
///    content as current. The countdown itself needs no refresh — the OS
///    ticks it. The 45-minute blanket is calibrated for the foreground,
///    where the block-boundary timer re-pushes at block edges; the
///    background path additionally caps staleDate at the up-next boundary,
///    because nothing re-pushes at boundaries back there.
@available(iOS 16.2, *)
final class LiveActivityBridge {
    static let shared = LiveActivityBridge()

    private static let staleAfter: TimeInterval = 45 * 60
    /// How far past the up-next fact's boundary a background update may still
    /// present the activity as fresh. Small on purpose: at the boundary the
    /// fact ("until 2:00 PM" / "starts in") lapses, and only a foreground
    /// push can compute the next block.
    private static let boundaryGrace: TimeInterval = 2 * 60

    // Only the fields this bridge needs; unknown snapshot keys are ignored.
    private struct SnapshotEnvelope: Decodable {
        var liveActivityEnabled: Bool?
        var daySummary: DaySummaryPayload?
    }
    private struct DaySummaryPayload: Decodable {
        var date: String?
        var unblocked: String?
        var effort: String?
        var restore: String?
        var done: String?
        var upNext: UpNextPayload?
        var labels: LabelsPayload?
    }
    // The island's Swift-rendered words, localized by the JS side (see the
    // snapshot's daySummary.labels). English fallbacks cover old snapshots.
    private struct LabelsPayload: Decodable {
        var done: String?
        var remaining: String?
        var startsIn: String?
        var noMoreBlocks: String?
    }
    private struct UpNextPayload: Decodable {
        var title: String?
        var timeLabel: String?
        var inProgress: Bool?
        var energy: String?
        var countdownStartMs: Double?
        var countdownEndMs: Double?
    }

    /// A snapshot that passed every render guard, reduced to what the two
    /// entry points need: the day it describes, the ready-to-push state, and
    /// the up-next fact's boundary (the moment that fact can lapse — the
    /// foreground ignores it because its boundary timer re-pushes; the
    /// background caps staleness at it).
    private struct ValidSummary {
        let date: String
        let state: DaySummaryAttributes.ContentState
        let countdownEnd: Date?
    }

    private static func decode(_ json: String) -> SnapshotEnvelope? {
        try? JSONDecoder().decode(SnapshotEnvelope.self, from: Data(json.utf8))
    }

    private static func validSummary(from payload: DaySummaryPayload?) -> ValidSummary? {
        guard let payload = payload,
              let date = payload.date,
              // unblocked is the empty-day sentinel, not display data: null
              // means nothing to measure (the strip shows nothing) → end.
              payload.unblocked != nil,
              let effort = payload.effort,
              let restore = payload.restore,
              let done = payload.done else { return nil }

        let up = payload.upNext
        let labels = payload.labels
        let msToDate: (Double?) -> Date? = { ms in ms.map { Date(timeIntervalSince1970: $0 / 1000) } }
        let state = DaySummaryAttributes.ContentState(
            blockTitle: up?.title,
            blockTime: up?.timeLabel,
            countdownStart: msToDate(up?.countdownStartMs),
            countdownEnd: msToDate(up?.countdownEndMs),
            inProgress: up?.inProgress ?? false,
            blockEnergy: up?.energy,
            done: done, effort: effort, restore: restore,
            doneLabel: labels?.done ?? "done",
            remainingLabel: labels?.remaining ?? "remaining",
            startsInLabel: labels?.startsIn ?? "starts in",
            noMoreBlocksLabel: labels?.noMoreBlocks ?? "No more blocks today")
        return ValidSummary(date: date, state: state, countdownEnd: msToDate(up?.countdownEndMs))
    }

    /// Today as the local-time "yyyy-MM-dd" the JS side writes into the
    /// snapshot's `date` (dateToString in utils/taskUtils.js): local timezone,
    /// Gregorian, zero-padded.
    private static func localDayString(_ date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    // MARK: - Foreground path

    func sync(fromSnapshotJSON json: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let envelope = Self.decode(json)

        // Opt-in gate first: turning the in-app toggle off (or an old
        // snapshot without the flag) tears down any live activity.
        guard envelope?.liveActivityEnabled == true else {
            endAll()
            return
        }

        guard let summary = Self.validSummary(from: envelope?.daySummary) else {
            endAll()
            return
        }

        let content = ActivityContent(state: summary.state, staleDate: Date().addingTimeInterval(Self.staleAfter))

        Task {
            // A new day is a new activity: end anything describing another date.
            for activity in Activity<DaySummaryAttributes>.activities where activity.attributes.date != summary.date {
                await activity.end(nil, dismissalPolicy: .immediate)
            }

            if let live = Activity<DaySummaryAttributes>.activities.first(where: { $0.attributes.date == summary.date }) {
                await live.update(content)
            } else {
                // Best-effort: request can throw (per-app activity cap, user
                // disabled Live Activities mid-session). The widgets still
                // carry the numbers, so failure here costs only the island.
                _ = try? Activity.request(
                    attributes: DaySummaryAttributes(date: summary.date),
                    content: content)
            }
        }
    }

    // MARK: - Background path (BGAppRefreshTask)

    /// Opportunistic staleness reduction from the background refresh task:
    /// re-presents the stored snapshot — which cannot have drifted, since no
    /// process ran to change the data — with a fresh staleness window, and
    /// tears down an activity whose day has rolled over. Worth having, never
    /// worth trusting: iOS runs the task when it pleases, or not at all, and
    /// the activity must stay correct without it. Awaitable on purpose, so
    /// the caller can hold the task open until the update actually lands.
    func refreshFromBackground(snapshotJSON: String?) async {
        // The common case is no live activity at all: notice it and get out
        // before touching anything else.
        guard !Activity<DaySummaryAttributes>.activities.isEmpty else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let envelope = snapshotJSON.flatMap(Self.decode)
        guard envelope?.liveActivityEnabled == true,
              let summary = Self.validSummary(from: envelope?.daySummary) else {
            // Same teardown the foreground performs for an opted-out, empty-day,
            // or unreadable snapshot — ending is always safe from back here.
            await endAllNow()
            return
        }

        // Rollover teardown, keyed on the CURRENT date — never the snapshot's.
        // A snapshot last written yesterday matches yesterday's activity, and
        // keying on it would cheerfully refresh yesterday's numbers past
        // midnight.
        let today = Self.localDayString()
        for activity in Activity<DaySummaryAttributes>.activities where activity.attributes.date != today {
            await activity.end(nil, dismissalPolicy: .immediate)
        }

        guard !Task.isCancelled,
              summary.date == today,
              let live = Activity<DaySummaryAttributes>.activities.first(where: { $0.attributes.date == today })
        else { return } // Activity.request is foreground-only: never create from here.

        let now = Date()
        var staleDate = now.addingTimeInterval(Self.staleAfter)
        if let boundary = summary.countdownEnd {
            guard boundary > now else {
                // Intended behaviour, not a missed case: the up-next fact's
                // boundary has passed, and only the JS side can compute the
                // next block. Un-dimming a lapsed fact is exactly what the
                // isStale dimming exists to prevent, so a fire that lands
                // after the last boundary refreshes nothing and the island
                // stays dimmed until the next foreground push.
                return
            }
            // Cap freshness at the boundary (plus a small grace): past it,
            // this same content must be allowed to dim on schedule.
            staleDate = min(staleDate, boundary.addingTimeInterval(Self.boundaryGrace))
        }

        guard !Task.isCancelled else { return }
        await live.update(ActivityContent(state: summary.state, staleDate: staleDate))
    }

    // MARK: - Teardown

    private func endAll() {
        Task { await self.endAllNow() }
    }

    private func endAllNow() async {
        for activity in Activity<DaySummaryAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
#endif
