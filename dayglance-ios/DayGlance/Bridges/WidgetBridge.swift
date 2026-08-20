import Foundation
import WidgetKit
import os

/// Receives the widget snapshot JSON from the JS bridge, writes it to the
/// App Group container, and asks WidgetKit to reload all timelines.
final class WidgetBridge {
    static let shared = WidgetBridge()

    /// Shared with the widget extension and the share extension. Was repeated as a
    /// literal in every method here; a single definition is one fewer place for a
    /// typo to silently disable the App Group.
    static let appGroup = "group.com.dayglance.app"

    /// The App Group key the snapshot lives under. The widget extension keeps
    /// its own copy of this literal (kSnapshotKey in WidgetModels.swift — a
    /// different target); inside the app target this is the one definition.
    static let snapshotKey = "widgetSnapshot"

    /// Widgets are killed at 30 MB with no warning. 200 KB is safely under that
    /// even with the full snapshot structure.
    private static let snapshotCapBytes = 200_000

    /// First logging in this target. os.Logger costs nothing when nothing is
    /// listening and surfaces in Console.app filtered by subsystem, so a dropped
    /// snapshot is diagnosable without attaching a debugger.
    private static let log = Logger(subsystem: "com.dayglance.app", category: "widget")

    func updateSnapshot(_ json: String) {
        // These three were one compound `guard ... else { return }`, which made
        // every failure mode silent AND indistinguishable: an oversized snapshot,
        // an encoding failure and a missing App Group all looked identical from
        // the outside. The widget simply froze at its last good snapshot, with no
        // signal in the app, the console, or anywhere else. Split so each failure
        // says which one it was.
        let byteCount = json.utf8.count
        guard byteCount <= Self.snapshotCapBytes else {
            // Single-line OSLogMessage literals throughout: the interpolation is
            // compile-time checked against a narrow set of forms, so a wrapped
            // multi-line literal is a needless risk for a diagnostic line.
            Self.log.error("Widget snapshot dropped: \(byteCount, privacy: .public) bytes exceeds the \(Self.snapshotCapBytes, privacy: .public) byte cap. Widgets and the Live Activity keep their previous data.")
            return
        }
        guard let data = json.data(using: .utf8) else {
            Self.log.error("Widget snapshot dropped: JSON could not be encoded as UTF-8.")
            return
        }
        guard let defaults = UserDefaults(suiteName: Self.appGroup) else {
            // Not a data problem — the App Group is unreachable, so widgets are
            // broken outright rather than stale. Worth its own message.
            Self.log.error("Widget snapshot dropped: App Group \(Self.appGroup, privacy: .public) is unavailable. Check the application-groups entitlement.")
            return
        }
        defaults.set(data, forKey: Self.snapshotKey)
        WidgetCenter.shared.reloadAllTimelines()
        // Same JSON drives the day-summary Live Activity — one entry point,
        // no separate JS bridge call to keep in sync.
        if #available(iOS 16.2, *) {
            LiveActivityBridge.shared.sync(fromSnapshotJSON: json)
        }
    }

    /// The stored snapshot JSON, as last written by updateSnapshot — read by
    /// the background refresh task, whose only data source is this container
    /// (the WebView is suspended when it fires). nil when the App Group is
    /// unreachable or nothing was ever pushed.
    func storedSnapshotJSON() -> String? {
        guard let defaults = UserDefaults(suiteName: Self.appGroup),
              let data = defaults.data(forKey: Self.snapshotKey) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func getPendingAction() -> String {
        guard let defaults = UserDefaults(suiteName: Self.appGroup),
              let action = defaults.dictionary(forKey: "widgetPendingAction") else {
            return "null"
        }
        defaults.removeObject(forKey: "widgetPendingAction")
        let encoded = (try? JSONSerialization.data(withJSONObject: action))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "null"
        return encoded
    }

    func getPendingShares() -> String {
        guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return "[]" }
        let items = defaults.stringArray(forKey: "shareExtensionPending") ?? []
        guard !items.isEmpty else { return "[]" }

        // Encode with JSONSerialization, never string concatenation. This used to
        // hand-build the array escaping only \ and ", which leaves control
        // characters raw — and shared text routinely contains newlines (a shared
        // paragraph) or tabs. A raw newline inside a JSON string literal is
        // invalid, so JSON.parse threw on the web side and the entire batch was
        // discarded, taking any well-formed shares queued alongside it.
        guard let data = try? JSONSerialization.data(withJSONObject: items),
              let json = String(data: data, encoding: .utf8) else { return "[]" }

        // Clear only once the payload is safely encoded: bailing out above leaves
        // the queue intact for the next attempt instead of dropping it.
        defaults.removeObject(forKey: "shareExtensionPending")
        return json
    }
}
