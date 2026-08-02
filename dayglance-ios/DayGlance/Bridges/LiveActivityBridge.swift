import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// Drives the day-summary Live Activity from the widget snapshot.
///
/// Single entry point, zero new JS surface: WidgetBridge.updateSnapshot already
/// receives the full snapshot JSON on every renderer push, and this bridge just
/// decodes the `daySummary` key out of the same string. The math never lives
/// here — the JS side precomputes everything (computeDaySummary for the
/// numbers, buildUpNextFact for the island's schedule facts), so the island
/// always agrees with the in-app strip.
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
///    activity by construction.
///  - Otherwise: update in place, or request if none is live. iOS ends Live
///    Activities after ~8h on its own; because a request happens on any
///    snapshot push with none live, the next app foreground re-establishes it
///    without dedicated plumbing.
///  - staleDate is ~45 min out on every update: with no server push (privacy-
///    first, no backend), state only refreshes while the app runs, and the
///    island dims rather than presenting stale content as current. The
///    countdown itself needs no refresh — the OS ticks it.
@available(iOS 16.2, *)
final class LiveActivityBridge {
    static let shared = LiveActivityBridge()

    private static let staleAfter: TimeInterval = 45 * 60

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
    }
    private struct UpNextPayload: Decodable {
        var title: String?
        var timeLabel: String?
        var inProgress: Bool?
        var countdownStartMs: Double?
        var countdownEndMs: Double?
    }

    func sync(fromSnapshotJSON json: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let envelope = try? JSONDecoder().decode(SnapshotEnvelope.self, from: Data(json.utf8))

        // Opt-in gate first: turning the in-app toggle off (or an old
        // snapshot without the flag) tears down any live activity.
        guard envelope?.liveActivityEnabled == true else {
            endAll()
            return
        }

        guard let payload = envelope?.daySummary,
              let date = payload.date,
              let unblocked = payload.unblocked,
              let effort = payload.effort,
              let restore = payload.restore,
              let done = payload.done else {
            endAll()
            return
        }

        let up = payload.upNext
        let msToDate: (Double?) -> Date? = { ms in ms.map { Date(timeIntervalSince1970: $0 / 1000) } }
        let state = DaySummaryAttributes.ContentState(
            blockTitle: up?.title,
            blockTime: up?.timeLabel,
            countdownStart: msToDate(up?.countdownStartMs),
            countdownEnd: msToDate(up?.countdownEndMs),
            inProgress: up?.inProgress ?? false,
            done: done, unblocked: unblocked, effort: effort, restore: restore)
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter))

        Task {
            // A new day is a new activity: end anything describing another date.
            for activity in Activity<DaySummaryAttributes>.activities where activity.attributes.date != date {
                await activity.end(nil, dismissalPolicy: .immediate)
            }

            if let live = Activity<DaySummaryAttributes>.activities.first(where: { $0.attributes.date == date }) {
                await live.update(content)
            } else {
                // Best-effort: request can throw (per-app activity cap, user
                // disabled Live Activities mid-session). The widgets still
                // carry the numbers, so failure here costs only the island.
                _ = try? Activity.request(
                    attributes: DaySummaryAttributes(date: date),
                    content: content)
            }
        }
    }

    private func endAll() {
        Task {
            for activity in Activity<DaySummaryAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }
}
#endif
