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
            return GoalEntity(id: id, title: g.title ?? "Untitled")
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
        let entry = GoalEntry(date: Date(), snapshot: loadSnapshot(), selectedGoalId: configuration.goal?.id)
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        return Timeline(entries: [entry], policy: .after(next))
    }
}

struct GoalWidgetView: View {
    var entry: GoalEntry
    @Environment(\.widgetFamily) var family

    // The configured goal, falling back to the first goal when nothing is
    // selected or the selection is no longer in the snapshot.
    private var selectedGoal: GoalData? {
        let goals = entry.snapshot?.allGoals ?? []
        if let id = entry.selectedGoalId, let match = goals.first(where: { $0.id == id }) {
            return match
        }
        return goals.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().padding(.vertical, 4)
            if let goal = selectedGoal {
                goalView(goal: goal)
            } else {
                Text("No active goals")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.top, 4)
            }
        }
        .padding()
        .containerBackground(.background, for: .widget)
    }

    private var header: some View {
        HStack {
            Text("GOAL")
                .font(.caption2).fontWeight(.bold)
                .foregroundColor(.secondary)
            Spacer()
            Text(entry.snapshot?.dateLabel ?? "")
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
                        if let days = goal.daysUntilDue {
                            dueBadge(days: days)
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
            }
        }
    }

    private func dueBadge(days: Int) -> some View {
        let (label, color): (String, Color) = {
            if days < 0 { return ("\(abs(days))d overdue", .red) }
            if days == 0 { return ("Due today", .orange) }
            return ("\(days)d left", .secondary)
        }()
        return Text(label)
            .font(.caption2)
            .foregroundColor(color)
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
