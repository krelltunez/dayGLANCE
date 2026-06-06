import EventKit

/// EventKit bridge for the DayGlanceNative JS interface.
///
/// All query methods block synchronously via DispatchSemaphore (same pattern as
/// HealthBridge). EKEventStore callbacks fire on a background queue so waiting
/// here does not deadlock.
///
/// JSON contract mirrors the Android calendar bridge exactly:
///   getCalendars()        → [{id, name, accountName, color}]
///   getEvents(date)       → [{id, title, start, end, allDay, notes, location, calendarId, calendarName, color}]
///   createEvent(eventJson)→ {success, id?, error?}
///   updateEvent(eventJson)→ {success, error?}
///   deleteEvent(eventId)  → {success}
final class CalendarBridge {

    static let shared = CalendarBridge()

    private let store = EKEventStore()

    // MARK: - Authorization

    func requestAuthorization(completion: @escaping () -> Void) {
        if #available(iOS 17.0, *) {
            store.requestFullAccessToEvents { _, _ in completion() }
        } else {
            store.requestAccess(to: .event) { _, _ in completion() }
        }
    }

    private var isAuthorized: Bool {
        if #available(iOS 17.0, *) {
            return EKEventStore.authorizationStatus(for: .event) == .fullAccess
        } else {
            return EKEventStore.authorizationStatus(for: .event) == .authorized
        }
    }

    // MARK: - getAuthStatus (debug helper)
    // Returns the raw EKAuthorizationStatus string so JS can diagnose permission issues.

    func getAuthStatus() -> String {
        let status: String
        if #available(iOS 17.0, *) {
            switch EKEventStore.authorizationStatus(for: .event) {
            case .notDetermined: status = "notDetermined"
            case .restricted:    status = "restricted"
            case .denied:        status = "denied"
            case .fullAccess:    status = "fullAccess"
            case .writeOnly:     status = "writeOnly"
            @unknown default:    status = "unknown"
            }
        } else {
            switch EKEventStore.authorizationStatus(for: .event) {
            case .notDetermined: status = "notDetermined"
            case .restricted:    status = "restricted"
            case .denied:        status = "denied"
            case .authorized:    status = "authorized"
            @unknown default:    status = "unknown"
            }
        }
        return #"{"status":"\#(status)"}"#
    }

    // MARK: - getCalendars
    // Returns: [{"id":"...","name":"...","accountName":"...","color":"#rrggbb"}]

    func getCalendars() -> String {
        guard isAuthorized else { return "[]" }
        let calendars = store.calendars(for: .event)
        let items = calendars.map { cal -> String in
            let id          = jsonEscape(cal.calendarIdentifier)
            let name        = jsonEscape(cal.title)
            let accountName = jsonEscape(cal.source?.title ?? "")
            let color       = hexColor(cal.cgColor)
            return #"{"id":"\#(id)","name":"\#(name)","accountName":"\#(accountName)","color":"\#(color)"}"#
        }
        return "[\(items.joined(separator: ","))]"
    }

    // MARK: - getEvents
    // Returns events whose start or end falls within the calendar day of `date`.
    // All-day events whose span includes `date` are also included.

    func getEvents(date: String) -> String {
        guard isAuthorized, let day = parseDate(date) else { return "[]" }

        let calendar = Calendar.current
        let start = calendar.startOfDay(for: day)
        let end   = calendar.date(byAdding: .day, value: 1, to: start)!

        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = store.events(matching: predicate)
        if events.isEmpty { return "[]" }

        let items = events.map { eventToJSON($0) }
        return "[\(items.joined(separator: ","))]"
    }

    // MARK: - createEvent
    // Accepts the same JSON shape as getEvents returns.
    // Returns: {"success":true,"id":"..."} or {"success":false,"error":"..."}

    func createEvent(json eventJSON: String) -> String {
        guard isAuthorized else { return #"{"success":false,"error":"not authorized"}"# }
        guard let dict = parseJSONObject(eventJSON) else {
            return #"{"success":false,"error":"invalid json"}"#
        }

        let event = EKEvent(eventStore: store)
        guard fill(event: event, from: dict) else {
            return #"{"success":false,"error":"missing required fields"}"#
        }

        do {
            try store.save(event, span: .thisEvent, commit: true)
            let id = jsonEscape(event.eventIdentifier ?? "")
            return #"{"success":true,"id":"\#(id)"}"#
        } catch {
            return #"{"success":false,"error":"\#(jsonEscape(error.localizedDescription))"}"#
        }
    }

    // MARK: - updateEvent

    func updateEvent(json eventJSON: String) -> String {
        guard isAuthorized else { return #"{"success":false,"error":"not authorized"}"# }
        guard let dict = parseJSONObject(eventJSON),
              let eventId = dict["id"] as? String else {
            return #"{"success":false,"error":"invalid json or missing id"}"#
        }

        guard let event = store.event(withIdentifier: eventId) else {
            return #"{"success":false,"error":"event not found"}"#
        }

        guard fill(event: event, from: dict) else {
            return #"{"success":false,"error":"missing required fields"}"#
        }

        do {
            try store.save(event, span: .thisEvent, commit: true)
            return #"{"success":true}"#
        } catch {
            return #"{"success":false,"error":"\#(jsonEscape(error.localizedDescription))"}"#
        }
    }

    // MARK: - deleteEvent

    func deleteEvent(eventId: String) -> String {
        guard isAuthorized else { return #"{"success":false}"# }
        guard let event = store.event(withIdentifier: eventId) else {
            return #"{"success":false}"#
        }
        do {
            try store.remove(event, span: .thisEvent, commit: true)
            return #"{"success":true}"#
        } catch {
            return #"{"success":false}"#
        }
    }

    // MARK: - Helpers

    private func fill(event: EKEvent, from dict: [String: Any]) -> Bool {
        guard let title = dict["title"] as? String,
              let startStr = dict["start"] as? String else { return false }

        event.title = title

        let allDay = dict["allDay"] as? Bool ?? false
        event.isAllDay = allDay

        if allDay {
            guard let startDay = parseDate(startStr) else { return false }
            event.startDate = Calendar.current.startOfDay(for: startDay)
            if let endStr = dict["end"] as? String, let endDay = parseDate(endStr) {
                event.endDate = Calendar.current.startOfDay(for: endDay)
            } else {
                event.endDate = event.startDate
            }
        } else {
            guard let startDate = parseDateTime(startStr) else { return false }
            event.startDate = startDate
            if let endStr = dict["end"] as? String, let endDate = parseDateTime(endStr) {
                event.endDate = endDate
            } else {
                event.endDate = startDate.addingTimeInterval(3600)
            }
        }

        if let notes = dict["notes"] as? String { event.notes = notes }
        if let location = dict["location"] as? String { event.location = location }

        if let calId = dict["calendarId"] as? String,
           let cal = store.calendar(withIdentifier: calId) {
            event.calendar = cal
        } else {
            event.calendar = store.defaultCalendarForNewEvents
        }

        return true
    }

    private func eventToJSON(_ event: EKEvent) -> String {
        let id           = jsonEscape(event.eventIdentifier ?? "")
        let title        = jsonEscape(event.title ?? "")
        let allDay       = event.isAllDay
        let start        = allDay ? formatDate(event.startDate) : formatDateTime(event.startDate)
        let end          = allDay ? formatDate(event.endDate)   : formatDateTime(event.endDate)
        let notes        = jsonEscape(event.notes ?? "")
        let location     = jsonEscape(event.location ?? "")
        let calendarId   = jsonEscape(event.calendar?.calendarIdentifier ?? "")
        let calendarName = jsonEscape(event.calendar?.title ?? "")
        let color        = hexColor(event.calendar?.cgColor)
        return """
        {"id":"\(id)","title":"\(title)","start":"\(start)","end":"\(end)",\
        "allDay":\(allDay),"notes":"\(notes)","location":"\(location)",\
        "calendarId":"\(calendarId)","calendarName":"\(calendarName)","color":"\(color)"}
        """
    }

    private func parseDate(_ string: String) -> Date? {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale   = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        return f.date(from: string)
    }

    private func parseDateTime(_ string: String) -> Date? {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f.locale   = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        return f.date(from: string)
    }

    private func formatDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale   = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        return f.string(from: date)
    }

    private func formatDateTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f.locale   = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        return f.string(from: date)
    }

    private func hexColor(_ cgColor: CGColor?) -> String {
        guard let cgColor,
              let comps = cgColor.components, comps.count >= 3 else { return "#000000" }
        let r = Int(comps[0] * 255)
        let g = Int(comps[1] * 255)
        let b = Int(comps[2] * 255)
        return String(format: "#%02x%02x%02x", r, g, b)
    }

    private func jsonEscape(_ string: String) -> String {
        string
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\t", with: "\\t")
    }

    private func parseJSONObject(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8),
              let obj  = try? JSONSerialization.jsonObject(with: data),
              let dict = obj as? [String: Any] else { return nil }
        return dict
    }

    // MARK: - Reminders (Phase 11)

    func getReminders() -> String {
        let predicate = store.predicateForReminders(in: nil)
        var result = "[]"
        let sem = DispatchSemaphore(value: 0)
        store.fetchReminders(matching: predicate) { reminders in
            let incomplete = (reminders ?? []).filter { !$0.isCompleted }
            let items = incomplete.compactMap { r -> [String: Any]? in
                guard let title = r.title else { return nil }
                return ["id": r.calendarItemIdentifier, "title": title, "notes": r.notes ?? ""]
            }
            result = (try? String(data: JSONSerialization.data(withJSONObject: items), encoding: .utf8)) ?? "[]"
            sem.signal()
        }
        sem.wait()
        return result
    }
}
