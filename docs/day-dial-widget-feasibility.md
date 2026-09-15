# Day Dial as a home screen widget — feasibility

Read-only investigation. No implementation code was changed. Every claim below
cites a file in this repo; anything that can only be settled on hardware is
marked **[device]**.

## Verdict

**Moderate on Android. Moderate-to-hard on iOS — and hard for the wrong
reason: not memory, but the fact that neither platform can move the needle
smoothly.**

The parts you would expect to be hard are not. The geometry is already a pure,
tested module (`src/utils/dayDial.js`, 1101 lines, 144 passing tests with
`src/utils/solar.test.js`). The snapshot pipeline already exists end to end on
both platforms and has ~187 KB of headroom under its own cap. The payload delta
is about 2 KB. Android's bitmap problem has a known escape hatch. iOS's 30 MB
widget limit is not the binding constraint.

What is genuinely hard is that the Day Dial's stated design thesis —
"the now line is the only moving element and the only saturated color"
(`src/components/DayDial.jsx:30-35`) — is the one thing a home screen widget
cannot deliver. WidgetKit steps between pre-rendered timeline entries with no
interpolation, and Android RemoteViews redraw at best every 15 minutes
(`WidgetUpdateWorker`, WorkManager's floor) or 30 minutes
(`updatePeriodMillis="1800000"` in `res/xml/widget_info.xml`). A needle that
jumps 3.75° every 15 minutes is a different object from the one in the app.
That is a product decision, not an engineering one, and it should be made
before any of the work below is scheduled.

---

## 1. What already ships

### iOS — `dayglance-ios/DayGlanceWidget/`

One widget extension target, `DayGlanceWidget`, declared in
`dayglance-ios/project.yml:151-180`: `type: app-extension`, deployment target
**17.0** (the app itself is 16.0), sources `DayGlanceWidget/` plus `Shared/`,
entitled to App Group `group.com.dayglance.app`.

`DayGlanceWidgetBundle.swift:1-19` registers five surfaces:

| Widget | File | Families |
|---|---|---|
| `UpNextWidget` | `UpNextWidget.swift:216` | `.systemMedium`, `.systemLarge` |
| `GoalWidget` | `GoalWidget.swift:186` | `.systemMedium`, `.systemLarge` |
| `ProjectWidget` | `ProjectWidget.swift:182` | `.systemMedium`, `.systemLarge` |
| `DaySummaryLiveActivity` | `DaySummaryLiveActivity.swift` | ActivityKit, not a family |
| 3 Control Center controls | `Shared/ControlWidgets.swift` | iOS 18+ only |

**No `.systemSmall`, no `.accessory*` (Lock Screen / watch) families anywhere
in the repo** — a grep for `supportedFamilies` returns exactly the three lines
above.

How the views are built: **plain SwiftUI stacks and text only.** A grep for
drawing primitives across `DayGlanceWidget/*.swift` returns
`RoundedRectangle` (a 3pt-wide color bar — `UpNextWidget.swift:53`,
`GoalWidget.swift:112`, `ProjectWidget.swift:118`), `Capsule`
(`UpNextWidget.swift:166`), and `ProgressView` (`GoalWidget.swift:125,151`,
`ProjectWidget.swift:132`, `DaySummaryLiveActivity.swift:82`).

**There is not a single `Path`, `Shape`, `Canvas`, or `GeometryReader` in the
iOS widget target.** Every dial primitive — arcs, sectors, ticks, the moon
terminator, the glow — is new Swift.

Timeline shape today (`UpNextWidget.swift:10-21`): a `TimelineProvider`
returning **one entry** with `.after(now + 15 min)`. There is no multi-entry
timeline anywhere in the repo to build on.

### Android — `dayglance-android/app/src/main/java/com/dayglance/app/widget/`

Four `AppWidgetProvider` subclasses, all registered in
`AndroidManifest.xml:170-227`:

| Provider | XML | cells | `updatePeriodMillis` | `resizeMode` |
|---|---|---|---|---|
| `DayGlanceWidget` (187 ln) | `widget_info.xml` | 3×4 target, 180×220 → 500×720 dp | 1800000 | `horizontal\|vertical` |
| `UpNextWidget` (270 ln) | `widget_upnext_info.xml` | 3×2, 180×110 → 500×400 dp | 1800000 | `horizontal\|vertical` |
| `GoalWidget` (334 ln) | `widget_goal_info.xml` | 3×3, 180×180 → 500×400 dp | 1800000 | `horizontal\|vertical` |
| `ProjectWidget` (244 ln) | `widget_project_info.xml` | 3×3, 180×180 → 500×400 dp | 1800000 | `horizontal\|vertical` |

**Raw `RemoteViews`, not Glance and not Compose** — `app/build.gradle.kts` has
no `androidx.glance` or Compose dependency at all. `DayGlanceWidget` uses a
`RemoteViewsService` + `RemoteViewsFactory` pair
(`DayGlanceWidgetListService.kt`, `DayGlanceWidgetListFactory.kt`, 838 ln) to
back a scrollable `ListView`.

**There is one bitmap-into-ImageView precedent, and it is the right one to
extend:** `DayGlanceWidgetListFactory.kt:708-752` (`drawHabitRing`) draws a
circular progress ring with `Canvas`/`Paint`/`Path` into an **80×80
`ARGB_8888`** bitmap and sets it with `setImageViewBitmap`
(`:459-460`), scaled up to 36dp by `scaleType=fitCenter`. Its own comment
states the constraint: *"RemoteViews cannot host custom views, so we bake the
ring into a Bitmap."* That is exactly the technique the dial needs, two orders
of magnitude larger.

`getAppWidgetOptions` / `OPTION_APPWIDGET_*` appear **nowhere** in the Android
source — nothing currently sizes itself to the host cell.

---

## 2. The data pipeline, end to end

It is **not** Capacitor. It is a hand-rolled `window.DayGlanceNative` JS
interface on both platforms.

```
src/App.jsx:7484-7963          one useEffect builds `snapshot` (line 7874)
  └─ evaluateSnapshotPush()    src/utils/widgetSnapshotDedupe.js — content
                               fingerprint, skips byte-identical re-pushes
  └─ window.DayGlanceNative.updateWidgetSnapshot(JSON.stringify(snapshot))
        │                                                    (App.jsx:7960)
        ├─ iOS   WidgetBridge.updateSnapshot()  Bridges/WidgetBridge.swift:29
        │         ├─ 200_000-byte cap                               (:27, :42)
        │         ├─ UserDefaults(suiteName: "group.com.dayglance.app")
        │         │    .set(data, forKey: "widgetSnapshot")         (:59)
        │         ├─ WidgetCenter.shared.reloadAllTimelines()       (:60)
        │         └─ LiveActivityBridge.shared.sync(...)            (:64)
        │      read back by loadSnapshot()      DayGlanceWidget/WidgetModels.swift:87
        │
        └─ Android NativeBridge.updateWidgetSnapshot()  bridge/NativeBridge.kt:332
                  ├─ SharedDataStore.widgetSnapshot (SharedPreferences,
                  │    key in data/SharedDataStore.kt:76)
                  ├─ requestUpdate() broadcast to all four providers   (:336-339)
                  └─ UpNextNotificationUpdater.schedule()              (:342)
```

**Where it lands.** iOS: App Group `group.com.dayglance.app` (declared in
`DayGlanceWidget/DayGlanceWidget.entitlements` and `project.yml:56-57,
161-162`), `UserDefaults` key `widgetSnapshot`. Android: not a shared file path
at all — a private `SharedPreferences` entry, readable by the widget because
providers run in the same process (`SharedDataStore.kt:74-82`).

**What triggers a write.** Three paths:

1. **The React effect** (`App.jsx:7484`), keyed on 18 deps
   (`App.jsx:7978-8000`) — tasks, habits, routines, frames, goals, projects,
   `currentTime`. It also arms a one-shot timer to re-push at the next block
   boundary (`App.jsx:7968-7974`).
2. **iOS background refresh**: `BGAppRefreshTaskRequest("com.dayglance.widgetrefresh")`,
   earliest +15 min (`AppDelegate.swift:138-142`), which calls
   `reloadAllTimelines()` against whatever is already in the App Group — the
   WebView is suspended, so it re-renders, it does not re-fetch
   (`AppDelegate.swift:55-63`).
3. **Android `WidgetUpdateWorker`**: a 15-minute periodic WorkManager job
   (`WidgetUpdateWorker.kt:41-60`) that patches `steps` and calendar events
   into the existing JSON and re-broadcasts.

**The schema** is defined in one place, `src/App.jsx:7874-7955`, and mirrored
(partially) into Swift as `struct WidgetSnapshot` in `WidgetModels.swift:7-16`.
Note the Swift struct decodes only 7 of the 23 top-level keys — the rest are
read on Android via `org.json` or ignored.

```
date, dateLabel, steps, use24Hour,
overdue[]        {id,title,colorHex,overdueType,projectName}
overdueToday[]   {id,title,colorHex,startTime,duration,projectName}
habits[]         {id,name,colorHex,ringColorHex,count,target,type,progress,complete}
goals[], allGoals[], allProjects[]
allDay[]         {id,title,colorHex,projectName}
deadlines[]
sections[]       {type:'frame'|'unframed', name,colorHex,start,end,
                  availableMinutes, tasks:[serTask]}
   serTask       {id,title,colorHex,startTime,duration,tags,projectName}   App.jsx:7588
routines[]       {id,name,startTime,isAllDay,completed}                    App.jsx:7647
hyperGlance[], glanceAhead, nextTask, upcomingTasks, nextUpNext,
liveActivityEnabled,
daySummary       {date, windowStart, windowEnd, unblocked/blocked/effort/
                  restore/done/completableMinutes, preformatted strings,
                  upNext fact, labels{}}                                   App.jsx:7898
updatedAt
```

---

## 3. The snapshot, measured

No fixture or sample exists in the repo (no `fixtures/` directory; the only
snapshot-shaped test data is the 5-key stub in
`src/utils/widgetSnapshotDedupe.test.js:5-22`). So the number below is derived
by reconstructing the exact shape emitted by `App.jsx:7874-7955` for a
representative day — 10 timed blocks in 2 frames, 4 habits, 3 routines, 2
all-day items, 2 overdue, 1 deadline, 3 goals × 3 projects, 8 projects × 6
tasks, 1 hyperGLANCE session, full `daySummary`:

```
TOTAL                                          12,834 bytes  (12.5 KiB)

   5,656  allProjects        1,753  sections        1,669  allGoals
     695  habits               549  daySummary        514  upcomingTasks
     431  nextTask             321  routines          266  overdue
     261  overdueToday         169  allDay            166  hyperGlance
     127  nextUpNext            96  deadlines       ~160  all scalars

With goals/projects disabled (allGoals/allProjects/hyperGlance empty):
                                                5,391 bytes  (5.3 KiB)
```

**≈12.8 KB typical, ≈5.4 KB lean, against the 200,000-byte cap at
`WidgetBridge.swift:27`.** Roughly 6% of budget used. `allProjects` alone is
44% of the payload and is read by exactly one widget.

---

## 4. The Day Dial renderer

`src/components/DayDial.jsx` — 1658 lines, component defined at `:570`, with
`src/components/DialComplications.jsx` (610 ln) and the
`src/components/DayDialModal.jsx` host (917 ln).

**Your premise here is right, and stronger than you put it. The geometry is
already fully separated.** `src/utils/dayDial.js` (1101 ln) exports 40
functions and constants, all pure; `DayDial.jsx:36-38` says so in its own
header — *"All geometry and rollups come from utils/dayDial.js; this file only
draws."* `src/utils/dayDial.test.js` + `src/utils/solar.test.js` = **144 tests,
all passing** (verified in this session).

Props consumed per render (`DayDial.jsx:570`):

```
dayTasks, prevDayTasks, dayWindow, date, nowMin, dayIsPast,
routines, routineCompletions, focusSpans, complications,
sun, daylight, moon, hourlyWeather,
formatTime, use24HourClock, chromeVisible,
+ 8 callbacks (onOpenTask, onToggleComplete, onStartFocus, …)
```

Where each layer's data comes from, per `DayDialModal.jsx`:

- `daylight` / `moon` / `sun` — computed **client-side** from a persisted
  geocode (`getStoredWeatherCoords()` → `src/utils/solar.js:161`), at
  `DayDialModal.jsx:478-505`. Never fetched; works offline for any date.
- `hourlyWeather` — `weather?.hourlyByDate?.[dateStr]`
  (`DayDialModal.jsx:754`), populated by `src/hooks/useWeather.js:135-142`
  from Open-Meteo as `{hour: {temp, code, uv}}`.
- `focusSpans` — `computeFocusSpans(focusLog, dateStr)`
  (`DayDialModal.jsx:532`).

**What is tangled with React state, and what is not.** The state in
`DayDial.jsx:614-700` — `inspected`, `sheetBlock`, keyboard roving selection,
dwell timers — is entirely **interaction** state. A widget has no hover, no
keyboard, and no action sheet, so none of it ports. The two things that are
*not* cleanly separable:

1. **The hub is an HTML overlay, not SVG** (`DayDial.jsx:1363`,
   `<div className="absolute inset-0 …">`). So are the legend and all-day pills
   (`:1136`, `:1171`). The dial is an SVG face plus an HTML center. Porting
   means reimplementing the hub typography in SwiftUI / RemoteViews.
2. **The glow is an SVG filter** — `<filter id="dial-glow"><feGaussianBlur
   stdDeviation="6"/>` at `DayDial.jsx:1225-1227`, applied at `:206` (wedge
   edges) and `:545` (the now-dot). SwiftUI `.blur(radius:)` and Android
   `BlurMaskFilter` are close equivalents but not identical output.

**The one finding that shapes the whole iOS design.** I traced every use of
`nowMin` in the render (`DayDial.jsx`, 20 sites). It splits three ways:

| Changes | What | Frequency |
|---|---|---|
| never within a day | ticks, chapter labels, daylight band, moon band, weather ring, routine bars, focus rail, sleep arcs, wedge *geometry* | 1× per day |
| at block boundaries | wedge past-dimming (`isPast`, `:838`; `past`, `:856`) | ~8–12× per day |
| continuously | `NowLine` — 15 trail sectors + needle + leading dot (`:498-548`) | every minute |

And `NowLine` is **rotationally invariant**: the trail runs `nowMin-60 →
nowMin` (`:511-516`), the needle is a fixed radius at
`deg = (nowMin/1440)*360` (`:499`, `:522-527`), and the dot sits at `nowMin`
(`:543`). The entire group can be drawn once at angle 0 and reproduced exactly
by a single rotation. (One edge case: before 01:00 the trail is clamped at
midnight by `Math.max(0, …)` at `:511`, so it is shorter.)

Element count for one representative frame (equinox, 41.88°N, 10 blocks,
3 routines), computed from `dialTicks()` and `computeDaylightBand()`:

```
  564  daylight sub-bands  (188 steps × 3 DAYLIGHT_FEATHER passes)
  288  ticks               (dialTicks(): 24 hour, 72 quarter, 192 minor)
   60  moon sub-bands      (20 steps × 3)
   15  trail sectors
   12  temp labels
   20  wedge fill + edge
    8  hour labels
   18  everything else
  985  TOTAL drawn elements
   18  of which move with the needle  (1.8%)
```

At the June solstice the daylight band grows to 229 steps → 687 paths, ~1108
elements total.

---

## 5. Payload delta — what the dial needs that the snapshot lacks

**Three of your six items are already in the snapshot.** Correcting the
premise:

| You listed | Reality |
|---|---|
| all blocks with start/end/category color | **Already there**, split across `sections[].tasks` (`serTask`, `App.jsx:7588` — has `startTime`, `duration`, `colorHex`) and `overdueToday[]` (`:7507`, same fields). Missing only `completed` and the energy `kind`. |
| sleep window | **Already there** — `daySummary.windowStart` / `windowEnd` (`App.jsx:7909-7910`), which is exactly `getDayWindow()`, the same input `computeDialModel` takes as `dayWindow`. |
| routines | **Already there** (`App.jsx:7647`) — but missing `duration`, which `computeDialRoutines` requires (`dayDial.js:413`: it filters on `(r.duration \|\| 0) > 0`). |
| hourly temps | Absent. |
| sunrise/sunset | Absent (computed client-side from stored coords). |
| moon phase | Absent. |

Measured additions, same representative day:

| Field | Bytes |
|---|---|
| per-block `{kind, completed, completable, isAllDay}` × 10 blocks | 690 |
| 1 previous-day overrun block (full `serTask` + dial extras) | 249 |
| 24h weather `{temp, code, uv}` | 800 |
| `routines[].duration` × 3 | 39 |
| `focusSpans[]` × 2 | 61 |
| **Solar/lunar — option B:** `coords` + `getSunTimes()` result + moon `{fraction, waxing}` | **125** |
| **Solar/lunar — option A:** the derived `computeDaylightBand` + `computeMoonBand` step arrays | **6,249** (daylight 5,640 / moon 588) |

```
Option B — ship inputs, port solar.js + the band math natively:
    12,834 + 1,964 =  14,798 bytes  (14.5 KiB)   +15%

Option A — ship the derived bands as geometry, no native solar port:
    12,834 + 8,088 =  20,922 bytes  (20.4 KiB)   +63%
```

**Both are ~7–10% of the 200 KB cap. Payload size is not a constraint on this
feature, at either option.**

Option A buys you out of porting `src/utils/solar.js` (the sunrise equation,
solar elevation, moon altitude/illumination) to Swift *and* Kotlin, and out of
`computeDaylightBand` / `computeMoonBand` / `moonStretches` — roughly 350 lines
of trigonometry, twice, plus tests. **Take option A.** The 6 KB is the cheapest
6 KB in this project. The one cost: the bands go stale if the widget renders
for a date the app has not pushed — but the widget only ever renders *today*,
and today is always the pushed date.

---

## 6. iOS memory — 96 entries at 15-minute steps

**The 30 MB figure is already load-bearing in this repo**: `WidgetBridge.swift:26`
— *"Widgets are killed at 30 MB with no warning."*

Rendered frame size, ARGB at native scale:

| Surface | Points | Pixels | Bytes |
|---|---|---|---|
| `.systemLarge`, 430pt device @3x | 364×382 | 1092×1146 | **4.77 MiB** |
| `.systemLarge`, 402pt device @3x | 345×362 | 1035×1086 | 4.29 MiB |
| `.systemLarge`, iPhone SE @2x | 329×345 | 658×690 | 1.73 MiB |
| `.systemMedium`, 430pt @3x | 364×170 | 1092×510 | 2.12 MiB |

**Answer: yes, it fits — but only because you are not doing what the question
assumes.** A `Timeline` returns *data*, not archived views. WidgetKit renders
entries in the extension process and releases each after archiving, so peak
resident memory is roughly *one* frame (4.8 MiB) + the SwiftUI view graph for
~985 shapes + the decoded model. That is comfortably under 30 MB.

Two things do blow up, and both have trivial fixes:

- **Entry payload.** If each of the 96 entries deep-copies a ~15 KB decoded
  model, that is ≈3.4 MiB of live Swift objects held simultaneously while the
  timeline is built. Make the entry `{date: Date, nowMin: Int}` and hold the
  model once (Swift arrays are copy-on-write, so a shared `let model` costs
  nothing per entry): **3.0 KiB total** for all 96 entries.
- **Render cost × 96.** 96 × ~985 `Path` shapes = ~94,000 shape rasterizations
  in one extension invocation, each at 1.25 Mpx. This is where the extension
  actually dies — on the render watchdog, not the memory ceiling. **[device]**
  This is the single number I cannot give you from the repo. It must be
  measured on an A15-class device with Instruments attached to the widget
  extension.

**The cheaper option, and it is not close: a static base layer plus a rotated
needle layer.** The repo's own numbers make the case — §4 shows **18 of 985
elements (1.8%) move with the needle**, and `NowLine` (`DayDial.jsx:498-548`)
is rotationally invariant, so those 18 are one group under
`.rotationEffect(.degrees(nowMin / 1440 * 360))`.

Concretely:

1. Render the 967 static elements **once**, at timeline-build time, into a
   `UIImage` via `ImageRenderer` (iOS 16+), and hold it for all entries. One
   4.8 MiB bitmap.
2. Each entry draws that `Image` plus the needle-and-trail group rotated.
   ~18 shapes per entry instead of ~985 — a **98% cut in per-entry render
   work**.
3. Wedge past-dimming changes only ~8–12 times a day (§4), so re-render the
   base layer at block boundaries, not at every needle step. Take the block
   boundaries from `sections[].tasks` start/end and emit entries at the union
   of {boundaries} ∪ {15-min needle steps} — still ~96–108 entries, but only
   ~10 base renders.

Reduce entries only if **[device]** measurement says you must; 96 is the right
target for a needle that steps every 15 minutes, and fewer entries makes the
jump worse, not better. Note WidgetKit will not interpolate between entries, so
3.75° is the floor on needle granularity at this entry count.

---

## 7. Android bitmap vs. the Binder ceiling

A 4×4 cell on a Pixel-class 5-column launcher is roughly 319×286 dp after
padding. At xxhdpi (density 3.0):

| Target | Pixels | ARGB_8888 | RGB_565 |
|---|---|---|---|
| 4×4 cell, 319×286 dp | 957×858 (0.82 Mpx) | **3.13 MiB** | 1.57 MiB |
| square dial inscribed, 286×286 dp | 858×858 (0.74 Mpx) | **2.81 MiB** | 1.40 MiB |
| `widget_info.xml` maxResize, 500×720 dp | 1500×2160 (3.24 Mpx) | 12.36 MiB | 6.18 MiB |

**Answer: no, it does not fit at ARGB_8888, and it does not fit at RGB_565
either.** Against a 1 MiB Binder transaction:

```
max square that fits, ARGB_8888:  512 × 512 px  (exactly 1.00 MiB)
max square that fits, RGB_565:    724 × 724 px
```

So at full 4×4 xxhdpi fidelity you are 3× over at ARGB and 1.6× over at 565.

Two separate limits are in play and they are often conflated:
- the **Binder transaction buffer** (~1 MiB, per process, shared with all
  in-flight transactions) — this is the binding one for `setImageViewBitmap`,
  which parcels the bitmap inline via `RemoteViews`' `BitmapCache`;
- the **AppWidget host bitmap-memory limit**, which AOSP derives from display
  area and is far more generous. It is not what stops you here.

Ranked options:

1. **`setImageViewUri` with a FileProvider URI — take this one.** Write a PNG
   to the app's cache dir and pass a `content://` URI; only the ~60-byte string
   is parceled, so the Binder limit stops applying entirely and you can render
   at full 957×858. The infrastructure is **already in the repo**:
   `AndroidManifest.xml:301-309` declares
   `androidx.core.content.FileProvider` with authority
   `${applicationId}.fileprovider`, and `res/xml/file_paths.xml` already
   exposes `<cache-path name="cache" path="." />`. You would need
   `grantUriPermission` to the launcher package, which is the one genuinely
   fiddly part **[device]** (launcher-specific behaviour, and the URI must
   change on each update or the host caches the old bitmap — append a
   timestamp query param).
2. **Size from `AppWidgetOptions`.** Read `OPTION_APPWIDGET_MIN_WIDTH` /
   `MAX_HEIGHT` in `onAppWidgetOptionsChanged` and render to the actual cell
   rather than a guessed 4×4. Nothing in `dayglance-android/` does this today
   (`getAppWidgetOptions` appears nowhere), so it is new code — but it is ~20
   lines and it is correct regardless of which option above you pick.
3. **RGB_565 — don't.** Beyond still being 1.6× over, the dial is built almost
   entirely from low-alpha gradients: `DAYLIGHT_FEATHER` sub-bands at 0.25/1.0
   weights (`DayDial.jsx:100`), `TRAIL_STEP_OPACITY = 0.011` accumulating to
   ~0.15 (`:135`), moon opacities floored at 0.012 (`dayDial.js:800`). 565
   banding lands exactly on those ramps. It also has no alpha channel — which
   is survivable, since the dial is deliberately a single dark look independent
   of app theme (`DayDial.jsx:36-38`), so an opaque background is honest.
4. **Downscale to 512×512 ARGB and `fitCenter`.** This is the existing
   `drawHabitRing` pattern (80px → 36dp, `DayGlanceWidgetListFactory.kt:709`)
   and it is the zero-risk fallback. But upscaling 512→957 softens exactly the
   marks the design depends on: 192 minor ticks at 1.0px stroke width
   (`TICK_STYLE`, `DayDial.jsx:69-73`) and the 12 temperature labels.

---

## 8. Reuse vs. new

### Carries over essentially unchanged

| File | Why |
|---|---|
| `src/utils/dayDial.js` (1101 ln) | All 40 exports are pure. Used as-is on the JS side to *build* the enriched snapshot. |
| `src/utils/solar.js`, `src/utils/energyAxis.js` | Same — `deriveBlockEnergy` (`energyAxis.js:41`) already runs in the snapshot builder for `nextUpNext.energy`. |
| `src/App.jsx:7484-7963` | Extend the existing effect. The dedupe (`widgetSnapshotDedupe.js`) and the block-boundary re-push timer (`:7968`) work unchanged. |
| `Bridges/WidgetBridge.swift` | No change. 200 KB cap has 185 KB of headroom. |
| `bridge/NativeBridge.kt:332`, `data/SharedDataStore.kt` | Add one `requestUpdate()` call for the new provider. |
| `AppDelegate.swift:55-63`, `WidgetUpdateWorker.kt` | Already reload/re-broadcast everything. |
| `dayglance-ios/project.yml:151` | New Swift files land in `DayGlanceWidget/`; xcodegen picks them up by directory. No target changes. |
| `DayGlanceWidgetBundle.swift` | One line to register the widget. |
| `WidgetModels.swift:7-16` | Extend `struct WidgetSnapshot` with the new fields; `loadSnapshot()` (`:87`) unchanged. |
| `ColorExtension.swift` | `Color(hex:)` works for every `colorHex` the dial uses. |

**Localization is already solved and needs no new infrastructure on either
native side.** `daySummary.labels` (`App.jsx:7940-7945`) ships pre-localized
strings from JS precisely so "the JS side owns all wording, so the iOS project
needs no localization infrastructure of its own." The dial's few strings follow
the same route into `public/locales/*/translation.json` (8 locales, enforced by
`locales.test.js`).

### Genuinely new

| Platform | What | Notes |
|---|---|---|
| iOS | `DayDialWidget.swift` — provider + multi-entry timeline | No multi-entry `TimelineProvider` exists in the repo to copy. |
| iOS | `DialGeometry.swift` — `Path` builders for arc / annular sector / tick / moon terminator | Ports `dialArcPath`, `dialSectorPath`, `dialPoint`, `dialLaneBand`, `moonPhasePath` (`dayDial.js:41-165, 951`). Circular arcs map to `Path.addArc`; `moonPhasePath`'s **elliptical** arc (`rx ≠ r`) has no direct SwiftUI equivalent — use `addArc` on a unit circle under a scale transform. |
| iOS | `DialFace.swift` — the 967 static elements + `ImageRenderer` base-layer cache | The largest new file. |
| iOS | `DialNeedle.swift` — 18 elements under one `.rotationEffect` | Small. |
| iOS | Hub typography in SwiftUI | `DayDial.jsx:1363+` is HTML, not SVG. |
| Android | `DayDialWidget.kt` + `widget_daydial_info.xml` + `widget_daydial.xml` layout | Structure copies `GoalWidget.kt` (334 ln) closely. |
| Android | `DialRenderer.kt` — `Canvas`/`Path`/`Paint` drawing | Same geometry port, second time. `arcTo(RectF, …)` handles the elliptical moon natively. Extends the `drawHabitRing` idiom (`DayGlanceWidgetListFactory.kt:708`). |
| Android | FileProvider URI plumbing + `AppWidgetOptions` sizing | §7 options 1 and 2. New; no precedent in `dayglance-android/`. |
| Both | Snapshot schema extension + Swift/Kotlin decoding | §5. |
| Tests | `dayDial.test.js` additions for the new snapshot projection | The pure-JS side stays testable; the native renderers are not covered by the existing harness. |

**Rough split: ~70% of the *logic* is reusable, ~0% of the *drawing* is.** The
geometry port is the same work done twice, in two languages, with no shared
test harness.

---

## Work items, dependency order

**Extend what exists**

| # | Item | Effort | Depends on |
|---|---|---|---|
| 1 | Product decision: is a 15-min-stepped needle acceptable? (§ Verdict) | — | — |
| 2 | Add `kind` + `completed` + `completable` to `serTask` (`App.jsx:7588`) and `duration` to `routineItems` (`:7647`) | 0.5 d | 1 |
| 3 | Add `dial: {}` block to the snapshot — prev-day overrun blocks, `hourlyWeather`, option-A daylight/moon step arrays, `focusSpans` | 1 d | 2 |
| 4 | Extend `WidgetSnapshot` (Swift) + Android `org.json` reads for the new keys | 0.5 d | 3 |
| 5 | Verify the real payload on device against the 200 KB cap and the dedupe fingerprint | 0.5 d **[device]** | 4 |

**Build new — iOS**

| # | Item | Effort | Depends on |
|---|---|---|---|
| 6 | `DialGeometry.swift` — arc, annular sector, tick, lane band, moon terminator | 2 d | 4 |
| 7 | `DialFace.swift` — static layer (ticks, bands, wedges, routines, focus rail, sleep, weather) | 4 d | 6 |
| 8 | Hub typography + `.containerBackground` for the fixed dark look | 1 d | 7 |
| 9 | `DialNeedle.swift` — rotated needle + trail group | 0.5 d | 6 |
| 10 | `ImageRenderer` base-layer cache + block-boundary invalidation | 1.5 d | 7, 9 |
| 11 | `DayDialWidget.swift` — multi-entry timeline, boundary ∪ 15-min steps | 1.5 d | 10 |
| 12 | **[device]** Instruments pass on the widget extension: peak RSS and render watchdog across 96 entries; tune entry count | 2 d | 11 |
| 13 | Register in `DayGlanceWidgetBundle.swift`, `.systemLarge` only — complications need ≥520px (`DialComplications.jsx:47`, `COMPLICATION_MIN_DIAL_PX`), and `.systemLarge` is ~364pt, so the dial ships without them | 0.5 d | 11 |

**Build new — Android**

| # | Item | Effort | Depends on |
|---|---|---|---|
| 14 | `DialRenderer.kt` — the same geometry against `Canvas`/`Path` | 3 d | 4 |
| 15 | Static face drawing (mirrors item 7) | 4 d | 14 |
| 16 | `AppWidgetOptions` sizing in `onAppWidgetOptionsChanged` | 0.5 d | 15 |
| 17 | FileProvider PNG path: cache write, cache-busted `content://` URI, `grantUriPermission` to the launcher | 1.5 d | 15, 16 |
| 18 | `DayDialWidget.kt` + `widget_daydial_info.xml` + layout + manifest receiver | 1 d | 17 |
| 19 | **[device]** Launcher matrix: Pixel Launcher, One UI (the repo already special-cases it — `DayGlanceWidgetListFactory.kt:761`), Nova. Verify URI grants and bitmap refresh | 2 d | 18 |
| 20 | Wire into `NativeBridge.updateWidgetSnapshot` (`:336-339`) and `WidgetUpdateWorker` | 0.5 d | 18 |

**Rough totals: ~2.5 d to extend the pipeline, ~13 d iOS, ~12.5 d Android.
≈28 engineer-days, not counting design iteration on what the dial should drop
at 364pt.**

---

## What can only be settled on device

1. **The iOS render watchdog across a 96-entry timeline.** The memory ceiling
   is fine (§6); whether ~94,000 shape rasterizations complete inside
   WidgetKit's budget is not something the repo can tell you. Highest-risk
   unknown in the project.
2. **Whether `ImageRenderer` inside a widget extension** produces the base
   layer at acceptable cost and fidelity, including the `feGaussianBlur`
   equivalent.
3. **Android FileProvider URI grants to third-party launchers**, and whether
   hosts re-read a changed `content://` URI without a cache-busting parameter.
4. **Actual 4×4 cell dp on real launcher grids** — the 319×286 dp figure is a
   Pixel-class estimate, and One UI in particular uses a different grid (the
   repo already compensates for its font scaling at
   `DayGlanceWidgetListFactory.kt:756-770`).
5. **Real-world snapshot size** for a heavy user — the 12.8 KB in §3 is a
   representative day, and `allProjects` (44% of it) scales with project count.
6. **Whether a 3.75°-per-15-minutes needle reads as an instrument or as a bug.**
   Nothing in this repo can answer that.
