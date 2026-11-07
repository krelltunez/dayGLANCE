# Day Dial — iOS `systemLarge` widget: handoff

**Status:** phases 0–5 landed and walked on device (21 Sep 2026). iOS only.
The Android widget has shipped at parity (§"Android, if it happens"). Wear OS
is planned, not started: a complication, a tile and a watch face, revised
27 Oct 2026 (§"Wear OS: feasible, and the better fit").
**Companion files:** `docs/day-dial-widget-spec.html` (reference render, exact geometry),
`docs/day-dial-palette-study.html` (block band treatment; variant C is what ships),
`docs/day-dial-widget-feasibility.md` (prior investigation, PR #1665).

The HTML spec is the source of truth for geometry. Its constants are named at the
top of the script — read the values, don't measure the picture.

---

## 1. What this is

A reduced Day Dial for the iOS home screen. Not the kiosk dial shrunk — a
deliberately smaller information set chosen so nothing depends on legible type
at 364×382pt.

**In:** block arcs, now needle, 24-hour tick ring, six hour labels, sky ring
(sun/moon strength) with sunrise/sunset/moon glyphs, hub with weekday, date,
current task, countdown, and runway.

**Out:** temperature numerals, complications, the 12-hour rolling variant,
per-block labels.

---

## 2. Geometry

Canvas 364×382pt. Centre `(182, 189)`. 24-hour, midnight at top, clockwise.
`angle = (minutes / 1440) × 360`.

| Element | Radius | Width | Notes |
|---|---|---|---|
| Sky ring | 119 | 6 | Constant width. 24 hour-aligned segments, butt caps. |
| Block band | 140 | 22 | Variant C: sector fill + outer rim per block, toned by state (below). The spec render's solid band and its 42 % past dimming are superseded. |
| Block track | 140 | 22 | White @ 4.5% beneath the blocks. |
| Tick ring | 155–166 | 1.5 | 24 major ticks. |
| Minor ticks | 161–166 | 1.0 | 3 per hour (every 15 min), white @ 13%. |
| Hour labels `00` `12` | 172 | — | 10.5pt, white @ 44%, tracking 1.4. |
| Hour labels `03 09 15 21` | 181 | — | Pushed out 9pt to clear the ticks. |
| Glyphs (sunrise/sunset/moon) | 104 | — | Upright, never rotated. |
| Needle | 126–159 | 2.6 | 3.4pt dot at the outer end. |

Three constraints worth not breaking:

- **No `06` / `18` labels.** At r=172 a label at the horizontal positions
  overflows the 364pt width by ~14pt. That space carries the sun glyphs instead.
- **Diagonal labels sit at 181, cardinals at 172.** The collision is with the
  *corner* of the label box, not its centre. At 172 the diagonals overlap the
  tick ring by ~4.6pt; at 181 they clear it by 4.4pt.
- **Needle inner end at 126** leaves a 4pt gap above the sky ring's outer edge
  (122). Anything lower touches it.

### Block band: variant C

Decided in Phase 2 from `docs/day-dial-palette-study.html`. The spec render's
one-stroke-per-category band at a fixed alpha, past at 42 %, is replaced by
the app's own treatment reweighted for widget scale: the study's variant C.
Pure logic in `DayDialGeometry` (`DialPalette.swift`, `DialBand.swift`, vector
tested in `PaletteTests.swift`); drawn by `DayGlanceWidget/Dial/DialFaceView.swift`.

- **Colour.** `muteDialColor` exactly as `dayDial.js`: hue kept, saturation
  capped at 0.5, lightness pinned at 0.73. The ten Tailwind hexes the task
  palette stores are in the vectors with the study's swatch values. Routine
  `#5eead4` and sleep `#c4b5fd` are fixed, not muted; an unparseable colour
  falls back to `#93c5fd` raw, as the JS does.
- **Each block** is an annular sector fill across the 22pt band (its lane's
  share when blocks overlap, `dialLaneBand`) plus a rim stroke on the OUTER
  edge, drawn inside the band, butt caps:

  ```
  t            = min(1, durationMin / 180)
  fill opacity = min(1, (0.05 + 0.11t) × 3.5 × stateFill)
  rim width    = 1.5 + 1.0t  pt
  rim opacity  = min(1, (0.45 + 0.55t) × stateEdge)
  ```

- **State multipliers** (fill / edge), as `DayDial.jsx`'s `blockTone`.
  `completed` is read before `past`: a block ticked off early is done now.

  | state | fill | edge |
  |---|---|---|
  | future / current | 1.0 | 1.0 |
  | completed | 0.6 | 0.25 |
  | past, undone (task) | 0.35 | 1.0 |
  | past event, or last night's overrun | 0.6 | 0.6 |
  | sleep | 0.6 | 0.6 |
  | sleep, past | 0.36 | 0.36 |

- **Routines** are rim only: opacity 0.5, completed 0.18, ABSOLUTE (no
  duration curve), rim width from `t` as above. No fill.
- **Separators:** a 1.6pt cut in the background colour where two consecutive
  blocks touch (§3), drawn last.
- **Not surviving:** the web dial's blurred glow (§7). Flat fills only.

**Projected days: required rule.** A projected day's completion flags are
always false, because the state cannot be known. Under the multipliers above
every past block on such a day would render as "past undone" with a full
rim, and each morning the widget would mark finished work as unfinished. So
on a day the resolution tier marks as projected (`WidgetDayTier.projected`),
every past task and routine takes the past-event tone (0.6 / 0.6; routines
0.18) regardless of its flag, and completion is not read at all, even on the
future half. Only the pushed day uses completion. Stale and unknown tiers
draw as pushed: their flags are the user's own, merely old. Both paths are
tested (`testProjectedDayNeverMarksPastWorkAsUndone`,
`testProjectedRuleReachesTheStyledBlocks`).

**Cache key.** Past/future now depends on the time, not only on the
snapshot: a block changes state when it ends. The cached static face
(`DialFaceCache`) is keyed on

```
face-v1 | digest(face input) | <w>x<h>@<scale>  -b<n>
```

where the face input is exactly what the ring and sky draw (blocks with
their flags and colours, the 24 sky strengths, sunrise/sunset/moon, the
tier) and `n` is `DialBand.pastBucket`: the number of blocks whose end is at
or before the entry's minute. The ended set is a prefix of the blocks in end
order, so its size names it; the key changes precisely at each distinct end
minute, 8–12 cold renders on a full day against Phase 0's 28 ms. Digesting
the face input rather than the raw snapshot means a push that only moved
goals or the Up Next list leaves the image valid. Old files are pruned on
each cold render.

### Hub

Rule sits at `y=189`, collinear with the 06/18 tick row. Rows:

| y | Content | Type |
|---|---|---|
| 138 | `TUESDAY` | 9.5pt, 600, tracking 3.2, white @ 46% |
| 172 | `July 7` | **Lora 500, 28pt**, white @ 96% |
| 189 | rule | 68pt wide, white @ 16% |
| 211 | task title | 15pt, 600, white @ 95% |
| 229 | `#work` | 11pt italic, white @ 44% |
| 249 | `until 12:30 · 1h 10m left` | 11.5pt, white @ 58% |
| 266 | `then 1h open` | 11pt, teal `#4ec9b0` @ 72%, only when gap ≥ 30 min |

Everything else is SF. Title needs single-line tail truncation — the hub is
circular, so usable width shrinks as rows move away from centre. At `y=211`
there's ~113pt.

**Landed in Phase 3** (`DayGlanceWidget/Dial/DialHubView.swift`, constants
in `DialSpec.Hub`). Three things the table above leaves implicit:

- **Every `y` is a text baseline**, not a box centre: the spec draws the
  rows as SVG `<text>` with `text-anchor: middle` and no `dominant-baseline`.
  The view converts baseline → frame centre with the font's own ascender and
  descender (`DialHubTypography.centerY`), which is the one piece of
  arithmetic that cannot live in the geometry package.
- **Row width is a rule, not a number:** half the chord of the sky ring's
  inner edge (r = 116) at the row's baseline, less a 6pt inset —
  `DialSpec.Hub.halfWidth(atY:inset:)`. That is ~114pt a side at the title
  row and ~87pt at the runway row. The title shrinks to 0.8× first, then
  tail-truncates; every other row truncates directly.
- **The hub is an overlay, never in the cached PNG.** The current block and
  the countdown change per entry; baking them in would invalidate the face
  cache every entry instead of at block boundaries, and Phase 4 needs the
  countdown to be a live `Text`. The Phase 2 cache key is unchanged: titles,
  tags and true ends ride on `DialFaceBlock` but are not in the digest.
- **Type sizes are fixed**, not Dynamic Type. The list widgets use text
  styles and scale; the dial is the deliberate exception because its
  geometry is fixed and an accessibility size would overflow the circle.
- **Facts come from `DialHub.resolve`** per entry: the running task, event
  or routine (latest-starting when nested; sleep is never narrated), its
  TRUE end (across midnight when it runs over), and the gap to the next
  narrated block, shown as the runway only when ≥ 30 minutes and never when
  the current block ends tomorrow. No current block → the four lower rows
  stay empty (Phase 5 writes that copy).
- **Strings:** "until %@ · %@ left" and "then %@ open" in the string catalog
  for every locale; the clock follows the snapshot's `use24Hour` exactly as
  the other widgets do, and the durations are the system's narrow units
  (`Duration.formatted(.units(...))`), so no hand-written plural forms exist
  to get wrong.

---

## 3. Block boundaries

Blocks draw at **exact spans**. Where two blocks touch (`a.end == b.start`),
draw a 1.6pt radial line in the background colour across the band.

Rejected alternative: trimming each arc end to leave a hairline gap. It
under-draws short blocks disproportionately — a 20-minute block loses ~21% of
its visible arc, a 2.5-hour block only 2.8%. Wrong failure mode for a time
instrument.

---

## 4. Sky ring

One band, sun by day and moon by night, colour and opacity driven by strength,
width constant. Sunrise and sunset are its zero-crossings; the moon glyph
explains the night half's brightness.

| | Colour | Opacity |
|---|---|---|
| Sun segment | `#d9b33c` | `0.10 + strength × 0.66` |
| Moon segment | `#c3c3e8` | `0.09 + strength × 0.52` |

Per hour, take the strength at the midpoint; whichever of sun/moon is greater
picks the colour.

**Do not port `solar.js`.** Per the feasibility findings, ship the derived bands
in the snapshot instead — the 8,088-byte option. Two independent solar
implementations that must agree to the minute is a bug source, and 8KB against
the 200,000-byte cap at `WidgetBridge.swift:27` costs nothing.

**The curves in the HTML spec are placeholders.** Sun is a sine between sunrise
and sunset; moon is phase × sine across the moon's window with phase hardcoded
at 0.5. Both are shape-only reference. Real values come from the snapshot. The
visible difference: the real sun curve leans later than the daylight midpoint
and falls off faster in the afternoon.

### Glyphs

Upright at r=104. Sunrise and sunset are a half-disc on a horizon line with
three rays, plus a chevron — up and above the disc for sunrise, down and below
the horizon for sunset. Two independent cues, so it still reads if one is lost
at small size. Moon is an outlined circle with the lit fraction filled.

---

## 5. Data

Everything the widget draws arrives in one JSON snapshot, built in
`src/App.jsx`'s widget effect and handed to `WidgetBridge.updateSnapshot`
(200,000-byte cap at `WidgetBridge.swift:27`). Decoded on the Swift side by
`WidgetModels.swift`. As of Phase 0 it carries, for the dial:

**`dial` — the ring.** Every timed block of the local day, *whether or not it
is done or already over*, plus the sleep window and today's routines, in one
start-sorted list. Produced by `projectDialSnapshot` (`src/utils/dayDial.js`)
over `computeDialModel` — the same model the in-app dial renders, so the
widget and the dial cannot disagree about the day's shape. Per block:

| field | notes |
|---|---|
| `type` | `task` · `event` (read-only imported calendar) · `routine` · `sleep` |
| `startMin`, `durationMin` | local minutes from midnight; `durationMin` is the **drawn** span, already clipped at midnight — `endsNextDay: true` + `endMinTrue` carry the real end when it was |
| `completed` | tasks, events, routines. Read by the block band's state multipliers on the pushed day only (§2 "Block band"); on a projected day it is always false and is not read |
| `kind` | `effort` · `restore` — the energy axis, tasks/events only |
| `colorHex` | tasks/events only; routine and sleep take the widget's fixed colours (spec: `#4ec9b0`, `#6f6f9e`) |
| `title`, `tag` | display title (no wikilinks, no `#tags`) and the first tag *without* its `#`, on every task/event/routine. On every block, not only the running one: the widget renders a 24-hour timeline from one snapshot, and which block is "current" changes with the entry, not with when the snapshot was pushed |
| `lane`, `laneCount` | concentric lane for overlapping blocks; a lone block is 0 of 1 |
| `startedPrevDay: true` | last night's overrun, drawn from midnight |

Nothing else: no notes, subtasks, project links, or anything the ring and hub
do not draw. Not tag-filtered (`getTasksForDate(today)`, the day as it holds): the home
screen shows the day, not a filtered view of it.

**Why this is its own field.** The snapshot's agenda-shaped fields —
`sections[].tasks`, `overdueToday[]`, `nextTask`, `upcomingTasks` — are all
built from `todayAgenda` (`App.jsx`, the `useMemo` near line 6706), which
**hides a completed task once it has ended** (*"Past: hide completed tasks"*).
That is right for an agenda and wrong for a dial: a completed 9 AM block still
has to be on the ring at 3 PM, dimmed. `todayAgenda` is deliberately untouched
— it also feeds the now-marker, three context values, the mobile and desktop
layouts, the Glance sidebar, the Electron bridge and the Stream Deck payload.

**`sky` — the sky ring.** From `computeSkySnapshot`, the same solar and lunar
math as the in-app bands, never re-solved in Swift (§4):

```json
{"sunriseMin":391,"sunsetMin":1138,"polar":null,
 "hours":[{"sun":0,"moon":0}, …24 entries sampled at hh:30…],
 "moon":{"fraction":0.306,"waxing":true,"glyphMin":1148}}
```

`sunriseMin`/`sunsetMin` are the exact local minutes for the glyph angles
(null, with `polar` set, on a polar day or night); `hours[h]` is the strength
at the hour's **midpoint**, the value §4's per-segment rule wants; `moon` has
the lit `fraction` for the glyph and `glyphMin`, the minute the in-app dial
places its moon glyph at. Null until a location has been geocoded
(`useWeather` stores the coords after each successful geocode, whether or not
header weather is on; the field is Settings → Weather on desktop and tablet and
Settings → App Settings → Location on phones (`MobileSettingsPanel`, the
phone's own settings surface; phones never open `SettingsModal`), which had no
way to set one until the dial shipped there), in which case the face draws the
ring **unlit** (a neutral track at the sky radius, `DialSpec.skyUnlitOpacity`)
and no glyphs. Decided after the first device run of the real widget: the
empty band read as a rendering fault, not as "no location". The widget's
`daydial` Console line prints `sky=none` in that state, and
`DayGlanceWidgetTests` pushes a live-shaped payload
(`TestFixtures/widgetSnapshot.live.json`, from the real JS producers) through
the decoder, day resolution and face mapping and samples the rendered ring,
so the fixture-fed `DIAL_PREVIEW` widget can no longer hide a skyless live
path.

**Hub.** Title, tag, and end time come from whichever `dial` block contains
the entry's time (`startMin ≤ t < startMin + durationMin`); "until hh:mm ·
Xm left" from its end against the entry's time; "then Xh open" from the gap to
the following block. Derive these from `dial` per entry — `daySummary.upNext`
also carries a preformatted `timeLabel` and countdown, but that is the Live
Activity's single-moment fact and is only right for the entry at push time.
`dateLabel` and `use24Hour` for the date rows are already present.

**Size**, on the spec's dense day (20 dial blocks) against the 200,000 cap:

| | bytes | of cap |
|---|---|---|
| `sky` | 633 | 0.3% |
| `dial` | 3,285 (~164 per block) | 1.6% |
| whole snapshot, typical | **16,752** | **8.4%** |
| whole snapshot, goals/projects off | 9,309 | 4.7% |

---

## 6. Rendering approach

**Decided: cached image.** The spike in PR #1670 ran on device (iPhone 15, A16)
and the cached-image path cleared every bar in the table below by a wide
margin; the numbers are under "Result" at the end of this section. Live paths
were not measured — the decision rule does not need them once the cache path
is clean.

The findings give the likely answer: 18 of ~985 elements move with the needle
(1.8%), and `NowLine` is rotationally invariant. So:

1. Render the static dial once with `ImageRenderer`, cached to the App Group,
   keyed on a hash of the snapshot.
2. Each timeline entry = that image + a `.rotationEffect` needle + the past/future
   dimming, which changes only at block boundaries (8–12×/day).

That's ~985 rasterisations once rather than per entry.

**Timeline cadence:** 96 entries at 15-minute steps. On a 24-hour dial that's
3.75° per step and under two minutes of positional error — imperceptible.

**Reload budget:** the ~40–70/day budget governs provider calls, not entries, so
96 entries is one reload. But dayGLANCE is a planning app where blocks get
dragged constantly, and every edit that should be reflected costs a
`reloadTimelines`. Debounce, or fire on commit rather than on every drag.

`Text(style: .timer)` stays live between entries — use it for the countdown.

### Deciding between the two paths

Measured with the spike from PR #1670 (its file header says how to read the
numbers). The criteria are not conjunctive: a defect in the cache path is
enough on its own to reopen the question, whatever live paths measure.

| cached image | live paths | decision |
|---|---|---|
| clean — `baseImage` under ~500 ms, correct at device scale, PNG survives across provider calls, per-entry gap small | anything | **cached image.** The default; live clearing its bar too is noted, not acted on |
| **defect** | fast and light — median inter-entry gap < ~15 ms **and** footprint < ~15 MB across all 96 | **live paths** |
| **defect** | slow or heavy | **neither is ready — stop and talk.** The options on the table are batching same-style shapes (cuts live's view count ~80%), fewer entries, or a different architecture; none is a default |
| clean per entry, but total archival > ~5 s | — | cached, with fewer entries (48 at 30 min) as a last resort — it makes the needle worse |

"Clean" and "defect" are about the cache path's own behaviour, not about how
it compares to live.

### Result

Cached-image mode, iPhone 15 (A16), read off the widget's corner readout
(PRs #1709 and #1710) rather than Console; the earlier Console run matched.

| measured | value | bar | result |
|---|---|---|---|
| `baseImage` cold `ImageRenderer` pass (key forced to miss) | 28 ms | < ~500 ms | clean |
| footprint on the entry that rendered it | 13 MB | < ~20 MB | clean |
| footprint / headroom on the first entry of the earlier run | 18.1 MB / 11.9 MB avail | < ~20 MB | clean; the two sum to the 30 MB cap, so headroom is real |
| entries shown | corner `1/96 · 08:01` → `18/96 · 12:16`, exactly on the 15-minute schedule over 4 h 15 min | all 96, on time | clean |
| image at device scale | crisp, no blur; needle at the correct angle | correct at device scale | clean |
| PNG across provider calls | later reloads in the first build hit the on-disk PNG (which is why the cold cost had to be forced with a new cache key) | survives | clean |
| crashes | none in Settings ▸ Analytics Data | none | clean |

Derating for the fleet: A16 is ~1.1–1.15× an A15 and ~1.8× the A12 floor
(iPhone XS/XR, the extension's iOS 17 minimum). Memory numbers transfer as
measured; the cold render becomes ~32 ms on an A15 and ~50 ms on an A12, still
an order of magnitude inside the bar. No reason to re-run on older hardware
before Phase 2.

Two things seen on the glass that are not defects: the hub is empty (Phase 3
draws it) and some detail is too small to read at widget size (the spike draws
web geometry unchanged; sizing is Phase 2 design work, see §7).

---

## 7. Known gaps

- **`Canvas` does not render in WidgetKit.** Use `Path` / `Shape`.
- **The glow does not survive.** The web dial uses `feGaussianBlur`
  (`DayDial.jsx:1225-1227`); there's no cheap `Path` equivalent in a widget. Flat
  fills. The widget will be slightly more austere than the desktop render.
  Confirmed in Phase 2: the 2.4× halo stroke under the blur is not drawn.
- **The hub is an HTML overlay, not SVG** (`DayDial.jsx:1363`), so the centre
  stack is new work rather than a port.
- **Complications are out.** They need ≥520px (`DialComplications.jsx:47`);
  `systemLarge` is ~364pt.
- **`dayDial.js` geometry is reusable as logic, not as drawing** — 42 pure
  exports; 140 tests in `dayDial.test.js` (the "144" quoted earlier was 131
  there plus 13 in `solar.test.js`). The vectors are exported:
  `dayglance-ios/TestFixtures/dayDial.vectors.json` — 171 geometry, 16 sky and
  2 snapshot cases, regenerated by `npm run ios:vectors` and held to the code
  by `dayDialVectors.test.js`. Run the Swift port against them; it won't
  reduce the work, but it stops the two implementations silently diverging.
- **Lora is bundled in the extension target** (done in Phase 3, not Phase 5:
  the date row cannot be drawn without it). `DayGlanceWidget/Fonts/
  Lora-Medium.ttf` (PostScript name `Lora-Medium`, weight 500) is registered
  through `UIAppFonts` in the widget's Info.plist (project.yml), the OFL text
  sits alongside it and the README's licence section credits it. Google
  Fonts is not reachable from a widget process. `DialHubTypography.
  loraIsInstalled` checks the registration at runtime and the preview prints
  it in its corner, because the system serif fallback is close enough to
  fool a glance.
- **A placeholder view is required.** Done in Phase 5: `DialFaceInput.
  placeholder` (a fixed mid-latitude sky, ticks, labels, no block band) with
  a hub of weekday and date only; a never-opened install shows the same face
  plus "Open dayGLANCE to set up".
- **`widgetURL`.** Done in Phase 5: `dayglance://day?date=YYYY-MM-DD&view=dial`,
  handled by App.jsx's deep-link drain (`openDayFromLink`): the day the
  widget showed is selected and the Day Dial opens over it.

---

## 8. Still to verify on device

Walked on device on 21 Sep 2026 (iPhone, iOS 26; iPad mini). Everything
below passed except item 2, which needs hardware this project's iOS devices
do not have.

1. ~~Render budget across the timeline.~~ **Verified** (§6 "Result"): 96
   entries on schedule, 28 ms cold render, 13–18 MB footprint on an A16.
2. **Open — for the first Android surface.** Low-opacity sky-ring segments
   at dawn and dusk on OLED in daylight: opacity carries the signal alone now
   that width is constant. No OLED iOS device is available to this project,
   so the check rides the Android widget (§"Android, if it happens"), on an
   OLED phone, and again on the watch, whose screen is OLED and is read
   outdoors more than any phone widget. If the faintest segments
   disappear there, raise the floor and compress the range rather than
   widening, and mirror the change in `DialSpec.skyOpacity` so every port
   agrees.
3. ~~Lora 500 at 28pt.~~ **Pass**: holds at 28pt on the phone; 600 not needed.
4. ~~Dense-day legibility of the separator cut at 1.6pt.~~ **Pass.**
5. ~~Sunrise/sunset glyph angles match real solar times.~~ **Pass** for the
   device's geocoded location against the day's actual times.
6. ~~Tinted.~~ **Pass**: the mono face on the tinted ground, hub and needle
   visible, separators as gaps; the three list widgets complete in white.
7. ~~Clear (iOS 26).~~ **Pass**: the same over glass.
8. ~~Small sizes.~~ **Pass on iPad mini** (306×306, the sweep's floor, factor
   0.80): nothing clipped or misdrawn. Legible but small — at that size the
   dial is a glance, not a read. The iPhone floor (321×324) was not on hand
   and is covered by `SizeSweepTests`.

**On a bigger dial for iPad.** WidgetKit's families are fixed and none is a
larger square: `systemLarge` is the largest square-ish family (306–379pt on
iPad, by model), and the only bigger one, `systemExtraLarge` (iPad only),
is a 2:1 landscape rectangle of two rows by four columns. A bigger dial on
iPad would therefore mean an extra-large widget with the dial centred and
the leftover width used for something — the day's list, or the hub's rows
beside the ring instead of inside it. Deferred with the Android port; the
face scales from the same spec coordinates, so only the layout around it
would be new.

---

## 9. Phase plan

Six phases, ~15 engineer-days for iOS. Phase 0 can reshape phases 2 and 4, so
the total is more reliable than any single line below.

| # | Phase | Est. | Done when |
|---|---|---|---|
| 0 | Spike + unblocked plumbing | 2d | Rendering architecture chosen on device evidence; snapshot extended; fixtures exported. **Closed**: cached image chosen on the iPhone 15 run (§6 "Result") |
| 0b | Dial blocks in the snapshot | 0.5d | `dial` field carries every timed block of the day (§5). **Landed** in the follow-up to #1670. Parallel to Phase 1; gates Phase 2 |
| 1 | Geometry port | landed | **Landed**: `dayglance-ios/Packages/DayDialGeometry`, pure Foundation, no UI. Its XCTest target loads `TestFixtures/dayDial.vectors.json` and asserts every geometry case; `ios.yml` runs it with `swift test`. Spec radii and rules win where the two dials differ (list below). Palette treatments are seams only (`DialPalette.swift`) — the Phase 2 gate |
| 2 | Static dial | landed | **Landed**: `DayGlanceWidget/Dial/` — `DialFaceView` (sky ring, glyphs, track, ticks, labels, variant C block band, separators, needle), `DialFaceCache` (ImageRenderer → PNG in the App Group, keyed as §2 "Cache key"), `DialFaceInput` (snapshot → what the face draws). Palette and band logic in `DayDialGeometry`, vector tested |
| 3 | Hub | landed | **Landed**: `DialHubView` overlay (all seven rows, baseline-placed, chord-bounded; §2 "Hub"), `DialHub.resolve` in the package (tested), Lora bundled and registered, the two hub strings in the catalog. To see it: `DG_WIDGET_FLAGS="DIAL_PREVIEW" npm run ios`, run on the phone, add the "Dial Preview" widget once per scenario and long-press → Edit Widget → Scenario (short title, long title, sparse with runway, dense without, projected) |
| 4 | Timeline + needle | landed | **Landed**: `DayDialWidget` registered in the bundle (name and description only; Phase 5 does the metadata, placeholder and `widgetURL`), a `TimelineProvider` over `ResolvedWidgetDay`, the entry set from `DialTimeline` in the package (tested), the live countdown, the face cache's eviction policy, and the resize gate on the app's push. Details below |
| 4b | Day rollover without the app | landed | **Landed** (day-keyed snapshot, `docs/widget-background-refresh-plan.md` "What landed"): the snapshot carries today+1…today+3 with per-block tags kept, iOS timelines get a midnight entry per day, Android an exact-or-inexact midnight alarm. The dial's Phase 4 timeline must be built from `ResolvedWidgetDay` so the entries after midnight draw tomorrow's `dial` from `days[]`; the projected tier's soft label matters less on the dial than on Up Next (past blocks dim by time, not completion — only the hub is really projecting), so do not over-treat it |
| 5 | States + ship | landed | **Landed**: the hub's open-time, sleep and runway-to-sleep copy (`DialHub.resolve` + `DialHubView`, tested), placeholder and no-data faces, the projected note and the Outdated and time-zone-changed states in the hub, the hemisphere flag and mirrored moon, `widgetURL`, a single VoiceOver summary, the screenshot day and every state as a `DIAL_PREVIEW` scenario. Rendering modes (a mono face for the accented mode, keyed apart) and the size sweep (`SizeSweepTests`, every systemLarge size) landed in the second Phase 5 PR — see "Phase 5 decisions" |

**All phases are done for iOS.** The cached-image path won (§6 "Result");
phase 2 is the `ImageRenderer` pass over the static face, and phase 4 is the
needle per entry, the timeline built from `ResolvedWidgetDay`, and the reload
gate on top of the cached PNG. There is no past-dimming sector any more:
variant C tones each block by state, so the cache key carries the ended-block
bucket instead (§2 "Cache key"). The spike (`DIAL_SPIKE`,
`DayGlanceWidget/Spike/`) was retired in Phase 4; its numbers live on in §6.
The preview widget (`DIAL_PREVIEW`, `DialPreviewWidget.swift`) stays: it is
how a scenario is eyeballed and how App Store screenshots are captured from a
curated fixture day, so it is not to be removed when the real widget changes.

**Phase 4, what landed and the decisions in it** (`DayDialWidget.swift`,
`DialTimeline.swift`, `DialFaceCache.swift`, `DialHubView.swift`):

- **Entry set.** The union of the 15-minute grid for 24 hours (the needle),
  an exact entry at every block start and end in range on each renderable
  day (the hub's current block, the band's past tone and the cache bucket all
  change there; a block ending at 06:25 no longer waits for 06:30), each
  local midnight the payload can render (the day switch through
  `ResolvedWidgetDay`, as the other widgets do), and the midnight after the
  last renderable day, which is the entry that renders Outdated. Deduplicated
  and sorted; policy `.atEnd`. Counts, pinned by `TimelineTests`: the palette
  study's dense day today and projected tomorrow gives **98** entries; 24
  blocks a day at odd minutes gives **144**; the bound is 96 + 2 × blocks in
  range + midnights. An entry carries the date and the decoded snapshot, never
  an image.
- **Needle.** Each entry composes the cached face PNG (fetched through
  `DialFaceCache` at render time, one decoded face kept in memory), the hub
  overlay and the needle. The face is re-rendered only when the cache key
  changes, i.e. at a block end (the bucket), a tier change or a new size.
- **Countdown: three rows, live to the minute.** Title, "until 19:00", the
  time left, runway. The time-left row (and the empty state's open-time
  title) is a system-updated duration spliced into the catalog phrase — the
  phrase is formatted with a marker in the duration's slot and split around
  it, so the words stay translated and the number updates with no timeline
  entry. On iOS 18 the duration is `Text(.currentDate, format:
  .offset(to:))` restricted to hours and minutes ("17 minutes left", every
  minute, never seconds); before iOS 18 it is `Text(end, style: .relative)`,
  which counts seconds under an hour. It never counts past zero (the block's
  end is an entry) and spells its units, so the row shrinks to 0.8 before it
  truncates. The concatenation never LEADS with the live Text: an empty
  prefix becomes a hair space (`DialHubView.spliceParts`, tested), after the
  open-state title ("%@ open") archived as nothing while the countdown
  (duration in the middle) archived fine. **Confirmed on device** in Home
  Screen timeline entries, matching the gallery: minutes only, stepping once
  a minute. History: the iOS 18 text was blamed for a blank Home Screen hub
  and removed twice; that hub was a stale timeline from a provider that had
  stopped delivering (next bullet). Should it ever need to go,
  `DialHubView.liveDuration` is the one line to revert to the relative style.
  Rows under the title **stack** at `DialSpec.Hub.rowBaseline` (16pt pitch
  from 211) with only the rows a state has, so the note still lands inside
  the ring when tag, until, left, runway and note are all present (last
  baseline 291, ~98pt usable; `HubTests`, `HubStatesTests`). The spec's
  fixed slots stay in `DialSpec.Hub` as the reference. The row's text is
  centre-aligned inside its frame: a time-driven Text reserves the widest
  width its value can take and would otherwise sit left of the axis.
- **The provider must not warm the mono face.** From the tinted-mode build
  on, `getTimeline` warmed both face variants and read
  `context.environmentVariants.widgetRenderingMode`; from that build on the
  real widget never delivered another timeline on device. The tell was the
  widget **gallery** (`getSnapshot`, no warm-up) rendering every new build
  correctly while the **Home Screen** kept the previous build's archived
  entries for hours — the joined two-line countdown, and blank rows in the
  open state. Several fixes were diagnosed against those stale entries
  before this was noticed; when the gallery and the Home Screen disagree,
  the provider has stopped delivering, and the `daydial` Console line is
  absent. The provider now warms the full-colour face only; the mono face
  renders on demand in the view (once per bucket, then cached) and its
  files are retained. The preview's face scenarios failed and recovered the
  same way.
- **Cache lifetime.** `DialFaceCache` bounds the App Group directory three
  ways, enforced on every write, oldest first: **12 MB, 40 files, 48 h**. The
  file just written is never evicted. A timeline build ends by retaining only
  the faces of the days it can render at the current size. A file that does
  not decode, or decodes to the wrong pixel size, is deleted and re-rendered;
  an entry never fails on a bad file. Writes are atomic, so a truncated file
  cannot come from this code. The extension's state ceiling is the 12 MB plus
  one decoded face in memory (~5 MB at 3×).
- **Reloads.** Only the gate from #1721: the app pushes with
  `reloadWidgets:true` only when today, tomorrow or the invariants changed,
  and `WidgetBridge` reloads only then. Phase 4 added one gate on the app
  side: the snapshot effect does nothing while a block is being **resized**
  (a resize writes state at every 15-minute step of the drag; a move commits
  on drop already) and pushes once when the drag ends. The provider adds no
  gate of its own.
- **Console.** `subsystem:com.dayglance.app category:daydial` prints one line
  per timeline build (`entries= days= boundaries= faces= cold= coldMs= cache=N
  files/M bytes builtMs= sky= first= last=`); `category:dialface` prints each
  cold render, each eviction and each discarded file.
- **Glyphs on the live path.** The second device run drew the ring and no
  sunrise, sunset or moon glyph. The glyph views had a zero-sized frame,
  offset to the glyph point: fine on screen, but `ImageRenderer`, which the
  face cache renders through, rasterises nothing for a zero-sized view. They
  now lay out in a real `DialSpec.glyphFrame` square centred on the point,
  and `LiveSnapshotSkyTests` samples the three glyph points on the rendered
  live face. (The `DIAL_PREVIEW` faces had the same gap; nobody had looked
  for the glyphs there since the cache landed.)
**Phase 5 decisions** (`DialHub.swift`, `DialHubView.swift`,
`DayDialWidget.swift`, `DialPreviewWidget.swift`):

- **Empty state.** Nothing narrated running → the title row is open time in
  the runway's teal, live through the same marker splice as the countdown
  ("35m open"), and the row below names what ends it: "until <title> at
  14:00" (the title measured and cut so the time always survives), "until
  sleep at 23:00", or "Nothing else today". Inside a sleep block: "Sleep",
  muted, and "until 06:25" to its true end. The runway after a current block
  may now end at sleep and says so: "then 2h 30m until sleep".
- **Placeholder and no data.** `DialFaceInput.placeholder`: the study's sky
  (a lit ring and glyphs), ticks and labels, no block band, hub with weekday
  and date only. The gallery gets it; a never-opened install gets it plus
  "Open dayGLANCE to set up". The unlit ring stays for a REAL day without a
  location; a gallery card is not a real day.
- **Freshness in the hub.** Projected day: "Planned as of Mon 8:42 PM" as the
  lowest, smallest row (`DialSpec.Hub.noteY` = 281, 9pt, 40 %), under the
  runway and inside the ring, shrinking to 0.8 before truncating; the task
  rows read first. Outdated: the face alone is dimmed, the task rows become
  "Outdated" and the "as of …" detail, and the needle stays because the time
  is right. The old bottom capsule is gone.
- **Time zone: labelled, not re-projected.** The snapshot now carries the IANA
  zone its minutes were computed in (`timezone`). When the device's offset
  differs at the entry's instant (`WidgetFreshness.zoneChanged`, compared by
  offset so aliases and same-offset zones never flag), the dial dims the face
  and shows "Time zone changed · Open dayGLANCE to refresh". Re-projection
  was rejected: the payload is day-keyed and minute-based, so shifting by the
  offset delta moves blocks across the midnight boundary into a day the
  payload may not carry, splits the sleep block, and disagrees with the sky
  (sampled in the old zone) — correct across day boundaries only with a
  rebuild, which is what the next foreground push is.
- **Southern moon.** `sky.southern` (the sign of the latitude, never the
  coordinates) mirrors the moon glyph's lit limb via `MoonPhase.geometry(…,
  mirror:)`, as DayDial.jsx does.
- **`widgetURL`.** `dayglance://day?date=<shown day>&view=dial`: App.jsx
  selects the day and opens the Day Dial over it (the app's dial is a modal
  over the day, which is the route). Without a payload the link still opens
  the app.
- **VoiceOver.** One element, one label: "Monday, September 21. Now: Write API
  documentation, 1 hour, 10 minutes left. Then 4 hours, 30 minutes open." —
  the same catalog strings as the rows with wide durations
  (`DialHubView.summary`, tested).
- **Screenshot day.** A `DIAL_PREVIEW` scenario built as a real payload for
  TODAY and rendered through `DayDialWidgetView` with the live countdown, so
  the store shot is the shipping path. It is the one scenario without the
  corner readout. Shoot between 10:00 and 12:30: "Write
  API documentation", a live countdown, "then 1h 30m open".
- **Preview scenarios** now exist for every state above (`DialPreviewWidget`
  header lists them); the four face scenarios stay for palette comparison.
  The preview's provider renders NOTHING and returns at once; the view
  fetches the face from the cache when it renders (cold the first time,
  ~28 ms). The face scenarios sat on their redacted placeholder on device
  for as long as the provider warmed the faces (both variants, from the
  tinted-mode build on), while the state scenarios, which never warmed,
  rendered; see "The provider must not warm the mono face" under Phase 4. `ios.yml` generates the
  CI project with `DIAL_PREVIEW`, so the preview compiles in CI; release
  builds still never set the flag.
  The corner prints the rendering mode (`fullColor` / `accented`), so a
  tinted or clear Home Screen is confirmed as the accented mode at a glance.
- **Rendering modes (the second Phase 5 PR).** Why tinted was blank: on a
  tinted or clear Home Screen (iOS 18+) WidgetKit renders the widget in the
  *accented* mode — every view is painted white at its own opacity, images
  included (an image with no `widgetAccentedRenderingMode` takes the primary
  colour at its alpha), and the container background is replaced. The face
  was an OPAQUE PNG (the background baked in so the band composites once), so
  it became one solid white rectangle, and the hub text and the needle,
  also white, disappeared into it: blank, hub included. The treatment is a
  second face for that mode, not a re-colouring of the first: `DialFaceView
  .mono` draws the same geometry in white at the spec's opacities on a
  TRANSPARENT ground (the system's alpha-preserving tint then does the
  rest), and the separators — background-colour lines in full colour, which
  would have become white cuts — are erased out of the band with
  `destinationOut` instead. It is rendered and cached under its own key
  (`face-v4-mono-…`; the mode is part of the key, `RenderingModeTests`), and
  the provider warms it whenever `context.environmentVariants
  .widgetRenderingMode` says the widget may be shown accented, so a tinted
  first render is as warm as a colour one. The needle is `widgetAccentable`
  (white on iOS, where both groups are white; the theme's accent on
  platforms that give one). Clear (iOS 26) is the same rendering mode with a
  glass background, so it needs nothing more. Block colours are lost in that
  mode by design — state (past/future tone), duration (fill weight) and the
  rims still read. Nothing in the three list widgets needed changing: they
  are text, dividers, capsules and progress bars in system colours, which the
  mode paints correctly; the only image is an SF Symbol.
- **Sizes.** `DialCanvas` scales the 364×382 canvas by
  `min(w/364, h/382)` about its centre and the cache renders at the same
  factor (`pixelScale`); `SizeSweepTests` renders the canvas at every
  systemLarge size in Apple's tables and checks the band lands at the same
  scaled radius on both axes: iPhone 321×324 (SE/8, factor 0.848), 329×345,
  338×354, 348×351, 360×379, 364×382 (1.0); iPad 306×306 (mini and 9.7",
  0.801, the floor), 321×321, 328×328, 342×342, 379×379 (0.992). The
  smallest type on the floor: the 9pt projected note at 7.2pt (5.8pt after
  its 0.8 minimum scale), the 10.5pt hour labels at 8.4pt, the 11.5pt
  countdown at 9.2pt. Legible on a 2× iPad mini in a test render; if it is
  not on glass, raise `noteFontSize` before dropping the note's minimum scale.
- **Decided, then reversed (26 Sep).** No Android home-screen dial; Wear OS
  tile if the dial earns a second surface. Reversed after the device spike:
  the Android widget is built at parity (§"Android, if it happens").
  The projected-day limitation stands: a day the app has not opened carries
  its shape, not its state (no routines, no completions; §"Phase 4b").
- **Release notes.** *Day Dial widget (iOS): your whole day as a dial on the
  home screen — sky, blocks, the current task and what comes next, updated
  through the day without opening the app.* And, from Phase 4: *Widgets no
  longer reload on every step of a block resize; they update once when you
  let go.*
- **Sky on the live path.** The first device run drew no sky ring: the
  payload's `sky` was null (no geocoded location in the app) and the face
  drew nothing there. The face now draws the ring unlit in that state (§5
  "sky"), the `daydial` line says `sky=none`, and `DayGlanceWidgetTests`
  (a simulator test target, run by `ios.yml`) pushes the live-shaped
  fixture through the real decode → resolve → map → render path and samples
  the ring, lit and unlit.

**Phase 4b was a gate, found late, and is closed.** Only the WebView writes
widget content, so every shipping widget held yesterday's data after a night
in the background. Two fixes landed: the stale state (honest, not fresh) and
then the day-keyed payload (fresh for the day). What a projected day cannot
carry, and what the dial should therefore expect on a day the app has not
opened yet:

- **No routines.** Routine chips are placed by the user each day and a new
  day genuinely starts empty, so a projected dial has no routine bars until
  the app opens that day. That is honest, not a bug; the soft "Planned as of"
  label covers it and nothing should try to synthesise them.
- **No completions, no habit counts, no overdue carry.** The block band
  reads completion on the pushed day only; on a projected day every past
  block takes the past-event tone (§2 "Block band", the projected-day rule),
  so the ring never claims a finished block was left undone. Only the hub's
  done/remaining phrasing is a projection.
- **Per-block tags and project references are kept** at full richness, so
  the hub names each block and its tag as it becomes current.

**Phase 1 is the largest single block and the most mechanical.** It is isolated
deliberately: it has no UI, it is fully testable against the exported fixtures,
and it is the only phase whose output serves a future Android port unchanged.

### Where dayDial.js and the spec disagree (the spec wins for the widget)

Found while porting; each is named in the Swift where it applies.

| Topic | Web dial (`dayDial.js`, what the vectors pin) | Widget spec (what `DialSpec` implements) |
|---|---|---|
| Tick schedule | 288 ticks every 5 min: hour / quarter / minor (`dialTicks`) | 96: major on the hour, minor at 15 min, nothing finer. `DialTicks.schedule(stepMinutes:)` yields both; `DialSpec.ticks` is the spec's |
| Hour labels | 8, every 3 h; one hides within 30 min of a sun glyph (`dialLabelYieldsToSun`) | 6, no `06`/`18`; cardinals at 172, diagonals at 181; glyphs sit at 104 so nothing yields |
| Block edges | each arc padded by up to 3 min per side, yielding on slivers (`padDialSegment`) | exact spans, 1.6pt separator cut where two blocks touch (§3). `DialSegments.pad` is ported for the vectors; `DialSpec.separatorMinutes` is the spec's rule |
| Block fill | per-task colour muted into one pastel family, intensity by duration, state multipliers, a blurred glow | **Decided for the app's treatment**, variant C (§2 "Block band"): the same mute, curve and multipliers, fills ×3.5 and the rim given a 1.5pt floor for widget scale, no glow, plus the projected-day rule the app never needed. The spec render's solid band is superseded |
| Canvas | 1000-unit viewBox, ring 300–385 | 364×382pt, block band 129–151 at 140 |

Nothing in the vectors contradicts the spec: the geometry functions are
radius-agnostic and the fixture evaluates them at both canvases, so no
"stop and ask" case arose.

### What the port does not re-derive, and why

- **The sky** (`computeSkySnapshot`, `computeDaylightBand`, `computeMoonBand`,
  `getSunTimes`): consumed from the snapshot per §4. The Swift test decodes
  the fixture's sky cases and checks the 24-segment shape the ring draws from
  and the spec's opacity mapping; it does not solve solar or lunar positions.
- **Block data** (`kind`, `colorHex`, `completable`, titles, the day's
  totals): `computeDialModel` derives these from task fields via
  `deriveBlockEnergy` and `taskColorToHex`, which drag in the energy keyword
  list, tag extraction and the Tailwind colour map. They travel in
  `dial.blocks`; the port compares only the geometric fields of those cases.
- **Routines on a projected day**: none (see phase 4b). `DialModel.routineBars`
  is ported and vector-checked for the pushed day.
- **`dialSelection`** (keyboard walk): web accessibility UI, no widget analogue.

### Android, if it happens

> **Reopened and built, 26 Sep 2026.** A throwaway device spike (#1818)
> tested the three objections below on a phone and a tablet, and each one
> had an answer the 22 Sep analysis missed:
>
> - **The needle** is not in the face. It is a `<rotate>` drawable over it,
>   turned by `ImageView.setImageLevel`, which `RemoteViews` can call in a
>   *partial* update: one int per tick, the face untouched. On device it
>   landed on the drawn minute.
> - **The tick** is a non-wakeup `AlarmManager` alarm at each minute
>   boundary. It fires while the screen is on and waits while the device
>   sleeps, catching up on wake, so a needle nobody can see costs nothing:
>   a night of ticks did not register in Battery usage. Without the exact
>   alarm grant the window widens to ~10 minutes; with it (the tablet's
>   case) the needle moves every minute.
> - **The face bitmap** reaches the launcher by ashmem, not inline in the
>   transaction: a ~9 MB full-screen tablet face delivered cleanly.
> - **The countdown** is not a `Chronometer`. The one row that changes by
>   the minute ("17m left", "35m open") is drawn by the same painter into a
>   small strip bitmap placed in a fixed slot of the layout; every other
>   hub row is baked into the face, which is redrawn only when its key
>   changes (a block boundary, the day, a push, a resize).
>
> So the Android widget is parity after all: `dayglance-android/.../widget/dial/`
> ports DialSpec, the palette, the hub and the face input against the same
> vectors and fixture, and draws the same face. The Wear OS analysis below
> stands for a watch surface, as revised at its head on 27 Oct 2026. §8
> item 2 (the faintest sky segments on OLED in daylight) now rides this
> widget. What follows is the original decision, kept for its reasoning.
>
> **Cards (Android only).** A placement taller or wider than the face shows
> the in-app dial's All Day pill and legend beside it (`DialArrangement`
> decides; the dial is never smaller for them). Their data rides the `dial`
> field as `allDay` and `totals`, from the same `computeDialModel` the
> in-app legend reads, for the pushed day and every projected one. iOS
> ignores both keys; an iPad `systemExtraLarge` dial (§8, "On a bigger dial
> for iPad") could use them unchanged.

Decided 22 Sep 2026, the night before the iOS release, after the device walk
in §8. Short form: **no Day Dial on the Android home screen; the Wear OS tile
is the Android surface worth building.** The iOS release does not wait for
either.

#### Why not the home screen

The dial's two live properties are the needle and the countdown, and an
Android home-screen widget can carry neither honestly.

- **There is no timeline.** WidgetKit takes 96 pre-rendered entries a day and
  swaps them on schedule with the app asleep (§6, §9 Phase 4). A
  `RemoteViews` widget redraws only when something wakes the provider:
  `updatePeriodMillis` floors at 30 min, WorkManager's periodic minimum is
  15 min with flex and Doze defers it further on an idle device, and an
  `AlarmManager` alarm per block boundary is exact only with the
  schedule-exact-alarm permission the app already treats as optional
  (`MidnightRolloverReceiver`'s exact-or-inexact fallback). So a needle
  drawn into the face bitmap sits still for up to 15 minutes, then jumps.
- **Live text is a `Chronometer`, and only that.** `setChronometerCountDown`
  ticks in the launcher without waking the app, but it renders `mm:ss` (or
  `h:mm:ss`) and cannot be formatted, so "17m left" becomes `16:59` counting
  down in seconds — the exact reading the user rejected on iOS and that the
  iOS 18 minute-only text was built to avoid. Anything phrased is static and
  goes stale with the needle.
- **The face bitmap has a ceiling.** A square dial in a 4×4 cell at xxhdpi is
  858×858 px, 2.8 MiB of ARGB against a ~1 MiB Binder transaction
  (feasibility doc §7: 512×512 is the largest square that parcels inline).
  The FileProvider URI path there avoids it but is new plumbing with
  launcher-specific grant behaviour; the app's largest widget bitmap today
  is the 80×80 `drawHabitRing`.

Jetpack Glance does not change any of this: it compiles to the same
`RemoteViews` and refreshes on the same `updateAll` / WorkManager cadence.
The user's verdict on the resulting product ("those are bad trade-offs") is
recorded as the decision.

Three positions were on the table; the first is the recommendation.

1. **No Android home-screen dial.** The list widgets already cover the
   home-screen job on Android. Nothing in the iOS pipeline is specific to
   this decision: the snapshot (`dial`, `sky`) is already pushed to both
   platforms, so reversing it later costs nothing upstream.
2. **A deliberately non-live "day shape" widget.** Face + block band as a
   bitmap, the current block named with its end time ("until 12:30"), the
   current block's segment emphasised, no needle, no countdown, refreshed
   at block boundaries by alarm and at the 15-min worker tick. Honest, and
   about 4–5 days (geometry port, face renderer, FileProvider path,
   provider). Not chosen because a dial without a needle is a different
   product from the iOS one and would ship under the same name.
3. **Parity, with the trade-offs above.** 7–9 days (the feasibility doc's
   ~12.5 was written before the geometry port, which is 2 days in Kotlin
   against the exported vectors). Rejected: the needle would jump and the
   countdown would either show seconds or go stale.

Revisit only if the platform changes the update model — Android's
home-screen widgets moving to Remote Compose, as Wear OS 7's are, would
reopen it. Watch for that; do not re-open on library releases alone.

#### Wear OS: feasible, and the better fit

> **Revised 27 Oct 2026; no Wear OS work has started.** Three things changed
> after this section was written: the Android widget shipped, GLANCElauncher
> gave the phone app a write path that works from outside it, and the scope
> grew to include a watch face. Where this note and the 22 Sep text below
> disagree, this note wins; the platform facts below still stand.
>
> **Scope and order.** Three surfaces, each reusing the one before:
>
> 1. **A complication data source.** It works on any watch face the user
>    already has, so it is the cheapest and reaches the most people.
> 2. **The tile**, as analysed below.
> 3. **A watch face.** Committed, not a stretch goal. It is the showiest
>    surface and the most expensive, and it only helps users willing to
>    switch faces.
>
> A full-screen interactive watch app is **not planned**: dragging blocks on
> a ~450 px round screen is a poor fit.
>
> **Open: complication first, or tile first.** The 22 Sep text puts the tile
> first because only it carries a live needle and countdown. The October
> plan puts the complication first, for reach and cost. Decide before
> starting.
>
> **The watch face.** From the September investigation; not re-verified
> here:
>
> - **The format.** Watch Face Format (WFF) has been required to install a
>   watch face on every Wear OS device since January 2026. It is declarative
>   XML with no code.
> - **What a face can read.** A WFF face is sandboxed and cannot read app
>   storage. Data reaches it only through system sources and complication
>   slots, at most 8 per face.
> - **The listing.** Since 15 Jul 2026, watch face apps on Play must meet
>   policy WO-G4: the listing icon is the face, centred and circular.
> - **The documented escape hatch.**
>   - Bundle our own complication data source in the same APK, as the face's
>     default (`DefaultProviderPolicy`), with the slot's `isCustomizable`
>     false, so the slot becomes a private data channel.
>   - The ring is drawn to a bitmap in Kotlin inside the data source and
>     served as an image complication.
>   - WFF draws the ticks, labels, hub text and needle on top. The needle is
>     a `Transform` rotation on a time expression, so it moves smoothly with
>     no updates from us.
>   - Step 1's data source is this channel, so the face builds on it.
> - **What maps directly.** WFF arcs take thickness and gradients, so the sky
>   ring and block band map almost one to one.
> - **What is hard.**
>   - *Ambient (always-on) mode is the real design problem.* It restricts
>     colour, refreshes about once a minute, and burn-in rules forbid large
>     filled areas. The dial is mostly filled rings, so the ambient face is
>     its own design, not a dimmed copy.
>   - *Size.* A round face is ~450 px against the 364×382 pt the widget
>     was already cut hard for. The hub likely drops to the countdown alone,
>     and the sky ring may not survive.
>
> **What exists now:**
>
> - **The face renderer.** `dayglance-android/.../widget/dial/` is the
>   geometry port this section budgeted 2 days for: `DialSpec`, the palette
>   and the hub. `DialFacePainter` draws the face to a bitmap with
>   `android.graphics.Canvas`, and the needle is a separate rotating layer.
>   That is the bitmap the complication, the tile image and the watch face's
>   private slot all need.
> - **The data for the dial.** The face reads the widget snapshot's `dial` and
>   `sky` (`DialFaceInput`), for the pushed day and every projected
>   `days[]` entry. That is what goes to the watch. The projected days also
>   let the watch show a day's shape while the phone is out of reach.
> - **Writes from outside the app** (complete a task, toggle a routine,
>   add a task), built for GLANCElauncher and described in
>   `docs/launcher-integration.md`:
>   - each carries a client id, so a repeat is never applied twice;
>   - a routine toggle sets a state rather than flipping it;
>   - each is held in a durable queue (`LauncherWriteQueue`) until the page
>     acks it;
>   - each is applied by the app's own handlers, JOBO record included;
>   - while the app is closed, the headless refresh applies them (CLAUDE.md,
>     "Headless refresh").
>
>   A tap on the watch is one more client of this path: the phone side of
>   the Data Layer hands it to the same queue the launcher's receiver
>   (`LauncherIntentReceiver`) fills.
> - **Launcher code that runs on a watch unchanged.** In
>   `krelltunez/dayGLANCE-launcher`, `data/provider/SnapshotParser.kt`,
>   `data/Models.kt` and `data/provider/Outbox.kt` are plain Kotlin plus
>   `org.json`, about 900 lines.
>   - They are needed only for task and routine lists the watch can act on,
>     not for the dial.
>   - They read through the `GlanceClient` interface, so a Data Layer client
>     would replace the content provider one.
>   - They would first move out of the launcher's app module into a shared
>     module, as `:daydial` already is.
>   - The launcher's `:daydial` geometry, sky, frames, solar, lunar and
>     weather are pure, JVM-tested Kotlin. Its `DayDial.kt` is Compose,
>     which complications, tiles and watch faces cannot host.
>
> **A constraint the 22 Sep text missed.** The Data Layer connects a watch
> app only to a phone app with the same package name and the same signing
> certificate. So the watch app is `com.dayglance.app`, a `wear` module in
> `dayglance-android/`, signed with dayGLANCE's key. Consequences:
>
> - Watch users do not need GLANCElauncher.
> - lastGLANCE content on the watch would need lastGLANCE's own watch app.
> - Play is the practical way to ship it, since sideloading to a watch is
>   adb over Wi-Fi.
>
> **Still new work:**
>
> - **The Data Layer transport.** A `WearableListenerService` in the phone
>   shell, a `DataClient` push on each snapshot write, capability discovery,
>   and handling a watch that is not connected.
> - **Update cadence against watch battery.** The launcher's refresh floor
>   and freshness log are a model, but the tuning is new.
> - **ProtoLayout** for the tile.
> - **The ambient design and the size pass** for every surface.
>
> **Estimate, replacing the 8–10 days below.** Rough figures, before device
> time:
>
> - **Complication, with the `wear` module and the relay:** 3–4 days.
> - **Tile on top of it:** 3–4 days.
> - **Watch face on top of both:** 4–6 days, a rougher figure. Most of it is
>   the ambient design and the WFF layout.
>
> Most of the remaining risk is the ambient design and the size pass, which
> nothing built so far covers.

Verified against the ProtoLayout sources and the Wear OS docs on 22 Sep
2026; each claim names what it rests on so the next person can re-check
rather than trust.

- **Tiles have a timeline.** A tile is a `Timeline` of `TimelineEntry`
  values, each with a `TimeInterval` validity; the renderer switches entries
  on the watch without calling the tile service. That is WidgetKit's model,
  not `RemoteViews`', so the iOS entry planner (`DialTimeline`) ports as is:
  one entry per block boundary carrying the face for that block and the hub
  text, `setFreshnessIntervalMillis` for the next payload and
  `TileService.getUpdater().requestUpdate` when the phone pushes new data.
- **Live values without redraws.** From Tiles 1.2 (renderer schema 1.200)
  properties bind to *dynamic expressions* evaluated on the watch, with the
  platform clock updating every second
  (`DynamicInstant.platformTimeWithSecondsPrecision()`). Both live
  properties come back:
  - the countdown as a `DynamicString` built from
    `platformTime.durationUntil(end).toIntMinutes()` — minutes only, the
    phrasing ours, no seconds;
  - the needle as a `DegreesProp` with a dynamic value: on `Arc`'s anchor
    angle (bindable since 1.200, so a rim marker works wherever dynamic data
    does) or on the `Transformation` modifier's rotation (schema 1.400,
    newer) to spin a radial needle image around the hub. Each dynamic prop
    also carries the static value older renderers read, so a watch that
    cannot bind shows the entry's baked needle and a static "Xm left",
    refreshed at the next entry.
  Wear OS caps the number of dynamic expressions per tile (the cap is
  unpublished; over it, everything falls back to static). Budget two —
  countdown and needle — and keep the face static. Read
  `deviceConfiguration.rendererSchemaVersion` in `onTileRequest` and build
  the static-only layout below 1.200.
- **The face** is one inline PNG per entry (`InlineImageResource`) or,
  cleaner, native `Arc` + `ArcLine` children per block and sky segment with
  no bitmap at all; ticks and glyphs are the parts that want the image. The
  round 1:1 canvas is the dial's natural shape for the first time.
- **The hub** is the tile's text: weekday, task, "until", time left, runway
  fit the round screen's chord at least as well as the 98pt widget hub.
- **The countdown text is also a complication**, for anyone who wants it on
  their watch face instead of in the carousel: a `SHORT_TEXT` source with
  `TimeDifferenceComplicationText` counts down on the face with no updates
  from us; `UPDATE_PERIOD_SECONDS` floors at 300 s and on-demand pushes are
  limited to one per 5 min on average, both fine for block boundaries.

What makes it real work rather than a port:

- **The data has to reach the wrist.** dayGLANCE has no watch app. The tile
  needs the same snapshot the phone widgets read (`dataStore.widgetSnapshot`,
  `NativeBridge.kt:332`) shipped over the Wearable Data Layer from the
  Android phone app, which means a `wear` module in `dayglance-android/`, a
  `DataClient` push on every snapshot write, and the reload flag's dedupe
  honoured on both ends. The Data Layer is Android-phone only: an
  iPhone-paired watch would need the tile to sync on its own from the
  GLANCEvault, a separate and larger piece. Scope the first cut to
  Android-phone owners and say so.
- **The platform is mid-transition.** Wear OS 7 introduces *Wear Widgets*
  (Jetpack Glance + Remote Compose, 2×1 and 2×2 cards, libraries at
  1.0.0-alpha as of this writing) and on partial-height devices (Galaxy
  Watch on 7) shows the widget instead of the tile; tiles remain the surface
  on Wear OS 3–6 and on full-height devices (Pixel Watch on 7). Google's
  recommended path is a dual service: tile plus widget in one logical
  `group`. The dial is a full-screen shape, so build the tile first and let
  the 2×2 widget be a reduced view (block band + countdown) when the Remote
  Compose libraries leave alpha. Whether Remote Compose exposes a
  client-side clock for a live needle was **not** verified; check before
  promising the widget more than the tile's static fallback.
- **Estimate: 8–10 days** to a tile with both live properties, before device
  time: Kotlin geometry port against the phase 1 vectors (2 d, and it serves
  option 2 above if that is ever revisited), face rendering on the watch
  (2 d), hub + dynamic expressions + timeline (1.5 d), Data Layer sync and
  the `wear` module (2 d), CI and preview tooling (1 d), the §8 item 2 OLED
  check and the size sweep across round and squircle screens (1 d). The
  complication is half a day on top of the module. Nothing here is on the
  iOS release's critical path.

Worth deciding after the iOS release has been in users' hands, not before:
a week of Home Screen use will say whether the dial earns a second surface
at all.

## 10. Frames

The day's frames drawn on the dial, in the app and on both widgets. The
reference render and the settled design are `docs/day-dial-frames-spec.html`;
this section records what the build decided on top of it.

### Model and payload

- **One producer.** `computeDialFrames` (`src/utils/dayDial.js`) turns
  `frameInstancesForDate` output into the dial's frames and the Frames
  percentage. The in-app dial calls it directly; `projectDialSnapshot`
  ships its result as `dial.frames` and `dial.totals.framesPercent`, for the
  pushed day and every projected day (frames are part of the shape of a
  day, not its state).
- **Wire shape**, per frame: `{name, colorHex, startMin, endMin, depth,
  slots: [[startMin, endMin], ...]}`, start-ordered. `slots` is the frame's
  free time from the same `computeAvailableSlots` GLANCE uses (so the same
  buffer and occupancy rules), computed WITHOUT the now floor: each widget
  entry takes "still available" at its own minute
  (`dialFrameAvailableMinutes`) instead of freezing the push's. Both read
  the unfiltered day: the calendar's tag and project filter is display-only
  and reaches neither. Completed tasks still occupy time (as in GLANCE).
- **Not derived from `sections`.** Today's `sections` drops frames that have
  ended and frames with nothing free and nothing in them, while the ring
  draws the whole day's; and a section carries its task rows, which the
  ring already has as blocks.
- **Colour.** A frame stores a pastel `-200` class (`FRAME_COLORS`), which
  `TAILWIND_TO_HEX` never carried, so every frame reached the widgets'
  `sections` as the fallback blue. `frameColorToHex` resolves the class to
  its family's `-500`. That fixes `sections` too.
- **Bytes**, measured against the 400 KB cap (`WIDGET_SNAPSHOT_CAP_BYTES`):
  - the live fixture day (four frames, five slots) adds 447 bytes, or about
    1.8 KB across the pushed and three projected days;
  - a heavy day (eight frames, six slots each, long names) adds 1.4 KB, or
    5.6 KB across four days (1.4 % of the cap);
  - a day without frames adds 33 bytes (`"frames":[]` and a null percent).

### Geometry

- **Enclosure.** Each frame is an outline just outside each edge of the
  block band, joined by radial end caps: the stroke of a closed annular
  sector (`dialSectorPath` at the frame's two radii). On the widget, the
  outlines are at r = 126 and 153, the gaps either side of the 129–151 band.
  The stroke is 1.8 pt at opacity 0.45. The spec drew 1.2 pt, which read
  too faint on devices. Nothing else moves.
- **Band-proportional.** `dialFrameRadii(rInner, rOuter, depth)` states every
  length as a fraction of the band's width: 3/22 inside, 2/22 outside, 3.2/22
  per level, and 1.8/22 for the stroke. The widgets draw exactly that.
- **The in-app dial places its own outlines** (`appFrameRadii` in
  `DayDial.jsx`). It starts from the same design and differs in three ways,
  all found on device:
  - *Width.* The stroke is 1.2/22 of the band (4.6 units) on a phone-sized
    dial, and is capped at 2.4 screen pixels. On a desktop or tablet dial,
    where the same units are about twice the pixels, the line gets thinner
    rather than heavier.
  - *Thinning comes from the inside.* The outer outline's outer edge stays
    where the phone draws it (≈395), whatever the width.
  - *The inner outline lies on the wedges' inner edge.* Its stroke runs from
    300 outward, so no wedge reaches past it. The daylight band (the sky
    strip) now ends at 300 rather than tucking under the wedges to 302. That
    tucked sliver was what looked like a task spilling past the border onto
    the strip.
  - Nested frames step in 3.2/22 of the band from both edges.
  - The widgets are unaffected: their 126 pt inner outline sits in a real gap,
    clear of their sky ring.
- **Selectable in the app.** A drawn frame joins the ring's selectable items
  (`frameItems`):
  - **Pointer:** the outline is the target, through a transparent 12 px hit
    stroke.
  - **Hub:** pointing at a frame, tapping it or walking to it with the
    keyboard puts it in the hub, with the same rows as the current frame
    ("available" on today only).
  - **Screen readers:** each frame has its own listbox option, "Frames:
    <name>, <span>, <available>".
  - **No action sheet.** A second tap or Enter does nothing, because a frame
    has nothing to act on.
  - **Keyboard entry** still lands on a block, never on a frame.
- **Colour.** The frame's hex through `muteDialFrameColor`: saturation
  capped at 0.28 and lightness 0.62 (`muteDialColorWith`, the app's
  `muteDialColor` arithmetic with the two constants as inputs). This keeps
  the ring below the block rims so the needle stays the brightest element.
- **Nesting depth is capped at 1** (two drawn levels). One step in (3.2 of 22)
  already puts the outlines on the band's own edges (129.2 / 149.8 on the
  widget). A second step would draw through the wedges' fills and rims,
  where it stops reading as an enclosure, so deeper frames draw at level 1.
- **Vectors.** `muteDialFrameColor`, `dialFrameRadii`, `dialCurrentFrame` and
  `dialFrameAvailableMinutes` are in `dayDial.vectors.json`, ported by
  `DialFrames.swift` (`FramesTests`) and `DialFrames.kt` (`DialFramesTest`).
  Depth and the percentage are decided once, in JS, and shipped.

### Edge cases, decided

- **Nesting.** The model has no parent field and the editor refuses
  overlaps, but a per-day time exception or a drag-resize is not
  re-checked, so one frame can end up inside another. Depth is containment:
  the number of frames that wholly enclose this one. For an identical span,
  the earlier frame is the outer one.
- **Overlap without nesting.** Both frames stay at depth 0 and their outlines
  cross where they overlap, which is what the day actually is. Neither frame
  is moved to a lane, since lanes belong to blocks. The percentage uses the
  union of the frames, so no minute counts twice.
- **Midnight.** Frames cannot span it: the editor refuses `end <= start` and a
  resize clamps to the day. A record that arrives that way anyway is dropped
  rather than guessed at, and spans are clamped to 00:00–24:00.
- **A frame with nothing in it.** It draws normally and counts toward the
  percentage as 0 %. The hub shows its whole span as available.
- **A day with no frames.** Nothing is drawn, and there is no Frames entry in
  the metrics, the same rule as Sleep and Unblocked without a day window.
  `framesPercent` is `null`, never 0: a dash would claim a measurement that
  was never taken.
- **Too short to draw.** Under `DIAL_FRAME_MIN_MINUTES` (10) the enclosure
  is not drawn: 10 minutes is 5.5 pt of arc at the widget's inner outline,
  about the least that still reads as a box. The editor's own floor is 15
  minutes, so only an exception gets here. The frame stays in the model, so
  the hub and the percentage still see it.

### Hub

A running block always wins. Frame rows appear only when nothing is running,
and they replace the open-time rows from Phase 5:
- the frame's name, at the task title's size and weight (15 pt, 600), in the
  frame colour through the STANDARD `muteDialColor`, after the Frames mark;
- its span;
- the time still available in it.

The current frame is the innermost one that now is inside
(`dialCurrentFrame`). The ring and the title share a hue but not a mute
level, on purpose.

### Frames metric

"Frames", as a whole percent, sits right of Routines in the in-app metrics,
with the same label styling as the others. It is the scheduled block minutes
inside frames divided by the frame minutes:
- blocks are the ring's own tasks and calendar events, done or not, merged so
  that lanes don't count twice;
- sleep and routines are never among them;
- the frame minutes are the union of the top-level frames.

The app's nearest existing figure is the Weekly Review's frame utilisation
(`WeeklyReviewModal.jsx`), which differs in four ways:
- it covers a week of recurring frames only;
- it counts a task by its START falling inside a frame, without clipping at
  the frame's edges;
- it leaves out imported calendar events;
- it sums overlapping tasks twice.

The dial's figure is what the ring shows for one day, so it can't be reused.

### The Frames mark

This is the app's own frames icon, lucide `LayoutGrid`: four rounded squares
in a 2×2 grid, outlined, as used on the Frames button and in GLANCE's frame
headers. The widgets use the nearest native equivalents: SF Symbol
`square.grid.2x2` on iOS, and the same four-square outline as a vector on
Android.

### iOS widget

- **In the cached face.** Frames are static for a day, so they are drawn into
  the face image (`DialFaceView.frames`), after the separators so that a cut
  between two touching blocks cannot erase a nested outline along the band's
  edge. They get no past or future dimming.
- **The cache key needs no new part, but the seed has to change.** Frames
  don't vary with the entry, so the past bucket (`-b<n>`) and the key's shape
  stay the same. They are drawn into the image, though, so each frame's span,
  depth and colour join `DialFaceInput.seed`. Without that, an edited frame
  would reuse a stale face. Names and free slots belong to the hub and stay
  out of the seed. A day without frames keeps its existing key, so
  `renderVersion` stays at `face-v4`.
- **Tinted and clear Home Screens (mono).** The outline is white at the same
  0.45. In that mode it is brighter than in full colour, where it is a
  softened hue at 0.45, and it sits above the minor ticks (0.13).
  `FramesWidgetTests` samples the rendered mono face to check that the
  outline keeps its alpha.
- **Hub.** `DialHubFrame` holds the frame and its free minutes. It is built
  only on a live day when nothing is running and the entry isn't in sleep.
  The title is `square.grid.2x2` plus the name at 15 pt semibold, in the
  standard mute. The detail rows are the span and "Xm available" in the
  runway teal; the available row is dropped when nothing is free. VoiceOver
  reads the same facts.
- **Extra-large (iPad).** The legend gains Frames, last, when
  `framesPercent` is present.
- **Previews.** `Frames · task running`, `· nothing running`, `· nested` and
  `· a frame at 0 %` are the spec day at 17:18, matching the in-app dial's
  scenarios.

### Android widget

- **Face.** `DialFacePainter.drawFrames` draws each frame's enclosure inside
  the face layer, after the DST_OUT separator cuts. Frames join
  `DialFaceInput.seed`, so an edited frame names a new face; names and free
  slots stay out of it.
- **Hub.** `DialHubRows.build(frame = …)` produces the frame rows when nothing
  is running on a live day and it isn't sleep time. The title uses
  `TITLE_FRAME`, which `drawFrameTitle` paints as the four-square mark plus
  the name, centred together, in the standard mute. The "available" row is
  the **live row** (the ROW1 strip): it counts down while now is inside a
  free slot, and as a static row it would redraw the whole face every
  minute. The face key keeps the frame's name and span.
- **Cards.**
  - The legend gains `FRAMES`, in the tall grid's third column (the spacer it
    replaces) and as a row in the wide list.
  - When a day has no frames, the tall cell is INVISIBLE rather than GONE, so
    that unblocked and routines keep their thirds.
  - The icon is `ic_day_dial_layout_grid`, lucide LayoutGrid, in the
    neutral `#c8c8d2`.
