import UIKit

/// iOS share bridge for window.DayGlanceNative.shareFile.
///
/// The web `<a download>` trick is never handled by WKWebView — blob downloads
/// need a WKDownload delegate this shell doesn't implement — so backup export
/// writes the file to the temp directory and presents the system share sheet,
/// mirroring Android's NativeBridge.shareFile() (cache dir + FileProvider +
/// ACTION_SEND).
final class ShareBridge {

    static let shared = ShareBridge()

    /// Writes [content] to the temp dir as [filename] and presents
    /// UIActivityViewController from the root view controller.
    ///
    /// Returns { success: true } once the sheet is scheduled, or
    /// { success: false, error } if the file can't be written. A dismissed
    /// share sheet is a cancel, not an error, so it stays success — the
    /// synchronous bridge returns before the sheet resolves anyway.
    func shareFile(filename: String, content: String) -> String {
        // Strip path separators so the suggested filename can't escape tmp/.
        let safeName = filename
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "\\", with: "_")
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try content.write(to: fileURL, atomically: true, encoding: .utf8)
        } catch {
            return resultJSON(success: false, error: error.localizedDescription)
        }
        DispatchQueue.main.async {
            guard let rootVC = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first?.windows.first?.rootViewController else { return }
            let activityVC = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            // iPad presents this as a popover and traps without an anchor.
            if let popover = activityVC.popoverPresentationController {
                popover.sourceView = rootVC.view
                popover.sourceRect = CGRect(x: rootVC.view.bounds.midX, y: rootVC.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            rootVC.present(activityVC, animated: true)
        }
        return resultJSON(success: true, error: nil)
    }

    private func resultJSON(success: Bool, error: String?) -> String {
        var payload: [String: Any] = ["success": success]
        if let error { payload["error"] = error }
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        return #"{"success":false,"error":"serialization error"}"#
    }
}
