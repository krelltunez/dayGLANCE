// swift-tools-version:5.9
//
// EntitlementRead: which copy of RevenueCat's customer info a billing status
// read uses. One rule for dayGLANCE, lastGLANCE and lifeGLANCE, kept as three
// byte-identical copies of this package (each repo's billing tests hold its
// copy to one fingerprint; change all three together).
//
// A package, and dependency-free (the rule is generic, so no RevenueCat), so
// `swift test` runs its behavioural tests on a Mac with no simulator, which is
// what each repo's ios.yml does.
import PackageDescription

let package = Package(
    name: "EntitlementRead",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "EntitlementRead", targets: ["EntitlementRead"]),
    ],
    targets: [
        .target(name: "EntitlementRead"),
        .testTarget(name: "EntitlementReadTests", dependencies: ["EntitlementRead"]),
    ]
)
