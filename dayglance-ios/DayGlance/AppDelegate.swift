import UIKit
import AVFoundation
import UserNotifications
import RevenueCat

class AppDelegate: NSObject, UIApplicationDelegate {

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

        return true
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
