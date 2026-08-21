import UIKit
import Combine

/// Drives the status bar content colour from the web layer's theme.
///
/// dayGLANCE owns its own dark/light source of truth — an in-app toggle that is
/// independent of the system appearance — so the native side can't infer the
/// status bar colour from the system trait collection; the web layer has to tell
/// it (mirroring the Android `setStatusBarAppearance` bridge call).
///
/// With `UIViewControllerBasedStatusBarAppearance` = YES (required so SwiftUI's
/// `.statusBarHidden` works for immersive mode, below) and no explicit style
/// override, the hosting controller reports `.default`, which resolves from its
/// trait collection — inherited from the key window. Overriding the window's
/// style therefore still flips the status bar text: dark theme → light (white)
/// text, light theme → dark text.
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

/// Observable immersive-mode flag — the iOS analogue of Android's immersive
/// mode, set by the web layer's `setImmersiveMode` bridge call (the Day Dial's
/// fullscreen toggle and ambient screensaver). ContentView observes it and
/// hides the status bar and home indicator while it is on. WKWebView offers no
/// Fullscreen API on iPhone, so the shell has to hide the system chrome itself.
final class ImmersiveBridge: ObservableObject {

    static let shared = ImmersiveBridge()

    @Published var immersive = false

    private init() {}

    func set(_ on: Bool) {
        // Bridge callbacks may run off the main thread; the @Published
        // mutation must happen on the main queue.
        DispatchQueue.main.async {
            self.immersive = on
        }
    }
}
