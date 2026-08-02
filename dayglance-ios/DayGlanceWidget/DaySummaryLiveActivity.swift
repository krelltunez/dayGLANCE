import ActivityKit
import WidgetKit
import SwiftUI

// Day-summary Live Activity: the summary strip's four numbers on the lock
// screen and in the Dynamic Island. Pure metadata plane — four short strings,
// no media — rendered from ContentState pushed by the app's
// LiveActivityBridge; this extension never reads the App Group or computes
// anything.
//
// Iconography mirrors the in-app strip: bolt (lucide Zap) for Effort, leaf for
// Restore, in the same indigo/green family. System colors are used rather than
// exact hexes so the island adapts to its always-dark rendering correctly.
//
// Staleness: the bridge sets a staleDate on every update. When the app hasn't
// refreshed the numbers (completions made on another device sync in only when
// the iOS app next wakes), `context.isStale` dims the content instead of
// presenting old numbers as current — honesty over polish.

private let effortColor = Color.indigo
private let restoreColor = Color.green
private let unblockedColor = Color.teal

struct DaySummaryLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DaySummaryAttributes.self) { context in
            // ── Lock screen / notification banner ────────────────────────
            LockScreenView(state: context.state, isStale: context.isStale)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                // ── Expanded ─────────────────────────────────────────────
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.unblocked)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(unblockedColor)
                        Text("unblocked")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(context.state.done)
                            .font(.title3.weight(.semibold))
                        Text("done")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 14) {
                        Label(context.state.effort, systemImage: "bolt.fill")
                            .foregroundStyle(effortColor)
                        Label(context.state.restore, systemImage: "leaf.fill")
                            .foregroundStyle(restoreColor)
                    }
                    .font(.footnote.weight(.medium))
                    .labelStyle(.titleAndIcon)
                    .opacity(context.isStale ? 0.5 : 1)
                }
            } compactLeading: {
                Image(systemName: "hourglass")
                    .foregroundStyle(unblockedColor)
            } compactTrailing: {
                Text(context.state.unblocked)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(unblockedColor)
                    .opacity(context.isStale ? 0.5 : 1)
            } minimal: {
                Image(systemName: "hourglass")
                    .foregroundStyle(unblockedColor)
            }
        }
    }
}

private struct LockScreenView: View {
    let state: DaySummaryAttributes.ContentState
    let isStale: Bool

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(state.unblocked)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(unblockedColor)
                Text("unblocked")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                HStack(spacing: 10) {
                    Label(state.effort, systemImage: "bolt.fill")
                        .foregroundStyle(effortColor)
                    Label(state.restore, systemImage: "leaf.fill")
                        .foregroundStyle(restoreColor)
                }
                .font(.footnote.weight(.medium))
                Text("\(state.done) done")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .opacity(isStale ? 0.55 : 1)
    }
}
