import Foundation

/// Reads and writes dayglance-sync.json in the app's iCloud ubiquitous container,
/// enabling zero-config sync across iOS/iPadOS devices on the same Apple ID.
///
/// Called synchronously from the JS bridge on a WKURLSchemeHandler background thread.
final class ICloudBridge {

    static let shared = ICloudBridge()

    private let containerID   = "iCloud.com.dayglance"
    private let syncFileName  = "dayglance-sync.json"

    // MARK: - Public API

    /// Returns the sync file JSON, "null" if unavailable/not yet downloaded,
    /// or {"error":"…"} if iCloud is not signed in.
    func readSync() -> String {
        guard let container = containerURL() else {
            return #"{"error":"iCloud not available"}"#
        }
        let fileURL = syncFileURL(in: container)

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return "null"
        }

        // Trigger download if the file exists in cloud but hasn't been fetched locally yet.
        try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)

        // If it's still a cloud-only placeholder, return null — next poll will get it.
        if let values = try? fileURL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
           let status = values.ubiquitousItemDownloadingStatus,
           status == .notDownloaded {
            return "null"
        }

        guard let data = try? Data(contentsOf: fileURL),
              let str  = String(data: data, encoding: .utf8) else {
            return "null"
        }
        return str
    }

    /// Writes json to the iCloud sync file. Returns {"ok":true} or {"ok":false,"error":"…"}.
    func writeSync(_ json: String) -> String {
        guard let container = containerURL() else {
            return #"{"ok":false,"error":"iCloud not available"}"#
        }
        let docsDir = container.appendingPathComponent("Documents")
        let fileURL = docsDir.appendingPathComponent(syncFileName)

        do {
            try FileManager.default.createDirectory(at: docsDir, withIntermediateDirectories: true)
            guard let data = json.data(using: .utf8) else {
                return #"{"ok":false,"error":"encoding error"}"#
            }
            try data.write(to: fileURL, options: .atomic)
            return #"{"ok":true}"#
        } catch {
            return "{\"ok\":false,\"error\":\"\(esc(error.localizedDescription))\"}"
        }
    }

    /// Returns {"available":true} if iCloud is signed in and the container is accessible.
    func isAvailable() -> String {
        containerURL() != nil ? #"{"available":true}"# : #"{"available":false}"#
    }

    // MARK: - Helpers

    private func containerURL() -> URL? {
        FileManager.default.url(forUbiquityContainerIdentifier: containerID)
    }

    private func syncFileURL(in container: URL) -> URL {
        container.appendingPathComponent("Documents/\(syncFileName)")
    }

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
