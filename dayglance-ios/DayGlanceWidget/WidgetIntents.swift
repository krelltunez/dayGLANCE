import AppIntents
import WidgetKit

// iOS 18.4 introduced stricter sandboxing for AppIntents running in the widget
// process when the main app is not alive. ForegroundContinuableIntent routes the
// intent through the main app process, avoiding entitlement errors.
@available(iOS 17.0, *)
@available(iOSApplicationExtension, unavailable)
extension CompleteTaskIntent: ForegroundContinuableIntent {}

@available(iOS 17.0, *)
@available(iOSApplicationExtension, unavailable)
extension StartFocusIntent: ForegroundContinuableIntent {}

@available(iOS 17.0, *)
struct CompleteTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Complete Task"
    // Task data lives in the web layer, so the app must be foregrounded to apply
    // the action; the web layer drains it via getWidgetPendingAction on resume.
    static var openAppWhenRun: Bool = true

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
    // Opens Focus mode in the app; foreground so the web layer can act on it.
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        if let defaults = UserDefaults(suiteName: "group.com.dayglance.app") {
            defaults.set(["action": "startFocus"], forKey: "widgetPendingAction")
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
