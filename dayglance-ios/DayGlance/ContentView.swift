import SwiftUI
import EventKit
import CoreSpotlight

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
            // Spotlight result taps. SwiftUI delivers these reliably on both cold
            // and warm launch, unlike the AppDelegate continueUserActivity path
            // which can be skipped under the scene-based lifecycle.
            .onContinueUserActivity(CSSearchableItemActionType) { activity in
                if let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
                    AppDelegate.pendingDeepLink = "dayglance://task?id=\(id)"
                    AppDelegate.notifyWebViewToDrainPendingActions()
                }
            }
            // dayglance:// deep links (e.g. from Shortcuts or other apps).
            .onOpenURL { url in
                if url.scheme == "dayglance" {
                    AppDelegate.pendingDeepLink = url.absoluteString
                    AppDelegate.notifyWebViewToDrainPendingActions()
                }
            }
    }
}

extension Notification.Name {
    static let dayGlanceReloadWebView  = Notification.Name("dayGlanceReloadWebView")
    static let dayGlanceForeground     = Notification.Name("dayGlanceForeground")
    static let dayGlanceWidgetRefresh  = Notification.Name("com.dayglance.widgetRefresh")
}
