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
    /// {"downloading":true} if a fresher version is being fetched from iCloud,
    /// or {"error":"…"} if iCloud is not signed in.
    ///
    /// NSFileCoordinator alone does not force iCloud to pull a newer remote
    /// version when a local copy already exists — it only serialises against
    /// in-flight operations the local daemon is already aware of. We therefore
    /// always call startDownloadingUbiquitousItem and only return file bytes
    /// once the downloading status reports .current.
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

        // Always ask the daemon to pull the latest version. No-op if already current.
        try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)

        // If a newer remote version exists, the status will be .downloaded
        // (older bytes cached) rather than .current. Returning the cached bytes
        // would serve stale data, so signal the caller to retry instead.
        let status = (try? fileURL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?
            .ubiquitousItemDownloadingStatus
        if let status, status != .current {
            return #"{"downloading":true}"#
        }

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
        // Kick off a download for the changed file before notifying JS — otherwise
        // readSync() will see "file exists, no placeholder" and return cached bytes
        // from the previous version. The download is async; readSync() gates on
        // ubiquitousItemDownloadingStatus and will return {"downloading":true}
        // until the new bytes arrive, prompting JS to retry on its next poll.
        if let container = containerURL() {
            try? FileManager.default.startDownloadingUbiquitousItem(at: syncFileURL(in: container))
        }
        // Fire the same notification that scenePhase foreground transitions use,
        // so the JS sync cycle runs immediately without waiting for the 60-second poll.
        NotificationCenter.default.post(name: .dayGlanceForeground, object: nil)
    }

    // MARK: - File operations (intents + multi-user)

    /// Lists filenames (not full paths) in a directory relative to Documents/.
    /// Returns a JSON array, [] if the directory doesn't exist, or {"error":"iCloud not available"}.
    func listFiles(relativePath: String) -> String {
        guard let container = containerURL() else {
            return #"{"error":"iCloud not available"}"#
        }
        let docsDir = container.appendingPathComponent("Documents")
        let dirURL = docsDir.appendingPathComponent(relativePath)

        guard FileManager.default.fileExists(atPath: dirURL.path) else {
            return "[]"
        }

        let entries: [String]
        do {
            entries = try FileManager.default.contentsOfDirectory(atPath: dirURL.path)
        } catch {
            return "[]"
        }

        // Trigger download for any .icloud placeholder files (non-blocking).
        for entry in entries where entry.hasPrefix(".") && entry.hasSuffix(".icloud") {
            let inner = String(entry.dropFirst().dropLast(".icloud".count))
            let realURL = dirURL.appendingPathComponent(inner)
            try? FileManager.default.startDownloadingUbiquitousItem(at: realURL)
        }

        let names = entries.filter { !$0.hasPrefix(".") }
        let json = names.map { "\"\(esc($0))\"" }.joined(separator: ",")
        return "[\(json)]"
    }

    /// Reads a file relative to Documents/. Returns content, "null", {"downloading":true}, or {"error":"..."}.
    func readFile(relativePath: String) -> String {
        guard let container = containerURL() else {
            return #"{"error":"iCloud not available"}"#
        }
        let docsDir = container.appendingPathComponent("Documents")
        let fileURL = docsDir.appendingPathComponent(relativePath)

        let placeholderURL = fileURL.deletingLastPathComponent()
            .appendingPathComponent("." + fileURL.lastPathComponent + ".icloud")
        if FileManager.default.fileExists(atPath: placeholderURL.path) {
            try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
            return #"{"downloading":true}"#
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
            return "null"
        }

        try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)

        let status = (try? fileURL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?
            .ubiquitousItemDownloadingStatus
        if let status, status != .current {
            return #"{"downloading":true}"#
        }

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

    /// Writes content to a file relative to Documents/, creating parent directories.
    /// Returns {"ok":true} or {"ok":false,"error":"..."}.
    func writeFile(relativePath: String, content: String) -> String {
        guard let container = containerURL() else {
            return #"{"ok":false,"error":"iCloud not available"}"#
        }
        let docsDir = container.appendingPathComponent("Documents")
        let fileURL = docsDir.appendingPathComponent(relativePath)

        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            guard let data = content.data(using: .utf8) else {
                return #"{"ok":false,"error":"encoding error"}"#
            }
            // Write in-place (not atomic) to preserve iCloud xattrs so the daemon queues the upload.
            try data.write(to: fileURL, options: [])
            return #"{"ok":true}"#
        } catch {
            return "{\"ok\":false,\"error\":\"\(esc(error.localizedDescription))\"}"
        }
    }

    /// Deletes a file relative to Documents/. Idempotent — returns {"ok":true} if not found.
    func deleteFile(relativePath: String) -> String {
        guard let container = containerURL() else {
            return #"{"ok":false,"error":"iCloud not available"}"#
        }
        let docsDir = container.appendingPathComponent("Documents")
        let fileURL = docsDir.appendingPathComponent(relativePath)

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return #"{"ok":true}"#
        }

        do {
            try FileManager.default.removeItem(at: fileURL)
            return #"{"ok":true}"#
        } catch {
            return "{\"ok\":false,\"error\":\"\(esc(error.localizedDescription))\"}"
        }
    }

    /// Creates a directory (with intermediates) relative to Documents/.
    /// Returns {"ok":true} or {"ok":false,"error":"..."}.
    func makeDir(relativePath: String) -> String {
        guard let container = containerURL() else {
            return #"{"ok":false,"error":"iCloud not available"}"#
        }
        let docsDir = container.appendingPathComponent("Documents")
        let dirURL = docsDir.appendingPathComponent(relativePath)

        do {
            try FileManager.default.createDirectory(at: dirURL, withIntermediateDirectories: true)
            return #"{"ok":true}"#
        } catch {
            return "{\"ok\":false,\"error\":\"\(esc(error.localizedDescription))\"}"
        }
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
