# GLANCElauncher integration

How dayGLANCE hands its data to the GLANCElauncher and takes writes back. The
launcher's side of the design is `SPEC.md` ("Real data") in the launcher repo;
this is the app's half. lastGLANCE follows the same pattern.

dayGLANCE's data lives in the WebView's IndexedDB, which native code cannot
read. The native side has only what the web layer pushes, so the launcher
reads a **snapshot** the app builds, and its writes reach the app the way the
automation intents do: queued natively, drained by the web layer when it runs.

## Reads: the launcher snapshot and the provider

`src/utils/launcherSnapshot.js` builds the snapshot from plain inputs; the
effect in `App.jsx` beside the widget-snapshot effect gathers them, runs on the
same trigger (every data change while the app runs), and pushes through
`DayGlanceNative.updateLauncherSnapshot` only when the content changed. Shape:

```
{ version: 1, updatedAt, timezone, today,
  inboxCount,                                   // the Inbox count as this app shows it (below)
  tasks:    [{ id, title, date, startTime, duration, isAllDay, completed, completedAt,
               colorHex, priority, notes, projectId, deadline, source: "dayglance"|"calendar",
               energy, clientId, recurringId, native }],   // scheduled, Inbox (date null), recurring occurrences;
                                                // native: a device-calendar event, read live, never stored
  goals:    [{ id, title, description, colorHex, targetDate, status }],
  projects: [{ id, title, goalId, colorHex, description, status, targetDate }],   // targetDate: the project's own, as on a goal (null when unset)
  routines: [{ id, name, startTime, duration, isAllDay, completed }],   // today's
  frames:   [{ id, frameId, date, start, end, name, colorHex,
              slots: [{ start, end }] }],                     // per day, today-7 to today+34; slots: its free time (below)
  dayShape: { dayStartMin, dayStopMin, sunriseMin, sunsetMin, use24HourClock,
              lat, lon,                                  // the weather location, for the moon and solar elevation
              dialAlarm: { on, fromMin },               // the dial's alarm-mark prefs
              dialLayers: { solar, weather, calendars, routines, frames } },   // the dial's layer toggles (below)
  weather:  [{ id: date, date, unit: "fahrenheit"|"celsius",
               hours: [{ hour, temp, code, uv }] }],      // one row per forecast date, as the dial's ring reads it
  handledWrites: [{ clientId, taskId, action, at }],
  deviceCalendar: { filter, overrides, daysBefore, daysAfter },   // how the provider reads the calendar itself (below)
  carryDeviceEvents: true }                       // headless only: this snapshot could not read the calendar
```

**`dayShape.dialLayers`** is the app dial's layer toggles on this device
(`utils/dialPrefs.js`, the dial's Layers panel), so the launcher's dial draws
what the app's dial does: sun and moon, the weather ring, imported calendar
events, routines and frames. Focus is left out (the launcher has no focus
data). Device-local like the toggles themselves, and read from the same
storage by the headless refresh; a build that sends none means every layer on.

**`frames[].slots`** is each frame's free time, as the app's dial reads it
(App.jsx `dialFrameSlots`): `computeAvailableSlots` over that day's timed
task rows and today's routines, overlaps merged, with no now floor, so the
launcher takes "still available" at its own minute, as the app's widget does.
The hub's "N available" and the dial's frame readout come from it, so the two
dials agree. A build that sends none leaves the launcher to work it out from
the tasks it draws. A task still running from the night before is already
netted out (below).

### Tasks that run past midnight (#2278)

A task row is one row on one `date`. When a timed row's start plus its
duration passes 24:00, the part after midnight lands on the next date. The
snapshot sends nothing extra for that part: the launcher derives it from the
rows, by the app's rule (`packages/agenda-core/src/overnight.js`,
`continuationsFromPreviousDay`), which every surface of the app uses:

- **Which rows carry.** A timed block only: `isAllDay` false, a `startTime`
  (`HH:MM`; seconds, if any, ignored) and a `duration` above 0. Completed rows
  carry too (drawn as completed): the piece is the day's shape, not a todo.
