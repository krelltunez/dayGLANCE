import Foundation

// Shared App Group suite name — must match entitlements and WidgetBridge.swift
let kAppGroupSuite = "group.com.dayglance.app"
let kSnapshotKey   = "widgetSnapshot"

struct WidgetSnapshot: Codable {
    var date: String?
    var dateLabel: String?
    var use24Hour: Bool?
    var nextTask: NextTaskData?
    var upcomingTasks: [UpcomingTaskData]?
    var allGoals: [GoalData]?
    var allProjects: [ProjectData]?
    var updatedAt: Double?
}

// Lightweight task used to fill leftover space in the Up Next widget when the
// primary task has no subtasks/notes of its own.
struct UpcomingTaskData: Codable {
    var id: String?
    var title: String?
    var colorHex: String?
    var startTime: String?
    var duration: Int?
}

struct NextTaskData: Codable {
    var id: String?
    var title: String?
    var colorHex: String?
    var startTime: String?
    var duration: Int?
    var tags: [String]?
    var notes: String?
    var subtasks: [SubtaskData]?
    var projectName: String?
}

struct SubtaskData: Codable {
    var title: String
    var completed: Bool
}

struct GoalData: Codable {
    var id: String?
    var title: String?
    var colorHex: String?
    var targetDate: String?
    var daysUntilDue: Int?
    var progressPct: Int?
    var totalTasks: Int?
    var completedTasks: Int?
    var projects: [ProjectSummary]?
}

struct ProjectSummary: Codable {
    var id: String?
    var title: String?
    var status: String?
    var progressPct: Int?
    var totalTasks: Int?
    var completedTasks: Int?
}

struct ProjectData: Codable {
    var id: String?
    var title: String?
    var status: String?
    var goalId: String?
    var goalTitle: String?
    var goalColorHex: String?
    var progressPct: Int?
    var totalTasks: Int?
    var completedTasks: Int?
    var tasks: [TaskSummary]?
}

struct TaskSummary: Codable {
    var id: String?
    var title: String?
    var completed: Bool?
}

// Read the latest snapshot from the App Group UserDefaults.
// Returns nil if no snapshot has been written yet.
func loadSnapshot() -> WidgetSnapshot? {
    guard let defaults = UserDefaults(suiteName: kAppGroupSuite),
          let data = defaults.data(forKey: kSnapshotKey) else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
}
