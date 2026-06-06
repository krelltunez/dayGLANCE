import AppIntents
import WidgetKit

@available(iOS 17.0, *)
struct CompleteTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Complete Task"

    @Parameter(title: "Task ID")
    var taskId: String

    init() {}
    init(taskId: String) { self.taskId = taskId }

    func perform() async throws -> some IntentResult {
        // Write a pending action to App Group so the main app can pick it up.
        if let defaults = UserDefaults(suiteName: "group.com.dayglance.app") {
            defaults.set(["action": "completeTask", "taskId": taskId], forKey: "widgetPendingAction")
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

@available(iOS 17.0, *)
struct StartFocusIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Focus"

    func perform() async throws -> some IntentResult {
        if let defaults = UserDefaults(suiteName: "group.com.dayglance.app") {
            defaults.set(["action": "startFocus"], forKey: "widgetPendingAction")
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
