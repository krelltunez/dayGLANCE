import ActivityKit
import WidgetKit
import SwiftUI

// Day-summary Live Activity: schedule facts in the Dynamic Island, and a
// lock-screen banner that mirrors the expanded island (block + done on the
// left, countdown + energy on the right). Pure metadata plane — short
// strings and a countdown interval, no media — rendered from ContentState
// pushed by the app's LiveActivityBridge; this extension never reads the App
// Group or computes anything.
//
// The island leads with the current-or-next block ("Deep work until 2:00 PM")
// plus a live countdown. The countdown is Text(timerInterval:) — the OS ticks
// it every second with no updates and no pushes, so the most glanceable
// element is also the one that can never go stale. The labels are phrased as
// schedule facts that stay true after a boundary passes; `context.isStale`
// dims everything else instead of presenting old state as current.
//
// Iconography mirrors the in-app strip: bolt (lucide Zap) for Effort, leaf
// for Restore, in the same indigo/green family. System colors are used rather
// than exact hexes so the island adapts to its always-dark rendering.

private let effortColor = Color.indigo
private let restoreColor = Color.green
private let unblockedColor = Color.teal

// The live countdown: the OS renders the remaining time in the interval,
// showing 0:00 once it has passed (next to a label that is still factual).
// Falls back to the given string when there is no interval to count.
@ViewBuilder
private func countdownText(_ state: DaySummaryAttributes.ContentState, fallback: String) -> some View {
    if let start = state.countdownStart, let end = state.countdownEnd, start < end {
        Text(timerInterval: start...end, countsDown: true)
    } else {
        Text(fallback)
    }
}

// The live block-progress RING: same OS-animated mechanism as the countdown
// text (ProgressView over the interval ticks with zero updates and zero
// pushes), so the compact leading slot shows shape while the trailing shows
// number. In progress it drains as the block runs down; upcoming it drains
// toward the start. Labels are empty on purpose — the numeric countdown
// already lives on the trailing side, and the empty currentValueLabel is the
// slot where a per-block energy glyph could later sit inside the ring.
// Falls back to the hourglass when there is nothing to animate (no more
// blocks today).
@ViewBuilder
private func countdownRing(_ state: DaySummaryAttributes.ContentState) -> some View {
    if let start = state.countdownStart, let end = state.countdownEnd, start < end {
        // Explicitly sized: the circular gauge's natural size over-claims the
        // compact slot, leaving a dead gap between the ring and the sensor
        // housing. 18pt keeps the slot as tight as the system margins allow.
        ProgressView(timerInterval: start...end, countsDown: true,
                     label: { EmptyView() }, currentValueLabel: { EmptyView() })
            .progressViewStyle(.circular)
            .tint(unblockedColor)
            .frame(width: 18, height: 18)
    } else {
        Image(systemName: "hourglass")
            .foregroundStyle(unblockedColor)
            .imageScale(.small)
    }
}

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
                        Text(context.state.blockTitle ?? "No more blocks today")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                        if let time = context.state.blockTime {
                            Text(time)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.leading, 4)
                    .opacity(context.isStale ? 0.55 : 1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        // Timer text must never wrap: an hours-long countdown
                        // ("2:02:01") overflows a fixed width at title3, and a
                        // wrapped timer splits mid-digit. One line, scale down.
                        // multilineTextAlignment is what right-aligns the DIGITS —
                        // timer text reserves its max width and centers its glyphs
                        // inside it; frame(alignment:) only moves the box.
                        countdownText(context.state, fallback: context.state.done)
                            .font(.title3.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(unblockedColor)
                            .lineLimit(1)
                            .minimumScaleFactor(0.55)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 84, alignment: .trailing)
                        Text(context.state.blockTitle == nil ? "done"
                             : context.state.inProgress ? "remaining" : "starts in")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // Three labels can outgrow the row (long done + effort +
                    // restore values clipped the leaf's number at the edge):
                    // one line each, shrink together before anything clips.
                    HStack(spacing: 10) {
                        Label("\(context.state.done) done", systemImage: "checkmark.circle")
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 6)
                        Label(context.state.effort, systemImage: "bolt.fill")
                            .foregroundStyle(effortColor)
                        Label(context.state.restore, systemImage: "leaf.fill")
                            .foregroundStyle(restoreColor)
                    }
                    .font(.footnote.weight(.medium))
                    .labelStyle(.titleAndIcon)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    // The region clips at the island's curved edge rather than
                    // constraining the row (so scale-down alone never kicked in
                    // for the last label) — pull the row in from the edge.
                    .padding(.trailing, 8)
                    .opacity(context.isStale ? 0.5 : 1)
                }
            } compactLeading: {
                countdownRing(context.state)
                    .opacity(context.isStale ? 0.5 : 1)
            } compactTrailing: {
                countdownText(context.state, fallback: context.state.done)
                    .font(.caption2.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(unblockedColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 56, alignment: .trailing)
                    .opacity(context.isStale ? 0.5 : 1)
            } minimal: {
                countdownRing(context.state)
            }
        }
    }
}

private struct LockScreenView: View {
    let state: DaySummaryAttributes.ContentState
    let isStale: Bool

    // Mirrors the EXPANDED island as two clean rows: block title + time on the
    // left with the live countdown + caption right-flush opposite them, then a
    // spaced-out footer row of done progress (left) and the energy split
    // (right). Unblocked time is in-app currency, not glance currency — it
    // lives in the summary strip, not here.
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(state.blockTitle ?? "No more blocks today")
                        .font(.headline)
                        .lineLimit(2)
                    if let time = state.blockTime {
                        Text(time)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                // Same live countdown as the island (title3, matching it —
                // title2 dominated the banner). multilineTextAlignment is what
                // right-aligns the DIGITS: timer text reserves its max width
                // and centers its glyphs inside it; frame(alignment:) only
                // moves the box. Absent countdown (no more blocks) → the row
                // is just the title; the footer still carries done + energy.
                if let start = state.countdownStart, let end = state.countdownEnd, start < end {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(timerInterval: start...end, countsDown: true)
                            .font(.title3.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(unblockedColor)
                            .lineLimit(1)
                            .minimumScaleFactor(0.55)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 84, alignment: .trailing)
                        Text(state.inProgress ? "remaining" : "starts in")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            HStack(spacing: 10) {
                Label("\(state.done) done", systemImage: "checkmark.circle")
                    .foregroundStyle(.secondary)
                Spacer(minLength: 6)
                Label(state.effort, systemImage: "bolt.fill")
                    .foregroundStyle(effortColor)
                Label(state.restore, systemImage: "leaf.fill")
                    .foregroundStyle(restoreColor)
            }
            .font(.footnote.weight(.medium))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
        }
        .padding(14)
        .opacity(isStale ? 0.55 : 1)
    }
}
