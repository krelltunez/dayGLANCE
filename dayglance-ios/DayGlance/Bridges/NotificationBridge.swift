import UserNotifications

/// UNUserNotificationCenter bridge for the DayGlanceNative JS interface.
///
/// JSON contract mirrors the Android NotificationBridge:
///   scheduleReminder(id, title, body, triggerAtMillis) → void
///   cancelReminder(id)                                 → void
///   showNotification(title, body)                      → void
///   showTaskNotification(reminderId, taskId, title, body, type, isCalendarEvent) → void
///   syncReminders(remindersJson)                        → void
///   getPendingAction()                                  → "" | {"action":"complete","taskId":"..."}
final class NotificationBridge {

    static let shared = NotificationBridge()

    private let center = UNUserNotificationCenter.current()

    // Notification category identifiers
    static let catSnoozeComplete = "DG_SNOOZE_COMPLETE"
    static let catSnoozeOnly     = "DG_SNOOZE_ONLY"
    static let catCompleteOnly   = "DG_COMPLETE_ONLY"

    // Action identifiers
    static let actionSnooze   = "DG_SNOOZE"
    static let actionComplete = "DG_COMPLETE"

    private let pendingActionKey   = "dayglance.pendingNotificationAction"
    private let syncedIdsKey       = "dayglance.syncedReminderIds"

    // MARK: - Setup

