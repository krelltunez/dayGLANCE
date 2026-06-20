import UIKit

/// Drives the status bar content colour from the web layer's theme.
///
/// dayGLANCE owns its own dark/light source of truth — an in-app toggle that is
/// independent of the system appearance — so the native side can't infer the
/// status bar colour from the system trait collection; the web layer has to tell
/// it (mirroring the Android `setStatusBarAppearance` bridge call).
///
/// With `UIViewControllerBasedStatusBarAppearance` = NO and `UIStatusBarStyle` =
/// default (adaptive on iOS 13+), the status bar content colour resolves from the
/// key window's user interface style. Overriding that style therefore flips the
/// status bar text: dark theme → light (white) text, light theme → dark text.
final class StatusBarBridge {

    static let shared = StatusBarBridge()

    private init() {}

    func setAppearance(isDark: Bool) {
        // URL-scheme handler callbacks may run off the main thread; UIKit window
        // mutation must happen on the main queue.
        DispatchQueue.main.async {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }
                ?? scenes.first?.windows.first
            window?.overrideUserInterfaceStyle = isDark ? .dark : .light
        }
    }
}
