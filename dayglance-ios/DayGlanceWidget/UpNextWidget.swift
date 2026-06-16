import WidgetKit
import SwiftUI

struct UpNextEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct UpNextProvider: TimelineProvider {
    func placeholder(in context: Context) -> UpNextEntry {
        UpNextEntry(date: Date(), snapshot: nil)
    }
    func getSnapshot(in context: Context, completion: @escaping (UpNextEntry) -> Void) {
        completion(UpNextEntry(date: Date(), snapshot: loadSnapshot()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<UpNextEntry>) -> Void) {
        let entry = UpNextEntry(date: Date(), snapshot: loadSnapshot())
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct UpNextWidgetView: View {
    var entry: UpNextEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        if let task = entry.snapshot?.nextTask {
            taskView(task: task)
        } else {
            emptyView
        }
    }

    private var emptyView: some View {
        VStack(alignment: .leading, spacing: 4) {
            header
            Spacer()
            Text("Nothing scheduled")
                .font(.caption)
                .foregroundColor(.secondary)
            Spacer()
        }
        .padding()
        .containerBackground(.background, for: .widget)
    }

    private func taskView(task: NextTaskData) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().padding(.vertical, 3)
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(hex: task.colorHex ?? "#3b82f6"))
                    .frame(width: 3)
                    .padding(.vertical, 2)
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(task.title ?? "")
                            .font(.subheadline).fontWeight(.semibold)
                            .lineLimit(family == .systemLarge ? 3 : 2)
                        Spacer()
                        if let time = timeLabel(startTime: task.startTime, duration: task.duration) {
                            Text(time)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                    if let proj = task.projectName, !proj.isEmpty {
                        Text(proj)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    if let tags = task.tags, !tags.isEmpty {
                        Text(tags.map { "#\($0)" }.joined(separator: " "))
                            .font(.caption2)
                            .italic()
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    // Notes only on the large family, where there's room.
                    if family == .systemLarge, let notes = task.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(3)
                            .padding(.top, 2)
                    }
                    // iOS 17+ interactive buttons
                    if #available(iOS 17.0, *) {
                        HStack(spacing: 8) {
                            Button(intent: CompleteTaskIntent(taskId: task.id ?? "")) {
                                Label("Done", systemImage: "checkmark.circle")
                                    .font(.caption2)
                            }
                            .buttonStyle(.bordered)
                            Button(intent: StartFocusIntent()) {
                                Label("Focus", systemImage: "play.circle")
                                    .font(.caption2)
                            }
                            .buttonStyle(.bordered)
                        }
                        .padding(.top, 1)
                    }
                }
            }
            if let subtasks = task.subtasks, !subtasks.isEmpty {
                Divider().padding(.vertical, 3)
                ForEach(subtasks.prefix(family == .systemLarge ? 7 : 4), id: \.title) { sub in
                    HStack(spacing: 6) {
                        Image(systemName: sub.completed ? "checkmark.circle.fill" : "circle")
                            .font(.caption2)
                            .foregroundColor(sub.completed ? .green : .secondary)
                        Text(sub.title)
                            .font(.caption2)
                            .foregroundColor(sub.completed ? .secondary : .primary)
                            .lineLimit(1)
                    }
                }
            } else if !showsNotes(task), let upcoming = entry.snapshot?.upcomingTasks, !upcoming.isEmpty {
                // The primary task is simple, so fill the leftover space with the
                // next upcoming tasks (title + time only — no action buttons).
                Divider().padding(.vertical, 3)
                ForEach(upcoming.prefix(family == .systemLarge ? 4 : 2), id: \.id) { up in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color(hex: up.colorHex ?? "#3b82f6"))
                            .frame(width: 3, height: 14)
                        Text(up.title ?? "")
                            .font(.caption2)
                            .lineLimit(1)
                        Spacer()
                        if let time = timeLabel(startTime: up.startTime, duration: up.duration) {
                            Text(time)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
        }
        .padding()
        .containerBackground(.background, for: .widget)
    }

    // Notes are only rendered on the Large family, and only when present.
    private func showsNotes(_ task: NextTaskData) -> Bool {
        family == .systemLarge && !(task.notes?.isEmpty ?? true)
    }

    private var header: some View {
        HStack {
            Text("UP NEXT")
                .font(.caption2).fontWeight(.bold)
                .foregroundColor(.secondary)
            Spacer()
            Text(entry.snapshot?.dateLabel ?? "")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }

    // Start time plus duration, e.g. "9:00AM · 30m". Falls back to just the
    // start time when no duration is set.
    private func timeLabel(startTime: String?, duration: Int?) -> String? {
        guard let time = formattedTime(startTime) else { return nil }
        if let d = duration, d > 0 { return "\(time) · \(formattedDuration(d))" }
        return time
    }

    private func formattedDuration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes)m" }
        let h = minutes / 60, m = minutes % 60
        return m == 0 ? "\(h)h" : "\(h)h\(m)m"
    }

    private func formattedTime(_ startTime: String?) -> String? {
        guard let st = startTime, !st.isEmpty else { return nil }
        let use24 = entry.snapshot?.use24Hour ?? false
        let parts = st.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return st }
        let h = parts[0], m = parts[1]
        if use24 { return String(format: "%02d:%02d", h, m) }
        let period = h < 12 ? "AM" : "PM"
        let h12 = h == 0 ? 12 : (h > 12 ? h - 12 : h)
        return m == 0 ? "\(h12)\(period)" : "\(h12):\(String(format: "%02d", m))\(period)"
    }
}

struct UpNextWidget: Widget {
    let kind = "UpNextWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UpNextProvider()) { entry in
            UpNextWidgetView(entry: entry)
        }
        .configurationDisplayName("Up Next")
        .description("Your next scheduled task.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
