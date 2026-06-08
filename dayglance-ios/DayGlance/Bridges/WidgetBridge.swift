import Foundation
import WidgetKit

/// Receives the widget snapshot JSON from the JS bridge, writes it to the
/// App Group container, and asks WidgetKit to reload all timelines.
final class WidgetBridge {
    static let shared = WidgetBridge()

    func updateSnapshot(_ json: String) {
        // Widgets are killed at 30 MB with no warning. Cap stored JSON at 200 KB —
        // safely under that limit even with the full snapshot structure.
        guard json.utf8.count <= 200_000,
              let data = json.data(using: .utf8),
              let defaults = UserDefaults(suiteName: "group.com.dayglance.app") else { return }
        defaults.set(data, forKey: "widgetSnapshot")
        WidgetCenter.shared.reloadAllTimelines()
    }

    func getPendingAction() -> String {
        guard let defaults = UserDefaults(suiteName: "group.com.dayglance.app"),
              let action = defaults.dictionary(forKey: "widgetPendingAction") else {
            return "null"
        }
        defaults.removeObject(forKey: "widgetPendingAction")
        let encoded = (try? JSONSerialization.data(withJSONObject: action))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "null"
        return encoded
    }

    func getPendingShares() -> String {
        guard let defaults = UserDefaults(suiteName: "group.com.dayglance.app") else { return "[]" }
        let items = defaults.stringArray(forKey: "shareExtensionPending") ?? []
        defaults.removeObject(forKey: "shareExtensionPending")
        let json = items.map { "\"\($0.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\"" }.joined(separator: ",")
        return "[\(json)]"
    }
}
