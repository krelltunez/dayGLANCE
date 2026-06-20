# dayGLANCE → lastGLANCE: Closed‑App Notifications, the actual implementation

A reusable technical writeup of how dayGLANCE delivers timely notifications when the
app is fully closed, written so you can replicate it in lastGLANCE. Every claim is
cited to a specific file and line in this repo.

> **Headline correction up front:** dayGLANCE is **not a Capacitor app.** There is no
> `@capacitor/*` anywhere in `package.json` / `package-lock.json` and no
> `capacitor.config.*` file. It is a hand‑rolled `WebView` shell with a custom
> `@JavascriptInterface` bridge (`window.DayGlanceNative`). All notification work is
> done in **native Kotlin via `AlarmManager`** — not by `@capacitor/local-notifications`,
> not by push/FCM, not by a headless JS runner. If lastGLANCE is Capacitor‑based you
> can still lift the *model* and the Kotlin classes; you just won't get them for free
> from a plugin.

---

## 0. The shape of the system (one paragraph)

The WebView (React) computes, in advance, every reminder that should fire for *today*
and hands the full list to native via one bridge call (`syncReminders`). Native turns
each entry into an exact `AlarmManager` alarm and **persists the list to
SharedPreferences**. When an alarm fires — app open, backgrounded, or fully killed — a
`BroadcastReceiver` builds and posts the notification from the alarm's own extras. No
database is read in the background for reminders. The only thing native *recomputes* in
the background is the cosmetic "Up Next" persistent notification, and it does that from a
JSON **snapshot** the WebView previously wrote to SharedPreferences — never from Dexie.

---

## 1. Notification scheduling

### What fires when the app is closed
**`android.app.AlarmManager`**, set from a custom bridge, delivered to a
`BroadcastReceiver`. No WorkManager, JobScheduler, or FCM is involved in *firing* a
reminder. (WorkManager exists, but only as a 15‑minute widget/Up‑Next backstop — see §6.)

- Scheduling entry point: `NotificationBridge.scheduleAlarm()` —
  `dayglance-android/app/src/main/java/com/dayglance/app/bridge/NotificationBridge.kt:224`
- Delivery target: `ReminderReceiver.onReceive()` →
  `dayglance-android/app/src/main/java/com/dayglance/app/notifications/ReminderReceiver.kt:31`
- Registered in the manifest as a (non‑exported) receiver:
  `dayglance-android/app/src/main/AndroidManifest.xml:210`

### AlarmManager vs WorkManager vs JobScheduler — and exactness
**AlarmManager, exact, Doze‑proof.** The core call is:

```kotlin
// NotificationBridge.kt:224
private fun scheduleAlarm(pi: PendingIntent, triggerAtMillis: Long) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
        am.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)              // graceful inexact fallback
    } else {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi) // the good path
    }
}
```

- `setExactAndAllowWhileIdle` is the key: it fires precisely **and pierces Doze**.
- On Android 12+ (API 31, `S`) exact alarms require user permission; if it hasn't been
  granted yet the code **degrades to inexact `am.set()`** rather than crashing
  (`SecurityException` avoidance). That degraded path is exactly the "late when closed"
  failure mode — see the war story in §5.
- `RTC_WAKEUP` (wall‑clock + wake the CPU), because triggers are wall‑clock task times.

### Pre‑scheduled from JS, or native reads data at runtime?
**Pre‑scheduled from JS.** This is the part you care about, so be precise:

