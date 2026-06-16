import WidgetKit
import SwiftUI

struct ProjectEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct ProjectProvider: TimelineProvider {
    func placeholder(in context: Context) -> ProjectEntry { ProjectEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (ProjectEntry) -> Void) {
        completion(ProjectEntry(date: Date(), snapshot: loadSnapshot()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ProjectEntry>) -> Void) {
        let entry = ProjectEntry(date: Date(), snapshot: loadSnapshot())
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct ProjectWidgetView: View {
    var entry: ProjectEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().padding(.vertical, 4)
            if let projects = entry.snapshot?.allProjects,
               let proj = projects.first(where: { $0.status != "completed" && $0.status != "archived" }) ?? projects.first {
                projectView(proj: proj)
            } else {
                Text("No active projects")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.top, 4)
            }
        }
        .padding()
        .containerBackground(.background, for: .widget)
    }

    private var header: some View {
        Text("PROJECT")
            .font(.caption2).fontWeight(.bold)
            .foregroundColor(.secondary)
    }

    private func projectView(proj: ProjectData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(hex: proj.goalColorHex ?? "#3b82f6"))
                    .frame(width: 3, height: 36)
                VStack(alignment: .leading, spacing: 2) {
                    if let goalTitle = proj.goalTitle, !goalTitle.isEmpty {
                        Text(goalTitle)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    Text(proj.title ?? "")
                        .font(.subheadline).fontWeight(.semibold)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        ProgressView(value: Double(proj.progressPct ?? 0) / 100.0)
                            .tint(progressColor(pct: proj.progressPct ?? 0))
                        Text("\(proj.completedTasks ?? 0)/\(proj.totalTasks ?? 0)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }
            if let tasks = proj.tasks, !tasks.isEmpty {
                Divider()
                let incomplete = tasks.filter { !($0.completed ?? false) }
                let complete = tasks.filter { $0.completed ?? false }
                let visible = Array((incomplete + complete).prefix(family == .systemLarge ? 8 : 4))
                ForEach(visible, id: \.id) { t in
                    HStack(spacing: 6) {
                        Image(systemName: (t.completed ?? false) ? "checkmark.circle.fill" : "circle")
                            .font(.caption2)
                            .foregroundColor((t.completed ?? false) ? .green : .secondary)
                        Text(t.title ?? "")
                            .font(.caption2)
                            .foregroundColor((t.completed ?? false) ? .secondary : .primary)
                            .lineLimit(1)
                    }
                }
                let overflow = tasks.count - visible.count
                if overflow > 0 {
                    Text("+\(overflow) more")
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

struct ProjectWidget: Widget {
    let kind = "ProjectWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ProjectProvider()) { entry in
            ProjectWidgetView(entry: entry)
        }
        .configurationDisplayName("Project")
        .description("Progress on your active project.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
