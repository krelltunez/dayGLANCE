import UIKit
import AVFoundation
import UserNotifications
import RevenueCat
import BackgroundTasks
import CoreSpotlight
import WidgetKit

class AppDelegate: NSObject, UIApplicationDelegate {

    static var pendingShortcutAction: String? = nil
    static var pendingDeepLink: String? = nil

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Configure audio session up front so WKWebView's Web Audio API doesn't
        // trigger AVAudioSession routing warnings on first sound. Ambient mixes
        // with other audio and respects the silent switch — correct for UI sounds.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)

        NotificationBridge.shared.registerCategories()
        UNUserNotificationCenter.current().delegate = self

        // Phase 9 — RevenueCat subscriptions
        SubscriptionBridge.shared.configure(apiKey: "appl_uHejfwubTbYOTpEPNYFsjXAgnHw")

        // Phase 10 — Background widget refresh
        BGTaskScheduler.shared.register(forTaskWithIdentifier: "com.dayglance.widgetrefresh", using: nil) { task in
            // The WebView is suspended when this fires so posting a notification to it
            // does nothing. Reload from whatever is already in the App Group container —
            // it's the freshest data available without the app running.
            WidgetCenter.shared.reloadAllTimelines()
            task.setTaskCompleted(success: true)
        }

        // Capture Quick Action if app was cold-launched via a home screen shortcut.
        // (On warm launch, performActionFor shortcutItem: is called instead.)
        if let shortcut = launchOptions?[UIApplication.LaunchOptionsKey.shortcutItem] as? UIApplicationShortcutItem {
            AppDelegate.pendingShortcutAction = shortcut.type
        }

        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        scheduleWidgetRefresh()
    }

    private func scheduleWidgetRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: "com.dayglance.widgetrefresh")
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    // MARK: - Home Screen Quick Actions

    func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        AppDelegate.pendingShortcutAction = shortcutItem.type
        AppDelegate.notifyWebViewToDrainPendingActions()
        completionHandler(true)
    }

    // MARK: - URL / Deep Link handling

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if url.scheme == "dayglance" {
            AppDelegate.pendingDeepLink = url.absoluteString
            AppDelegate.notifyWebViewToDrainPendingActions()
        }
        return true
    }

    // MARK: - Spotlight / NSUserActivity

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        if userActivity.activityType == CSSearchableItemActionType,
           let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
            AppDelegate.pendingDeepLink = "dayglance://task?id=\(id)"
            AppDelegate.notifyWebViewToDrainPendingActions()
        }
        return true
    }

    /// Nudges the web layer to poll for the pending shortcut/deep-link it just
    /// stored. The WebView translates .dayGlanceForeground into a JS
    /// `dayglanceForeground` event, whose handler drains the pending action.
    /// Posting here (rather than relying solely on the scenePhase → active
    /// transition) closes the cold-launch race where the native callback can
    /// arrive after the app is already active and the one-shot drain has run.
    static func notifyWebViewToDrainPendingActions() {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .dayGlanceForeground, object: nil)
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension AppDelegate: UNUserNotificationCenterDelegate {

    /// Show notifications as banners even when the app is in the foreground.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    /// Handle Snooze / Mark Complete action button taps.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let actionId = response.actionIdentifier
        let userInfo = response.notification.request.content.userInfo

        if actionId != UNNotificationDefaultActionIdentifier &&
           actionId != UNNotificationDismissActionIdentifier {
            NotificationBridge.shared.handleNotificationAction(
                actionIdentifier: actionId,
                userInfo: userInfo
            )
        }

        completionHandler()
    }
}
