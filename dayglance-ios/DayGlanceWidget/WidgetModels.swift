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
    var sky: SkySnapshot?
    var dial: DialSnapshot?
    /// today+1 … today+N, projected in advance (utils/widgetDayProjection.js)
    /// so a timeline can switch days at midnight with the app in the
    /// background. Resolved against the entry's local day by
    /// `ResolvedWidgetDay` (WidgetFreshness.swift); never read directly.
    var days: [WidgetDay]?
    var updatedAt: Double?
    /// The IANA zone the snapshot's clock minutes were computed in (the
    /// device's zone at push time). A device now in a zone with a different
    /// offset draws every block at the wrong angle, so the dial labels that
    /// state rather than re-projecting (WidgetFreshness.zoneChanged).
    var timezone: String?
}

/// One projected day: the per-day fields only. The day-invariant blocks
/// (goals, projects, clock preference) live once on the snapshot. A projected
/// day is right about the SHAPE of the day and silent about state that cannot
/// exist yet — see the JS module's header. Its `nextTask` is the first
/// incomplete timed task of the day and `upcomingTasks` the whole rest of the
/// list, uncapped: the view promotes through it by the clock when the day
/// arrives, which a day built in advance cannot do.
struct WidgetDay: Codable {
    var date: String?
    var dateLabel: String?
    var nextTask: NextTaskData?
    var upcomingTasks: [UpcomingTaskData]?
    var sky: SkySnapshot?
    var dial: DialSnapshot?
}

// The Day Dial widget's sky ring, derived on the JS side from the same solar
// and lunar math the in-app dial draws with (computeSkySnapshot in
// src/utils/dayDial.js). Consumed, never re-solved here — see
// docs/day-dial-widget-handoff.md §4. Nil until the app has a geocoded
// location, in which case the ring is drawn unlit and without glyphs.
struct SkySnapshot: Codable {
    /// Minutes past local midnight; nil on a polar day/night (see `polar`).
    var sunriseMin: Int?
    var sunsetMin: Int?
    /// "day" (sun never sets), "night" (never rises), or nil for an ordinary day.
    var polar: String?
    /// 24 entries, each sampled at hh:30. Strengths in 0...1; the consumer
    /// applies its own opacity mapping. Moon is 0 while the sun is up.
    var hours: [SkyHour]?
    var moon: SkyMoon?
    /// The observer is south of the equator: the moon glyph's lit limb is
    /// mirrored (the sign of the latitude, never the coordinates).
    var southern: Bool?
}

struct SkyHour: Codable {
    var sun: Double?
    var moon: Double?
}

struct SkyMoon: Codable {
    /// Lit portion of the disc, 0 (new) to 1 (full).
    var fraction: Double?
    var waxing: Bool?
    /// Where the dial places the moon glyph, minutes past midnight; nil when
    /// no night stretch is long enough to carry one.
    var glyphMin: Int?
}

// Lightweight task used to fill leftover space in the Up Next widget when the
// primary task has no subtasks/notes of its own.
struct UpcomingTaskData: Codable {
    var id: String?
    var title: String?
    var colorHex: String?
    var startTime: String?
    var duration: Int?
    /// Present on a projected day's rows (kept at full richness there so a
    /// promoted row loses nothing); absent on the pushed day's light rows.
    var tags: [String]?
    var projectName: String?
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

extension ProjectSummary {
    /// A goal's project paused in the app (`status: "on-hold"`): the Goal
    /// widget lists it after the active ones and says "On hold" for its count.
    var isOnHold: Bool { status == "on-hold" }
}

struct ProjectData: Codable {
    var id: String?
    var title: String?
    var status: String?
    var goalId: String?
    var goalTitle: String?
    var goalColorHex: String?
    /// The project's own colour as the app draws it (absent from older pushes).
    var colorHex: String?
    /// The project's own target date (#2160), 'yyyy-MM-dd', in the goal's
    /// shape; absent from older pushes. `daysUntilDue` is the push-time count.
    var targetDate: String?
    var daysUntilDue: Int?
    var progressPct: Int?
    var totalTasks: Int?
    var completedTasks: Int?
    var tasks: [TaskSummary]?
}

extension ProjectData {
    /// Paused in the app (`status: "on-hold"`): still listed, after the active
    /// projects, with no due badge.
    var isOnHold: Bool { status == "on-hold" }