    /// Register Snooze / Mark Complete action categories. Call once at app start.
    func registerCategories() {
        let snooze   = UNNotificationAction(identifier: Self.actionSnooze,   title: "Snooze 15m",    options: [])
        let complete = UNNotificationAction(identifier: Self.actionComplete,  title: "Mark Complete", options: [])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.catSnoozeComplete, actions: [snooze, complete], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Self.catSnoozeOnly,     actions: [snooze],           intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Self.catCompleteOnly,   actions: [complete],          intentIdentifiers: [], options: []),
        ])
    }

    func requestAuthorization(completion: @escaping () -> Void) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in completion() }
    }

    // MARK: - scheduleReminder

    func scheduleReminder(id: String, title: String, body: String, triggerAtMillis: Double) {
        let triggerDate = Date(timeIntervalSince1970: triggerAtMillis / 1000.0)
        guard triggerDate > Date() else { return }

        let content = makeContent(title: title, body: body)
        content.userInfo = ["triggerAtMillis": triggerAtMillis]

        let comps   = reminderComponents(from: triggerDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }

    // MARK: - cancelReminder

    func cancelReminder(id: String) {
        center.removePendingNotificationRequests(withIdentifiers: [id])
    }

    // MARK: - showNotification

    func showNotification(title: String, body: String) {
        let content = makeContent(title: title, body: body)
        let id = "dg-immediate-\(Int(Date().timeIntervalSince1970 * 1000))"
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    // MARK: - showTaskNotification

    func showTaskNotification(
        reminderId: String,
        taskId: String,
        title: String,
        body: String,
        type: String,
        isCalendarEvent: Bool
    ) {
        let content = makeContent(title: title, body: body)
        content.categoryIdentifier = category(for: type, isCalendarEvent: isCalendarEvent)
        content.userInfo = [
            "taskId": taskId,
            "type": type,
            "isCalendarEvent": isCalendarEvent,
            "title": title,
            "body": body,
        ]
        // Use taskId as the identifier so back-to-back reminders for the same
        // task replace the previous one rather than stacking.
        center.add(UNNotificationRequest(identifier: "dg-task-\(taskId)", content: content, trigger: nil))
    }

    // MARK: - syncReminders

    func syncReminders(json: String) {
        guard let data = json.data(using: .utf8),
              let arr  = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }

        var newMap: [String: [String: Any]] = [:]
        for r in arr { if let id = r["id"] as? String { newMap[id] = r } }

        // IDs we scheduled on the previous sync call
        let prevIds = Set((UserDefaults.standard.array(forKey: syncedIdsKey) as? [String]) ?? [])

        // Fetch currently pending triggers so we can skip unchanged ones
        var pendingTriggerMs: [String: Double] = [:]
        let sem = DispatchSemaphore(value: 0)
        center.getPendingNotificationRequests { reqs in
            for req in reqs {
                if let ms = req.content.userInfo["triggerAtMillis"] as? Double {
                    pendingTriggerMs[req.identifier] = ms
                }
            }
            sem.signal()
        }
        sem.wait()

        // Cancel removed or changed reminders
        var toCancel: [String] = []
        for id in prevIds {
            guard let newR = newMap[id],
                  let newMs = (newR["triggerAtMillis"] as? NSNumber)?.doubleValue else {
                toCancel.append(id)
                continue
            }
            if let oldMs = pendingTriggerMs[id], abs(oldMs - newMs) > 999 {
                toCancel.append(id) // trigger time changed by more than 1 second
            }
        }
        center.removePendingNotificationRequests(withIdentifiers: toCancel)
        let cancelledSet = Set(toCancel)

        // Schedule new or changed reminders
        let stillPendingIds = prevIds.subtracting(cancelledSet)
        for (id, r) in newMap {
            if stillPendingIds.contains(id) { continue } // unchanged, already scheduled

            guard let millis   = (r["triggerAtMillis"] as? NSNumber)?.doubleValue,
                  let title    = r["title"] as? String,
                  let taskId   = r["taskId"] as? String,
                  let type     = r["type"] as? String else { continue }
            let body            = r["body"] as? String ?? ""
            let isCalendarEvent = (r["isCalendarEvent"] as? Bool) ?? false

            let triggerDate = Date(timeIntervalSince1970: millis / 1000.0)
            guard triggerDate > Date() else { continue }

            let content = makeContent(title: title, body: body)
            content.categoryIdentifier = category(for: type, isCalendarEvent: isCalendarEvent)
            content.userInfo = [
                "taskId": taskId,
                "type": type,
                "isCalendarEvent": isCalendarEvent,
                "title": title,
                "body": body,
                "triggerAtMillis": millis,
            ]

            let comps   = reminderComponents(from: triggerDate)
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        }

        UserDefaults.standard.set(Array(newMap.keys), forKey: syncedIdsKey)
    }

    // MARK: - getPendingAction

    func getPendingAction() -> String {
        let val = UserDefaults.standard.string(forKey: pendingActionKey) ?? ""
        if !val.isEmpty { UserDefaults.standard.removeObject(forKey: pendingActionKey) }
        return val
    }

    // MARK: - Action handling (called by AppDelegate)

    func handleNotificationAction(actionIdentifier: String, userInfo: [AnyHashable: Any]) {
        let taskId          = userInfo["taskId"] as? String ?? ""
        let type            = userInfo["type"] as? String ?? ""
        let isCalendarEvent = userInfo["isCalendarEvent"] as? Bool ?? false
        let title           = userInfo["title"] as? String ?? ""
        let body            = userInfo["body"] as? String ?? ""

        switch actionIdentifier {
        case Self.actionComplete:
            let json = #"{"action":"complete","taskId":"\#(jsonEscape(taskId))"}"#
            UserDefaults.standard.set(json, forKey: pendingActionKey)

        case Self.actionSnooze:
            let snoozeDate    = Date().addingTimeInterval(15 * 60)
            let content       = makeContent(title: title, body: body)
            content.userInfo  = ["taskId": taskId, "type": type, "isCalendarEvent": isCalendarEvent,
                                 "title": title, "body": body,
                                 "triggerAtMillis": snoozeDate.timeIntervalSince1970 * 1000]
            content.categoryIdentifier = category(for: type, isCalendarEvent: isCalendarEvent)

            let comps   = reminderComponents(from: snoozeDate)
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
            let snoozeId = "dg-snooze-\(taskId)-\(Int(snoozeDate.timeIntervalSince1970))"
            center.add(UNNotificationRequest(identifier: snoozeId, content: content, trigger: trigger))

        default:
            break
        }
    }

    // MARK: - Helpers

    private func makeContent(title: String, body: String) -> UNMutableNotificationContent {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body  = body
        c.sound = .default
        return c
    }

    private func reminderComponents(from date: Date) -> DateComponents {
        Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    }

    private func category(for type: String, isCalendarEvent: Bool) -> String {
        let hasSnooze   = type != "end"
        let hasComplete = (type == "start" || type == "end") && !isCalendarEvent
        switch (hasSnooze, hasComplete) {
        case (true,  true):  return Self.catSnoozeComplete
        case (true,  false): return Self.catSnoozeOnly
        case (false, true):  return Self.catCompleteOnly
        default:             return ""
        }
    }

    private func jsonEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
