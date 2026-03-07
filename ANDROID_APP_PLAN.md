# DayGlance Android Native App — Architecture Plan

## Overview

DayGlance is a privacy-focused, open-source day planner. The web app (PWA) is the primary UI. This document describes the architecture for a native Android app that wraps the existing DayGlance web frontend in a WebView and adds native integrations that aren't possible from a PWA.

The web frontend remains the single source of truth for UI. The native app does NOT rebuild the interface — it loads the existing DayGlance frontend and extends it with native capabilities through a JavaScript bridge.

---

## Core Architecture: WebView + Native Bridges

The app is a native Android shell containing:

1. **A WebView** that loads the DayGlance web frontend (bundled locally or from hosted URL)
2. **Native Kotlin modules** that access Android platform APIs
3. **A JavaScript bridge** (`window.DayGlanceNative`) that connects the two
4. **A home screen widget** that displays today's agenda at a glance
5. **Native notification support**

### JavaScript Bridge Pattern

The native bridge is injected into the WebView's JavaScript context. The web frontend feature-detects it and uses it when available:

```javascript
// In the DayGlance frontend
if (window.DayGlanceNative) {
  // Running in native app — use native integrations
  const steps = await DayGlanceNative.getSteps('2026-02-24');
  const events = await DayGlanceNative.getEvents('2026-02-24');
} else {
  // Running as PWA — gracefully degrade, hide native features
}
```

On the Kotlin side, each bridge module is registered via `addJavascriptInterface`:

```kotlin
webView.addJavascriptInterface(NativeBridge(context), "DayGlanceNative")
```

---

## Native Integrations

### 1. Health Connect (Steps, Health Data)

**API:** Android Health Connect (formerly Google Health Connect)
**Purpose:** Read step counts, sleep data, heart rate, and other health metrics to display in DayGlance.

- Request Health Connect permissions at runtime
- Query health records by date range
- Return data as JSON to the frontend via the bridge
- Health Connect is a standard Android API — works with Samsung Health, Google Fit, and other apps that write to it

```kotlin
class HealthBridge(private val context: Context) {
    @JavascriptInterface
    fun getSteps(date: String): String {
        // Query Health Connect for step records on the given date
        // Return JSON: { "steps": 8432, "goal": 10000 }
    }

    @JavascriptInterface
    fun getSleep(date: String): String {
        // Query sleep sessions
        // Return JSON with sleep stages, duration, etc.
    }
}
```

### 2. Calendar (via Android Calendar Provider + DAVx⁵)

**API:** Android `CalendarContract` content provider
**Purpose:** Bidirectional calendar sync. Read and write calendar events.

**Important:** This does NOT implement CalDAV directly. Instead, it reads/writes from Android's built-in Calendar Provider. Users who run DAVx⁵ (common in the Nextcloud/self-hosting community) get automatic bidirectional sync with their Nextcloud calendar — DAVx⁵ handles all the CalDAV protocol work.

This also means DayGlance works with ANY calendar synced to the phone (Google Calendar, Exchange, etc.), not just Nextcloud.

```kotlin
class CalendarBridge(private val context: Context) {
    @JavascriptInterface
    fun getEvents(date: String): String {
        // Query CalendarContract.Events for the given date
        // Returns events from ALL synced calendars
        // DAVx⁵ users get Nextcloud events automatically
    }

    @JavascriptInterface
    fun createEvent(eventJson: String): String {
        // Insert into Calendar Provider
        // DAVx⁵ automatically syncs new events back to Nextcloud
    }

    @JavascriptInterface
    fun updateEvent(eventJson: String): String { /* ... */ }

    @JavascriptInterface
    fun deleteEvent(eventId: String): String { /* ... */ }
}
```

### 3. Obsidian Vault (Direct File Access)

**API:** Android file system (Storage Access Framework or direct path if granted)
**Purpose:** Read and write to the user's Obsidian vault on-device.

On Android, Obsidian stores vaults as plain markdown files on the file system. The native app can read/write these directly — something a PWA cannot do.

