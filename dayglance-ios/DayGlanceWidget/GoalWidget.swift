import WidgetKit
import SwiftUI

struct GoalEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct GoalProvider: TimelineProvider {
    func placeholder(in context: Context) -> GoalEntry { GoalEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (GoalEntry) -> Void) {
        completion(GoalEntry(date: Date(), snapshot: loadSnapshot()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<GoalEntry>) -> Void) {
        let entry = GoalEntry(date: Date(), snapshot: loadSnapshot())
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct GoalWidgetView: View {
    var entry: GoalEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().padding(.vertical, 4)
            if let goals = entry.snapshot?.allGoals, let goal = goals.first {
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
                ForEach(projects.prefix(3), id: \.id) { proj in
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
        StaticConfiguration(kind: kind, provider: GoalProvider()) { entry in
            GoalWidgetView(entry: entry)
        }
        .configurationDisplayName("Goal")
        .description("Progress on your active goal.")
        .supportedFamilies([.systemMedium])
    }
}
