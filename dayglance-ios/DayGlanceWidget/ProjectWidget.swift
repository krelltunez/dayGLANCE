import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Configuration

/// A project the user can pick in the widget editor (long-press → Edit Widget).
struct ProjectEntity: AppEntity {
    let id: String
    let title: String
    let goalTitle: String?

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Project" }
    static var defaultQuery = ProjectEntityQuery()

    var displayRepresentation: DisplayRepresentation {
        if let goalTitle, !goalTitle.isEmpty {
            return DisplayRepresentation(title: "\(title)", subtitle: "\(goalTitle)")
        }
        return DisplayRepresentation(title: "\(title)")
    }
}

/// Supplies the project list (from the latest snapshot) to the widget editor and
/// resolves a previously-selected project by id.
struct ProjectEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ProjectEntity] {
        allEntities().filter { identifiers.contains($0.id) }
    }
    func suggestedEntities() async throws -> [ProjectEntity] { allEntities() }

    private func allEntities() -> [ProjectEntity] {
        (loadSnapshot()?.allProjects ?? []).compactMap { p in
            guard let id = p.id else { return nil }
            return ProjectEntity(id: id, title: p.title ?? "Untitled", goalTitle: p.goalTitle)
        }
    }
}

/// Per-widget configuration: which project to show. nil = first active project
/// (the prior behavior), so widgets placed before this change keep working.
struct SelectProjectIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Select Project"
    static var description = IntentDescription("Choose which project this widget displays.")

    @Parameter(title: "Project")
    var project: ProjectEntity?
}

// MARK: - Timeline

struct ProjectEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let selectedProjectId: String?
}

struct ProjectProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ProjectEntry {
        ProjectEntry(date: Date(), snapshot: nil, selectedProjectId: nil)
    }
    func snapshot(for configuration: SelectProjectIntent, in context: Context) async -> ProjectEntry {
        ProjectEntry(date: Date(), snapshot: loadSnapshot(), selectedProjectId: configuration.project?.id)
    }
    func timeline(for configuration: SelectProjectIntent, in context: Context) async -> Timeline<ProjectEntry> {
        let entry = ProjectEntry(date: Date(), snapshot: loadSnapshot(), selectedProjectId: configuration.project?.id)
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        return Timeline(entries: [entry], policy: .after(next))
    }
}

struct ProjectWidgetView: View {
    var entry: ProjectEntry
    @Environment(\.widgetFamily) var family

    // The configured project, falling back to the first active (non-completed,
    // non-archived) project when nothing is selected or the selection is gone.
    private var selectedProject: ProjectData? {
        let projects = entry.snapshot?.allProjects ?? []
        if let id = entry.selectedProjectId, let match = projects.first(where: { $0.id == id }) {
            return match
        }
        return projects.first(where: { $0.status != "completed" && $0.status != "archived" }) ?? projects.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().padding(.vertical, 4)
            if let proj = selectedProject {
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
        HStack {
            Text("PROJECT")
                .font(.caption2).fontWeight(.bold)
                .foregroundColor(.secondary)
            Spacer()
            Text(entry.snapshot?.dateLabel ?? "")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
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
                            .strikethrough(t.completed ?? false)
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
        AppIntentConfiguration(kind: kind, intent: SelectProjectIntent.self, provider: ProjectProvider()) { entry in
            ProjectWidgetView(entry: entry)
        }
        .configurationDisplayName("Project")
        .description("Progress on a project. Long-press to choose which one.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
