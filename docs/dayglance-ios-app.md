This document describes the strategy and phased implementation plan for an iOS version of dayGLANCE, based on the existing Android architecture.

---

## Table of Contents

- [Architecture approach](#architecture-approach)
- [What transfers for free](#what-transfers-for-free)
- [macOS ↔ iOS sync (iCloud)](#macos--ios-sync-icloud)
- [Bridge parity: Android → iOS](#bridge-parity-android--ios)
- [Feature delta: what changes on iOS](#feature-delta-what-changes-on-ios)
- [iOS-exclusive features](#ios-exclusive-features)
- [Phased implementation plan](#phased-implementation-plan)
- [Post-launch roadmap](#post-launch-roadmap)
- [native.js changes](#nativejs-changes)
- [Open questions](#open-questions)

---

## Architecture approach

The iOS app follows the exact same pattern as Android: a **WKWebView shell** loading the bundled React SPA from local assets, with Swift bridge objects injected into the JavaScript context to mirror `window.DayGlanceNative` and `window.DayGlanceObsidian`.

```
┌─────────────────────────────────────────────────────┐
│              React SPA (same web build)              │
│   native.js detects iOS bridge, degrades on PWA     │
└────────────┬──────────────────────┬─────────────────┘
             │ window.DayGlanceNative│ window.DayGlanceObsidian
    ┌────────▼────────┐     ┌────────▼────────┐
    │  Swift NativeBridge  │     │ Swift ObsidianBridge │
    │  (WKScriptMessageHandler) │ (WKScriptMessageHandler) │
    └────────┬────────┘     └────────┬────────┘
             │                       │
   ┌─────────▼─────────────────────────────────────┐
   │  EventKit · HealthKit · UNUserNotifications    │
   │  URLSession · AVAudioRecorder · WidgetKit      │
   │  App Intents · ActivityKit · UIImpactFeedback  │
   └────────────────────────────────────────────────┘
```

The web build gets a sibling `vite.config.ios.js` (identical to `vite.config.android.js` — relative base path, no Vercel telemetry, no crossorigin attributes) outputting to `dayglance-ios/DayGlance/Resources/web/`.

The JS bridge communication differs slightly: Android uses synchronous `JavascriptInterface` calls that return strings directly, while WKWebView requires async message passing. The cleanest approach is to keep the same synchronous-looking JS API by using `WKWebView.evaluateJavaScript` to post return values back, with a small promise wrapper on the JS side. Alternatively, use `WKURLSchemeHandler` for truly synchronous responses — that approach is simpler for the existing call sites.

---

## What transfers for free

| Component | Status |
|---|---|
| All React UI in `App.jsx` | No changes needed |
| `src/native.js` bridge wrappers | Minor additions (see below) |
| `src/obsidian.js` markdown parser | No changes needed |
| `src/mergeSync.js` WebDAV engine | No changes needed |
| `src/ai.js` / AI features | No changes needed |
| `vite.config.android.js` approach | Clone for iOS |
| WebDAV sync | Works via `URLSession` HTTP bridge |
| TRMNL integration | No changes needed |
| localStorage data model | WKWebView uses same Web Storage API |

---

## macOS ↔ iOS sync (iCloud)

Both the macOS (Electron) and iOS apps can sync automatically via a shared iCloud ubiquity container — zero user configuration required beyond being signed into the same Apple ID on both devices. WebDAV remains available alongside iCloud for users who also sync with Android or other platforms.

### Mechanism

The app's data model lives in `localStorage` inside the webview. iCloud sync serialises this to a single JSON file in a shared iCloud container, using the same merge strategy as the existing `mergeSync.js` WebDAV engine (timestamp-per-item, last-write-wins per field).

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  macOS (Electron)        │         │  iOS (WKWebView shell)   │
│                          │         │                          │
│  Electron main process   │         │  CloudSyncBridge.swift   │
│  icloud-sync.ts          │◄───────►│  NSMetadataQuery watch   │
│  fs.watch on container   │         │  FileManager ubiquity    │
│                          │  iCloud │                          │
│  IPC: icloud:read/write  │  Drive  │  nativeGetCloudData()    │
│  → renderer mergeSync    │         │  nativeSetCloudData()    │
└──────────────────────────┘         └──────────────────────────┘
              │                                   │
              └──────────── iCloud container ─────┘
                   iCloud.com.dayglance.app
                   Documents/dayglance-data.json
```

### macOS side (Electron)

Electron apps can access iCloud Drive once the app holds the correct entitlements:

- `com.apple.developer.icloud-container-identifiers` → `["iCloud.com.dayglance.app"]`
- `com.apple.developer.ubiquity-kvstore-identifier` → `$(TeamIdentifierPrefix)com.dayglance.app`

The container path is predictable: `~/Library/Mobile Documents/iCloud~com~dayglance~app/Documents/dayglance-data.json`. A new `electron/icloud-sync.ts` module:

1. Checks whether the path exists and iCloud Drive is available (the entitlement is present and the user is signed in).
2. Reads the file on startup and sends the data to the renderer via `icloud:data` IPC.
3. Watches the file with `fs.watch` for remote changes (iOS writing while the Mac app is open) and re-sends via IPC.
4. Exposes an `icloud:write` IPC handler the renderer calls after any local mutation, writing the merged JSON back to the container file.

`icloudSyncAvailable()` returns `false` gracefully if the entitlement is missing, iCloud is disabled, or the platform is not macOS — no error surfaces to the user.

### iOS side (Swift)

A new `CloudSyncBridge.swift` exposes two bridge calls:

| JS call | Swift action |
|---|---|
| `nativeGetCloudData()` | Reads `dayglance-data.json` from the ubiquity container; returns JSON string or `null` |
| `nativeSetCloudData(json)` | Writes JSON string to the ubiquity container; iCloud propagates to macOS automatically |
| `nativeIsCloudSyncAvailable()` | Returns `true` if `ubiquityIdentityToken` is non-nil (user is signed into iCloud) |

On app launch, `CloudSyncBridge` starts an `NSMetadataQuery` scoped to `NSMetadataQueryUbiquitousDocumentsScope` watching for changes to `dayglance-data.json`. When the query fires (macOS wrote a change), the bridge calls `evaluateJavaScript` on the webview to trigger a merge in the web layer — same path as WebDAV's `mergeSync.js` reconcile.

### Merge strategy

No new merge logic is needed. The existing `mergeSync.js` already handles the read-merge-write cycle. iCloud sync is just a new transport that calls into the same merge function:

```
readCloudData() → mergeSync.merge(local, remote) → writeCloudData(merged)
```

Conflicts (both sides wrote while offline) are resolved identically to WebDAV: most-recent `updatedAt` timestamp per item wins. The merged result is written back so both sides converge.

### Coexistence with WebDAV

iCloud and WebDAV sync are independent providers and can both be active:

| Scenario | Behaviour |
|---|---|
| Apple-only (Mac + iPhone) | iCloud only — no config needed |
| Cross-platform (+ Android) | WebDAV for Android; iCloud for Mac ↔ iPhone |
| Both configured | iCloud syncs Apple devices continuously; WebDAV syncs on demand with Android/other |

iCloud sync is enabled by default (if available) and requires no settings UI. WebDAV remains opt-in via the existing settings screen.

### Entitlements + App Store requirements

- iCloud capability must be enabled in the App Store Connect record for both the macOS and iOS apps.
- The iCloud container (`iCloud.com.dayglance.app`) is registered once in the Apple Developer portal and shared by both apps.
- The macOS Electron app's `entitlements.plist` (already used for notarization) gets the two iCloud keys added.
- `PrivacyInfo.xcprivacy` (required for iOS 17+ App Store) must declare use of `NSPrivacyAccessedAPICategoryFileTimestamp` for the container file access.

---

## Bridge parity: Android → iOS

Each Android bridge class gets a Swift equivalent. All method signatures exposed to JS remain identical so `native.js` needs no call-site changes — only the bridge detection logic changes.

| Android (Kotlin) | iOS (Swift) | Notes |
|---|---|---|
| `NativeBridge.kt` | `NativeBridge.swift` | Top-level WKScriptMessageHandler dispatcher |
| `HealthBridge.kt` | `HealthBridge.swift` | HealthKit instead of Health Connect; same JSON shape |
| `CalendarBridge.kt` | `CalendarBridge.swift` | EventKit instead of CalendarProvider |
| `NotificationBridge.kt` | `NotificationBridge.swift` | UNUserNotificationCenter; see notes below |
| `HttpBridge.kt` | `HttpBridge.swift` | URLSession; straightforward |
| `ObsidianBridge.kt` | `ObsidianBridge.swift` | Security-scoped bookmarks; see notes below |
| `FocusBridge.kt` | ~~Not implemented~~ | DND/Focus control not available to iOS apps |
| `AudioBridge` (in MainActivity) | `AudioBridge.swift` | AVAudioRecorder; same base64 MP4 output |

### HealthKit vs Health Connect

HealthKit is a direct drop-in for the steps + sleep data we already read, and it's richer:

- `HKStatisticsQuery` for step count → same `{ steps, goal }` JSON
- `HKCategoryTypeIdentifier.sleepAnalysis` for sleep stages → same `{ duration, stages }` JSON
- **Bonus data available**: HRV, resting heart rate, blood oxygen, respiratory rate — can be surfaced in a richer sleep card without any web-layer changes beyond reading the extra fields

Health Connect on Android requires the Health Connect app to be installed; HealthKit is built into every iPhone. Permission flow is simpler.

### EventKit vs CalendarProvider

EventKit maps cleanly to the existing `getEvents` / `createEvent` / `updateEvent` / `deleteEvent` API. One difference: Android can silently read all synced calendars; iOS requires the user to grant `NSCalendarsUsageDescription` permission first, which is functionally the same user-visible experience.

### UNUserNotificationCenter vs AlarmManager

`UNUserNotificationCenter` with `UNCalendarNotificationTrigger` handles scheduled reminders. The key differences:

- **No boot receiver needed**: iOS restores scheduled notifications automatically after restart.
- **No exact-alarm permission dialog**: iOS notifications just work once `requestAuthorization` is granted.
- **Less precise**: iOS can delay notifications by a few minutes in low-power mode. Acceptable for task reminders.
- **Notification action buttons** (Snooze, Mark Complete): fully supported via `UNNotificationAction` / `UNNotificationCategory`. The pending-action polling pattern (`nativeGetPendingAction`) works the same — store the action in UserDefaults, read it on next app foreground.
- **Snooze**: can use `UNTimeIntervalNotificationTrigger` for 15-minute reschedule, same as Android.

### Obsidian / file access on iOS

Obsidian on iOS stores vaults in iCloud Drive (`/private/var/mobile/Library/Mobile Documents/md~obsidian/Documents/<vault>/`) or in the Obsidian app's local sandbox. The recommended approach:

1. Use `UIDocumentPickerViewController` (equivalent of Android's SAF picker) for the user to select their vault folder once.
2. Save a **security-scoped bookmark** (`URL.bookmarkData(options: .withSecurityScope)`) in UserDefaults — this is the iOS equivalent of SAF persistent URI permissions and survives app restarts.
3. Call `url.startAccessingSecurityScopedResource()` / `stopAccessingSecurityScopedResource()` around each read/write.

This works for iCloud Drive vaults. Local-only vaults inside the Obsidian app sandbox are not accessible (iOS app sandboxing), but iCloud vaults are accessible from the Files app picker, which covers most Obsidian iOS users. A settings screen (equivalent to `SettingsActivity`) is needed for the one-time vault selection.

---

## Feature delta: what changes on iOS

### Focus mode (DND)

iOS provides no API for an app to enable/disable the system Focus mode or Do Not Disturb. The `nativeEnterFocusMode` / `nativeExitFocusMode` / `nativeIsDndPermissionGranted` bridge calls will return `null` / `false` on iOS.

In `App.jsx`, the focus mode UI should gracefully degrade: hide the "Enable DND" toggle on iOS (it can detect platform via the bridge detection logic), but still support the immersive full-screen mode using WKWebView's `setValue(true, forKey: "fullscreenEnabled")` and hiding the status bar via `prefersStatusBarHidden`.

### Home screen widget

Android ships three widget types: **Up Next**, **Goal**, and **Project**. The iOS equivalents mirror these using WidgetKit static SwiftUI snapshots (WidgetKit does not support scrollable lists).

| Widget | Small (2×2) | Medium (2×4) | Large (4×4) |
|---|---|---|---|
| **Up Next** | Next task/event + time | Up to 5 upcoming items | Up to 10 upcoming items |
| **Goal** | Goal name + progress ring | Goal name + progress bar + streak | Goal details + recent history |
| **Project** | Project name + % complete | Project name + next 3 tasks | Project name + full task list |

All three widgets read from an **App Group shared container** (`UserDefaults(suiteName: "group.com.dayglance.app")`), the iOS equivalent of Android's `SharedDataStore`. The web layer writes snapshot JSON via a `nativeUpdateWidgetSnapshot(type, json)` bridge call (Up Next, Goal, and Project each get their own snapshot key). A `BGAppRefreshTask` refreshes snapshots every 15–30 minutes, same as `WorkManager` on Android.

**Note**: iOS 17+ WidgetKit interactive widgets (buttons) make habit check-off or task complete directly from the widget feasible — same capability already on Android — as a follow-on to the initial static implementation.

### iPad layout (required at launch)

iPad is a day-one target. The existing React UI scales well and the `max-w-*` Tailwind constraints already handle wider viewports acceptably. Required work:

- `UIRequiresFullScreen = false` in Info.plist — iPad apps must support split view and slide-over or Apple will reject them
- All orientations enabled on iPad (`UISupportedInterfaceOrientations~ipad`)
- System keyboard shortcut overlay (iPadOS shows ⌘-key cheatsheet on long-press — no code needed, just ensure the app doesn't suppress it)
- Swift injects `window.isIPad = true` flag at launch; web layer can use this for any layout adjustments if the default scaling looks off in practice

iPad Lock Screen widgets (iPadOS 17+) have much more horizontal space than iPhone — the medium widget could show a full day agenda column, added in Phase 12.

---

## iOS-exclusive features

These have no Android equivalent and represent genuine differentiators for the iOS version.

### 1. Siri Shortcuts / App Intents

With the App Intents framework (iOS 16+), dayGLANCE can expose intents that users invoke by voice or via Shortcuts:

- "Add task to dayGLANCE" — opens the app to the add-task sheet with pre-filled text
- "What's on my agenda today?" — Siri reads back the next 3 scheduled items
- "Start focus session" — launches the focus mode timer directly

Implementation: define `AppIntent` conforming structs in Swift. The "open with parameter" intents use `ForegroundContinuableIntent` to hand off to the app. The "read agenda" intent can be fully headless using the shared App Group data.

### 2. Live Activities (Dynamic Island / Lock Screen)

ActivityKit (iOS 16.2+) lets dayGLANCE push a persistent live update to the Dynamic Island (iPhone 14 Pro+) and the Lock Screen during a focus session or while a task is in progress.

Use cases:
- **Focus session**: countdown timer visible at a glance without unlocking the phone, matching the in-app focus mode experience
- **Next task**: show the title and time of the next scheduled task while the phone is locked

Implementation: define an `ActivityAttributes` struct with the session state (time remaining, task title). The Swift bridge calls `Activity<DayGlanceAttributes>.request(...)` when focus mode starts and `activity.end(...)` when it ends. The web layer triggers this via a new `nativeStartLiveActivity(title, durationSeconds)` bridge call.

### 3. Focus Filters (iOS 16+)

Apps can register a `SetFocusFilterIntent` that the system calls when the user switches Focus modes (Work, Personal, Sleep, etc.). dayGLANCE could:

- Show only work calendars during Work Focus
- Hide personal tasks / show only work tasks during Work Focus
- Suppress all notifications during Sleep Focus (complementary to the user's own DND)

Implementation: an `AppFocusFilterIntent` struct in Swift stores the user's preference per Focus mode. When the system activates a Focus, the intent fires and writes to the App Group container; the web app reads this flag on next foreground.

### 4. StandBy mode (iOS 17+, iPhone only)

When an iPhone is charging in landscape orientation, iOS shows StandBy. Apps can provide a WidgetKit widget that renders full-screen in StandBy.

A large WidgetKit widget variant (the full-width StandBy size) could show:
- Current time (large)
- Today's remaining agenda items
- Active focus session countdown if running

This is implemented as an additional widget size/configuration in the same WidgetKit extension — no separate code path needed beyond a new SwiftUI view for the large variant.

### 5. Haptic feedback

iOS's `UIImpactFeedbackGenerator` and `UINotificationFeedbackGenerator` support distinct haptic patterns. Proposed mapping:

| Action | Haptic |
|---|---|
| Task complete | `.success` (notification feedback) |
| Habit logged | `.medium` impact |
| Focus session start | `.heavy` impact |
| Reminder fires | `.warning` (notification feedback) |
| Task deleted | `.light` impact |

Implementation: `nativeHaptic(type: string)` bridge call, called from App.jsx at existing action points. No-op on Android (or uses `Vibrator` if desired as a follow-up).

### 6. Share Extension

An iOS Share Extension lets users share text or URLs from any app (Safari, Notes, Reminders, etc.) directly into dayGLANCE as a new task. The extension writes to the App Group container; on next app open, dayGLANCE reads it and pre-populates the add-task sheet.

---

## Phased implementation plan

### Phase 1 — Xcode project shell + WebView (Foundation)

- Create `dayglance-ios/` Xcode project (Swift, SwiftUI app lifecycle)
- `ContentView` hosts a `WKWebView` loading requests via `WKURLSchemeHandler` (chosen over promise-wrapper approach: keeps all `native.js` call sites synchronous-looking with no changes)
- `vite.config.ios.js` (clone of android config) outputting to `dayglance-ios/DayGlance/Resources/web/`
- Build script: `npm run build:ios` → Vite build → copy assets → open Xcode
- Status bar colour matching + safe area insets; portrait lock on iPhone, all orientations on iPad
- iPad split view / multitasking support (`UIRequiresFullScreen = false`); system keyboard shortcut overlay
- Bridge detection: inject `window.DayGlanceIOS = true` so `native.js` can distinguish iOS from Android
- App icon, launch screen, bundle ID (`com.dayglance.app`)

**Status: ✅ Complete.** Minor gap: status bar text colour is static (`UIStatusBarStyleDefault`) — does not flip to white in dark mode. Cosmetic; can be addressed in Phase 12 polish.

### Phase 2 — Health (HealthKit)

- `HealthBridge.swift`: steps via `HKStatisticsQuery`, sleep via `HKSampleQuery`
- `NSHealthShareUsageDescription` in Info.plist
- Same JSON response shape as Android (`{ steps, goal }`, `{ duration, stages, ... }`)
- Expose bonus fields (HRV, resting HR) as optional keys — web layer ignores unknown keys today, can surface them later

**Status: ✅ Complete.** HRV and resting HR are pre-declared in `readTypes` (future-proofed for when the web layer surfaces them).

### Phase 3 — Calendar (EventKit)

- `CalendarBridge.swift`: `getCalendars`, `getEvents`, `createEvent`, `updateEvent`, `deleteEvent`
- `NSCalendarsUsageDescription` + `NSCalendarsWriteOnlyAccessUsageDescription`
- Identical JSON contract to Android

**Status: ✅ Complete.** `NSCalendarsFullAccessUsageDescription` added (required for iOS 17+ `requestFullAccessToEvents`). `getCalendarAuthStatus` debug bridge method also added. Device Calendars filter UI now shown on iOS (was previously Android-only).

### Phase 4 — Notifications

- `NotificationBridge.swift`: `scheduleReminder`, `cancelReminder`, `showNotification`, `showTaskNotification`, `syncReminders`, `getPendingAction`
- `UNUserNotificationCenter` with Snooze + Mark Complete action categories
- `UNCalendarNotificationTrigger` for scheduled reminders
- `UNNotificationServiceExtension` not needed — action handling in `UNUserNotificationCenterDelegate`
- No boot receiver needed (iOS restores notifications automatically)

**Status: ✅ Complete.** All six bridge methods implemented. Snooze + Mark Complete action categories registered at launch via `AppDelegate`. `UNUserNotificationCenterDelegate` wired for foreground banner presentation and action handling.

### Phase 5 — File access + Obsidian

- `ObsidianBridge.swift`: `getDailyNote`, `listNotes`, `appendToNote`, `getTasksFromNote`, `writeDailyNote`, `isVaultConfigured`, `getVaultConfig`
- `UIDocumentPickerViewController` for one-time vault selection
- Security-scoped bookmarks in `UserDefaults` (App Group container for widget access too)
- Settings screen (`SettingsViewController` or SwiftUI sheet) for vault path display + re-pick
- `NSFileProviderDomainIdentifier` not needed — direct file URL access is sufficient

**Status: ✅ Complete.** Implemented methods exceed the spec: also includes `getAllDailyNotes` (single-round-trip batch read), `getNote`, `writeNote`, `buildNoteIndex`, `openNote` (obsidian:// URI), `clearVault`, and `setVaultSettings`. The last one is a notable addition: Android persists folder/pattern via `SettingsActivity`; iOS has no equivalent, so a `setVaultSettings(folder, pattern, newNotesFolder)` bridge call was added, called from an `App.jsx` effect whenever `obsidianConfig` changes, keeping `UserDefaults` in sync with the web settings UI.

**Deferred to Phase 10**: bookmarks are currently stored in `UserDefaults.standard`; they need migrating to the App Group container (`group.com.dayglance.app`) so the WidgetKit extension can access the vault.

**isNativeAndroid → isNativeApp audit also completed**: 21 guards across 8 files updated so iOS behaves identically to Android everywhere it should (calendar sync configuration, cloud sync dedup, settings UI, reminder notifications, native event editing, etc.). Guards intentionally kept as `isNativeAndroid()`: status bar appearance, `notifyNativeReady` splash callback, `nativeShareFile`, `nativeHttpRequest` ICS fetch, DnD permission checks, tab bar safe-area padding, and the SettingsModal Obsidian section (hidden on iOS — covered by `MobileSettingsPanel`).

### Phase 6 — HTTP bridge + WebDAV

- `HttpBridge.swift`: `URLSession` based, same `{ status, ok, body }` JSON response
- `NSAppTransportSecurity` → `NSAllowsArbitraryLoads: true` (or whitelist known WebDAV hosts)
- Verify WebDAV sync end-to-end on iOS

**Status: ✅ Complete.** `HttpBridge.swift` implemented with `DispatchSemaphore`-based synchronous URLSession (safe — WKURLSchemeHandler callbacks run on a background thread). `httpRequest` dispatch added to `BridgeSchemeHandler`. `NSAllowsArbitraryLoads: true` added to `project.yml` (required for HTTP WebDAV servers on local networks). ICS task-calendar fetch guard updated from `isNativeAndroid()` to `isNativeApp()` so iOS uses the native HTTP path too. Note: `cloudSyncProviders.js` (WebDAV) already detected the bridge via `window.DayGlanceNative?.httpRequest` — because iOS uses a Proxy object this was always truthy, causing WebDAV to attempt the native path and fail with "bridge unavailable"; Phase 6 makes that path actually work.

### Phase 7 — iCloud sync (macOS ↔ iOS)

- Register `iCloud.com.dayglance.app` container in Apple Developer portal
- **iOS**: `CloudSyncBridge.swift` — `nativeGetCloudData()`, `nativeSetCloudData(json)`, `nativeIsCloudSyncAvailable()`; `NSMetadataQuery` watch for remote changes
- **macOS (Electron)**: `electron/icloud-sync.ts` — file read/write at ubiquity container path; `fs.watch` for remote changes; `icloud:read` / `icloud:write` IPC handlers
- Add iCloud entitlements to macOS `entitlements.plist` (`icloud-container-identifiers`, `ubiquity-kvstore-identifier`)
- Wire renderer: on `icloud:data` IPC event, call `mergeSync.merge(local, remote)` and write merged result back
- `nativeIsCloudSyncAvailable()` degrades gracefully (returns `false`) when iCloud is unavailable
- Add `NSPrivacyAccessedAPICategoryFileTimestamp` to `PrivacyInfo.xcprivacy`
- Enable iCloud capability in App Store Connect for both macOS and iOS app records

**Status: ✅ Complete.** Container ID is `iCloud.com.dayglance`. iOS side implemented in `ICloudBridge.swift` (NSFileCoordinator-coordinated reads, `startDownloadingUbiquitousItem` + `ubiquitousItemDownloadingStatus` gating to avoid stale-cache reads, NSMetadataQuery watch firing `dayGlanceForeground` to wake the JS sync loop). macOS side in `electron/icloud-sync.ts` writes in-place to preserve bird's xattrs (rename-based writes lose tracking and force re-upload from scratch). JS layer adds a 5 s write throttle to prevent CloudKit conflict storms on rapid successive saves. Mac→iOS and iOS→Mac propagation verified within seconds via NSMetadataQuery. Bug fixes: #838, #839, #843, #844, #845, #847, #848.

### Phase 8 — Audio recording

- `AudioBridge.swift`: `AVAudioRecorder` capturing to `.m4a` (AAC, 16kHz, 32kbps)
- Returns same `data:audio/mp4;base64,...` string as Android
- `NSMicrophoneUsageDescription` in Info.plist

**Status: ✅ Complete.**

### Phase 9 — Subscriptions (StoreKit 2)

StoreKit 2 integration is required on both platforms and unlocks Universal Purchase — a purchase on iOS is automatically recognised on macOS via Apple's entitlement infrastructure.

**App Store Connect setup (once, before any code)**
- Register one auto-renewable subscription group: "dayGLANCE Pro"
- Two products:
  - `com.dayglance.app.pro.yearly` — auto-renewable subscription (14-day free trial included)
  - `com.dayglance.app.pro.lifetime` — **non-consumable** in-app purchase (not in the subscription group)
- Founder pricing: launch both products at the founder price, raise prices manually in App Store Connect after the founder window (~3 months, matching the approach used on Android). For the yearly subscription, existing subscribers continue at their original price on renewal — Apple grandfathers the founder rate. For the lifetime non-consumable, founder buyers keep the entitlement permanently regardless of the later price change. No offer codes or introductory offer apparatus needed; the price-change mechanic handles it cleanly on both product types.
- Enable Universal Purchase: link iOS and macOS apps in App Store Connect under the same bundle ID family

**iOS — RevenueCat SDK (`purchases-ios`)**
- The iOS app uses the `purchases-ios` Swift SPM package for the full RevenueCat SDK experience: entitlement checks, product fetching, purchase/restore flows, and trial eligibility.
- `SubscriptionBridge.swift` wraps the SDK and exposes it to the web layer via the `WKURLSchemeHandler` synchronous bridge: `getSubscriptionStatus()`, `getProductPrices()`, `purchase(productId:)`, `restorePurchases()`.
- RevenueCat maps both products to the single "Pro" entitlement — app code only checks `isActive` on the entitlement, never branches on which SKU the user holds.
- `Purchases.shared.checkTrialOrIntroDiscountEligibility` is used to conditionally show the 14-day trial copy on the yearly card only when the user is eligible.

**macOS (Electron) — REST API + `electron.inAppPurchase`**

The macOS Electron app uses a different but architecturally correct approach: `electron.inAppPurchase` (Electron's built-in StoreKit wrapper) for the purchase/restore UI, and the **RevenueCat REST API** for entitlement validation.

Why `purchases-ios` cannot run in the Electron main process: `purchases-ios` is an Apple XCFramework — a compiled Swift/Objective-C binary targeting Darwin. Electron's main process is Node.js. Loading an Apple framework in Node.js requires a custom N-API native addon with a C++/Objective-C bridge, significant engineering effort, and maintenance across Electron version updates. The REST API + `electron.inAppPurchase` approach delivers identical correctness without that complexity and is the idiomatic choice for Electron hosts.

How it works:
- `electron/subscription.ts` calls `inAppPurchase.getProducts(...)` at startup for prices, `inAppPurchase.purchaseProduct(...)` for purchases, and `inAppPurchase.restoreCompletedTransactions()` for restores.
- The `transactions-updated` observer fires on purchase/restore completion. On success, `fetchEntitlementStatus()` posts the MAS receipt to RevenueCat (`POST /v1/receipts`) — this both registers the purchase and returns entitlement status in one call.
- App User ID is a deterministic SHA-256 hash of the Electron `userData` path (`getStableAnonymousId()`) — stable across launches without needing a persisted file. The real identity signal is the receipt itself: the Apple ID embedded by StoreKit is what RevenueCat keys off for cross-device Universal Purchase, so the App User ID doesn't need to match across devices for restore to work.
- Results are delivered to the renderer via `subscription:event` IPC, matching the same `window.__billingEvent` callback pattern used by Android and iOS.

- RevenueCat dashboard provides customer lookup, manual entitlement grants, and webhook events (subscription started, cancelled, churned) for support and analytics.
- Free tier covers up to $2,500 MRR; 1% fee above that.

**Distribution model and free-build behavior**

dayGLANCE's subscription model is structurally tied to distribution channel, not to a debug toggle:

- **macOS — GitHub / Developer ID builds are free forever.** The paywall is gated on the presence of an MAS receipt at `[AppBundle]/Contents/_MASReceipt/receipt`, placed by StoreKit only when the app is installed from the Mac App Store. Developer ID builds distributed via GitHub (DMG/zip) have no such receipt. `isMASBuild()` in `electron/subscription.ts` checks this at runtime: no receipt → `subscription:status` returns `{ active: true }` immediately, no RevenueCat call made. This is the correct architectural expression of "GitHub builds free forever" — not a debug flag, not an env var, just the absence of a receipt that can only exist in a MAS-distributed binary.

- **iOS — all distribution is App Store only.** There is no Developer ID equivalent for iOS, so every real user goes through the paywall as designed. For local Xcode development, `SubscriptionBridge.swift` wraps `configure()` and `getStatus()` in `#if DEBUG` guards: debug builds are always Pro and RevenueCat is never initialised. `DEBUG` is defined automatically by Xcode in the Debug scheme build configuration and is absent from Release/Archive — it is not set in `SWIFT_ACTIVE_COMPILATION_CONDITIONS` or `OTHER_SWIFT_FLAGS` for Release, so the guard is completely inert in App Store submissions.

**Cross-platform subscription scope (deliberate decision)**

Subscriptions are **per-platform**. A user who subscribes on Android does not automatically get Pro on iOS/macOS, and vice versa. This is a deliberate choice, not a limitation to be solved later. Rationale:

- **No accounts.** dayGLANCE is local-first, no-accounts, privacy-first. Cross-platform entitlement recognition fundamentally requires either an account system (Spotify/Kindle model) or a license key flow — both add backend surface and friction that conflicts with the brand. The audience that pays for dayGLANCE is the audience that values the absence of accounts.
- **RevenueCat doesn't solve this for free.** RevenueCat's cross-platform story handles the *technical* entitlement abstraction (one "Pro" entitlement across SDKs) but cannot bypass Apple's and Google's billing rules. Each store still expects its own IAP for purchases made on its platform. Cross-platform recognition still requires accounts or license keys underneath — RevenueCat just makes the plumbing slightly easier.
- **No evidence the problem exists.** The overlap between dayGLANCE Android and iOS users is unknown and likely small at launch. Solving for it now would be premature.

If cross-platform complaints surface post-launch, **license keys** are the preferred path forward (RevenueCat webhook → email service → user pastes key into other platforms to unlock Pro). This avoids accounts entirely. Not in v1 scope.

**Web layer (`src/subscription.js`)**
- New module wrapping `nativeGetSubscriptionStatus()` / `nativePurchase()` / `nativeRestorePurchases()`
- `useSubscription()` hook returns `{ isPro, loading, purchase, restore }`
- Paywall UI component (shown when a Pro feature is accessed without an active subscription)
- All gated features degrade gracefully in the web layer when `isPro` is false

**macOS MAS sandbox audit (folded into Phase 9)**

Wiring RevenueCat into Electron is the natural moment to also enable App Sandbox entitlements in a dev build and surface any breakage early, rather than discovering it under launch pressure in Phase 12. Steps:

- Enable `com.apple.security.app-sandbox` in the macOS Electron dev build's entitlements.plist
- Add the entitlements required for current functionality: `com.apple.security.network.client` (WebDAV, RevenueCat, AI), `com.apple.security.files.user-selected.read-write` (Obsidian vault picker), `com.apple.developer.icloud-container-identifiers` (already added in Phase 7), and any others surfaced by testing
- Smoke-test: WebDAV sync, Obsidian vault read/write (security-scoped bookmarks under sandbox), iCloud sync, AI features, RevenueCat purchase + restore flow
- Document any APIs that break under sandbox and either fix or scope-cut before Phase 12 submission
- This was previously tracked as open question #9; folding it here resolves the "when?" timing question — it happens alongside the RevenueCat work since both touch the same Electron entitlement surface

**Pre-submission verification (in addition to standard sandbox testing)**

Two items easy to miss that should be explicitly verified before App Store submission:

- **Real-hardware Universal Purchase test**: buy on iPhone, install on Mac, tap Restore on Mac and confirm entitlement is recognised. Sandbox passing is necessary but not sufficient — entitlement propagation timing and App Store Connect configuration can differ in production.
- **`com.apple.security.in-app-payments` entitlement**: must be wired into the macOS hardened runtime config, not just the app entitlements file. MAS sandbox is strict about this.

**Status: ✅ Implementation complete (PR #851).** Both commits landed on `develop`: macOS anonymous ID consolidation (REST-only, SHA-256 of userData path as App User ID, identity derived from MAS receipt) and iOS trial eligibility (RC `checkTrialOrIntroDiscountEligibility` with `UserDefaults` caching, conditional trial copy in `SubscriptionWall.jsx`). Pre-merge: cold-launch iOS to confirm eligibility resolves to `.eligible`/`.ineligible` (not `.unknown`) within the 3-second refresh window — racing the offerings load would require gating the check on offerings being ready. Post-merge: App Store Connect product registration + subscription group + Universal Purchase, RevenueCat dashboard (iOS app, macOS app, "Pro" entitlement, offering, API keys), API key swap, MAS sandbox entitlement audit. None of those are code work — they unblock TestFlight, not the merge.

### Phase 10 — Home screen widgets (WidgetKit) — v1 launch scope

Ship the three widget kinds at the minimum-viable sizes to give iOS a native-feeling launch. Extra sizes, StandBy, and Lock Screen variants are deferred to v1.1 so widgets don't gate launch.

- New `DayGlanceWidget` WidgetKit extension target
- App Group shared container (`group.com.dayglance.app`) replaces Android's `SharedDataStore`
- Three widget kinds matching Android: **Up Next**, **Goal**, **Project**. The fourth Android widget — **dayGLANCE** (mirror of the GLANCE tab) — is intentionally **out of v1 scope**; it's the densest layout and benefits most from being designed alongside the Live Activity work in v1.1.
- `nativeUpdateWidgetSnapshot(type, json)` bridge call — one call per widget kind
- SwiftUI views — **Medium** size for all three at launch; Small added where the design is obvious (Up Next, Project)
- `BGAppRefreshTask` for 15-minute background refresh
- iOS 17+ interactive widget buttons (task complete) on Up Next — App Intents required (small set: complete-task, start-focus)

**Deferred to v1.1**: Large size, StandBy variant, Lock Screen widgets (separate widget family — circular, rectangular, inline), iPad-XL size.

### Phase 11 — iOS launch polish (v1)

Native-feeling touches that make v1 look like an iOS app rather than a port. All items are small and self-contained.

- **Haptics**: `nativeHaptic(type)` bridge call wired to `UIImpactFeedbackGenerator` (light/medium/heavy/success/warning/error). Web layer fires on task complete, snooze, focus-start, etc.
- **Share Extension**: Receive shared text/URLs → create new inbox task on next app open. Standard `ShareViewController` extension target.
- **Home Screen Quick Actions**: Long-press app icon menu with up to four actions — "New scheduled task", "New inbox task", "Start Focus on next task", "Open today". Static items in `Info.plist` (`UIApplicationShortcutItems`); handled in scene delegate, routed to the WebView as a deep link (e.g. `dg:///?action=newInboxTask`).
- **Spotlight indexing**: CoreSpotlight indexes today's and upcoming tasks (and goals/projects), so users can search from the home screen and tap to open dayGLANCE deep-linked to the item. Index updates on data change via the bridge.
- **Reminders read (opt-in)**: EventKit already covers Reminders. Add a Settings toggle "Show iOS Reminders as inbox tasks" (off by default). When enabled, reminders surface read-only alongside dayGLANCE inbox tasks — gives Apple-ecosystem users a way to consolidate without forced migration.
- **Validate free platform features** (no implementation, just confirm they work): Universal Clipboard (copy on Mac, paste on iOS), AirDrop (export sharing), Continuity Camera (image attachments to task notes), Live Text (free OCR on attached images).

**Deferred to v1.1/v1.2**: Siri / App Intents (deep automation surface), Live Activities, Focus Filters, Action Button suggestions, Apple Watch complications — see the post-launch roadmap below.

### Phase 12 — Polish + App Store (v1 release)

- App Store metadata, screenshots (iPhone 6.7", iPad 13")
- Privacy manifest (`PrivacyInfo.xcprivacy`) — required for App Store since iOS 17
- **macOS MAS sandbox audit**: test existing Electron app under MAS sandbox entitlements; fix any file-access, network, or API breakage before submitting macOS to the App Store alongside iOS
- TestFlight beta (iOS + macOS — both platforms support TestFlight under MAS)
- Status bar text colour: flip to white in dark mode (carried over from Phase 1)

**Launch gate**: Phases 9 → 10 → 11 → 12 in that order. Phase 9 (subscriptions) must precede 12 because the App Store listing declares subscription products and Apple reviews the IAP flow. Phases 10 and 11 give the launch app native-feeling surfaces without blocking on the more expensive iOS work.

---

## Post-launch roadmap

Once v1 ships, the iOS-distinctive work that earns "first-class iOS" status follows in focused update releases. Each update is also a marketing moment.

### v1.1 — iOS showcase update

The features that make iOS the premium dayGLANCE experience, anchored by the Dynamic Island feature that maps 1:1 onto the now-line / HyperGLANCE concept.

- **HyperGLANCE Live Activity** — Focus sessions and active HyperGLANCE bars render in the Dynamic Island (iPhone 14 Pro+) and on the Lock Screen (all iOS 16.1+ devices). Compact leading shows the active GTD frame icon; compact trailing shows the countdown / progress ring; expanded view shows the full bar with pause/resume/complete buttons (backed by App Intents). 8-hour ActivityKit cap handled by automatic re-issue on long sessions.
- **Lock Screen widgets** — circular (progress ring or remaining-task count), rectangular (current task + time remaining), and inline (above the clock text). iOS 17+ interactivity for tap-to-complete.
- **StandBy mode rendering** — the large Home Screen widget rendered full-screen when iPhone is on a charger in landscape. Turns any charging iPhone into an ambient dayGLANCE display.
- **Full widget size matrix** — Large home screen variants (mini DAY view with HyperGLANCE bars), iPad XL (full 12-hour DAY view).
- **dayGLANCE widget** — fourth widget kind mirroring the GLANCE tab (densest layout, parity with the Android widget set).

### v1.2 — Automation and ecosystem

The deep iOS automation surface and integration with the broader GLANCE family.

- **App Intents / Siri Shortcuts** — full set of actions (add task, complete task, start focus, snooze, add to inbox) and queries (current task, next task, today's tasks, focus session). App Shortcuts for Siri discoverability. iOS 16+ App Intents-backed Quick Actions replacing the static Phase 11 set.
- **Action Button suggestions** (iPhone 15 Pro+) — recommend dayGLANCE App Shortcuts as Action Button assignments.
- **Focus Filters** — `FocusFilterIntent` extension lets a specific iOS Focus mode filter dayGLANCE to context-tagged tasks (Work Focus → only work-tagged tasks).
- **Apple Watch complications + Smart Stack** — watchOS widget extension showing current/next task and a schedule strip. Live Activity mirror happens automatically via the iOS↔Watch bridge. No full watchOS app at this stage.
- **dayGLANCE intents for lastGLANCE / lifeGLANCE** — App Intents exposed for cross-app data exchange so the future lastGLANCE and lifeGLANCE iOS apps can read dayGLANCE state and vice versa. Designed and shipped in lockstep with those apps; not worth front-loading the API surface before there's a consumer.

### Later / nice-to-have

- Full watchOS app (independent, syncs through iCloud)
- File Provider extension (Files-app browsing of task data)
- Handoff (compose task on iPhone, continue on Mac)
- Vision Pro spatial app (far future)

---

## native.js changes

The existing `isNativeAndroid()` check needs a companion for iOS, plus a platform-agnostic helper:

```js
// Add to native.js:

export const isNativeIOS = () =>
  typeof window !== 'undefined' && !!window.DayGlanceIOS;

export const isNativeApp = () => isNativeAndroid() || isNativeIOS();
```

All existing `nativeBridge()` calls already degrade gracefully to `null` when the bridge is absent — no call-site changes needed in `App.jsx`. The only places that need iOS-awareness are:

- **Focus mode UI**: hide the DND toggle on iOS (`isNativeIOS()`)
- **Haptics**: new feature, iOS-only initially
- **Live Activities**: new feature, iOS-only
- **Health extras** (HRV etc.): read optional fields from existing `nativeGetSleep` response
- **iCloud sync**: three new bridge calls available on both iOS and macOS (Electron IPC):

```js
// New bridge calls for iCloud sync:
// nativeIsCloudSyncAvailable() → boolean
// nativeGetCloudData()         → JSON string | null
// nativeSetCloudData(json)     → void

// On iOS these go through CloudSyncBridge.swift.
// On macOS they go through Electron IPC (icloud:available, icloud:read, icloud:write).
// Both call into the existing mergeSync.merge() on the JS side.
export const isCloudSyncAvailable = () =>
  isNativeIOS()
    ? nativeBridge('nativeIsCloudSyncAvailable') === true
    : window.__electronIPC?.icloudAvailable ?? false;
```

---

## Open questions

1. **Obsidian local vaults**: Users with vaults not in iCloud Drive can't use the Obsidian bridge on iOS. Worth a warning in the settings screen, or an alternative (manual import/export of the daily note)?

2. ~~**WKWebView async bridge**~~: **Resolved** — using `WKURLSchemeHandler` for synchronous-looking JS call sites.

3. **TestFlight timing**: Should the iOS beta be gated behind the Android feature set reaching parity (Phases 1–7), or released earlier for testing with a subset of features?

4. ~~**App Store pricing**~~: **Resolved** — yearly auto-renewable subscription + lifetime non-consumable. Both launch at founder pricing; no offer codes or intro offers. Universal Purchase links macOS and iOS. See Phase 9 for product IDs and rationale.

5. ~~**iPad as first-class target**~~: **Resolved** — iPad required at launch. Split view / multitasking support added to Phase 1.

6. **iCloud sync conflict window**: If both macOS and iOS are offline simultaneously and make different changes, the merge on reconnect resolves per-item by timestamp. Is last-write-wins per item acceptable, or do we need a richer conflict UI (e.g. "both versions" diff) for any data type?

7. ~~**iCloud sync phase timing**~~: **Resolved** — Phase 6 (HTTP bridge / WebDAV) ships first. Rationale: the iOS half of iCloud sync (`CloudSyncBridge.swift`, `NSMetadataQuery`) doesn't need the HTTP bridge, but the macOS Electron half (`electron/icloud-sync.ts`, entitlements, IPC wiring) is a non-trivial parallel change, and the iCloud container (`iCloud.com.dayglance.app`) must be registered in the Apple Developer portal before any of it is testable. Phase 6 unblocks WebDAV end-to-end testing on device in the meantime. iCloud sync (Phase 7) then follows as a deliberate two-codebase effort once the portal setup is in place. The two sync transports are fully independent and coexist cleanly: iCloud covers Apple-to-Apple zero-config; WebDAV covers cross-platform (Android, Windows, self-hosted).

8. ~~**StoreKit on macOS / Electron**~~: **Resolved** — iOS uses `purchases-ios` Swift SDK; macOS Electron uses `electron.inAppPurchase` + RevenueCat REST API. `purchases-ios` cannot load in Electron's Node.js main process (Apple XCFramework vs Node.js incompatibility; native addon approach is out of scope). See Phase 9 for the full architecture breakdown. Android uses Google Play Billing directly (already implemented) and is intentionally independent — subscriptions are per-platform, no cross-platform entitlement recognition, no accounts. See Phase 9 "Cross-platform subscription scope" for rationale.

9. ~~**macOS MAS sandbox**~~: **Resolved** — folded into Phase 9 alongside the RevenueCat Electron work, since both touch the same entitlement surface. See Phase 9 "macOS MAS sandbox audit" subsection.
