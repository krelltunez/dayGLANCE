# dayGLANCE Android — High-Level Architecture Plan

## Overview

A native Kotlin Android app that provides the full dayGLANCE experience with Android-specific features (widgets, DAVx5, Obsidian integration). Uses the same data model and sync format as the web app, so users can sync between both.

---

## Phase 1: Foundation

### Data Layer
- Room database with entities mirroring the web app's JSON schema: `ScheduledTask`, `InboxTask`, `RecurringTask`, `RoutineDefinition`, `RoutineChip`, `DailyNote`, `Tombstone`
- Each entity tracks `lastModified` (ISO timestamp) on every mutation
- Repository pattern abstracting Room queries behind a clean API
- JSON serialization (kotlinx.serialization) matching the web app's `sync.json` format exactly

### Sync Engine
- Direct port of `mergeSync.js` — same tombstone maps, same per-entity merge, same cross-list reconciliation, same "newer wins with local tie-break" semantics
- WebDAV client (Retrofit + OkHttp) targeting the same `/dayglance/sync.json` path
- WorkManager for background sync (every 15 min, matching web app)
- Conflict resolution identical to web: task-level merge, not dataset-level

### iCal Parser
- Parse VEVENT and VTODO from iCal URLs
- Handle RRULE expansion (YEARLY with BYMONTH/BYDAY/COUNT/UNTIL)
- Multi-day event splitting (Day 1/N, Day 2/N...)
- Track completed imported tasks by `icalUid`

---

## Phase 2: Core UI (Jetpack Compose)

### Glance Screen (home)
- Today's agenda with color-coded task dots
- "Now" marker with free time calculation
- Overdue section (collapsible)
- Routines row
- Tap task to jump to timeline

### Timeline Screen
- 24-hour vertical scroll with hour lines
- Tasks as colored blocks positioned by `startTime` and `duration`
- Drag to move, drag bottom edge to resize
- Side-by-side columns for overlapping tasks (port `calculateConflictPosition` logic)
- All-day section above timeline
- Day navigation (swipe or arrows), Today button

### Inbox Screen
- Task list with priority indicators (0-3)
- Filter by priority
- Long-press drag to timeline (or explicit "schedule" action)
- Hide completed toggle

### Task Editor
- Title with `#tag` autocomplete
- Notes with Markdown preview (`**bold**`, `*italic*`, `__underline__`)
- Subtasks (add/remove/toggle)
- Color picker (9 colors)
- Duration presets (15, 30, 45, 60, 90, 120 min)
- Deadline date picker
- Recurrence editor (daily/weekly/biweekly/monthly/yearly, day-of-week picker, end date)

### Focus Mode
- Pomodoro timer: work (25m) / short break (5m) / long break (15m)
- Cycle counter, per-task time distribution
- Foreground service to keep timer alive
- WakeLock during active work phase

---

## Phase 3: Android-Specific Features

### Notifications & Reminders
- AlarmManager for precise reminder scheduling
- Actionable notifications: "Complete", "Snooze 15m", "Open"
- Morning summary notification
- Weekly review reminder

### Widgets (Glance framework or RemoteViews)
- Agenda widget — today's upcoming tasks, auto-refreshes
- Quick-add widget — tap to create inbox task
- Focus timer widget — start/stop from home screen

### DAVx5 Integration
- ContentProvider exposing tasks as CalDAV VTODO entries
- Sync adapter registered for DAVx5 discovery
- Two-way sync: DAVx5 changes propagate to Room DB and vice versa

### Obsidian Integration
- Read/write daily notes as Markdown files in a configurable Obsidian vault directory (via SAF/Scoped Storage)
- File watcher for external changes
- Format: `YYYY-MM-DD.md` with frontmatter containing task metadata

---

## Phase 4: Polish & Platform Features

### PWA Shortcuts Equivalent
- App Shortcuts (long-press app icon): "New Task", "Open Inbox", "Start Focus"
- Deep links for notification actions

### Auto-Backup
- WorkManager job with configurable frequency (hourly/daily/weekly)
- Local backup to app-specific storage (JSON export)
- Remote backup to Nextcloud WebDAV
- Retention policy (24 hourly, 30 daily, 12 weekly)

### Settings
- Dark/light theme (follow system or manual)
- 12/24 hour clock
- Weather location (zip code)
- Sync configuration (Nextcloud URL, credentials)
- Calendar import URLs
- Reminder preferences (per-category intervals)
- Sound toggle
- Backup configuration

### Search
- Full-text search across all tasks (scheduled, inbox, recurring, deleted)
- Room FTS4 for fast queries

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Kotlin |
| UI | Jetpack Compose + Material 3 |
| Navigation | Compose Navigation |
| Local DB | Room (SQLite) |
| Background work | WorkManager |
| Networking | Retrofit + OkHttp |
| Serialization | kotlinx.serialization |
| DI | Hilt |
| Widgets | Jetpack Glance |
| Notifications | NotificationCompat + AlarmManager |
| Testing | JUnit 5 + Turbine + Compose Testing |

---

## Key Architectural Decisions

1. **Shared sync format** — The Android app reads and writes the exact same `sync.json` that the web app uses. No server changes needed.
2. **Offline-first** — Room is the source of truth. Sync is background reconciliation, not a prerequisite.
3. **Merge engine parity** — The Kotlin merge engine must produce byte-identical results to the JS version for the same inputs. Port the mergeSync test suite to verify.
4. **Timestamp discipline** — Every mutation sets `lastModified = Instant.now().toString()`. This is the foundation of conflict resolution.