- **The piece.** With `start` the row's start in minutes since midnight,
  `spill = min(1440, start + duration - 1440)`. A positive `spill` is drawn on
  the date after the row's `date`, from 00:00 to `spill` minutes. A row that
  ends exactly at 24:00 has `spill` 0 and leaves nothing. A user's own task is
  at most 24 hours long; a longer imported event is clipped at the end of the
  next date (how a block spans more than two dates is a later phase).
- **Who owns it.** The start date. Its counts, its task list and every write
  stay there: a tap, COMPLETE or MOVE on the piece acts on the row itself, by
  its `id` (a recurring occurrence keeps its `recurring-<template>-<date>` id,
  whose date is the one it started on). The next date only **shows** the piece
  and **counts its time as busy**; it is not one of that date's tasks, so it is
  never counted, listed or offered as that date's work.
- **Where it ends.** A row is over at its real end, `date` + start + duration:
  a 23:00 task of 120 minutes is still running at 00:30 the next day and has
  ended at 01:00 (the app's overdue list and NOW line judge it so).
- **Frames.** `frames[].slots` already net the piece out: a frame on the next
  date is busy from 00:00 to the end of every piece. Do not subtract it again.
- **The rows it needs.** To draw the pieces on the first date it shows
  (today), the launcher needs the previous date's rows, and the snapshot
  carries them: every scheduled task whatever its date, yesterday's recurring
  occurrences that run past midnight (the app's recurring expansion opens a
  day before the earliest date it covers, and keeps yesterday's occurrence
  that crosses midnight even when it was not completed), and device-calendar
  rows from well before today (`deviceCalendar.daysBefore`, below; the
  provider's own read uses the same window). A device event's `duration` is
  its full start to its full end, wall-clock, at most a whole day, so an event
  from 23:00 to 01:00 is a 120-minute row on its start date.

**Vectors.** `dayglance-ios/TestFixtures/overnight.vectors.json`
(`overnight.vectors/1`, generated from the app's own functions by
`src/utils/overnightVectors.js`, refreshed with `npm run ios:vectors`, and held
to the code by `overnightVectors.test.js`) gives the rule's numbers over
snapshot task rows: `spill` (each row's `spillMinutes` and real `end`),
`continuations` (a date's pieces from the previous date's rows, in row order:
`id`, `fromDate`, `startMinutes`, `endMinutes`, `minutes`) and `frameSlots`
(a frame's slots on the next date). Each case is `{ name, input, expected }`.
The launcher can copy the file into its test resources and assert its port
against every case, as the Swift dial does with `dayDial.vectors.json`; a
change to the rule regenerates the file, and the launcher picks up the new
copy.

**`inboxCount`** is the number the app's own Inbox badge and dial complication
show: the Inbox through the user's filters (priority, project, tag, completed,
standalone) and the multi-user lens, without Bucket List, archived or example
tasks (`utils/inboxFilter.js`, the one filter all of them use). The task rows
carry every visible Inbox task, so counting them overcounts; the launcher's
Inbox complication shows `inboxCount` and counts rows only for a build that
sends none. The filter preferences are device-local, and the headless refresh
reads them from the same storage, so both paths send the same number.

`LauncherProvider` (`dayglance-android/.../launcher/`) serves it read-only at
`content://com.dayglance.app.launcher/<collection>` for `tasks`, `goals`,
`projects`, `routines`, `frames`, `weather`, `dayShape` (one row) and `meta` (one row:
version, updatedAt, timezone, today, inboxCount, handledWrites). Each cursor has `_id`,
`id` and `json` columns, the row as JSON. Every push calls `notifyChange` on
the authority, so a `ContentObserver` registered on any collection URI sees
every change. `insert`, `update` and `delete` throw.

**Device-calendar events are read by the provider, not the snapshot.** The
calendar is the OS's, so an event added in another app changes nothing the app
pushes, and the app may be closed for days. On every `tasks` query the provider
reads the calendar itself over the window around today
(`launcher/LauncherDeviceEvents.kt`), in one range query whose events are then
listed under each day they cover. The window is 37 days back and 42 ahead
(`DEVICE_EVENT_WINDOW` in `utils/launcherSnapshot.js`): every cell of the
launcher's month grid for today's month, whatever the day, since an event
outside the window is simply absent and the grid reads as a quiet month. The
app's recurring expansion reaches back to the same grid's first cell
(`utils/recurringExpansionRange.js`) for the same reason. The read takes the
snapshot's `deviceCalendar`: the
calendars the user shows (`filter`, empty for all) and the user's edits to
device events (`overrides`, by event id, colour resolved to hex). Those rows
replace the snapshot's `native` ones, and a change to the calendar notifies
the authority (after 1.5 s of quiet, for as long as the process lives), so the
launcher re-reads. The launcher also re-reads on every return to Home. Without
the calendar permission, or before a snapshot carries `deviceCalendar`, the
snapshot's own rows are served (in a headless snapshot, the previous one's,
carried by `LauncherWrites.withCarried`).

The provider's rows must equal the ones the snapshot builds from the same
events, or an event would change shape depending on who read it.
`dayglance-ios/TestFixtures/launcherDeviceEvents.vectors.json` is generated
from the web layer (`src/utils/launcherDeviceEvents.fixture.test.js`, with
`GEN_FIXTURE=1`) and `LauncherDeviceEventsTest` holds the Kotlin to it, the
restore keywords included. A change to `nativeEventToTask`, `taskRow` or the
energy keywords regenerates the fixture and then needs the Kotlin to match.

## Freshness: the heartbeat and REFRESH

The snapshot is pushed only when its content changes, so `meta.updatedAt` says
when something last moved, not when the app last looked. Two more stamps say
that (`utils/launcherHeartbeat.js`), written natively beside the snapshot and
merged into `meta` by the provider:

- `checkedAt` (ms): every run of the snapshot builder, changed or not, and
  every return to the foreground.
- `syncedAt` (ISO): the latest completed cycle across the enabled sync tiers
  (the file tier's and the vault's `getLastSynced`), the moment other devices'
  changes are known to be in. Null when no tier is configured.

`meta` also carries `rendererAlive` (whether a MainActivity with a live WebView
exists in the process at the moment of the read) and `refreshLog`, the last 20
REFRESH requests.

**`com.dayglance.app.launcher.REFRESH`** asks the app to confirm its data now.
It is not a write: it carries a `clientId` for dedupe and logging only, is never
in the handled ledger, and the launcher sends it outside its outbox. The
receiver routes it by liveness and logs every request with the liveness it saw:

| Outcome | When |
| --- | --- |
| `queued` | the renderer is alive: queued and woken; the web layer runs every enabled tier to completion (one after the other), re-pushes, re-stamps the heartbeat, then reports `ran` (with `durationMs`), `skipped` or `failed` (each with `reason`) into the same entry |
| `coalesced` | a queued or scheduled refresh from the last minute has no outcome yet |
| `unanswered` | a `queued` refresh the web layer did not answer while `LauncherAwakeWorker` held the app awake; `reason` says how far it got (the wake never reached the app; the app was woken but the page never took it; or the page took it and did not finish), how long the hold lasted and how late it began (Android can hold the job itself back). `wokenAt` and `pickedUpAt` stamp the first two steps (`LauncherRefreshTrace`), `holdStartedAt` and `finishedAt` the hold. A cycle that hangs once taken reports `failed` after 45 s instead, naming the step (`REFRESH_CAP_MS`). After two minutes or more in the background, a page that left a refresh unanswered is closed, as a swipe from Recents would, once it answers `ok` to the retire check (no daily-note write in flight, `intents/retireCheck.js`); the reason then ends "the app closed the unresponsive page, and a headless refresh follows", and a `<clientId>-headless` entry follows (`LauncherPageRetire`). Otherwise it ends "the page was left open: …" |
| `scheduled` | no renderer in the process: a headless run is enqueued (below); the entry gains `startedAt`, `waitMs` and `headless: true` when it runs, then `ran`/`failed` from the web layer or `aborted`/`throttled`/`failed` from the worker |
| `deferred` | no renderer, and the headless run could not be enqueued (`reason` says why) |

**A live renderer in the background.** Android freezes a backgrounded app's
processes, the WebView's renderer among them, a couple of minutes after it
goes idle. The receiver is thawed to take the REFRESH, but the web layer that
answers it was not: on a device a `queued` refresh once waited 392 s, until
the app was opened, and once was never answered. So a `queued` REFRESH also
starts `LauncherAwakeWorker`, an expedited job that runs nothing and only waits
(at most a minute, the in-flight window) for the web layer to record an
outcome. An app running a job is not frozen, so the app's own cycle runs in its
one WebView as it would on screen; there is no second WebView, unlike the
headless path. Below Android 12 the job shows the same quiet notification as a
headless run; in a restricted standby bucket it may itself wait, but no longer
for the app to be opened.

**`ran` means a cycle completed.** Both tiers return early, silently, while a
cycle of theirs is in flight, and the vault does during a failure cooldown;
REFRESH once took any return for a completed cycle. A cycle frozen mid-request
then held the vault's in-flight guard, and every later REFRESH logged `ran` in
a millisecond while nothing synced for eight hours (2026-10-22): the 1 ms
answer also ended the keep-awake job at once, so the stuck cycle never got the
running time to time out. Now (`src/intents/launcherRefreshCycle.js`) a vault
cycle in flight is joined for up to 20 s, which keeps the job, and so the app,
awake while it finishes, and is followed by a cycle of the REFRESH's own; one
still running after that, a cooldown, a held-back pull or an engine not ready
is `skipped` with the reason, and a cycle that failed without throwing is
`failed`.

**The headless run** (`launcher/LauncherRefreshWorker.kt`; `src/headless/` on
the web side; the rules in CLAUDE.md, "Headless refresh"). An expedited,
network-constrained WorkManager job boots the web bundle in a WebView with
no Activity, at `index.html?headless=refresh&clientId=…`, where the headless
root runs one cycle of every configured tier with the app's own payload and
apply, fetches the forecast for the stored location (one read-only request,
started with the sync; when it fails the shell keeps the last snapshot's
weather), pushes the snapshot and the heartbeat, and reports. Then:

- `ran` / `failed` come from the web layer as on the alive path, with
  `liveness: dead` and `headless: true` on the entry;
- `waitMs` is how long the OS held the job between the request and the run:
  a standby bucket or Doze shows up here, not as a lost request;
- `throttled`: two headless runs are never closer than ten minutes (a WebView
  boot costs seconds and tens of MB); the entry says how long ago the last
  one finished;
- `aborted`: the user opened the app during the run. The reverse lock is
  signal-abort: `MainActivity.onCreate` destroys the headless WebView on the
  main thread before the live one loads, and the root checks
  `headlessShouldAbort` at each phase boundary. The live instance's own start
  runs a cycle, so nothing is lost; waiting would only hold the splash.
- `failed` with `timed out after 120 s`: the cap (an alive cycle has been
  measured at 75 s, and a headless run adds the WebView boot); the WebView is
  torn down;
- a run that finds the renderer alive by the time it executes hands the
  REFRESH to it instead (the entry turns `queued`).

`meta.headlessRunning` says whether a headless WebView exists at the moment
of the read. The sync keys come from the same Keystore slots the app uses, so
an encrypted tier with no cached key reports `failed` with `passphrase
required` rather than prompting.

The launcher measures staleness per app from `syncedAt` when sync is
configured and from `checkedAt` otherwise, and its diagnostics panel shows
the log, so standby-bucket deferral and dead-process gaps are visible over
time.

## Writes: the launcher receiver

`LauncherIntentReceiver` takes `com.dayglance.app.launcher.<ACTION>` broadcasts
with two String extras: `payload`, a JSON object, and `clientId`, an id the
launcher generates per write. The actions and their payloads:

| Action | Payload | Does |
| --- | --- | --- |
| `CREATE` | the automation CREATE shape: `title`, `due`, `duration`, `all_day`, `deadline`, `tags`, `priority`, `notes`, `project` | makes a task and stamps `clientId` on it |
| `COMPLETE` | `task_id` and optional `completed_at`, or `title` | completes the task; a recurring occurrence id (`recurring-<template>-<date>`) marks that date on the series |
| `UNCOMPLETE` | `task_id` | reopens it, Inbox and recurring occurrences included |
| `MOVE` | `task_id`, `date` (`YYYY-MM-DD`), optional `start` (`HH:MM`) | an Inbox task is scheduled (it needs `start`; priority and deadline are dropped, as the app's own schedule path does); a block moves to the date and, when given, the time; without `start` an all-day task stays all-day and a timed one keeps its time |
| `RESIZE` | `task_id`, `duration` (minutes, 5 or more) | changes the block's length |
| `TOGGLE_ROUTINE` | `routine_id`, optional `date`, optional `completed` | sets today's completion of the routine to `completed` (already so: nothing changes), or flips it when `completed` is absent (a launcher from before it was sent); another date is refused, since completions are kept for today only |

MOVE, RESIZE, COMPLETE and UNCOMPLETE run through the MCP write model's pure
mutations (`utils/taskMutations.js`), so a calendar event, a device-calendar
event, a routine block, a CalDAV task and a MOVE or RESIZE of a recurring
occurrence are refused with the same words the MCP tools use, and a placement
over a routine is refused rather than slid. Each stamps `lastModified` at the
write. The receiver queues the
write in its own slot (several deep, unlike the automation transport's single
slot) and sends the same package-scoped wake broadcast, so a running app
drains at once and a dead app on next launch.

Two rules keep a write from being lost on the way (`intents/useAndroidIntentBridge.js`):

- **Nothing drains before the data has loaded.** The bridge waits for
  `dataLoaded` and, with vault sync on, the first pull of the session
  (`intentDrainGate.js`), like the other intent drains. Draining at mount
  handled every write against the empty initial task lists: a `COMPLETE` found
  no such task and recorded the failure, and a created task was replaced by the
  stored list a moment later. That was every write sent while the app was
  closed, which the self-closing page (`LauncherPageRetire`) made the usual case.
- **A write leaves the queue only once it is saved.** `getPendingLauncherIntents`
  hands the page every entry but keeps the writes (`LauncherWriteQueue`); the page
  handles each with its setters inside a synchronous flush, so the change is
  committed and saved before the write is recorded in the ledger and acknowledged
  (`ackLauncherIntents`). A page that stalls in the background, or is closed or
  killed first, leaves its writes for the next, which dedupes on the id (a CREATE
  also on a task already carrying it). Writes are handled before refreshes, so
  none waits behind a sync cycle. A REFRESH is still taken off on read.
- **The snapshot waits for the ledger.** A write's synchronous flush runs the
  app's launcher-snapshot effect before the write is recorded, so the effect
  holds while a write is in flight (`launcherWritesInFlight`) and runs again
  when the drain settles. Pushed in between, the snapshot showed the change
  without its id in `handledWrites`, and the launcher, still holding the write
  as pending, applied it again on top: a TOGGLE_ROUTINE flipped straight back.

A write that reaches the app while it is closed does not wait for it to open:
the receiver schedules a headless run (logged as `<clientId>-write`, unless a
run is already queued or running, or one ran in the last ten minutes; the
launcher re-sends a write until it sees it land, so a later send starts it),
and the headless root applies the queue after its pull, saves each write,
acknowledges it, and runs the tiers again to push what changed
(`src/headless/HeadlessRefresh.jsx`). `TOGGLE_ROUTINE` waits for the app.

The web layer (`src/intents/launcherWrites.js`) dedupes on `clientId` with a
ledger kept in localStorage: a re-sent write is acknowledged, never applied
twice. A write that fails for good (an unknown id, a read-only block, a routine
in the way) is recorded too, with its error, so the launcher sees the id in
the next snapshot and lets its optimistic change go at once rather than when
its outbox entry expires; a failed CREATE is the exception, since the launcher
may correct the payload and re-send. `CREATE`
stamps `clientId` on the task it made (the field is declared to the sync seams
like `originalPlan`: stripped from the re-stamp comparison, carried across
both merge tiers and the apply); `COMPLETE` with `task_id` completes that task
by id and is idempotent. The ledger rides the snapshot as `handledWrites`, so
the launcher retires an outbox entry when the snapshot shows its id, on the
created task or in the ledger.

The client id travels beside the payload rather than inside it because the
intents package's payload schemas are strict and shared with Tasker. The
receiver does not consult the "Automation intents" toggle, which keeps gating
the public transport exactly as before. No RESULT broadcast is sent for
launcher writes; the launcher reads the outcome from the next snapshot.

## Permission

Both the provider and the receiver sit behind `com.dayglance.permission.LAUNCHER`,
`protectionLevel="signature|knownSigner"`, with `knownCerts` naming the
**launcher's** signing certificates (`res/values/launcher_certs.xml`): its
release certificate, and its Play app signing certificate once it ships there. dayGLANCE's own
signature satisfies the `signature` half, so the app can always reach its own
provider. `knownSigner` exists from Android 12; on older devices the permission
is signature-only and the launcher stays in demo mode. The launcher declares
`<uses-permission android:name="com.dayglance.permission.LAUNCHER" />`.

That name, and the provider's authority `com.dayglance.app.launcher`, belong to
release builds. A debug build (`com.dayglance.app.debug`) declares its own,
`com.dayglance.permission.LAUNCHER_DEBUG` and `com.dayglance.app.debug.launcher`
(the `launcherPermission` manifest placeholder and `applicationId`), because two
packages with different signatures cannot declare one permission or one
authority: a test APK would otherwise refuse to install beside the store app
(#2272). The launcher pairs only with `com.dayglance.app`, so a debug build is
never paired.

A digest is read from the launcher's keystore (`keytool -list -v`, SHA-256,
lowercase, no colons). The Play entry stays a placeholder until the launcher ships
there. There is no debug entry: where the launcher's release key is present, its
debug builds carry that key too.

## Verifying on a device

With a launcher signed by the release key and both apps installed:

1. Open dayGLANCE once so the web layer pushes. Then from a shell:
   `adb shell content query --uri content://com.dayglance.app.launcher/meta`
   prints the meta row (adb's shell holds every permission). `.../tasks`
   lists today's rows; change a task in the app and query again.
2. A write: `adb shell am broadcast -a com.dayglance.app.launcher.COMPLETE
   -n com.dayglance.app/.launcher.LauncherIntentReceiver --es clientId test-1
   --es payload '{"task_id":"<an id from step 1>"}'`. With the app in the
   foreground the task completes at once; with it dead, on next launch. Send
   it again with the same `clientId`: nothing changes, and `meta` lists the
   id under `handledWrites`.
3. A create: the same with `.CREATE` and `--es payload '{"title":"From the
   launcher"}'`; the new task's row carries `"clientId":"test-2"`.
   Then the gestures: `.MOVE` with `'{"task_id":"<id>","date":"<tomorrow>","start":"09:00"}'`
   moves the block (query `tasks` again); `.RESIZE` with
   `'{"task_id":"<id>","duration":60}'`; `.UNCOMPLETE` with `'{"task_id":"<id>"}'`
   reopens the task completed in step 2; `.TOGGLE_ROUTINE` with
   `'{"routine_id":"<an id from routines>"}'` flips today's pill. A MOVE of a
   `recurring-…` id is refused, and `meta.handledWrites` lists that id with its
   `error`.
4. A refresh: `am broadcast -a com.dayglance.app.launcher.REFRESH -n
   com.dayglance.app/.launcher.LauncherIntentReceiver --es clientId rf-1`.
   With the app alive, `meta.refreshLog` shows the entry go `queued` then
   `ran`, and `syncedAt` moves if a tier is configured; with the process
   killed (`adb shell am kill com.dayglance.app`, never `force-stop`), the
   entry is `scheduled` with `rendererAlive` false, then gains `startedAt`
   and `waitMs` and ends `ran` (`adb logcat -s LauncherRefresh:I` follows
   the run); a second REFRESH inside ten minutes ends `throttled`. Open the
   app during a run (`am start`) and the entry ends `aborted`.
5. Permission: from any app without the permission the query is refused
   with a `SecurityException` and the broadcast is not delivered.

Unit tests: `vitest run src/utils/launcherSnapshot.test.js
src/intents/launcherWrites.test.js src/headless` and, on the Android side,
`./gradlew :app:testDebugUnitTest --tests 'com.dayglance.app.launcher.*'`.
