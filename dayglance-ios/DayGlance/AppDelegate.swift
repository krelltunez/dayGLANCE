import UIKit
import AVFoundation
import UserNotifications
import RevenueCat
import BackgroundTasks
import CoreSpotlight
import WidgetKit
import os

/// Calls setTaskCompleted exactly once, however many paths race to it —
/// normal completion, a failure, and the expiration handler all funnel
/// through here. Overrunning the BGAppRefreshTask deadline without
/// completing gets the app terminated by the system and can reduce future
/// scheduling, so this is the constraint with teeth.
private final class BGTaskCompletionGuard {
    private let lock = NSLock()
    private var task: BGTask?
    init(_ task: BGTask) { self.task = task }
    func complete(success: Bool) {
        lock.lock()
        let task = self.task
        self.task = nil
        lock.unlock()
        task?.setTaskCompleted(success: success)
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {

    static var pendingShortcutAction: String? = nil
    static var pendingDeepLink: String? = nil

    private static let bgLog = Logger(subsystem: "com.dayglance.app", category: "background")

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

        // Phase 10 — Background widget + Live Activity refresh. Opportunistic:
        // iOS runs this when it pleases (usage patterns, battery, Low Power
        // Mode), or not at all — both refreshes must stay correct without it,
        // and this only ever makes them fresher.
        BGTaskScheduler.shared.register(forTaskWithIdentifier: "com.dayglance.widgetrefresh", using: nil) { task in
            // The WebView is suspended when this fires so posting a notification to it
            // does nothing. Reload from whatever is already in the App Group container —
            // it's the freshest data available without the app running.
            //
            // The widget path runs FIRST and synchronously: it cannot fail and is
            // complete before any Live Activity code executes, so a problem in the
            // activity leg can never cost the widget refresh.
            WidgetCenter.shared.reloadAllTimelines()

            guard #available(iOS 16.2, *) else {
                task.setTaskCompleted(success: true)
                return
            }

            let completion = BGTaskCompletionGuard(task)
            var refresh: Task<Void, Never>?
            // Armed before the async work starts, so a deadline landing
            // mid-flight cancels the work instead of racing it.
            task.expirationHandler = {
                refresh?.cancel()
                Self.bgLog.error("Background refresh expired at the BGAppRefreshTask deadline; Live Activity leg cancelled.")
                completion.complete(success: false)
            }
            refresh = Task {
                let clock = ContinuousClock()
                let start = clock.now
                await LiveActivityBridge.shared.refreshFromBackground(
                    snapshotJSON: WidgetBridge.shared.storedSnapshotJSON())
                let ms = (clock.now - start) / .milliseconds(1)
                // notice, not info: info-level is hidden by default in
                // Console.app (and easy to lose in Xcode's console), which
                // defeats this line's purpose — the measured duration must be
                // readable on a device without a debugger attached.
                Self.bgLog.notice("Background refresh done; Live Activity leg took \(ms, format: .fixed(precision: 1), privacy: .public)ms")
                completion.complete(success: true)
            }
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

    // MARK: - Scene configuration

    // SwiftUI's App lifecycle is scene-based. Routing scene creation through a
    // UISceneConfiguration with our SceneDelegate is the only reliable way to
    // receive Home Screen Quick Actions (and cold-launch Spotlight / deep links)
    // in this kind of app. We do not manage a window in the delegate, so SwiftUI
    // continues to provide and render the scene's content unchanged.
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
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
