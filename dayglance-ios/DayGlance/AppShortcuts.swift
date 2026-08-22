import AppIntents
import Foundation

// Siri and Shortcuts surface for dayGLANCE.
//
// The app had App Intents already — CompleteTaskIntent and StartFocusIntent for
// interactive widget buttons, and three control intents for Control Center — but
// all of them live in the DayGlanceWidget extension target. The Shortcuts app
// reads the *app's* Metadata.appintents, and the app target had no App Intents
// code at all, so dayGLANCE showed nothing in Shortcuts and had no Siri phrases.
// (The build log said as much on every build: "Metadata extraction skipped. No
// AppIntents.framework dependency found" for the DayGlance target.)
//
// So this is a fourth entry point onto machinery that already exists, not new
// plumbing. Home Screen Quick Actions, Control Center controls, and interactive
// widget buttons all write the same pending action to the App Group, which
// WidgetBridge.getPendingAction() hands to the web layer on resume (App.jsx,
// `wa === 'newInboxTask'` and friends). These intents do exactly the same thing.
//
// Names are suffixed "ShortcutIntent" to stay distinct from the extension's
// StartFocusIntent. They compile into separate modules so there is no build
// conflict, but two App Intents with the same type name inside one app bundle is
// a needless ambiguity for the system to resolve.
//
// iOS 16+, matching the app target. The extension's intents are gated to 17/18
// because interactive widgets and Controls need that — App Intents itself does
// not, which is why these carry no availability annotation.

struct AddInboxTaskShortcutIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Inbox Task"
    static var description = IntentDescription(
        "Opens dayGLANCE with a new inbox task ready to capture."
    )

    // Task data lives in the web layer, so there is nothing to do headlessly —
    // same reasoning as every other intent in this project.
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        WidgetBridge.writePendingAction("newInboxTask")
        return .result()
    }
}

struct StartFocusShortcutIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Focus"
    static var description = IntentDescription(
        "Opens dayGLANCE in Focus mode on your next task."
    )

    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        WidgetBridge.writePendingAction("startFocus")
        return .result()
    }
}

// Surfaces both intents to Siri and the Shortcuts app without the user having to
// assemble a shortcut first. Phrases must interpolate .applicationName — the API
// requires the app name in every phrase.
//
// Deliberately only two. App Shortcuts also feed Spotlight and Siri suggestions,
// so the list is a discoverability surface rather than a menu: "add a scheduled
// task" implies details Siri cannot collect without parameterized intents, and a
// voice-input shortcut would mean asking Siri to open a voice capture UI. Both
// remain available as Home Screen Quick Actions and Control Center controls.
struct DayGlanceAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddInboxTaskShortcutIntent(),
            phrases: [
                "Add a task in \(.applicationName)",
                "New task in \(.applicationName)",
                "Add a \(.applicationName) task",
            ],
            shortTitle: "Add inbox task",
            systemImageName: "tray.and.arrow.down"
        )
        AppShortcut(
            intent: StartFocusShortcutIntent(),
            phrases: [
                "Start focus in \(.applicationName)",
                "Start a \(.applicationName) focus session",
            ],
            shortTitle: "Start focus",
            systemImageName: "timer"
        )
    }
}
