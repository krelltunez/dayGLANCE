# macOS Native Calendar (Electron / EventKit) — Implementation Plan

Status: **planned, not started.** This doc captures full context so the work can
resume cold in a future session. Follows the calendar work in PRs #1029 (toggles)
and #1030 (per-user calendar config).

## Goal

Give the **macOS desktop (Electron)** build read access to the system Calendar via
**EventKit**, so events surface as device-local tasks — mirroring iOS/Android.
This removes the need for URL/CalDAV subscriptions on macOS, and because native
events are tagged `_native: true` (never synced), it **sidesteps the multi-user
calendar-leak concern entirely on that platform** (consistent with #1030).

Scope: macOS only. PWA / Windows / Linux keep relying on URL subscriptions plus
the per-user calendar config from #1030. This is a quality-of-life add for one
platform, not a replacement for that work.

## Current wiring (verified against the codebase)

**Mobile native bridge — `src/native.js`:**
- `isNativeApp()` = `isNativeAndroid()` (`window.DayGlanceNative`) || `isNativeIOS()` (`window.DayGlanceIOS`).
- Calendar accessors call a **synchronous** injected bridge returning JSON strings:
  `nativeGetCalendars()` (~136), `nativeGetEvents(date)` (~146), `nativeCreateEvent()` (~156), `nativeUpdateEvent()` (~166).

**App-side consumption — `src/App.jsx`:**
- `nativeEventToTask(event)` (~3690): maps a native event → task with `_native: true`,
  `imported: true`, `isTaskCalendar` derived from a `task-` id prefix.
- Calendar fetch (~3750–3806): `nativeGetCalendars()` then
  `dates.map(d => nativeGetEvents(d))` over a **−2..+2 day window** — **synchronous**
  (inline comment notes the iOS bridge uses synchronous XHR). Replaces all `_native`
  tasks on each refetch.
- Gated by `isNativeApp()`. The URL/CalDAV path (`syncWithCalendar`) early-returns
  when `isNativeApp()` is true.

**Electron:**
- `electron/preload.ts`: `contextBridge.exposeInMainWorld('electronAPI', { isElectron: true, platform: process.platform, proxyFetch: (…) => ipcRenderer.invoke('proxy-fetch', …), … })`. **No calendar methods today.**
- `electron/main.ts`: `ipcMain.handle('proxy-fetch', …)` and friends — the pattern to mirror.
- Packaging/signing: `electron-builder.config.cjs`.
- Renderer consumes the bridge via `src/hooks/useElectronBridge.js`.

## Central design problem: synchronous fetch vs async IPC

The existing native calendar fetch is **synchronous**; Electron `ipcRenderer.invoke`
is **async**. Pick one:

- **(A) Async pre-fetch + cache — RECOMMENDED.** On date change, call an async
  `electronAPI.getCalendarEvents(startISO, endISO)`, store results in a ref keyed by
  date, then feed the existing render path. Most isolated, never blocks the renderer,
  and the one-time EventKit access request (async) fits naturally.
- **(B) Make the fetch path async end-to-end** (await per platform). Cleaner
  conceptually but edits the large `App.jsx` fetch loop and all its callers.
- **(C) Synchronous IPC (`ipcRenderer.sendSync`)** so Electron mirrors the mobile
  sync bridge exactly (least App.jsx change). EventKit event queries are synchronous
  once access is granted, but `sendSync` blocks the renderer and is fragile, and
  access must be pre-granted. **Not recommended.**

## Native layer (how Electron reaches EventKit)

Node can't call EventKit directly. Options:

- **(1) Swift helper binary — RECOMMENDED.** A tiny signed Swift CLI bundled via
  electron-builder `extraResources`; `main.ts` spawns it (`child_process`) and reads
  JSON on stdout. Subcommands: `request-access`, `calendars`, `events --start --end`.
  Simplest signing/entitlement story, no node-gyp, no per-Electron-ABI rebuilds.
- (2) Native Node addon (node-addon-api / Obj-C++). Most integrated but heavy:
  per-arch prebuilds (x64 + arm64), node-gyp, rebuild on Electron ABI bumps.
- (3) Existing npm package (e.g. a `node-mac-calendar`-style module). Fast, but
  evaluate maintenance, arch coverage, and Electron-ABI support before depending.

EventKit specifics: macOS 14+ uses `requestFullAccessToEvents` (vs legacy
`requestAccess(to: .event)`) — handle both. Event queries (`events(matching:)`) are
**synchronous** once authorized; only the access request is async.

## Permissions / packaging

- **Info.plist:** `NSCalendarsUsageDescription` (+ `NSCalendarsFullAccessUsageDescription`
  on macOS 14+). Add via electron-builder `mac.extendInfo` in `electron-builder.config.cjs`.
- **Entitlements** (hardened runtime / notarization / App Store):
  `com.apple.security.personal-information.calendars`. Update the entitlement
  plist(s) referenced by the config.
- **Sign the helper binary** (if used) as part of the app bundle; ensure it is in
  `extraResources` and gets notarized.

## App-side changes

1. **`src/native.js`** (or a new `src/utils/nativeCalendar.js` — CLAUDE.md already
   flags `nativeEventToTask` + fetch as an opportunistic extraction candidate; this
   is a good moment): add `hasNativeCalendar()` = `isNativeApp() || electronCalendarAvailable()`,
   plus Electron-aware accessors (async, or a cache façade) for calendars/events.
2. **`src/App.jsx`:**
   - Extend the calendar-fetch gate and the `syncWithCalendar` early-return from
     `isNativeApp()` → `hasNativeCalendar()`.
   - Wire the async pre-fetch/cache (Option A) so the −2..+2 window populates
     `_native` tasks on desktop too. Reuse `nativeEventToTask` unchanged.
   - The calendar-picker UI (`availableCalendars` / `calendarFilter`, fed by
     `nativeGetCalendars`) already exists — point it at the Electron source.
3. **`electron/preload.ts`:** expose `getCalendars`, `getCalendarEvents`,
   `requestCalendarAccess` via `ipcRenderer.invoke`.
4. **`electron/main.ts`:** `ipcMain.handle('calendar:*')` → spawn helper / call addon;
   cache the EKEventStore; emit the **same event JSON shape** the app already consumes
   from mobile so `nativeEventToTask` needs no changes.

## Event JSON contract

Keep the Electron helper's JSON **identical** to the iOS/Android bridge output so
`nativeEventToTask` is unchanged. Verify the exact fields against the mobile bridge,
but expected: `id`, `title`/`summary`, `start`, `end`, `allDay`, `calendarId`,
`calendarName`, `color`, and the `task-` id-prefix convention for task-list calendars.

## Testing / validation

- **Unit:** add a fixture for the Electron event shape and assert `nativeEventToTask`
  mapping.
- **Manual (macOS):** run the Electron app, grant calendar permission, verify events
  appear across the −2..+2 window, the calendar filter works, and events are `_native`
  (confirm they're **excluded from the sync payload**).
- **Multi-user:** confirm native events never enter sync (they're `_native`) → no
  leak, consistent with #1030.
- **Regression:** non-macOS Electron (win32/linux) and PWA fall back to URL
  subscriptions unchanged.

## Risks / open questions

- Signing / notarization for the helper binary; App Store sandbox calendar entitlement.
- macOS 14 access-API differences; permission-denied UX (hint + link to System Settings).
- Async-refactor scope if Option A's cache doesn't cleanly fit the existing
  synchronous fetch loop.
- **Write-back** (create/update events) is **out of scope for MVP** (read-only display
  first). `nativeCreateEvent`/`nativeUpdateEvent` exist but are not UI-wired today.

## Suggested sequencing

1. Spike the Swift helper standalone (access + events JSON).
2. Wire main/preload IPC + `hasNativeCalendar()` capability + async cache (Option A),
   behind a flag.
3. Packaging: Info.plist + entitlements + sign helper; test a signed build.
4. UX polish: permission-denied state, calendar filter.
5. (Stretch) write-back.

## Key file references

- `src/native.js` — bridge + calendar accessors (~136–174).
- `src/App.jsx` — `nativeEventToTask` (~3690), native fetch loop (~3750–3806),
  `syncWithCalendar` `isNativeApp()` early-return.
- `electron/preload.ts`, `electron/main.ts` — IPC bridge.
- `electron-builder.config.cjs` — Info.plist / entitlements / `extraResources` / signing.
- `src/hooks/useElectronBridge.js` — renderer-side bridge consumption.