```kotlin
class ObsidianBridge(private val context: Context) {
    @JavascriptInterface
    fun getDailyNote(date: String): String {
        // Read today's daily note markdown from the vault
    }

    @JavascriptInterface
    fun listNotes(folder: String): String {
        // List notes in a vault folder (e.g., "daily", "tasks")
    }

    @JavascriptInterface
    fun appendToNote(path: String, content: String): Boolean {
        // Append content to a note (e.g., add a task from DayGlance)
    }

    @JavascriptInterface
    fun getTasksFromNote(path: String): String {
        // Parse markdown checkboxes from a note
        // Return JSON array of tasks with completion status
    }
}
```

**Configuration:** The user will need to point DayGlance at their vault location. Provide a settings screen where they select the vault root folder.

### 4. Notifications

**API:** Android NotificationManager / NotificationCompat
**Purpose:** Native notifications for reminders, focus block timers, Pomodoro alerts, and upcoming events.

```kotlin
class NotificationBridge(private val context: Context) {
    @JavascriptInterface
    fun scheduleReminder(id: String, title: String, body: String, triggerAtMillis: Long) {
        // Schedule a notification using AlarmManager
    }

    @JavascriptInterface
    fun cancelReminder(id: String) { /* ... */ }

    @JavascriptInterface
    fun showNotification(title: String, body: String) {
        // Show an immediate notification
    }
}
```

Set up notification channels on app startup (e.g., "Reminders", "Focus Mode", "Events").

---

## Home Screen Widget

**API:** Android AppWidgetProvider + RemoteViews
**Important constraint:** Android widgets CANNOT use WebView. The widget must be built with RemoteViews, which supports a limited set of layout elements (TextView, ImageView, ListView, LinearLayout, etc.).

### Widget Requirements

- Display today's schedule/agenda at a glance
- Show step count if Health Connect is available
- Show current or next focus block / GTD Block
- Show upcoming tasks (from Obsidian daily note or DayGlance tasks)
- **Match DayGlance's visual design language as closely as RemoteViews allows** — refer to the DayGlance web frontend for colors, spacing, and layout patterns (Lora font family, blue/orange palette)
- Tapping the widget opens the full DayGlance app (the WebView)

### Widget Data Flow

The widget and the WebView both read from a shared data layer:

```
┌─────────────────────────────────────────┐
│           Native Android App            │
│                                         │
│  ┌────────────┐    ┌─────────────────┐  │
│  │  WebView   │    │ Widget Provider  │  │
│  │ (DayGlance │    │ (RemoteViews)   │  │
│  │  full UI)  │    │                 │  │
│  └─────┬──────┘    └──────┬──────────┘  │
│        │                  │             │
│  ┌─────┴──────────────────┴──────┐      │
│  │       Shared Data Layer        │      │
│  │  (Room DB or SharedPreferences)│      │
│  │                                │      │
│  │  ┌────────┐ ┌───────┐ ┌─────┐ │      │
│  │  │ Health │ │Calendar│ │Obsid│ │      │
│  │  │Connect │ │Provider│ │ ian │ │      │
│  │  └────────┘ └───────┘ └─────┘ │      │
│  └────────────────────────────────┘      │
└─────────────────────────────────────────┘
```

Widget updates via `WorkManager` on a schedule (e.g., every 15–30 minutes) and also refreshes when the app syncs new data.

---

## Project Structure

