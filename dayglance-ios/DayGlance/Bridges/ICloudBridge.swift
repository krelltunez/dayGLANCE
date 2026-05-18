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
    private let writeSuppressionInterval: TimeInterval = 2.0

    // MARK: - Public API

    /// Returns the sync file JSON, "null" if unavailable/not yet downloaded,
    /// or {"error":"…"} if iCloud is not signed in.
    ///
    /// Uses NSFileCoordinator for the actual read so iCloud refreshes the local
    /// copy from the cloud before we read it — without this, iOS can serve a
    /// stale cached version even when the Mac has written a newer one.
    func readSync() -> String {
        guard let container = containerURL() else {
            return #"{"error":"iCloud not available"}"#
        }
        let fileURL = syncFileURL(in: container)

        // On older iOS versions, a cloud-only file appears as a hidden .filename.icloud
        // placeholder. Detect it before attempting a coordinated read.
        let placeholderURL = fileURL.deletingLastPathComponent()
            .appendingPathComponent("." + fileURL.lastPathComponent + ".icloud")
        if FileManager.default.fileExists(atPath: placeholderURL.path) {
            try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
            return #"{"downloading":true}"#
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            // File doesn't exist locally — request download and signal caller to retry.
            try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
            return "null"
        }

        // Coordinated read: iCloud will freshen the local copy from the server
        // before our read block executes, ensuring we get the latest version.
        var result = "null"
        var coordError: NSError?
        let coordinator = NSFileCoordinator()
        coordinator.coordinate(readingItemAt: fileURL, options: [], error: &coordError) { url in
            guard let data = try? Data(contentsOf: url),
                  let str  = String(data: data, encoding: .utf8) else { return }
            result = str
        }
        if let err = coordError {
            return "{\"error\":\"\(esc(err.localizedDescription))\"}"
        }
        return result
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

        // NSMetadataQueryDidFinishGathering must be observed — the query won't
        // post NSMetadataQueryDidUpdate until the initial gathering phase completes.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleQueryUpdate),
            name: .NSMetadataQueryDidFinishGathering,
            object: q
        )
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