- JS computes each reminder's absolute epoch‑ms trigger and pushes the whole set:
  `src/hooks/useReminderEngine.js:276`–`359` (the second `useEffect`, the "background
  alarm" one). It walks today's tasks + hyperGLANCE sessions, derives trigger points
  (`before15/10/5`, `start`, `end`, `morning`), converts each to
  `todayMidnight.getTime() + triggerMin*60000`, drops anything already past, and calls
  `nativeSyncReminders(futureReminders)`.
- Bridge hop: `src/native.js:452` `nativeSyncReminders()` → `JSON.stringify` →
  `window.DayGlanceNative.syncReminders(json)`.
- Native side never opens IndexedDB/Dexie and never "decides" what to fire. The alarm
  carries everything the notification needs as Intent extras (`id`, `taskId`, `title`,
  `body`, `type`, `isCalendarEvent`) and `ReminderReceiver` just renders them:
  `ReminderReceiver.kt:53`–`114`.

There is exactly **one** "native recomputes at runtime" feature — the *Up Next*
persistent (ongoing) notification — and even that reads a JSON **snapshot**, not the DB.
Covered in §2.

---

## 2. The data question (the important one)

### Reminders: data is never touched in the background
Because reminders are fully pre‑scheduled (§1), native makes **no runtime data
decision** for them. The alarm's extras *are* the data.

### Up Next notification: native re‑reads a SharedPreferences snapshot (not the DB)
The only background "read app data and decide" path is the cosmetic ongoing "Up Next"
notification and the home‑screen widgets. The mechanism is a **SharedPreferences JSON
snapshot**, *pushed by JS*, *read by native* — there is **no** native SQLite mirror, **no**
headless JS context (`@capacitor/background-runner`), and **no** headless WebView.

- The snapshot store is plain `SharedPreferences` (`MODE_PRIVATE`, prefs file
  `"dayglance_shared"`): `dayglance-android/app/src/main/java/com/dayglance/app/data/SharedDataStore.kt:16`–`19`,
  with `widgetSnapshot` at `SharedDataStore.kt:74`.
- JS writes it whenever Glance‑affecting state changes, via
  `NativeBridge.updateWidgetSnapshot(snapshotJson)`:
  `dayglance-android/app/src/main/java/com/dayglance/app/bridge/NativeBridge.kt:266`. That
  method stores the JSON, kicks the widgets, and arms the Up‑Next alarm chain
  (`NativeBridge.kt:276`).
- On each alarm tick `UpNextNotificationUpdater.refresh()` reads `widgetSnapshot`,
  recomputes the body string ("Starts in 15m" / "In progress · ends at 3:15 PM") for the
  *current* clock time, posts it, and arms the next alarm:
  `dayglance-android/app/src/main/java/com/dayglance/app/notifications/UpNextNotificationUpdater.kt:53`–`123`.
- Room is on the dependency list (`gradle/libs.versions.toml:11`, `app/build.gradle.kts:106`)
  and described as a "shared data layer", but the reminders/Up‑Next paths in this codebase
  use `SharedPreferences`, not Room. Treat Room as available‑but‑unused for this feature.

> Note the **Room dependency is present but the notification path does not use it.** Don't
> assume there's a SQLite mirror feeding notifications — there isn't.

### The JS ↔ native bridge API surface (for scheduling)
Native side (`@JavascriptInterface`), all on `window.DayGlanceNative`:

| Method | Where | Purpose |
|---|---|---|
| `scheduleReminder(id, title, body, triggerAtMillis)` | `NotificationBridge.kt:45` | one‑off alarm |
| `cancelReminder(id)` | `NotificationBridge.kt:61` | cancel by id |
| `syncReminders(remindersJson)` | `NotificationBridge.kt:162` | **diff‑replace the whole alarm set** (primary API) |
| `showTaskNotification(reminderId, taskId, title, body, type, isCalendarEvent)` | `NotificationBridge.kt:110` | immediate rich notif (used when app *is* open) |
| `showNotification(title, body)` | `NotificationBridge.kt:80` | immediate plain notif |
| `updateUpNextNotification(taskJson)` / `cancelUpNextNotification()` | `NotificationBridge.kt:308` / `436` | ongoing Up Next |
| `showFocusTimerNotification(...)` / `dismissFocusTimerNotification()` | `NotificationBridge.kt:350` / `404` | focus timer (native chronometer) |
| `updateWidgetSnapshot(snapshotJson)` | `NativeBridge.kt:266` | push agenda snapshot + arm Up‑Next chain |
| `getPendingAction()` / `getPendingIntent()` | `NativeBridge.kt:441` / `486` | drain notif‑action / intent results into JS |

JS wrappers (null‑safe, no‑op as PWA) live in `src/native.js`:
`nativeSyncReminders` (`:452`), `nativeShowTaskNotification` (`:341`),
`nativeScheduleReminder` (`:317`), `nativeGetPendingAction` (`:361`),
`nativeGetPendingIntent` (`:395`).

The bridge is injected in `MainActivity.kt:341`:
`webView.addJavascriptInterface(nativeBridge, "DayGlanceNative")`.

`syncReminders` payload schema (each array element):
```json
{ "id": "...", "taskId": "...", "title": "...", "body": "...",
  "type": "before15|before10|before5|start|end|morning|hg-upnext|hg-start",
  "isCalendarEvent": false, "triggerAtMillis": 1750000000000 }
```

---

## 3. Rescheduling & lifecycle

### What triggers (re)scheduling
- **Any data/settings change**: the `useReminderEngine` background effect re‑runs on
  `[tasks, expandedRecurringTasks, reminderSettings, hgSessions, isVisibleForUser]` and
  calls `nativeSyncReminders` every time — `src/hooks/useReminderEngine.js:359`. So edits,
  completions, snoozes, setting toggles all re‑sync.
- **App open / foreground**: same effect runs on mount; widget snapshot is re‑pushed too.
- **Device reboot**: `ReminderReceiver` is registered for `BOOT_COMPLETED`
  (`AndroidManifest.xml:213`–`215`) and re‑registers every still‑future alarm from the
  persisted JSON — `ReminderReceiver.kt:33`, `38`–`51`. (AlarmManager alarms do not
  survive reboot, hence the persisted list.)
- **15‑minute backstop**: `WidgetUpdateWorker` re‑arms the Up‑Next alarm chain in case an
  OEM killer or restart cleared it — `WidgetUpdateWorker.kt:81`–`83`.
- **Timezone change**: there is **no** dedicated `TIMEZONE_CHANGED`/`TIME_SET` receiver.
  Re‑sync happens opportunistically the next time the app is foregrounded. (Gap worth
  closing in lastGLANCE — see "if I were doing this again".)

### Cancellation, dedup, idempotency
- **PendingIntent request code = `id.hashCode()`** is the idempotency key for *alarms*
  (`NotificationBridge.kt:54`, `199`, `455`). Re‑scheduling the same `id` with
  `FLAG_UPDATE_CURRENT` updates in place rather than duplicating.
- **Notification id = `taskId.hashCode()`** (note: task, not reminder), so successive
  reminders for the same task (`before15` → `before5` → `start`) **replace** each other in
  the shade instead of stacking — `ReminderReceiver.kt:63`, `NotificationBridge.kt:120`.
- **Diff‑based sync, not cancel‑all/reschedule‑all.** `syncReminders` compares the stored
  set against the new set and only cancels alarms that were removed *or* whose trigger time
  / body changed, and only schedules new/changed ones — `NotificationBridge.kt:162`–`220`.
  The comment at `:147`–`160` calls out *why*: a blanket cancel‑then‑reschedule opens a
  window where a due‑any‑second alarm could be lost. Unchanged alarms are left strictly
  alone.

---

## 4. Permissions & manifest

From `dayglance-android/app/src/main/AndroidManifest.xml`:

| Permission / component | Line | Notes |
|---|---|---|
| `POST_NOTIFICATIONS` | `:13` | requested at runtime on API 33+ |
| `SCHEDULE_EXACT_ALARM` | `:14` | **present**; `USE_EXACT_ALARM` is **not** used |
| `RECEIVE_BOOT_COMPLETED` | `:15` | for reboot re‑registration |
| `ACCESS_NOTIFICATION_POLICY` | `:17` | Focus‑mode DND, not reminders |
| `ReminderReceiver` (BOOT_COMPLETED) | `:210`–`216` | exported=false |
| `NotificationActionReceiver` (snooze/complete) | `:219`–`226` | exported=false |
| `UpNextNotificationUpdater` (UP_NEXT_TICK) | `:242`–`248` | exported=false |
| `IntentReceiver` (CREATE/COMPLETE/OPEN/QUERY) | `:229`–`238` | exported=true (Tasker) |

There is **no** `<service>` foreground service for notifications, **no**
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, **no** `WAKE_LOCK` — confirmed absent by grep.
The only `<service>` is the widget's `RemoteViewsService` (`:204`).

**Why `SCHEDULE_EXACT_ALARM` and not `USE_EXACT_ALARM`:** `USE_EXACT_ALARM` is the
auto‑granted‑but‑Play‑Store‑restricted permission for alarm‑clock‑class apps; dayGLANCE
instead uses the revocable `SCHEDULE_EXACT_ALARM` and *asks* the user, which keeps it
Play‑policy‑safe for a planner. The tradeoff is you must handle the not‑granted case.

### Runtime permission flows
- **POST_NOTIFICATIONS + calendar + mic** requested together on startup:
  `MainActivity.kt:348`–`375` (`requestRuntimePermissions()`), gated on API 33 (`TIRAMISU`)
  for notifications at `:357`–`361`.
- **Exact‑alarm special access** is *not* a normal runtime permission — it's a Settings
  deep‑link. dayGLANCE shows a one‑time‑per‑session dialog in `onResume`:
  `MainActivity.kt:425` calls `maybePromptExactAlarmPermission()` →
  `:448`–`471`, which checks `am.canScheduleExactAlarms()` and, if false, opens
  `Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM`. The user‑facing copy is at `:456`–`460`.
- Channels are created once in `Application.onCreate`:
  `dayglance-android/app/src/main/java/com/dayglance/app/DayGlanceApplication.kt:15`–`47`
  — `reminders` (HIGH), `focus_mode` (DEFAULT), `events` (DEFAULT), `up_next` (LOW).

---

## 5. The war story — "not timely when closed"

**Root cause:** there were two compounding problems.

1. **The in‑WebView timer can't fire when closed.** The original reminder engine is a
   foreground loop: `useReminderEngine.js:71`–`256` watches `currentTime` (a ticking
   clock) and fires toasts/notifications when "now" enters a 2‑minute window around a
   trigger. That logic only runs while the WebView is alive and unthrottled. Background a
   WebView and the timers throttle/suspend; kill the app and they don't run at all. So
   anything relying on the JS loop was simply absent when the app was closed.

2. **Inexact alarms get batched by Doze.** Even after moving scheduling to AlarmManager,
   plain `set()` / `setInexactRepeating()` alarms are coalesced and deferred during Doze,
   so a batch of reminders all arrive together when the device next wakes — the classic
   "they're all late, then they dogpile" symptom. On Android 12+ you *only* get exact
   delivery if you (a) call `setExactAndAllowWhileIdle` **and** (b) hold
   `SCHEDULE_EXACT_ALARM`. Missing either silently drops you to the batched path.

**The fix (what actually made it reliable):**

- Move from "fire from the JS loop" to **pre‑scheduling exact alarms** computed in JS and
  registered in native (`useReminderEngine.js:276` → `syncReminders` →
  `setExactAndAllowWhileIdle`). The JS loop stays, but only for in‑app toasts and sound
  while the app is open (`useReminderEngine.js:226`, `:250`); native owns closed‑app
  delivery.
- Use `setExactAndAllowWhileIdle(RTC_WAKEUP, …)` so alarms pierce Doze
  (`NotificationBridge.kt:229`).
- Declare and **actively prompt for** `SCHEDULE_EXACT_ALARM`
  (`AndroidManifest.xml:14`, `MainActivity.kt:448`). Without the prompt, the code's own
  fallback to `am.set()` (`NotificationBridge.kt:227`) reproduces the original late
  behaviour — so the prompt is load‑bearing, not cosmetic.
- Persist the alarm set and re‑register on `BOOT_COMPLETED` (`ReminderReceiver.kt:33`,
  `38`) so a reboot doesn't silently wipe pending reminders.
- For the *ongoing* Up Next notification specifically, use a **belt‑and‑suspenders dual
  alarm**: a per‑minute `setExact` countdown tick (fires when the screen is on / not in
  Doze) **plus** a `setExactAndAllowWhileIdle` alarm at the exact start/end transition so
  the state flips correctly even if Doze ate the ticks — `UpNextNotificationUpdater.kt:177`–`198`.

**OEM / Doze / battery‑killer handling:** dayGLANCE does **not** request a battery‑opt
exemption, does not run a foreground service, and does not hold a wakelock. Its only
defense against OEM background killers (Samsung/Xiaomi/etc. clearing alarms) is the
**WorkManager 15‑minute backstop** that re‑arms the Up‑Next alarm chain
(`WidgetUpdateWorker.kt:81`). Note this backstop covers Up‑Next/widgets only — it does
**not** re‑register task reminders. On aggressive OEMs a killed app can still miss a task
reminder until next open; `setExactAndAllowWhileIdle` + exact‑alarm permission is what
gets you correct on stock/Pixel/most devices.

---

## 6. Background sync (CRDT) — does it run while closed?

**No.** dayGLANCE does **not** pull remote CRDT changes while the app is closed.

- The only background job is `WidgetUpdateWorker` (WorkManager, 15‑min periodic,
  `KEEP` policy): `WidgetUpdateWorker.kt:188`–`197`. Its `doWork`
  (`:43`–`86`) reads **Health Connect steps** and **the Android Calendar Provider**, patches
  those fields into the existing snapshot JSON, and refreshes widgets + Up‑Next. It does
  **not** touch Dexie/IndexedDB and **never** invokes the WebDAV/CRDT sync engine.
- The CRDT sync engine runs **only inside the WebView** (it's JS using Dexie). On Android
  it bypasses CORS by routing HTTP through the native bridge
  (`NativeBridge.httpRequest` `:288`; JS side `src/native.js:432` `nativeHttpRequest`,
  used by `src/utils/cloudSyncProviders.js`). When the app is closed there is no JS
  context, so no sync.
- No FCM/push, no `@capacitor/background-runner`, no headless WebView — all confirmed
  absent by grep.

Practical consequence: remote changes are reconciled on the **next foregrounding**, not
in the background. If lastGLANCE needs closed‑app remote pulls you'd have to add a real
background sync path (a `CoroutineWorker` that can drive a headless sync, or a push
trigger) — dayGLANCE deliberately doesn't.

---

## 7. Deep linking / action routing

There are **two** routing channels. Know which is which before you unify them.

### Channel A — the "pending action" drain (notification actions + launcher shortcuts)
Background components can't call into JS directly, so they **write a flag to
SharedPreferences and bring the activity forward**; JS drains it on `visibilitychange`.

- Notification **tap** → `tapPendingIntent()` opens `MainActivity` `SINGLE_TOP`
  (`NotificationBridge.kt:233`, `ReminderReceiver.kt:65`).
- Notification **action buttons** (Snooze / Mark Complete / focus Pause·Resume·Stop) →
  `NotificationActionReceiver` (`NotificationActionReceiver.kt:25`). Snooze reschedules a
  +15 min alarm and stores `pendingSnoozeTaskId` (`:41`); Complete stores
  `pendingCompleteTaskId` and `startActivity` (`:73`); focus actions store
  `pendingFocusAction` (`:86`).
- **Launcher shortcuts** (long‑press icon → Voice Input / Add Task / Inbox Task) are
  declared at `AndroidManifest.xml:60`–`100` (resource `res/xml/shortcuts.xml`) and stored
  as `pendingVoiceInput` / `pendingAddTask` / … in `MainActivity` (`:153`–`158`, and
  `onNewIntent` `:547`–`551`).
- **Share sheet** (`ACTION_SEND` text) → `pendingShareText` (`MainActivity.kt:573`).
- JS drains all of the above via `NativeBridge.getPendingAction()`
  (`NativeBridge.kt:441`, returns a `{action, …}` JSON and clears it) on every
  `visibilitychange`: `src/App.jsx:6465`–`6526`. That switch is your de‑facto router for
  notif/shortcut/share actions.

### Channel B — the shared intent protocol dispatcher (`handleIntent`)
The full automation protocol (Tasker, URLs, cross‑app WebDAV "notify") goes through a
single dispatcher built on the shared `@glance-apps/intents` package.

- Native intake: `IntentReceiver` (broadcast, `intents/IntentReceiver.kt:22`) and
  `MainActivity.onNewIntent` (`:552`–`555`) re‑serialize the payload through `JSONObject`
  (anti‑injection) into `pendingIntentJson`.
- JS dispatcher: `src/intents/handleIntent.js` — a single function keyed by
  `ACTIONS.{CREATE,COMPLETE,OPEN,QUERY,NOTIFY}` with Zod‑validated payloads.
- **Three** entry points all funnel into that one dispatcher:
  - Android intents → `src/intents/useAndroidIntentBridge.js:34` (drains
    `nativeGetPendingIntent()` on visibilitychange, reports back via
    `nativeReportIntentResult` → `app.dayglance.RESULT` broadcast).
  - URL / deep links → `src/intents/useUrlActionHandler.js` (`handleIntent` at top).
  - WebDAV cross‑app events → `src/intents/useIntentPoller.js`.

**So: does dayGLANCE already have the "one router shared by widgets, notifications, and
shortcuts" primitive you want?** Partially. `handleIntent` is exactly that primitive for
the *protocol* actions and is already shared across three transports. But **notification
action buttons and launcher shortcuts currently use Channel A** (`getPendingAction`), not
`handleIntent`, and **Android widget taps just open the app** (they don't carry an action
into either router). The cleanest lastGLANCE design is to make widgets, notification
actions, and shortcuts all emit `@glance-apps/intents` envelopes and route them through
`handleIntent`, collapsing Channel A into Channel B.

---

## 8. Reuse — versions, what's shared, lift path

### Versions involved
- **No Capacitor.** Custom WebView shell.
- Android (`gradle/libs.versions.toml`, `app/build.gradle.kts`): AGP **8.4.0**, Kotlin
  **1.9.24**, `compileSdk`/`targetSdk` **35**, `minSdk` **26**, WorkManager **2.9.0**,
  Room **2.6.1** (present, unused by notifications), Health Connect `1.1.0-alpha12`,
  WebKit `1.11.0`.
- Shared JS packages (`package.json`): `@glance-apps/intents` **^1.3.3**,
  `@glance-apps/sync` **1.5.2**. React 18.

### What's already shared vs dayGLANCE‑local
- **Shared (already a package, already in lastGLANCE per your note):**
  `@glance-apps/intents` — Zod schemas, normalizers (`normalizePriority/Tags/Due/Recurring`),
  idempotency (`createKey`, deterministic IDs), encryption helpers, action/event constants;
  and `@glance-apps/sync` — the CRDT engine. `handleIntent.js` is dayGLANCE‑local glue *on
  top of* `@glance-apps/intents` and is straightforward to copy.
- **dayGLANCE‑local (NOT extracted into a package):** the entire native Kotlin
  notification layer — `NotificationBridge`, `ReminderReceiver`, `NotificationActionReceiver`,
  `UpNextNotificationUpdater`, `SharedDataStore`, `DayGlanceApplication` channels, and the
  manifest entries. There is no `@glance-apps/native-android` package today.

### Cleanest lift path into lastGLANCE
1. **Copy the Kotlin notification package** (`notifications/` + `bridge/NotificationBridge.kt`
   + the relevant `SharedDataStore` keys + channel creation) and rename the
   `com.dayglance.app` package/action strings to lastGLANCE's. The classes are
   self‑contained and depend only on `androidx.core` + WorkManager.
2. **Manifest:** add `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`,
   and register the three receivers (`AndroidManifest.xml:13`–`15`, `210`–`248`).
3. **Permission flow:** port `requestRuntimePermissions()` + `maybePromptExactAlarmPermission()`
   (`MainActivity.kt:348`, `:448`).
4. **JS:** reuse the `useReminderEngine` pre‑schedule effect pattern
   (`useReminderEngine.js:276`) and the `src/native.js` wrappers; have lastGLANCE compute its
   own `{id, taskId, title, body, type, isCalendarEvent, triggerAtMillis}` list and call
   `syncReminders`.
5. **Routing:** since you're building widgets + notif actions + shortcuts fresh, wire them
   all to `handleIntent` / `@glance-apps/intents` envelopes from day one (do what dayGLANCE
   *should* have done) rather than re‑creating the dual‑channel `getPendingAction` split.
   - If you're on **Capacitor**, you can't `addJavascriptInterface` the same way — wrap the
     same Kotlin in a small Capacitor plugin exposing `syncReminders`/`getPendingAction`
     and keep the receivers/AlarmManager logic verbatim.

---

## "If I were doing this again" — minimum viable, and the traps

**Minimum viable reliable closed‑app notifications:**
1. Compute every "today" trigger in JS as an absolute epoch‑ms and push the full set to
   native in one diff‑replace call. Don't fire from a WebView timer.
2. Native schedules each as `setExactAndAllowWhileIdle(RTC_WAKEUP, …)` to a
   `BroadcastReceiver` that renders the notification from the alarm's own extras.
3. Declare `SCHEDULE_EXACT_ALARM` **and** actively prompt the user for it (deep‑link to
   `ACTION_REQUEST_SCHEDULE_EXACT_ALARM`); treat the not‑granted state as a first‑class
   degraded mode.
4. Persist the alarm set; re‑register on `BOOT_COMPLETED`.
5. Use the notification **id = stable entity hash** so successive reminders for one entity
   replace rather than stack; use the **PendingIntent request code = reminder‑id hash** for
   alarm idempotency.
6. Request `POST_NOTIFICATIONS` at runtime on API 33+ and create channels in
   `Application.onCreate`.

**Traps to avoid (each one bit dayGLANCE or is a known gap):**
- *Inexact alarms.* Plain `set()` is Doze‑batched → late dogpile. Exactness needs both
  the API call and the permission; missing either silently degrades.
- *Forgetting the exact‑alarm prompt.* The permission isn't auto‑granted on 12+; without
  the prompt you're permanently on the inexact fallback.
- *Relying on a WebView/JS timer for delivery.* It doesn't run closed and throttles
  backgrounded. Keep the JS loop only for in‑app toasts/sound.
- *Cancel‑all‑then‑reschedule on every change.* Opens a race where a due‑now alarm is lost;
  diff instead (`NotificationBridge.kt:147`).
- *Assuming reboot keeps alarms.* It doesn't — persist + `BOOT_COMPLETED`.
- *No timezone/clock‑change receiver.* dayGLANCE lacks `ACTION_TIMEZONE_CHANGED` /
  `ACTION_TIME_CHANGED` handling and only re‑syncs on next open. Add a receiver that
  re‑runs `syncReminders` if you care about travel/DST correctness.
- *Expecting background CRDT pulls.* dayGLANCE has none; the 15‑min WorkManager touches
  only Health/Calendar/widget snapshot, not the sync engine or Dexie. Add a real
  background sync path if lastGLANCE needs it.
- *Counting on WorkManager to save task reminders from OEM killers.* The backstop re‑arms
  only Up‑Next/widgets, not task alarms. If you need OEM resilience for task reminders,
  either extend the backstop to re‑register reminders too, or add a battery‑optimization
  exemption prompt (dayGLANCE intentionally ships neither).

— Cited against dayGLANCE `versionName 3.5` (`versionCode 129`, `app/build.gradle.kts:23`–`24`).
