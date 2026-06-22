import Foundation
import EventKit

// dayglance-calendar-helper
//
// A tiny read-only EventKit CLI spawned by the Electron main process to give the
// macOS desktop build access to the system Calendar. It emits JSON on stdout in
// the exact same shape as the iOS/Android DayGlanceNative bridge so the renderer's
// nativeEventToTask mapping is unchanged.
//
// Subcommands:
//   request-access            → {"granted":bool}
//   auth-status               → {"status":"notDetermined|denied|fullAccess|..."}
//   calendars                 → [{id,name,accountName,color}]
//   events --start YYYY-MM-DD --end YYYY-MM-DD
//                             → {"YYYY-MM-DD":[event,...], ...} (one bucket per day,
//                                inclusive of start/end; each event overlaps that day)
//
// Event JSON: {id,title,start,end,allDay,notes,location,calendarId,calendarName,color}
// (start/end are "yyyy-MM-dd" for all-day events, "yyyy-MM-dd'T'HH:mm:ss" otherwise.)

let store = EKEventStore()

// MARK: - Authorization

func isAuthorized() -> Bool {
    if #available(macOS 14.0, *) {
        return EKEventStore.authorizationStatus(for: .event) == .fullAccess
    } else {
        return EKEventStore.authorizationStatus(for: .event) == .authorized
    }
}

// Requests access synchronously (the only EventKit call that is async). Event
// queries are synchronous once authorized. Returns true when events can be read.
func ensureAccess() -> Bool {
    if isAuthorized() { return true }
    let sem = DispatchSemaphore(value: 0)
    var granted = false
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { ok, _ in granted = ok; sem.signal() }
    } else {
        store.requestAccess(to: .event) { ok, _ in granted = ok; sem.signal() }
    }
    sem.wait()
    return granted || isAuthorized()
}

func authStatusString() -> String {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted:    return "restricted"
        case .denied:        return "denied"
        case .fullAccess:    return "fullAccess"
        case .writeOnly:     return "writeOnly"
        @unknown default:    return "unknown"
        }
    } else {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted:    return "restricted"
        case .denied:        return "denied"
        case .authorized:    return "authorized"
        @unknown default:    return "unknown"
        }
    }
}

// MARK: - Formatting helpers

func makeFormatter(_ format: String) -> DateFormatter {
    let f = DateFormatter()
    f.dateFormat = format
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = .current
    return f
}

let isoDate = makeFormatter("yyyy-MM-dd")
let isoDateTime = makeFormatter("yyyy-MM-dd'T'HH:mm:ss")

func hexColor(_ cgColor: CGColor?) -> String {
    guard let cg = cgColor, let comps = cg.components, comps.count >= 3 else { return "#000000" }
    let clamp = { (v: CGFloat) -> Int in max(0, min(255, Int(v * 255))) }
    return String(format: "#%02x%02x%02x", clamp(comps[0]), clamp(comps[1]), clamp(comps[2]))
}

func printJSON(_ obj: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    } else {
        print("null")
    }
}

func eventDict(_ e: EKEvent) -> [String: Any] {
    let allDay = e.isAllDay
    return [
        "id": e.eventIdentifier ?? "",
        "title": e.title ?? "",
        "start": allDay ? isoDate.string(from: e.startDate) : isoDateTime.string(from: e.startDate),
        "end": allDay ? isoDate.string(from: e.endDate) : isoDateTime.string(from: e.endDate),
        "allDay": allDay,
        "notes": e.notes ?? "",
        "location": e.location ?? "",
        "calendarId": e.calendar?.calendarIdentifier ?? "",
        "calendarName": e.calendar?.title ?? "",
        "color": hexColor(e.calendar?.cgColor),
    ]
}

// MARK: - Argument parsing

func optionValue(_ name: String, in args: [String]) -> String? {
    guard let idx = args.firstIndex(of: name), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

// MARK: - Main

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
    printJSON(["error": "no command"])
    exit(1)
}

switch command {
case "request-access":
    printJSON(["granted": ensureAccess()])

case "auth-status":
    printJSON(["status": authStatusString()])

case "calendars":
    guard ensureAccess() else { printJSON([] as [Any]); break }
    let cals = store.calendars(for: .event).map { cal -> [String: Any] in
        [
            "id": cal.calendarIdentifier,
            "name": cal.title,
            "accountName": cal.source?.title ?? "",
            "color": hexColor(cal.cgColor),
        ]
    }
    printJSON(cals)

case "events":
    guard let startStr = optionValue("--start", in: args),
          let endStr = optionValue("--end", in: args),
          let startDay = isoDate.date(from: startStr),
          let endDay = isoDate.date(from: endStr) else {
        printJSON([String: Any]())
        break
    }
    guard ensureAccess() else { printJSON([String: Any]()); break }

    let calendar = Calendar.current
    var result: [String: [[String: Any]]] = [:]
    var dayStart = calendar.startOfDay(for: startDay)
    let lastDayStart = calendar.startOfDay(for: endDay)

    // One overlap predicate per day so multi-day all-day events appear under every
    // day they span — mirroring the mobile bridge's per-day getEvents(date).
    while dayStart <= lastDayStart {
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart)!
        let predicate = store.predicateForEvents(withStart: dayStart, end: dayEnd, calendars: nil)
        result[isoDate.string(from: dayStart)] = store.events(matching: predicate).map { eventDict($0) }
        dayStart = dayEnd
    }
    printJSON(result)

default:
    printJSON(["error": "unknown command: \(command)"])
    exit(1)
}
