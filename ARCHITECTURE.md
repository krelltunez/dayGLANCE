# dayGLANCE Architecture

This document describes the high-level architecture of the dayGLANCE app for contributors who want to understand how the pieces fit together before diving into the code.

---

## Table of Contents

- [Overview](#overview)
- [Frontend (React + Vite)](#frontend-react--vite)
- [Data model](#data-model)
- [WebDAV sync engine](#webdav-sync-engine)
- [Obsidian integration](#obsidian-integration)
- [Android WebView bridge](#android-webview-bridge)
- [Proxy layer](#proxy-layer)
- [Home screen widget (Android)](#home-screen-widget-android)

---

## Overview

dayGLANCE is a single-page React app wrapped in an Android WebView. The web app is the single source of truth — the Android layer provides native bridges for capabilities the browser can't reach (calendar, file system, notifications, health data). Cloud sync is optional and handled via WebDAV.

```
┌─────────────────────────────────────────────────────┐
│                 React SPA (Vite)                     │
│  App.jsx — all UI and business logic                 │
│  localStorage — primary data store                  │
└──────┬──────────────┬───────────────┬───────────────┘
       │              │               │
  WebDAV sync   Obsidian vault   AI features
  (Vercel proxy  (FSA API or     (direct API
   for web)       native bridge)  calls)
       │              │
       └──────────────┘
              │
   ┌──────────▼──────────┐
   │  Android WebView    │
   │  JavascriptInterface│
   ├─────────────────────┤
   │ CalendarBridge      │  → Android CalendarProvider
   │ ObsidianBridge      │  → Storage Access Framework
   │ NativeBridge        │  → Notifications, Health Connect,
   │ HttpBridge          │    Audio, Widget snapshot
   │ FocusBridge         │  → DND / immersive mode
   └─────────────────────┘
```

---

## Frontend (React + Vite)

### Structure

The entire UI and application logic lives in `src/App.jsx` — a single large component. This is intentional: it keeps data flow explicit and avoids prop-drilling complexity. Supporting modules handle isolated concerns:

| File | Responsibility |
|---|---|
| `App.jsx` | All UI, state management, and orchestration |
| `ai.js` | AI provider abstraction (OpenAI, Anthropic, Ollama, etc.) |
| `ai-prompts.js` | Prompt templates for every AI feature |
| `native.js` | Thin JS wrappers around the Android JavascriptInterface |
| `obsidian.js` | Obsidian vault sync (desktop and Android paths) |
| `mergeSync.js` | WebDAV sync and three-way merge logic |
| `trmnl.js` | TRMNL e-ink display integration |
| `versionCheck.js` | Update checking |

### State management

dayGLANCE uses plain React hooks — no Redux, Zustand, or Context. `App.jsx` declares around 300 `useState` hooks directly. This keeps data flow linear and easy to trace, at the cost of a large top-level component. `useCallback` and `useMemo` are used extensively to avoid re-renders on expensive derived data.

### Persistence

All data is stored in `localStorage`. Cloud sync (WebDAV) is optional and layered on top — the app works fully offline without it. Key storage buckets:

| Key | Contents |
|---|---|
| `day-planner-tasks` | Scheduled tasks array |
| `day-planner-unscheduled` | Inbox tasks array |
| `day-planner-recycle-bin` | Soft-deleted tasks |
| `day-planner-recurring-tasks` | Recurring task templates |
| `day-planner-daily-notes` | Notes by date (`{ "YYYY-MM-DD": { text, lastModified } }`) |
| `day-planner-gtd-frames` | GTD time-block frame definitions |
| `day-planner-habits` | Habit definitions |
| `day-planner-habit-logs` | Habit completion counts by date |
| `day-planner-routine-definitions` | Routine chips by day of week |
| `day-planner-cloud-sync-config` | WebDAV credentials and settings |
| `day-planner-ai-config` | AI provider config and feature flags |
| `day-planner-deleted-task-ids` | Tombstones: `{ id: deletionTimestamp }` |

Tombstone maps (deleted IDs with timestamps) exist for tasks, routine chips, habits, and frames. They prevent deleted items from being resurrected during sync merges.

---

## Data model

### Task

```js
{
  id: string,                 // stable unique ID
  title: string,              // may contain inline #tags
  date: "YYYY-MM-DD",         // null for inbox tasks
  startTime: "HH:MM",         // "00:00" for all-day events
  duration: number,           // minutes
  completed: boolean,
  priority: 0 | 1 | 2 | 3,   // 0 = none, 3 = high
  color: string,              // Tailwind bg-* class
  notes: string,
  subtasks: [{ id, title, completed, duration? }],
  deadline: "YYYY-MM-DD"?,
  isAllDay: boolean?,
  imported: boolean?,         // true for calendar events
  importSource: "obsidian" | "calendar"?,
  lastModified: string,       // ISO 8601 — used for sync conflict resolution
}
```

### Recurring task template

Recurring tasks are stored as templates with a `recurrence` descriptor. Occurrences are computed on the fly via `getOccurrencesInRange()` — they are never written to the tasks array.

```js
{
  id: number,
  title: string,
  recurrence: {
    type: "daily" | "weekly" | "monthly",
    startDate: "YYYY-MM-DD",
    endDate?: "YYYY-MM-DD",
    daysOfWeek?: number[],    // 0–6, for weekly
    dayOfMonth?: number,      // for monthly
  },
  completedDates: string[],   // ["YYYY-MM-DD", ...]
  exceptions: {
    "YYYY-MM-DD": { startTime?, title?, ... }  // per-instance overrides
  },
  lastModified: string,
}
```

### GTD frame

Frames are named time blocks that appear on the day view. Tasks are assigned to frames based on tag affinity and energy level.

```js
{
  id: number,
  label: string,
  days: number[],             // days of week this frame is active
  start: "HH:MM",
  end: "HH:MM",
  energyLevel: "low" | "medium" | "high",
  tagAffinity: string[],      // prefer tasks with these tags
  bufferMinutes: number,
  enabled: boolean,
  singleDate?: "YYYY-MM-DD",  // for one-off overrides
}
```

---

## WebDAV sync engine

### How it works

Sync is file-based: the entire app dataset is serialised to a single JSON file stored on a WebDAV server (Nextcloud, ownCloud, any WebDAV host). On each sync:

1. **Fetch** the remote file
2. **Merge** local and remote data using `mergeSyncData()` in `mergeSync.js`
3. **Write** the merged result back to the server
4. **Apply** the merged result to local state

There is no server-side logic — the client does all conflict resolution.

### Conflict resolution

Merges happen at the **item level**, not the file level. The strategy is "newest `lastModified` wins" per item, with tombstones to prevent deleted items from being resurrected:

```
merge(local, remote):
  for each item ID in union(local.ids, remote.ids):
    if ID in tombstones:
      skip (deleted, don't resurrect)
    elif only in local:
      keep local
    elif only in remote:
      add from remote
    elif local.lastModified >= remote.lastModified:
      keep local version
    else:
      take remote version
```

Specialised mergers handle the nuances of each data type:

| Function | What it handles |
|---|---|
| `mergeTaskArrays` | Tasks and inbox items — preserves local ordering, appends remote-only items at the end |
| `mergeRoutineDefinitions` | Routine chips grouped by day-of-week bucket |
| `mergeDailyNotes` | Notes by date key, supports tombstone entries |
| `mergeHabits` | Habit definitions with union tombstone sets |
| `mergeHabitLogs` | Per-date habit counts — takes the maximum count (counts only go up within a day) |
| `mergeSyncData` | Orchestrates all of the above, handles cross-list reconciliation (e.g. a task in the active list on one device and the recycle bin on another) |

### Web vs Android

On the **web/PWA**, WebDAV requests go through the Vercel proxy (`/api/webdav-proxy`) to bypass CORS restrictions imposed by WebDAV servers.

On **Android**, the native `HttpBridge` makes HTTP requests directly from Kotlin, bypassing CORS entirely. The proxy is not used.

---

## Obsidian integration

Obsidian tasks are treated as a **read source** — dayGLANCE imports tasks from daily notes and writes completion state back, but the vault is never the authoritative store. The app owns scheduling.

### Desktop (File System Access API)

The user picks their vault root with `window.showDirectoryPicker()`. The directory handle is persisted in IndexedDB so permission only needs to be granted once per session.

```
User picks vault root
  → dirHandle saved to IndexedDB
  → on sync: dirHandle.getFileHandle("YYYY-MM-DD.md")
  → file.text() → parse markdown
  → write back: fileHandle.createWritable() → write(content)
```

### Android (Storage Access Framework)

The vault path is configured in native settings. The `ObsidianBridge` Kotlin class handles all file I/O via the Android Storage Access Framework (SAF) and exposes it synchronously to JS via `window.DayGlanceObsidian`.

```
JS: window.DayGlanceObsidian.getDailyNote("2026-03-15")
  → ObsidianBridge.getDailyNote() [Kotlin, SAF]
  → returns raw markdown string
```

### Markdown parsing

Both paths use the same parser in `obsidian.js`. Supported task formats:

```markdown
- [ ] 2026-03-15 09:00 Task title #obsidian     → scheduled timed task
- [ ] 2026-03-15 Task title #obsidian            → all-day task
- [ ] 09:00 Task title #obsidian                 → timed task (today)
- [ ] Task title #obsidian                       → inbox task
- [ ] 09:00-10:30 Task title #obsidian           → timed with duration
```

Each imported task gets a **stable ID** derived from `obsidian-{date}-{hash(title)}`. On re-sync, existing tasks are matched by ID so user edits (scheduling, notes, colour, subtasks) are preserved and not overwritten. Completion state is written back to the vault file.

---

## Android WebView bridge

The Android app (`MainActivity.kt`) loads the web bundle from `assets/web/` in a WebView. Native capabilities are exposed to JavaScript via `@JavascriptInterface` methods, which appear as properties on `window`.

### Interface objects

| Window object | Kotlin class | Capabilities |
|---|---|---|
| `window.DayGlanceNative` | `NativeBridge` | Health Connect (steps/sleep), notifications, audio recording, widget snapshot, file sharing |
| `window.DayGlanceCalendar` | `CalendarBridge` | Read/write Android CalendarProvider events |
| `window.DayGlanceObsidian` | `ObsidianBridge` | Vault file I/O via SAF |
| `window.DayGlanceHttp` | `HttpBridge` | Raw HTTP requests (bypasses WebView CORS) |
| `window.DayGlanceFocus` | `FocusBridge` | Immersive mode, Do Not Disturb |

### Communication pattern

All bridge calls are **synchronous from the JS perspective** — parameters are passed as JSON strings, return values are JSON strings. The JS wrappers in `native.js` handle serialisation and provide fallback no-ops when running in a browser (i.e. not inside the Android WebView).

```js
// native.js wrapper pattern
export function nativeGetEvents(date) {
  if (!isNativeAndroid()) return [];
  return JSON.parse(window.DayGlanceCalendar.getEvents(date));
}
```

### Notification action loop

Task reminder notifications include action buttons (e.g. "Snooze 10 min", "Mark done"). When tapped, the action is written to a pending-action slot in native storage. The next time the WebView is foregrounded, the app calls `getPendingAction()` to read and process it.

---

## Proxy layer

Two Vercel serverless functions provide a proxy for requests that browsers can't make directly due to CORS:

### `/api/webdav-proxy`

Forwards WebDAV requests (GET, PUT, PROPFIND, MKCOL, etc.) to any WebDAV server.

- Accepts `?url={target}` query parameter
- Validates the target URL (blocks `localhost`, private IP ranges, IPv6 loopback)
- Forwards the request body unchanged
- Maps `X-WebDAV-Auth` → `Authorization` (Basic auth) and `Depth` headers
- Returns the raw response body and content-type

### `/api/calendar-proxy`

Fetches read-only calendar/iCalendar data (for the "task calendar" feature).

- GET only
- `Cache-Control: max-age=900, stale-while-revalidate` (15-minute cache)
- Same URL validation as the WebDAV proxy

Both proxies are only used by the web/PWA deployment. The Android app makes all network requests through `HttpBridge` natively.

---

## Home screen widget (Android)

The Android home screen widget is implemented entirely in Kotlin — it does not use the WebView.

```
App (WebView JS)
  → window.DayGlanceNative.updateWidgetSnapshot(json)
  → NativeBridge writes JSON to SharedPreferences (SharedDataStore)

Widget update triggered (WorkManager / AppWidgetManager)
  → DayGlanceWidgetListFactory reads snapshot from SharedDataStore
  → Parses sections: frames, tasks, routines, habits
  → Builds RemoteViews for each item type
  → Renders into widget via AppWidgetManager
```

The snapshot JSON contains a pre-computed agenda for today — the widget has no business logic of its own, it just renders what the app tells it to. This means the widget is always consistent with the app's view of the day.

Layout files for widget item types live in `dayglance-android/app/src/main/res/layout/widget_item_*.xml`. All text sizes use `sp` units with a minimum of `11sp` for readability across launchers and system font scale settings.
