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
    // Resolving a saved choice looks at every project in the snapshot, so a
    // widget pinned to a project that has since been completed keeps it.
    func entities(for identifiers: [String]) async throws -> [ProjectEntity] {
        allEntities(includeCompleted: true).filter { identifiers.contains($0.id) }
    }
    // The picker offers the open ones only: the snapshot lists the projects
    // the app shows (widgetGoalsProjects.js), and a completed project is
    // reopened in the app before it is pinned again.
    func suggestedEntities() async throws -> [ProjectEntity] { allEntities(includeCompleted: false) }

    private func allEntities(includeCompleted: Bool) -> [ProjectEntity] {
        (loadSnapshot()?.allProjects ?? []).compactMap { p in
            guard let id = p.id, includeCompleted || p.status != "completed" else { return nil }
            return ProjectEntity(id: id, title: p.title ?? String(localized: "Untitled"), goalTitle: p.goalTitle)
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
        // One snapshot, two entries: now and the next local midnight, so the
        // stale state flips on the minute (WidgetFreshness.swift).
        let snapshot = loadSnapshot()
        let entries = WidgetTimelineDates.rolloverDates(midnights: 1 + (snapshot?.days?.count ?? 0)).map {
            ProjectEntry(date: $0, snapshot: snapshot, selectedProjectId: configuration.project?.id)
        }
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        return Timeline(entries: entries, policy: .after(next))
    }
}

struct ProjectWidgetView: View {
    var entry: ProjectEntry
    @Environment(\.widgetFamily) var family

    // The configured project; the first active (non-completed, non-archived)
    // one only when nothing is selected. A selection no longer in the
    // snapshot (archived or deleted) says so rather than showing an
    // unrelated project under the same configuration.
    private var selectedProject: ProjectData? {
        let projects = entry.snapshot?.allProjects ?? []
        guard let id = entry.selectedProjectId else {
            return projects.first(where: { $0.status != "completed" && $0.status != "archived" && !$0.isOnHold })
                ?? projects.first(where: { $0.status != "completed" && $0.status != "archived" })
                ?? projects.first
        }
        return projects.first(where: { $0.id == id })
    }
    private var configuredProjectIsGone: Bool {
        entry.selectedProjectId != nil && selectedProject == nil && !(entry.snapshot?.allProjects ?? []).isEmpty
    }

    // Against the entry's date, not the clock (see ResolvedWidgetDay).
    // Projects are day-invariant, so a projected day changes only the label.
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
                if let proj = selectedProject {
                    projectView(proj: proj)
                } else if configuredProjectIsGone {
                    Text("This project may have been archived or deleted. Edit the widget to choose another.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.top, 4)
                } else {
                    Text("No active projects")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.top, 4)
                }
            }
            .staleDimmed(freshness)
        }
        .padding()
        .containerBackground(.background, for: .widget)
        // The project on screen, its card in view (WidgetLink).
        .widgetURL(WidgetLink.project(selectedProject?.id))
    }

    private var header: some View {
        HStack {
            Text("PROJECT")
                .font(.caption2).fontWeight(.bold)
                .foregroundColor(.secondary)
            Spacer()
            Text(day.dateLabel ?? "")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }

    private func projectView(proj: ProjectData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 2)
                    // The project's colour, else its goal's; an empty string
                    // (a standalone project's goal colour) is missing, not
                    // Color(hex: "")'s white.
                    .fill(Color(hex: [proj.colorHex, proj.goalColorHex].compactMap { $0 }.first { !$0.isEmpty } ?? "#3b82f6"))
                    .frame(width: 3, height: 36)
                VStack(alignment: .leading, spacing: 2) {
                    if let goalTitle = proj.goalTitle, !goalTitle.isEmpty {
                        Text(goalTitle)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    HStack {
                        Text(proj.title ?? "")
                            .font(.subheadline).fontWeight(.semibold)
                            .lineLimit(1)
                        Spacer()
                        // The project's own target date (#2160), as the
                        // Goal widget shows a goal's (ProjectData.dueDays).
                        // A project on hold says so in its place.
                        if proj.isOnHold {
                            Text("On hold")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        } else if let days = proj.dueDays(from: entry.date, isStale: freshness.isStale) {
                            WidgetDueBadge(days: days)
                        }
                    }
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
                // Against the project's total: the payload carries only the
                // first few tasks (widgetGoalsProjects.js), so its length
                // would hide how many more there are.
                let overflow = max(proj.totalTasks ?? tasks.count, tasks.count) - visible.count
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
