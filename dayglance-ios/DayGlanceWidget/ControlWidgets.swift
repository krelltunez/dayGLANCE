import AppIntents
import SwiftUI
import WidgetKit

/// Control Center controls (iOS 18+) that mirror the Home Screen Quick Actions:
/// add a scheduled task, add an inbox task, and capture a task by voice.
///
/// A control button can only trigger an `AppIntent` (unlike home-screen widgets,
/// which can use a `Link`/`widgetURL`). So each control runs a tiny intent that
/// stashes a pending action in the shared App Group and opens the app
/// (`openAppWhenRun`). On foreground the web layer drains it via
/// `getWidgetPendingAction` → `nativeGetWidgetPendingAction()` — the same App
/// Group slot the widget bridge already reads (see WidgetBridge.getPendingAction).
///
/// Gated to iOS 18 because the Controls (WidgetKit `ControlWidget`) API does not
/// exist before then; users on iOS 16/17 keep the Home Screen Quick Actions.

// MARK: - Shared store

@available(iOS 18.0, *)
private enum ControlActionStore {
    static func write(_ action: String) {
        // Same suite + key the widget bridge drains; value shape matches the
        // existing widget intents ({ "action": ... }).
        UserDefaults(suiteName: "group.com.dayglance.app")?
            .set(["action": action], forKey: "widgetPendingAction")
    }
}

// MARK: - Intents

// iOS 18.4 tightened sandboxing for AppIntents running in the widget process when
// the main app is not alive. Conforming to ForegroundContinuableIntent (in the app
// process only) routes the intent through the app, matching how the existing widget
// intents avoid entitlement errors. See WidgetIntents.swift.
@available(iOS 18.0, *)
@available(iOSApplicationExtension, unavailable)
extension AddScheduledTaskControlIntent: ForegroundContinuableIntent {}

@available(iOS 18.0, *)
@available(iOSApplicationExtension, unavailable)
extension AddInboxTaskControlIntent: ForegroundContinuableIntent {}

@available(iOS 18.0, *)
@available(iOSApplicationExtension, unavailable)
extension VoiceInputControlIntent: ForegroundContinuableIntent {}

@available(iOS 18.0, *)
struct AddScheduledTaskControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Add Scheduled Task"
    // Task data lives in the web layer, so the app must be foregrounded to act.
    static var openAppWhenRun: Bool = true

    init() {}

    func perform() async throws -> some IntentResult {
        ControlActionStore.write("newScheduledTask")
        return .result()
    }
}

@available(iOS 18.0, *)
struct AddInboxTaskControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Add Inbox Task"
    static var openAppWhenRun: Bool = true

    init() {}

    func perform() async throws -> some IntentResult {
        ControlActionStore.write("newInboxTask")
        return .result()
    }
}

@available(iOS 18.0, *)
struct VoiceInputControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Add Task by Voice"
    static var openAppWhenRun: Bool = true

    init() {}

    func perform() async throws -> some IntentResult {
        ControlActionStore.write("voiceInput")
        return .result()
    }
}

// MARK: - Controls

@available(iOS 18.0, *)
struct AddScheduledTaskControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.dayglance.control.scheduledTask") {
            ControlWidgetButton(action: AddScheduledTaskControlIntent()) {
                Label("Scheduled Task", systemImage: "calendar.badge.plus")
            }
        }
        .displayName("Scheduled Task")
        .description("Add a task to today's schedule.")
    }
}

@available(iOS 18.0, *)
struct AddInboxTaskControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.dayglance.control.inboxTask") {
            ControlWidgetButton(action: AddInboxTaskControlIntent()) {
                Label("Inbox Task", systemImage: "tray.and.arrow.down.fill")
            }
        }
        .displayName("Inbox Task")
        .description("Quickly capture a task to your inbox.")
    }
}

@available(iOS 18.0, *)
struct VoiceInputControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.dayglance.control.voiceInput") {
            ControlWidgetButton(action: VoiceInputControlIntent()) {
                Label("Voice Task", systemImage: "mic.fill")
            }
        }
        .displayName("Voice Task")
        .description("Capture a task by voice.")
    }
}
