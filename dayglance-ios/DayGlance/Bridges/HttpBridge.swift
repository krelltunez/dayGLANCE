import Foundation

/// URLSession HTTP bridge for window.DayGlanceNative.httpRequest.
///
/// Mirrors Android's HttpBridge exactly: takes (method, url, headersJson, body)
/// and returns { status, ok, body } or { status: 0, ok: false, error } JSON.
///
/// Used by WebDAV cloud sync and ICS task-calendar fetch to bypass WKWebView
/// CORS restrictions — the same reason Android's HttpBridge exists.
///
/// Blocks the calling thread via DispatchSemaphore; only call from a
/// background thread (WKURLSchemeHandler callbacks satisfy this).
final class HttpBridge {

    static let shared = HttpBridge()

    // MARK: - request

    func request(method: String, url: String, headersJson: String, body: String) -> String {
        guard let targetURL = URL(string: url) else {
            return errorJSON("Invalid URL: \(url)")
        }

        var req = URLRequest(url: targetURL)
        req.httpMethod = method
        req.timeoutInterval = 20
        // Never return a cached response — cloud sync must always see the
        // current file on the server, not a URLSession-cached copy.
        req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        // Apply caller-supplied headers
        if let data = headersJson.data(using: .utf8),
           let headers = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            for (key, value) in headers {
                req.setValue(value, forHTTPHeaderField: key)
            }
        }

        // Attach body for non-idempotent methods (mirrors Android's behaviour)
        if !body.isEmpty, method != "GET", method != "HEAD" {
            req.httpBody = body.data(using: .utf8)
        }

        var resultJSON = errorJSON("No response received")
        let sem = DispatchSemaphore(value: 0)

        URLSession.shared.dataTask(with: req) { data, response, error in
            defer { sem.signal() }
            if let error {
                resultJSON = self.errorJSON(error.localizedDescription)
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let bodyStr = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let ok = (200...299).contains(status)
            resultJSON = #"{"status":\#(status),"ok":\#(ok ? "true" : "false"),"body":"\#(self.esc(bodyStr))"}"#
        }.resume()

        sem.wait()
        return resultJSON
    }

    // MARK: - Helpers

    private func errorJSON(_ msg: String) -> String {
        #"{"status":0,"ok":false,"body":"","error":"\#(esc(msg))"}"#
    }

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
         .replacingOccurrences(of: "\n", with: "\\n")
         .replacingOccurrences(of: "\r", with: "\\r")
         .replacingOccurrences(of: "\t", with: "\\t")
    }
}
