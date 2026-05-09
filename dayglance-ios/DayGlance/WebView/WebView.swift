import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {

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

        if #available(iOS 16.4, *) { webView.isInspectable = true }

        // Reload the page after permission dialogs close so the web app can
        // re-fetch health and calendar data with fresh authorization.
        NotificationCenter.default.addObserver(
            forName: .dayGlanceReloadWebView,
            object: nil,
            queue: .main
        ) { [weak webView] _ in
            webView?.reload()
        }

        // Three-slash URL: scheme=dg, empty host, path starts at /
        // Relative refs in index.html (./assets/…) resolve to dg:///assets/…
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
}
