import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Serve bundled web assets via dg:// scheme (custom, unambiguous)
        config.setURLSchemeHandler(LocalFileSchemeHandler(), forURLScheme: "dg")

        // Handle all DayGlanceNative / DayGlanceObsidian bridge calls via dgbridge://
        config.setURLSchemeHandler(BridgeSchemeHandler(), forURLScheme: "dgbridge")

        // Inject bridge shims before any page script runs
        let shim = WKUserScript(
            source: bridgeScript(),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(shim)

        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear

        // Route external links (window.open / target="_blank" / same-frame external
        // navigations) to the system browser instead of hijacking the app shell.
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator

        // Web Inspector (Safari → Develop). iOS 16.4+ defaults isInspectable to
        // false, so a distribution build is otherwise un-inspectable. Enable it in
        // Debug (Xcode runs) AND TestFlight (sandbox receipt) so beta test builds
        // are debuggable — but NEVER in an App Store production build.
        if #available(iOS 16.4, *) {
            #if DEBUG
            webView.isInspectable = true
            #else
            let isTestFlight = Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
            webView.isInspectable = isTestFlight
            #endif
        }

        // Reload the page after permission dialogs close so the web app can
        // re-fetch health and calendar data with fresh authorization.
        NotificationCenter.default.addObserver(
            forName: .dayGlanceReloadWebView,
            object: nil,
            queue: .main
        ) { [weak webView] _ in
            webView?.reload()
        }

        // Fire a custom event whenever the app comes to foreground so the
        // cloud sync download handler runs immediately. We use a custom event
        // rather than visibilitychange because scenePhase fires before WKWebView
        // updates document.hidden, so the visibilitychange handler's
        // !document.hidden guard would incorrectly skip the sync.
        NotificationCenter.default.addObserver(
            forName: .dayGlanceForeground,
            object: nil,
            queue: .main
        ) { [weak webView] _ in
            webView?.evaluateJavaScript(
                "document.dispatchEvent(new Event('dayglanceForeground'))",
                completionHandler: nil
            )
        }

        // Three-slash URL: scheme=dg, empty host, path starts at /
        // Relative refs in index.html (./assets/…) resolve to dg:///assets/…
        // Give SubscriptionBridge a weak reference so it can fire __billingEvent callbacks.
        SubscriptionBridge.shared.webView = webView
        // Same for the native SSE reader — it pushes frames via __glanceVaultSseReceive.
        VaultSseBridge.shared.webView = webView

        webView.load(URLRequest(url: URL(string: "dg:///index.html")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    // MARK: - Bridge script

    private func bridgeScript() -> String {
        let isIPad = UIDevice.current.userInterfaceIdiom == .pad
        return """
        window.DayGlanceIOS = true;
        window.isIPad = \(isIPad ? "true" : "false");

        // Route any bridge call through the dgbridge:// synchronous XHR scheme.
        // Both DayGlanceNative and DayGlanceObsidian are Proxy objects so any
        // method name works without enumerating them — future bridge phases just
        // handle new method names in BridgeSchemeHandler.swift.
        (function() {
            function _callBridge(namespace, method, args) {
                try {
                    var xhr = new XMLHttpRequest();
                    var url = 'dgbridge://' + namespace + '_' + method
                            + '?args=' + encodeURIComponent(JSON.stringify(args));
                    xhr.open('GET', url, false);
                    xhr.send(null);
                    if (xhr.status === 200) return xhr.responseText;
                } catch (e) {}
                return null;
            }

            window.DayGlanceNative = new Proxy({}, {
                get: function(_, method) {
                    return function() {
                        return _callBridge('native', method, Array.from(arguments));
                    };
                }
            });

            window.DayGlanceObsidian = new Proxy({}, {
                get: function(_, method) {
                    return function() {
                        return _callBridge('obsidian', method, Array.from(arguments));
                    };
                }
            });
        })();
        """
    }

    // MARK: - Coordinator (navigation + UI delegates)

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {

        /// Open a URL in the system (Safari, Mail, Phone, …). Only http/https/mailto/tel.
        private func openExternally(_ url: URL) {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }

        // window.open(url, '_blank') and target="_blank" anchors ask WebKit to
        // create a new web view. We never create one — instead we hand off any
        // web URL to the system browser and return nil.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url,
               let scheme = url.scheme?.lowercased(),
               scheme == "http" || scheme == "https" {
                openExternally(url)
            }
            return nil
        }

        // Governs navigations (document loads), not fetch/XHR. The dgbridge:// XHR
        // traffic and dg:// resource loads never reach here as navigations, but we
        // explicitly allow those schemes plus about:blank to be safe.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            let scheme = url.scheme?.lowercased()

            // Internal app content, the synchronous bridge scheme, and blank frames
            // stay inside the web view.
            if scheme == "dg" || scheme == "dgbridge" || scheme == "about" {
                decisionHandler(.allow)
                return
            }

            // mailto:/tel:/sms: are always handed to the system.
            if scheme == "mailto" || scheme == "tel" || scheme == "sms" {
                decisionHandler(.cancel)
                openExternally(url)
                return
            }

            // External web links: never load them in the app shell. Open a tapped
            // link, or any main-frame / new-window navigation away from the app
            // scheme, in the system browser. Sub-frame http(s) loads (e.g. an
            // embedded iframe) are left to proceed normally.
            if scheme == "http" || scheme == "https" {
                let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
                if navigationAction.navigationType == .linkActivated || isMainFrame {
                    decisionHandler(.cancel)
                    openExternally(url)
                    return
                }
            }

            decisionHandler(.allow)
        }
    }
}
