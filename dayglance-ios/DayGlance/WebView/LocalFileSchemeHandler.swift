import WebKit

/// Serves the bundled React web app for the `dg://` URL scheme.
///
/// The Vite build outputs to DayGlance/Resources/web/ which Xcode adds to the
/// app bundle as a folder reference. Files are resolved relative to that folder:
///   dg:///index.html        →  <Bundle>/web/index.html
///   dg:///assets/main.js    →  <Bundle>/web/assets/main.js
final class LocalFileSchemeHandler: NSObject, WKURLSchemeHandler {

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url,
              let resourceURL = Bundle.main.resourceURL else {
            finish(urlSchemeTask)
            return
        }

        var relativePath = requestURL.path
        if relativePath.hasPrefix("/") { relativePath = String(relativePath.dropFirst()) }
        if relativePath.isEmpty { relativePath = "index.html" }

        let fileURL = resourceURL.appendingPathComponent("web").appendingPathComponent(relativePath)

        guard let data = try? Data(contentsOf: fileURL) else {
            finish(urlSchemeTask)
            return
        }

        let mimeType = Self.mimeType(for: fileURL.pathExtension.lowercased())
        let response = URLResponse(
            url: requestURL,
            mimeType: mimeType,
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}

    // MARK: - Helpers

    private func finish(_ task: any WKURLSchemeTask) {
        // Use didFailWithError for missing files — returning an HTTPURLResponse
        // for a non-HTTP scheme causes WKWebView to emit WebKitErrorDomain code=102.
        task.didFailWithError(URLError(.fileDoesNotExist))
    }

    private static func mimeType(for ext: String) -> String {
        switch ext {
        case "html":        return "text/html"
        case "js", "mjs":  return "application/javascript"
        case "css":         return "text/css"
        case "json":        return "application/json"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif":         return "image/gif"
        case "svg":         return "image/svg+xml"
        case "ico":         return "image/x-icon"
        case "woff":        return "font/woff"
        case "woff2":       return "font/woff2"
        case "ttf":         return "font/ttf"
        case "webp":        return "image/webp"
        default:            return "application/octet-stream"
        }
    }
}
