import Foundation
import StoreKit

// dayglance-storefront-helper
//
// A tiny CLI spawned by the Electron main process to report the Mac App Store
// storefront the app is running under. Used to comply with regional legal
// requirements — specifically suppressing generative-AI features on the China
// (CN) storefront per App Store Review Guideline 5 (Deep Synthesis / MIIT).
//
// Subcommand:
//   country → {"countryCode":"CHN"}  (ISO 3166-1 alpha-3, matching StoreKit)
//           → {"countryCode":null}   (storefront could not be determined)
//
// The main process treats a null/absent result as "unknown" and falls back to
// the OS region (app.getLocaleCountryCode), so a nil here never silently
// disables AI for the whole world — see electron/storefront.ts.

func printCountry(_ code: String?) {
    let obj: [String: Any] = ["countryCode": code as Any]
    if let data = try? JSONSerialization.data(withJSONObject: obj),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    } else {
        print("{\"countryCode\":null}")
    }
}

// Prefer StoreKit 2's Storefront.current (macOS 12+, authoritative, async).
// Fall back to StoreKit 1's SKPaymentQueue.storefront (macOS 11+), then nil.
// Both expose the storefront country as an ISO 3166-1 alpha-3 code.
func resolveAndExit() {
    if #available(macOS 12.0, *) {
        Task {
            let sk2 = await Storefront.current?.countryCode
            if let sk2 = sk2, !sk2.isEmpty {
                printCountry(sk2)
            } else if let sk1 = SKPaymentQueue.default().storefront?.countryCode, !sk1.isEmpty {
                printCountry(sk1)
            } else {
                printCountry(nil)
            }
            exit(0)
        }
        // Keep the process alive for the async Task above; exit(0) inside it ends us.
        RunLoop.main.run()
    } else if #available(macOS 11.0, *) {
        printCountry(SKPaymentQueue.default().storefront?.countryCode)
        exit(0)
    } else {
        printCountry(nil)
        exit(0)
    }
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "country":
    resolveAndExit()
default:
    printCountry(nil)
    exit(1)
}
