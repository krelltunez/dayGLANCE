import Foundation
import UIKit
import UniformTypeIdentifiers

/// iOS Obsidian vault bridge for window.DayGlanceObsidian.
///
/// Vault access uses a security-scoped bookmark persisted in UserDefaults —
/// the iOS equivalent of Android's SAF persistent tree URI. File I/O uses
/// FileManager, mirroring ObsidianRepository.kt's DocumentFile operations.
///
/// JS contract (identical to Android):
///   pickVault()                              → void  (presents UIDocumentPickerViewController)
///   isVaultConfigured()                      → "true" | "false"
///   getVaultConfig()                         → {configured, folder, pattern, newNotesFolder}
///   getDailyNote(date)                       → raw markdown | ""
///   writeDailyNote(date, content)            → "true" | "false"
///   listNotes(folder)                        → JSON array of paths
///   getAllDailyNotes(folder, cutoff)          → JSON array of {date, text}
///   appendToNote(path, content)              → "true" | "false"
///   getNote(path)                            → {text, lastModified} | ""
///   writeNote(path, content)                 → "true" | "false"
///   getTasksFromNote(path)                   → JSON array of {text, completed, line}
///   buildNoteIndex()                         → void
///   clearVault()                             → void
///   openNote(noteName)                       → void  (opens obsidian:// URL)
final class ObsidianBridge: NSObject {

    static let shared = ObsidianBridge()

    // UserDefaults keys
    private let bookmarkKey        = "dayglance.obsidian.vaultBookmark"
    private let folderKey          = "dayglance.obsidian.dailyNoteFolder"
    private let patternKey         = "dayglance.obsidian.dailyNotePattern"
    private let newNotesFolderKey  = "dayglance.obsidian.newNotesFolder"

    // In-memory note index: lowercase name (no .md) → absolute URL
    private var noteIndex: [String: URL] = [:]
    private var noteIndexBuilt = false

    // MARK: - Vault bookmark

