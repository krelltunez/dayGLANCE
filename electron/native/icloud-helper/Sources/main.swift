import Foundation

// dayglance-icloud-helper
//
// Resolves the real iCloud ubiquity container URL via NSFileManager and prints it
// as JSON on stdout. The Electron main process spawns this (same pattern as the
// EventKit calendar helper) because under the Mac App Store sandbox the
// $HOME-relative path the unsandboxed Developer ID build uses
// (~/Library/Mobile Documents/iCloud~com~dayglance) points inside the sandbox
// container and can never reach Mobile Documents. `url(forUbiquityContainerIdentifier:)`
// returns the true container location honoring the app's iCloud entitlement.
//
// Subcommands:
//   container [identifier]  → {"url":"/Users/.../Mobile Documents/iCloud~com~dayglance"}
//                             or {"url":null} when iCloud is unavailable / not entitled.
// `identifier` is the iCloud-prefixed container ID (e.g. "iCloud.com.dayglance");
// when omitted, the app's primary container from its entitlements is used.

func resolveContainer(_ identifier: String?) -> String? {
    // url(forUbiquityContainerIdentifier:) performs blocking iCloud setup and must
    // not be called on the main thread; run it on a background queue and wait.
    var result: URL?
    let sem = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .userInitiated).async {
        result = FileManager.default.url(forUbiquityContainerIdentifier: identifier)
        sem.signal()
    }
    sem.wait()
    return result?.path
}

func printJSON(_ obj: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    } else {
        print("null")
    }
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
    printJSON(["error": "no command"])
    exit(1)
}

switch command {
case "container":
    let identifier = args.count > 1 ? args[1] : nil
    // NSNull so the JSON serializes as {"url":null} rather than failing on nil.
    printJSON(["url": resolveContainer(identifier) ?? NSNull()])

default:
    printJSON(["error": "unknown command: \(command)"])
    exit(1)
}
