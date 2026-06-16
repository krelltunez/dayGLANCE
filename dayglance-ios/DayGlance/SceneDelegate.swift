import UIKit
import CoreSpotlight

/// SwiftUI's `App` lifecycle is scene-based, so the system delivers Home Screen
/// Quick Actions to a `UIWindowSceneDelegate` — NOT to the app delegate's
/// `application(_:performActionFor:)`, and NOT via `launchOptions[.shortcutItem]`.
/// Without this scene delegate those callbacks never fire, which is why tapping
/// a Quick Action only opened the app and did nothing else.
///
/// We attach this delegate through `AppDelegate.application(_:configurationForConnecting:options:)`.
/// Importantly we do NOT create or manage a `UIWindow` here — SwiftUI still owns
/// the scene's content, so the UI renders exactly as before. We only listen for
/// the launch events and stash them where the web layer drains them.
final class SceneDelegate: NSObject, UIWindowSceneDelegate {

    // Cold launch: the app was not running. The triggering shortcut / activity /
    // URL arrives in the connection options. The web layer drains these once its
    // data has loaded (the `dataLoaded` effect in App.jsx), so there's no need to
    // nudge it here — the WebView isn't even up yet.
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        if let shortcut = connectionOptions.shortcutItem {
            AppDelegate.pendingShortcutAction = shortcut.type
        }
        connectionOptions.userActivities.forEach(captureUserActivity)
        if let url = connectionOptions.urlContexts.first?.url {
            captureURL(url)
        }
    }

    // Warm launch: the app was already running in the background. Stash the action
    // and nudge the web layer to drain it immediately.
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        AppDelegate.pendingShortcutAction = shortcutItem.type
        AppDelegate.notifyWebViewToDrainPendingActions()
        completionHandler(true)
    }

    // Warm launch: Spotlight result tap / Handoff.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        captureUserActivity(userActivity)
        AppDelegate.notifyWebViewToDrainPendingActions()
    }

    // Warm launch: dayglance:// deep link.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        captureURL(url)
        AppDelegate.notifyWebViewToDrainPendingActions()
    }

    // MARK: - Helpers

    private func captureUserActivity(_ activity: NSUserActivity) {
        guard activity.activityType == CSSearchableItemActionType,
              let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String else { return }
        AppDelegate.pendingDeepLink = "dayglance://task?id=\(id)"
    }

    private func captureURL(_ url: URL) {
        guard url.scheme == "dayglance" else { return }
        AppDelegate.pendingDeepLink = url.absoluteString
    }
}
