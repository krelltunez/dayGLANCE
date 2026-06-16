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

    @ViewBuilder
    private func taskView(task: NextTaskData) -> some View {
        let subtaskLimit = family == .systemLarge ? 8 : 3
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().padding(.vertical, 4)
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
                        if let time = formattedTime(task) {
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
                    if family == .systemLarge, let notes = task.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(3)
                            .padding(.top, 2)
                    }
                    if #available(iOS 17.0, *), family != .systemSmall {
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
                        .padding(.top, 2)
                    }
                }
            }
            if family != .systemSmall, let subtasks = task.subtasks, !subtasks.isEmpty {
                Divider().padding(.vertical, 4)
                ForEach(subtasks.prefix(subtaskLimit), id: \.title) { sub in
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
            }
        }
        .padding()
        .containerBackground(.background, for: .widget)
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

    private func formattedTime(_ task: NextTaskData) -> String? {
        guard let st = task.startTime, !st.isEmpty else { return nil }
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