    private func vaultURL() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: data,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        ) else { return nil }
        if stale, let fresh = try? url.bookmarkData(options: []) {
            UserDefaults.standard.set(fresh, forKey: bookmarkKey)
        }
        return url
    }

    /// Calls `body` with the vault root URL while the security scope is active.
    /// Returns `fallback` if the vault isn't configured or access fails.
    private func withVault<T>(fallback: T, _ body: (URL) -> T) -> T {
        guard let url = vaultURL() else { return fallback }
        guard url.startAccessingSecurityScopedResource() else { return fallback }
        defer { url.stopAccessingSecurityScopedResource() }
        return body(url)
    }

    // MARK: - pickVault

    func pickVault() {
        DispatchQueue.main.async {
            guard let rootVC = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first?.windows.first?.rootViewController else { return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            rootVC.present(picker, animated: true)
        }
    }

    // MARK: - isVaultConfigured / getVaultConfig / clearVault

    func isVaultConfigured() -> String {
        UserDefaults.standard.data(forKey: bookmarkKey) != nil ? "true" : "false"
    }

    func getVaultConfig() -> String {
        let configured  = UserDefaults.standard.data(forKey: bookmarkKey) != nil
        let folder      = UserDefaults.standard.string(forKey: folderKey) ?? ""
        let pattern     = UserDefaults.standard.string(forKey: patternKey) ?? "yyyy-MM-dd"
        let newFolder   = UserDefaults.standard.string(forKey: newNotesFolderKey) ?? "dayGLANCE"
        return #"{"configured":\#(configured),"folder":"\#(esc(folder))","pattern":"\#(esc(pattern))","newNotesFolder":"\#(esc(newFolder))"}"#
    }

    func clearVault() {
        UserDefaults.standard.removeObject(forKey: bookmarkKey)
        noteIndex.removeAll()
        noteIndexBuilt = false
    }

    /// Persists folder/pattern/newNotesFolder from the web settings UI to UserDefaults
    /// so getDailyNote/writeDailyNote use the correct path without needing a native SettingsActivity.
    func setVaultSettings(folder: String, pattern: String, newNotesFolder: String) {
        UserDefaults.standard.set(folder, forKey: folderKey)
        UserDefaults.standard.set(pattern, forKey: patternKey)
        UserDefaults.standard.set(newNotesFolder, forKey: newNotesFolderKey)
    }

    // MARK: - getDailyNote / writeDailyNote

    func getDailyNote(date: String) -> String {
        withVault(fallback: "") { vault in
            guard let fileName = dailyNoteFileName(date: date) else { return "" }
            let file = dailyNoteURL(vault: vault, fileName: fileName)
            return (try? String(contentsOf: file, encoding: .utf8)) ?? ""
        }
    }

    func writeDailyNote(date: String, content: String) -> String {
        withVault(fallback: "false") { vault in
            guard let fileName = dailyNoteFileName(date: date) else { return "false" }
            let dir = dailyNoteDir(vault: vault)
            createDirs(at: dir)
            let file = dir.appendingPathComponent(fileName)
            return write(content, to: file) ? "true" : "false"
        }
    }

    // MARK: - listNotes

    func listNotes(folder: String) -> String {
        withVault(fallback: "[]") { vault in
            let dir = folder.isEmpty ? vault : vault.appendingPathComponent(folder)
            let prefix = folder.isEmpty ? "" : "\(folder)/"
            guard let entries = try? FileManager.default.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: nil
            ) else { return "[]" }
            let paths = entries
                .filter { $0.pathExtension == "md" }
                .map { "\"\(esc(prefix + $0.lastPathComponent))\"" }
                .sorted(by: >)
                .joined(separator: ",")
            return "[\(paths)]"
        }
    }

    // MARK: - getAllDailyNotes

    func getAllDailyNotes(folder: String, cutoff: String) -> String {
        withVault(fallback: "[]") { vault in
            let dir = folder.isEmpty ? vault : vault.appendingPathComponent(folder)
            guard let entries = try? FileManager.default.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: nil
            ) else { return "[]" }

            let dateRe = try? NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}$"#)
            var items: [String] = []
            for entry in entries {
                guard entry.pathExtension == "md" else { continue }
                let dateStr = entry.deletingPathExtension().lastPathComponent
                let range = NSRange(dateStr.startIndex..., in: dateStr)
                guard dateRe?.firstMatch(in: dateStr, range: range) != nil else { continue }
                if !cutoff.isEmpty && dateStr < cutoff { continue }
                let text = (try? String(contentsOf: entry, encoding: .utf8)) ?? ""
                items.append(#"{"date":"\#(dateStr)","text":"\#(esc(text))"}"#)
            }

            if !noteIndexBuilt { buildNoteIndex(vault: vault) }
            return "[\(items.joined(separator: ","))]"
        }
    }

    // MARK: - appendToNote

    func appendToNote(path: String, content: String) -> String {
        withVault(fallback: "false") { vault in
            let segments = path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
            guard !segments.isEmpty else { return "false" }
            let fileName  = segments.last!
            let folderPath = segments.dropLast().joined(separator: "/")
            let dir = folderPath.isEmpty ? vault : vault.appendingPathComponent(folderPath)
            createDirs(at: dir)
            let file = dir.appendingPathComponent(fileName)
            let existing = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
            let sep = (!existing.isEmpty && !existing.hasSuffix("\n")) ? "\n" : ""
            return write("\(existing)\(sep)\(content)", to: file) ? "true" : "false"
        }
    }

    // MARK: - getNote

    func getNote(path: String) -> String {
        withVault(fallback: "") { vault in
            let segments = path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
            guard !segments.isEmpty else { return "" }
            let noteName = segments.last!
            let fileURL: URL
            if segments.count > 1 {
                let folderPath = segments.dropLast().joined(separator: "/")
                fileURL = vault.appendingPathComponent(folderPath).appendingPathComponent("\(noteName).md")
            } else {
                if !noteIndexBuilt { buildNoteIndex(vault: vault) }
                guard let indexed = noteIndex[noteName.lowercased()] else { return "" }
                fileURL = indexed
            }
            guard let text = try? String(contentsOf: fileURL, encoding: .utf8) else { return "" }
            let modified = (try? fileURL.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            let iso = modified.map { ISO8601DateFormatter().string(from: $0) } ?? ""
            return #"{"text":"\#(esc(text))","lastModified":"\#(iso)"}"#
        }
    }

    // MARK: - writeNote

    func writeNote(path: String, content: String) -> String {
        withVault(fallback: "false") { vault in
            let segments = path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
            guard !segments.isEmpty else { return "false" }
            let noteName = segments.last!
            let fileName = "\(noteName).md"
            let fileURL: URL
            if segments.count > 1 {
                let folderPath = segments.dropLast().joined(separator: "/")
                let dir = vault.appendingPathComponent(folderPath)
                createDirs(at: dir)
                fileURL = dir.appendingPathComponent(fileName)
            } else {
                if !noteIndexBuilt { buildNoteIndex(vault: vault) }
                if let indexed = noteIndex[noteName.lowercased()] {
                    fileURL = indexed
                } else {
                    let newFolder = UserDefaults.standard.string(forKey: newNotesFolderKey) ?? "dayGLANCE"
                    let dir = newFolder.isEmpty ? vault : vault.appendingPathComponent(newFolder)
                    createDirs(at: dir)
                    fileURL = dir.appendingPathComponent(fileName)
                    noteIndex[noteName.lowercased()] = fileURL
                }
            }
            return write(content, to: fileURL) ? "true" : "false"
        }
    }

    // MARK: - getTasksFromNote

    func getTasksFromNote(path: String) -> String {
        withVault(fallback: "[]") { vault in
            let segments = path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
            guard !segments.isEmpty else { return "[]" }
            let fileName   = segments.last!
            let folderPath = segments.dropLast().joined(separator: "/")
            let fileURL    = folderPath.isEmpty
                ? vault.appendingPathComponent(fileName)
                : vault.appendingPathComponent(folderPath).appendingPathComponent(fileName)
            guard let text = try? String(contentsOf: fileURL, encoding: .utf8) else { return "[]" }

            let taskRe = try? NSRegularExpression(pattern: #"^- \[([xX ])\] (.+)$"#)
            var items: [String] = []
            for (i, line) in text.components(separatedBy: "\n").enumerated() {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                let range = NSRange(trimmed.startIndex..., in: trimmed)
                guard let match = taskRe?.firstMatch(in: trimmed, range: range) else { continue }
                let completed = (trimmed as NSString).substring(with: match.range(at: 1)).lowercased() == "x"
                let taskText  = (trimmed as NSString).substring(with: match.range(at: 2))
                items.append(#"{"text":"\#(esc(taskText))","completed":\#(completed),"line":\#(i + 1)}"#)
            }
            return "[\(items.joined(separator: ","))]"
        }
    }

    // MARK: - buildNoteIndex / openNote

    func buildNoteIndex() {
        withVault(fallback: ()) { vault in buildNoteIndex(vault: vault) }
    }

    func openNote(noteName: String) {
        let vaultName: String = withVault(fallback: "") { url in url.lastPathComponent }
        guard !vaultName.isEmpty,
              let encoded = noteName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let vaultEncoded = vaultName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "obsidian://open?vault=\(vaultEncoded)&file=\(encoded)") else { return }
        DispatchQueue.main.async { UIApplication.shared.open(url) }
    }

    // MARK: - Private helpers

    private func buildNoteIndex(vault: URL) {
        var fresh: [String: URL] = [:]
        indexDirectory(vault, into: &fresh)
        noteIndex = fresh
        noteIndexBuilt = true
    }

    private func indexDirectory(_ dir: URL, into index: inout [String: URL]) {
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: .skipsHiddenFiles
        ) else { return }
        for entry in entries {
            let isDir = (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            if isDir {
                indexDirectory(entry, into: &index)
            } else if entry.pathExtension == "md" {
                let name = entry.deletingPathExtension().lastPathComponent.lowercased()
                index[name] = entry
            }
        }
    }

    private func dailyNoteFileName(date: String) -> String? {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.locale = Locale(identifier: "en_US_POSIX")
        guard let parsed = fmt.date(from: date) else { return nil }
        let pattern = UserDefaults.standard.string(forKey: patternKey) ?? "yyyy-MM-dd"
        let out = DateFormatter()
        out.dateFormat = pattern
        out.locale = Locale(identifier: "en_US_POSIX")
        return "\(out.string(from: parsed)).md"
    }

    private func dailyNoteDir(vault: URL) -> URL {
        let folder = UserDefaults.standard.string(forKey: folderKey) ?? ""
        return folder.isEmpty ? vault : vault.appendingPathComponent(folder)
    }

    private func dailyNoteURL(vault: URL, fileName: String) -> URL {
        dailyNoteDir(vault: vault).appendingPathComponent(fileName)
    }

    private func createDirs(at url: URL) {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    private func write(_ text: String, to url: URL) -> Bool {
        (try? text.write(to: url, atomically: true, encoding: .utf8)) != nil
    }

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
         .replacingOccurrences(of: "\n", with: "\\n")
         .replacingOccurrences(of: "\r", with: "\\r")
         .replacingOccurrences(of: "\t", with: "\\t")
    }
}

// MARK: - UIDocumentPickerDelegate

extension ObsidianBridge: UIDocumentPickerDelegate {

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let bookmark = try? url.bookmarkData(options: []) else { return }
        UserDefaults.standard.set(bookmark, forKey: bookmarkKey)
        noteIndex.removeAll()
        noteIndexBuilt = false
        // Reload the webview so the JS vault-detection logic re-runs with the new vault
        NotificationCenter.default.post(name: .dayGlanceReloadWebView, object: nil)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {}
}
