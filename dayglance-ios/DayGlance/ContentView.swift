import SwiftUI
import EventKit

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var lastCalendarStatus = EKEventStore.authorizationStatus(for: .event)

    var body: some View {
        WebView()
            .ignoresSafeArea()
            .task {
                let calendarWasUndetermined = EKEventStore.authorizationStatus(for: .event) == .notDetermined

                HealthBridge.shared.requestAuthorization()

                await withCheckedContinuation { continuation in
                    CalendarBridge.shared.requestAuthorization { continuation.resume() }
                }

                await withCheckedContinuation { continuation in
                    NotificationBridge.shared.requestAuthorization { continuation.resume() }
                }

                if calendarWasUndetermined {
                    NotificationCenter.default.post(name: .dayGlanceReloadWebView, object: nil)
                }
                lastCalendarStatus = EKEventStore.authorizationStatus(for: .event)
            }
            .onChange(of: scenePhase) { phase in
                guard phase == .active else { return }
                // Always notify the web layer that the app came to foreground so
                // cloud sync can pull any changes made while the app was backgrounded.
                NotificationCenter.default.post(name: .dayGlanceForeground, object: nil)
                let current = EKEventStore.authorizationStatus(for: .event)
                if current != lastCalendarStatus {
                    lastCalendarStatus = current
                    NotificationCenter.default.post(name: .dayGlanceReloadWebView, object: nil)
                }
            }
    }
}

extension Notification.Name {
    static let dayGlanceReloadWebView = Notification.Name("dayGlanceReloadWebView")
    static let dayGlanceForeground    = Notification.Name("dayGlanceForeground")
}