    /// The Project widget's due badge (#2160), in days from the entry's day,
    /// or nil for no badge. Computed at RENDER time from `targetDate`, as the
    /// Goal widget's is; the push-time `daysUntilDue` is only the fallback for
    /// a date that does not parse. No badge without a target date, on a stale
    /// snapshot, on a completed project, whose date is history, or on one on
    /// hold, which the app keeps from asking for attention (`isOnHold`: the
    /// widget says "On hold" instead).
    func dueDays(from now: Date, isStale: Bool, calendar: Calendar = .current) -> Int? {
        guard !isStale, status != "completed", !isOnHold, let target = targetDate, !target.isEmpty else { return nil }
        return ResolvedWidgetDay.daysUntil(target, from: now, calendar: calendar) ?? daysUntilDue
    }
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
    return decodeSnapshot(data)
}

/// The one decode of the stored bytes, whole or nothing: a single field in
/// the wrong shape (a fractional minute where an Int? is declared) rejects
/// the entire snapshot and every widget goes blank, which is why the JS side
/// pins the wire shape (widgetSnapshotFixture.test.js) and the widget tests
/// decode a live-shaped fixture through this exact function.
func decodeSnapshot(_ data: Data) -> WidgetSnapshot? {
    try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
}

// The whole local day for the Day Dial widget's ring — every timed block
// regardless of completion or elapse, plus sleep and routines — projected on
// the JS side by projectDialSnapshot (src/utils/dayDial.js) from the same
// model the in-app dial renders. Built from the unfiltered day, NOT from the
// agenda that hides completed past tasks. See docs/day-dial-widget-handoff.md §5.
struct DialSnapshot: Codable {
    var date: String?
    /// Start-sorted. `durationMin` is the DRAWN span, already clipped at
    /// midnight; `endMinTrue` carries the real end when `endsNextDay`.
    var blocks: [DialBlock]?
    /// The day's all-day items, incomplete first, and the in-app legend's
    /// totals: the iPad extra-large dial's cards (DialCardsColumn). Absent
    /// from payloads before the cards; `totals` absent draws no legend.
    var allDay: [DialAllDayItem]?
    /// The day's frames (docs/day-dial-frames-spec.html), start-ordered, each
    /// with its nesting depth and its free slots as [startMin, endMin] pairs,
    /// not floored at now. Absent from payloads before frames.
    var frames: [DialFrameWire]?
    var totals: DialTotals?
}

struct DialFrameWire: Codable {
    var name: String?
    var colorHex: String?
    var startMin: Int?
    var endMin: Int?
    var depth: Int?
    var slots: [[Int]]?
}

struct DialAllDayItem: Codable {
    var id: String?
    var title: String?
    var completed: Bool?
    var colorHex: String?
}

/// Whole minutes (projectDialSnapshot rounds them). Sleep and unblocked are
/// null without a declared day window.
struct DialTotals: Codable {
    var effortMinutes: Int?
    var restoreMinutes: Int?
    var sleepMinutes: Int?
    var unblockedMinutes: Int?
    /// Scheduled minutes inside the top-level frames over their minutes, as a
    /// whole percent; null on a day without frames (no legend entry).
    var framesPercent: Int?
}

struct DialBlock: Codable {
    /// "task" | "event" (read-only imported calendar) | "routine" | "sleep".
    var type: String?
    var id: String?
    /// Cleaned for display: no wikilinks, no #tags. Absent on sleep.
    var title: String?
    /// The first #tag, for the hub's italic line. Absent on routine/sleep.
    var tag: String?
    var startMin: Int?
    var durationMin: Int?
    /// "effort" | "restore" — the energy axis. Tasks/events only.
    var kind: String?
    var completed: Bool?
    /// Tasks/events only; routine and sleep take the widget's fixed colours.
    var colorHex: String?
    /// Concentric lane for overlapping blocks; a lone block is 0 of 1.
    var lane: Int?
    var laneCount: Int?
    var endsNextDay: Bool?
    var endMinTrue: Int?
    var startedPrevDay: Bool?
}

// MARK: - Tap links

/// Where a widget's tap lands in the app: a dayglance:// link, stored by the
/// app's URL handlers (ContentView.onOpenURL, SceneDelegate) and applied by
/// the web layer (App.jsx, utils/goalsLink.js and utils/dayLink.js). The
/// Android widgets open the same URLs (WidgetLinks.kt).
enum WidgetLink {
    /// Today's calendar, wherever the app was (Up Next).
    static let today = URL(string: "dayglance://today")!

    /// That goal in Goals & Projects; with no goal, the space.
    static func goal(_ id: String?) -> URL { link("goal", id) }

    /// That project, its card in view; with no project, the space.
    static func project(_ id: String?) -> URL { link("project", id) }

    /// Up Next's Done: complete that task.
    static func completeTask(_ id: String) -> URL { link("completeTask", id) }

    /// Up Next's Focus: a focus session on that task (without an id, on the
    /// block the app derives from the clock).
    static func startFocus(_ id: String?) -> URL { link("startFocus", id) }

    /// RFC 3986 unreserved characters only. `.urlQueryAllowed` keeps '+',
    /// '&' and '=', which URLSearchParams on the web side reads as a space
    /// and as separators, so an id containing them (an ICS UID can) would
    /// arrive cut or changed.
    private static let unreserved = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    static func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }

    private static func link(_ host: String, _ id: String?) -> URL {
        guard let id, !id.isEmpty else { return URL(string: "dayglance://\(host)")! }
        return URL(string: "dayglance://\(host)?id=\(encode(id))") ?? URL(string: "dayglance://\(host)")!
    }
}
