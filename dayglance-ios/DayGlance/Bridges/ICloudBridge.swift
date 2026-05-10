import Foundation

/// Reads and writes dayglance-sync.json in the app's iCloud ubiquitous container,
/// enabling zero-config sync across iOS/iPadOS devices on the same Apple ID.
///
/// Called synchronously from the JS bridge on a WKURLSchemeHandler background thread.
final class ICloudBridge {

    static let shared = ICloudBridge()

    private let containerID   = "iCloud.com.dayglance"
    private let syncFileName  = "dayglance-sync.json"

    // MARK: - Remote-change watching

    private var metadataQuery: NSMetadataQuery?

    // Suppress query callbacks that fire immediately after our own local write.
    private var lastLocalWriteDate: Date?
    private let writeSuppressionInterval: TimeInterval = 5.0

    // MARK: - Public API

    /// Returns the sync file JSON, "null" if unavailable/not yet downloaded,
    /// or {"error":"…"} if iCloud is not signed in.
    func readSync() -> String {
        guard let container = containerURL() else {
            return #"{"error":"iCloud not available"}"#
        }
        let fileURL = syncFileURL(in: container)

        // On older iOS versions, a cloud-only file appears as a hidden .filename.icloud
        // placeholder whose body is metadata, not JSON. Detect it before fileExists() so
        // we never accidentally read placeholder bytes as sync data.
        let placeholderURL = fileURL.deletingLastPathComponent()
            .appendingPathComponent("." + fileURL.lastPathComponent + ".icloud")
        if FileManager.default.fileExists(atPath: placeholderURL.path) {
            try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
            return #"{"downloading":true}"#
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return "null"
        }

        // Trigger download if the file exists in cloud but hasn't been fetched locally yet.
        try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)

        // If it's still a cloud-only placeholder per the ubiquitous status API, signal
        // "downloading" so the caller doesn't seed iCloud with empty/stale data.
        if let values = try? fileURL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
           let status = values.ubiquitousItemDownloadingStatus,
           status == .notDownloaded {
            return #"{"downloading":true}"#
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
            lastLocalWriteDate = Date()
            try data.write(to: fileURL, options: .atomic)
            return #"{"ok":true}"#
        } catch {
            return "{\"ok\":false,\"error\":\"\(esc(error.localizedDescription))\"}"
        }
    }

    /// Returns {"available":true} if iCloud is signed in and the container is accessible.
    /// Also kicks off NSMetadataQuery watching the first time availability is confirmed.
    func isAvailable() -> String {
        guard containerURL() != nil else { return #"{"available":false}"# }
        DispatchQueue.main.async { self.startWatching() }
        return #"{"available":true}"#
    }

    // MARK: - NSMetadataQuery watch

    /// Starts an NSMetadataQuery that watches the iCloud sync file for remote changes
    /// (e.g. the macOS app wrote while the iOS app was open). Must run on main thread.
    private func startWatching() {
        guard metadataQuery == nil else { return }

        let q = NSMetadataQuery()
        q.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        q.predicate = NSPredicate(format: "%K == %@", NSMetadataItemFSNameKey, syncFileName)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleQueryUpdate),
            name: .NSMetadataQueryDidUpdate,
            object: q
        )

        q.start()
        metadataQuery = q
    }

    @objc private func handleQueryUpdate() {
        // Skip if the change was caused by our own recent write.
        if let lastWrite = lastLocalWriteDate,
           Date().timeIntervalSince(lastWrite) < writeSuppressionInterval {
            return
        }
        // Fire the same notification that scenePhase foreground transitions use,
        // so the JS sync cycle runs immediately without waiting for the 60-second poll.
        NotificationCenter.default.post(name: .dayGlanceForeground, object: nil)
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
