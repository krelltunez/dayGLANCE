import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// Drives the day-summary Live Activity from the widget snapshot.
///
/// Single entry point, zero new JS surface: WidgetBridge.updateSnapshot already
/// receives the full snapshot JSON on every renderer push, and this bridge just
/// decodes the `daySummary` key out of the same string. The math never lives
/// here — the JS side precomputes everything (the projection IS
/// computeDaySummary), so the island always agrees with the in-app strip.
///
/// Lifecycle, on record:
///  - No `daySummary`, or `unblocked` null (empty day, no declared window):
///    END the activity. The strip renders nothing in that state; so do we.
///  - The date rolled over: yesterday's activity ends, today's is requested —
///    an activity's fixed attributes can't change, so a new day is a new
///    activity by construction.
///  - Otherwise: update in place, or request if none is live. iOS ends Live
///    Activities after ~8h on its own; because a request happens on any
///    snapshot push with none live, the next app foreground re-establishes it
///    without dedicated plumbing.
///  - staleDate is ~45 min out on every update: with no server push (privacy-
///    first, no backend), numbers only refresh while the app runs, and the
///    island dims rather than presenting stale numbers as current.
@available(iOS 16.2, *)
final class LiveActivityBridge {
    static let shared = LiveActivityBridge()

    private static let staleAfter: TimeInterval = 45 * 60

    // Only the fields this bridge needs; unknown snapshot keys are ignored.
    private struct SnapshotEnvelope: Decodable {
        var daySummary: DaySummaryPayload?
    }
    private struct DaySummaryPayload: Decodable {
        var date: String?
        var unblocked: String?
        var effort: String?
        var restore: String?
        var done: String?
    }

    func sync(fromSnapshotJSON json: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let payload = (try? JSONDecoder().decode(SnapshotEnvelope.self, from: Data(json.utf8)))?.daySummary

        guard let payload,
              let date = payload.date,
              let unblocked = payload.unblocked,
              let effort = payload.effort,
              let restore = payload.restore,
              let done = payload.done else {
            endAll()
            return
        }

        let state = DaySummaryAttributes.ContentState(
            unblocked: unblocked, effort: effort, restore: restore, done: done)
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