```
dayglance-android/
├── app/
│   ├── src/main/
│   │   ├── java/com/dayglance/app/
│   │   │   ├── MainActivity.kt              # WebView shell, bridge setup
│   │   │   ├── DayGlanceApplication.kt      # App-level init, notification channels
│   │   │   │
│   │   │   ├── bridge/
│   │   │   │   ├── NativeBridge.kt           # Main bridge, delegates to sub-bridges
│   │   │   │   ├── HealthBridge.kt           # Health Connect integration
│   │   │   │   ├── CalendarBridge.kt         # Android Calendar Provider
│   │   │   │   ├── ObsidianBridge.kt         # Vault file access
│   │   │   │   └── NotificationBridge.kt     # Native notifications
│   │   │   │
│   │   │   ├── data/
│   │   │   │   ├── HealthRepository.kt       # Health Connect queries
│   │   │   │   ├── CalendarRepository.kt     # CalendarContract queries
│   │   │   │   ├── ObsidianRepository.kt     # File system reads/writes
│   │   │   │   └── SharedDataStore.kt        # Shared data for widget + WebView
│   │   │   │
│   │   │   ├── widget/
│   │   │   │   ├── DayGlanceWidget.kt        # AppWidgetProvider
│   │   │   │   ├── WidgetUpdateWorker.kt     # WorkManager periodic refresh
│   │   │   │   └── WidgetDataHelper.kt       # Prepares data for RemoteViews
│   │   │   │
│   │   │   ├── notifications/
│   │   │   │   ├── NotificationHelper.kt     # Channel setup, show/schedule
│   │   │   │   └── ReminderReceiver.kt       # BroadcastReceiver for alarms
│   │   │   │
│   │   │   └── settings/
│   │   │       └── SettingsActivity.kt       # Obsidian vault path, permissions
│   │   │
│   │   ├── res/
│   │   │   ├── layout/
│   │   │   │   ├── activity_main.xml         # WebView container
│   │   │   │   ├── widget_layout.xml         # Home screen widget
│   │   │   │   └── activity_settings.xml
│   │   │   └── xml/
│   │   │       └── widget_info.xml           # Widget metadata
│   │   │
│   │   ├── assets/
│   │   │   └── web/                          # Bundled DayGlance frontend (optional)
│   │   │
│   │   └── AndroidManifest.xml
│   │
│   └── build.gradle.kts
│
├── gradle/
└── build.gradle.kts
```

---

## Build Order (Incremental)

Build and ship incrementally. Each phase is independently useful:

### Phase 1: WebView Shell
- `MainActivity` with WebView loading DayGlance frontend
- Basic `NativeBridge` skeleton with feature detection
- Settings screen for configuration

### Phase 2: Health Connect
- `HealthBridge` + `HealthRepository`
- Permission flow for Health Connect
- Frontend changes: health data widgets (steps, sleep) when native bridge is detected

### Phase 3: Calendar Integration
- `CalendarBridge` + `CalendarRepository`
- Read/write via Android Calendar Provider
- Works automatically with DAVx⁵ for Nextcloud bidirectional sync
- Frontend changes: native calendar data when bridge is detected

### Phase 4: Obsidian Integration
- `ObsidianBridge` + `ObsidianRepository`
- Settings UI for vault folder selection
- Read daily notes, parse tasks, append content
- Frontend changes: Obsidian tasks/notes panel when bridge is detected

### Phase 5: Notifications
- `NotificationBridge` + `NotificationHelper`
- Notification channels for reminders, focus mode, events
- Scheduled reminders via AlarmManager

### Phase 6: Home Screen Widget
- `DayGlanceWidget` with RemoteViews layout
- `WidgetUpdateWorker` for periodic refresh
- Shared data layer so widget and WebView stay in sync
- Visual design matching DayGlance's look and feel (consult the web frontend code for design tokens)

---

## Key Design Decisions

- **WebView is the UI** — don't rebuild the frontend in Kotlin. The web app is the single source of truth for the interface.
- **Feature detection** — the frontend checks for `window.DayGlanceNative` and gracefully hides native features when running as a PWA.
- **DAVx⁵ for CalDAV** — don't implement CalDAV protocol. Read/write Android's Calendar Provider and let DAVx⁵ handle sync.
- **Obsidian = file system** — no API needed, just read/write markdown files from the vault folder on disk.
- **Widget is native-only** — RemoteViews, not WebView. Match the design language but accept the constraints.
- **Privacy-first** — all data stays on-device or on the user's own Nextcloud. No analytics, no telemetry, no third-party services.

---

## Notes

- The DayGlance web frontend uses the **Lora** font family and a **blue/orange** color palette. The widget should reference the actual CSS/design tokens from the frontend codebase for exact values.
- GTD Blocks (time-based scheduling) and Pomodoro focus timers are core DayGlance features — both the widget and notifications should support these.
- Target audience is FOSS-minded, privacy-focused users who likely already run Nextcloud + DAVx⁵. Don't add friction for this audience.
