import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Configuration

/// A goal the user can pick in the widget editor (long-press → Edit Widget).
struct GoalEntity: AppEntity {
    let id: String
    let title: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Goal" }
    static var defaultQuery = GoalEntityQuery()

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

/// Supplies the goal list (from the latest snapshot) to the widget editor and
/// resolves a previously-selected goal by id.
struct GoalEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [GoalEntity] {
        allEntities().filter { identifiers.contains($0.id) }
    }
    func suggestedEntities() async throws -> [GoalEntity] { allEntities() }

    private func allEntities() -> [GoalEntity] {
        (loadSnapshot()?.allGoals ?? []).compactMap { g in
            guard let id = g.id else { return nil }
            return GoalEntity(id: id, title: g.title ?? String(localized: "Untitled"))
        }
    }
}

/// Per-widget configuration: which goal to show. nil = first/active (the prior
/// behavior), so widgets placed before this change keep working unchanged.
struct SelectGoalIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Select Goal"
    static var description = IntentDescription("Choose which goal this widget displays.")

    @Parameter(title: "Goal")
    var goal: GoalEntity?
}

// MARK: - Timeline

struct GoalEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let selectedGoalId: String?
}

struct GoalProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> GoalEntry {
        GoalEntry(date: Date(), snapshot: nil, selectedGoalId: nil)
    }
    func snapshot(for configuration: SelectGoalIntent, in context: Context) async -> GoalEntry {
        GoalEntry(date: Date(), snapshot: loadSnapshot(), selectedGoalId: configuration.goal?.id)
    }
    func timeline(for configuration: SelectGoalIntent, in context: Context) async -> Timeline<GoalEntry> {
        // One snapshot, two entries: now and the next local midnight, so the
        // stale state flips on the minute (WidgetFreshness.swift).
        let snapshot = loadSnapshot()
        let entries = WidgetTimelineDates.rolloverDates(midnights: 1 + (snapshot?.days?.count ?? 0)).map {
            GoalEntry(date: $0, snapshot: snapshot, selectedGoalId: configuration.goal?.id)
        }
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        return Timeline(entries: entries, policy: .after(next))
    }
}

struct GoalWidgetView: View {
    var entry: GoalEntry
    @Environment(\.widgetFamily) var family

    // The configured goal; the first goal only when nothing is selected. A
    // selection that is no longer in the snapshot (completed, paused or
    // deleted: the payload lists active goals) says so rather than showing
    // an unrelated goal under the same configuration.
    private var selectedGoal: GoalData? {
        let goals = entry.snapshot?.allGoals ?? []
        guard let id = entry.selectedGoalId else { return goals.first }
        return goals.first(where: { $0.id == id })
    }
    private var configuredGoalIsGone: Bool {
        entry.selectedGoalId != nil && selectedGoal == nil && !(entry.snapshot?.allGoals ?? []).isEmpty
    }

    // Against the entry's date, not the clock (see ResolvedWidgetDay). Goals
    // are day-invariant, so a projected day changes only the label and the
    // due badge's reference day.
    private var day: ResolvedWidgetDay { .resolve(entry.snapshot, at: entry.date) }
    private var freshness: WidgetFreshness { day.freshness }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if day.isStale {
                StaleBanner(freshness: freshness, use24Hour: entry.snapshot?.use24Hour)
            } else if day.isProjected {
                PlannedBanner(day: day, use24Hour: entry.snapshot?.use24Hour)
            }
            Divider().padding(.vertical, 4)
            Group {
                if let goal = selectedGoal {
                    goalView(goal: goal)
                } else if configuredGoalIsGone {
                    Text("This goal may have been completed or deleted. Edit the widget to choose another.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.top, 4)
                } else {
                    Text("No active goals")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.top, 4)
                }
            }
            .staleDimmed(freshness)
        }
        .padding()
        .containerBackground(.background, for: .widget)
        // The goal on screen, in Goals & Projects (WidgetLink).
        .widgetURL(WidgetLink.goal(selectedGoal?.id))
    }

    private var header: some View {
        HStack {
            Text("GOAL")
                .font(.caption2).fontWeight(.bold)
                .foregroundColor(.secondary)
            Spacer()
            Text(day.dateLabel ?? "")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }

    private func goalView(goal: GoalData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(hex: goal.colorHex ?? "#3b82f6"))
                    .frame(width: 3, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(goal.title ?? "")
                            .font(.subheadline).fontWeight(.semibold)
                            .lineLimit(2)
                        Spacer()
                        // Computed at RENDER time against the entry's day from
                        // the goal's target date, so it is right on the pushed
                        // day and on a projected one; the push-time value is
                        // only a fallback for a goal with no target date
                        // string. Not shown at all on a stale snapshot.
                        if !freshness.isStale,
                           let days = ResolvedWidgetDay.daysUntil(goal.targetDate, from: entry.date) ?? goal.daysUntilDue {
                            WidgetDueBadge(days: days)
                        }
                    }
                    ProgressView(value: Double(goal.progressPct ?? 0) / 100.0)
                        .tint(progressColor(pct: goal.progressPct ?? 0))
                    Text("\(goal.progressPct ?? 0)% · \(goal.completedTasks ?? 0)/\(goal.totalTasks ?? 0) tasks")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            if let projects = goal.projects, !projects.isEmpty {
                Divider()
                let projectLimit = family == .systemLarge ? 5 : 3
                ForEach(projects.prefix(projectLimit), id: \.id) { proj in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(proj.title ?? "")
                                .font(.caption2)
                                .lineLimit(1)
                            Spacer()
                            if proj.status == "completed" || (proj.progressPct ?? 0) == 100 {
                                Text("✓").font(.caption2).foregroundColor(.green)
                            } else if proj.isOnHold {
                                Text("On hold")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            } else {
                                Text("\(proj.completedTasks ?? 0)/\(proj.totalTasks ?? 0)")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                        if family == .systemLarge {
                            ProgressView(value: Double(proj.progressPct ?? 0) / 100.0)
                                .tint(progressColor(pct: proj.progressPct ?? 0))
                        }
                    }
                }
                // Projects past the rows the family has room for.
                if projects.count > projectLimit {
                    Text("+\(projects.count - projectLimit) more")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    private func progressColor(pct: Int) -> Color {
        if pct >= 80 { return .green }
        if pct >= 40 { return .orange }
        return .red
    }
}

struct GoalWidget: Widget {
    let kind = "GoalWidget"
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: SelectGoalIntent.self, provider: GoalProvider()) { entry in
            GoalWidgetView(entry: entry)
        }
        .configurationDisplayName("Goal")
        .description("Progress on a goal. Long-press to choose which one.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

/// "3d left" / "Due today" / "2d overdue": the Goal widget's due badge, and
/// the Project widget's since a project has its own target date (#2160).
struct WidgetDueBadge: View {
    let days: Int

    var body: some View {
        let (label, color): (String, Color) = {
            // String(localized:), not a plain String: Text(String) shows
            // its argument verbatim and never looks it up.
            if days < 0 { return (String(localized: "\(abs(days))d overdue"), .red) }
            if days == 0 { return (String(localized: "Due today"), .orange) }
            return (String(localized: "\(days)d left"), .secondary)
        }()
        Text(label)
            .font(.caption2)
            .foregroundColor(color)
    }
}
