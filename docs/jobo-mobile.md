# JOBO slice 8: mobile

Design note for slice 8 of #1726: JOBO on the phone, and on a tablet held
upright. The desktop shape is settled (slices 1 to 7b), so this note fits
it to a narrow screen rather than designing JOBO again. The mobile
prototype in #1675, since closed, is a source of interaction ideas, not
code: it predates slices 2 to 7.

Landscape tablets already show the desktop JOBO view and are unchanged.

## The layout

One day, as on desktop, with Plan and Do side by side on one hour grid, so
the comparison JOBO exists for survives the narrow screen. A phone cannot
give both sides real cards (two equal columns leave about 150px each on a
390px screen), and tabs would hide half the comparison at any moment. So
the two sides share the width unevenly:

- **One side is wide**, with full cards, exactly as that side works on its
  own.
- **The other is narrow**, about 44px, and shows the same items as coloured
  bars at their times: no text, the same positions on the same grid. It is
  a map of the other half of the day.
- **A divider** between them carries the swap control.

Plan stays on the left and Do on the right, as on desktop; a swap changes
their widths, never their order.

```
 Plan wide                     Do wide
 ┌────┬──────────────┬┬──┐     ┌────┬──┬┬──────────────┐
 │ 9  │ ▇ Write spec  ││▒▒│     │ 9  │▇▇││ ▒ Write spec  │
 │ 10 │ ▇ Call bank   ││  │  ⇄  │ 10 │▇▇││               │
 │ 11 │               ││▒▒│     │ 11 │  ││ ▒ Write spec  │
 └────┴──────────────┴┴──┘     └────┴──┴┴──────────────┘
  hours  Plan cards    Do        hours Plan   Do cards
                       bars            bars
```

### The hours stay on the left

The hour labels sit in the left gutter, as on the phone timeline
(`MOBILE_HOUR_GUTTER_W`, 48px), not on the divider. #1675 put one shared
hour axis between two equal columns. With one side narrow, an axis on the
divider would sit against the narrow lane and travel across the screen at
every swap, so the times would jump exactly when they are being read. The
left gutter keeps them still, matches the phone timeline, and leaves the
divider to the swap control alone.

### The wide side

- **Plan wide** is the phone timeline's own day column, the one
  `MobileTimeGrid` draws, so its cards, tap-to-add, long-press, the card
  swipes and the notes panel come with it, as DAY's column does for the
  desktop Plan side. JOBO does not reimplement timeline behaviour.
- **Do wide** is the Do column (`DoColumn`), its cards striped in the task's
  colour, unlinked work in grey, as on desktop.

### The narrow side

Each item drawn as a bar at its time and length, in the task's colour:

- Plan bars are solid; Do bars keep the stripes, so the two never read as
  each other, even at 44px.
- Unlinked Do are grey.
- Overlapping items split the lane into thin sub-columns, as overlapping
  tasks do anywhere.
- The NOW line runs across both sides.

The bars are a new mode of each side's existing renderer, so the narrow
lane always matches what the wide one would show.

## Swapping

- **Tap the narrow lane, or the divider's button**, to swap. The whole lane
  is the target, since a small button is fiddly on a phone and a lane of
  bars invites a tap anyway. The button (⇄) stays for clarity and has a
  label for screen readers.
- **Tapping a bar swaps and highlights that item** in the newly wide side,
  scrolling it into view if needed. The narrow lane is navigation, not
  decoration.
- **No swipe.** Horizontal swipes on the phone timeline's cards are already
  their actions (right to the Inbox, left to edit), so a swipe would mean
  two things.
- **The swap slides.** The wide side narrows as the other widens and the
  divider glides across, in about 250ms with an ease-out; cards fade in as
  their side reaches full width, so text never reflows mid-slide. With
  reduced motion set on the device, the swap is instant.

### Which side opens wide

- **Plan** for today and later, where the day is still to be planned.
- **Do** for past days, where what happened is the question.

A swap holds while you stay on that date; moving to another date opens it
on its own default.

## Pairs

Tapping a card in the wide side selects it, and its counterparts in the
narrow lane light up: a task's Do bars when a Plan card is selected, its
Plan bar when a Do card is. Desktop JOBO pairs a task's Plan and Do cards
the same way on hover; a phone has no hover, so a tap selects. Either way,
"which bar is this task" never needs reading.

## The header

The phone's date header row stays: the date, its arrows and Today. JOBO
adds three buttons to it:

- **Check** opens the day's Check (`CheckJournal`) as a near-full-height
  sheet, with the same journal, Not started group, next-step line and
  actions as on desktop.
- **Statistics** opens the full statistics panel from #1919
  (`StatisticsPanel`, Day, Week, Month and All time) in the same kind of
  sheet.
- **Add Do** opens the Do editor for the day.

The sheets take the dismissal MONTH's day sheet already has
(`utils/sheetDismissal.js`): the back button, a pull down, the left-edge
swipe and Escape.

## Do on the phone

- **Tap an empty slot in the wide Do side** to add a Do there, as clicking
  one does on desktop.
- **Tap a Do card** to edit it, in the Do editor (`DoEditor`) shown as a
  sheet. Exact times are typed there, as on desktop.
- **No dragging Do cards in the first build.** Desktop drags to move or
  resize a Do; on a phone that competes with scrolling the day. The editor
  covers it, and dragging can follow once the rest has been used.

## Tablets held upright

The same layout. A tablet in portrait shares the screen with the GLANCE
and Inbox sidebar, so the timeline is phone-width there too. It takes the
phone's view toggle, where JOBO joins as a view behind the same flag.

## What stays as it is

- **Desktop and landscape tablets**, and the desktop JOBO view.
- **The ledger, core, detector and day model.** The phone reads the same
  day model (`viewModel.js`) and writes through the same `recordJobo`. No
  task field is added.
- **The flag.** JOBO joins the phone's views only with `joboEnabled` on, as
  on desktop, where an off flag hides the view everywhere.
- **The past-day rule on the phone's other views** (its timeline, LIST and
  MONTH). Slice 6 left mobile unchanged; whether the phone's timeline also
  shows past days' Do is a separate question, below.

## Decisions to confirm

1. **One side wide with full cards, the other a narrow lane of bars**, Plan
   left and Do right, swapped by width.
2. **The hours in the left gutter**, not on the divider.
3. **Swap by tapping the narrow lane or the divider button**; tapping a bar
   swaps and highlights that item. No swipe.
4. **Plan opens wide for today and later, Do for past days**; a swap holds
   until the date changes.
5. **A slide animation**, instant with reduced motion.
6. **Check, Statistics and Add Do in the date header**, the first two as
   sheets.
7. **Do are added and edited by tap and the editor sheet**; no dragging in
   the first build.
8. **Portrait tablets get the same layout.**
9. **The phone's own timeline gets the past-day rule** (and, once built, the
   NOW-line split) in a later step, not in this slice's first build.

## Build order

1. **The view and its lanes**: JOBO as a phone view behind the flag, both
   sides with their wide and bar modes, the swap with its default and
   animation, the pairing highlight, read-only Do. Browser checks at 320,
   390 and 430px and on a portrait tablet.
2. **Do on the phone**: add by tap, the editor as a sheet, undo.
3. **The header's sheets**: the Check and the statistics.
4. **The past-day rule on the phone's timeline**: done before step 2, see below.

## Step 1, as built

- **The phone's views gain JOBO** behind `joboEnabled`, as on desktop: the
  flag hides it from the toggle, the default-view picker and Views on this
  device (`gateExperimentalViews` now gates both switchers), and a phone
  showing JOBO when the flag goes off lands on its first view still on.
- **The phone gets its own JOBO switch** (App Settings, under the views):
  the flag is per device, and phones had no Experimental section, so a
  phone could not turn JOBO on at all.
- **One component, `components/jobo/MobileJoboView.jsx`,** for the phone
  (MobileLayout) and the tablet held upright (DesktopLayout). It renders in
  the timeline's own scroll area, which MobileTimeGrid's touch handling
  measures against. The day model comes from `hooks/useJoboDay.js`, now
  shared with the desktop view, so the two cannot read a day differently.
- **A Plan/Do row** sticks under the date header: the wide side's name and
  the swap button on the divider. The narrow lane carries no name, since
  neither word fits 44px in every language.
- **Pairing** works both ways: a tapped Plan card outlines itself and lights
  its Do bars; a tapped Do card is outlined and lights its Plan bar. The Do
  card outline now matches ids as text, which also fixes desktop hover
  pairing for tasks with numeric ids.
- **Not yet:** adding and editing Do (step 2), the Check and statistics
  sheets (step 3). On a portrait tablet the date header is the desktop
  one, whose hour gutter is 16px wider than the phone timeline's.

## The phone's other views

Built before step 2, so the phone shows Do wherever the desktop does:

- **GRID** (the phone timeline, MULTI's counterpart) reads the day's display,
  as DAY's column does: past days, and today up to the NOW line, show the
  recorded Do as the striped read-only card, with its details and "Open in
  JOBO" on a tap. JOBO's own Plan side keeps to the plan (`planOnly`).
- **MONTH** reads the display on every layout, so its cells' bars follow the
  Do on the phone and portrait tablet too.
- **"Open in JOBO"** (a Do card, SCHED's Do badge) opens the phone's JOBO on
  the timeline tab, at the Do's time.
- **LIST** stays on the plan for now, as an agenda, like SCHED before its
  badge.

Also from testing step 1: the divider is a 2px blue line through the Plan/Do
row and the grid, with the swap button on it in a blue ring; the Do side
draws to the timeline's measured hour rather than a fixed 161px, since a
1px border can render thinner on a screen with a fractional pixel ratio and
a fixed hour would then drift from the NOW line; and DAY's NOW line reads the
app's clock, as the Do side does, so a render between the clock's 15-second
ticks no longer puts the Plan side's line a minute ahead on desktop.

## Step 2, as built

- **Add:** tap an empty slot in the wide Do side; the Do editor opens as a
  sheet at that time, 30 minutes long, as a click does on desktop.
- **Edit:** tap a Do. It pairs with its plan, as in step 1, and opens in
  the editor sheet, with Delete. Keep (an estimate) and Continue (an
  unfinished attempt) work from the card's own buttons, as on desktop.
- **The sheet** rises from the bottom, takes focus itself so the keyboard
  comes up only on a tap, and closes with the phone's back
  (`useBackClose`), Cancel or the backdrop. It is `DoEditor` with `sheet`.
- **Undo:** each accepted write shows the app's toast, "Do added", "Do
  saved" or "Do deleted", with Undo: a phone has no keyboard for the undo
  history every Do write already joins. Desktop keeps Ctrl+Z, unchanged.
- **No dragging:** the Do column's `gestures={false}` drops the resize
  handle and lets a completion marker scroll under a finger.
- **One set of actions:** add, edit, continue and keep moved from JoboView
  into `hooks/useJoboDoActions.js`, which both views use; the desktop view
  keeps its drag gestures on top, saving through the same `saveEdit`.

## Step 3, as built

- **The date header gains Check, Statistics and Add Do**
  (`MobileJoboHeaderActions`), on the phone and on a portrait tablet's
  header. The header is the layout's and the sheets are the JOBO view's, so
  the buttons send a window event the view listens for. Add Do opens the
  editor at now on today, 09:00 on another day, as on desktop.
- **Both sheets are `JoboSheet`,** near full height, with MONTH's day
  sheet's dismissal (`useSheetDismissal`): back, a pull down, the left-edge
  swipe, Escape, the X and the backdrop, each leaving through the sheet's
  history entry so no stale one swallows a later back.
- **The Check** is the same journal (`CheckJournal`), with its next steps.
  The sheet stays open under the task form a next step may open, so closing
  the form comes back to the Check. The sheet is placed inside the app shell
  (`sheetHost`), not on `<body>`: the shell is `position: fixed`, a stacking
  context of its own, and a sheet on `<body>` covered every form in it, so
  Add follow-up and Schedule… opened their forms behind the Check until the
  "Make a task" change found it.
- **The statistics** are the same panel with `sheet`: the four tabs and the
  figures in the sheet, without the desktop dialog's focus trap. Its inputs
  moved from the desktop's date-row tiles into `hooks/useJoboStatistics.js`,
  which both now use.

## Side by side, as built

Asked for after the first phone build: with one side wide, the narrow lane
shows when and how long but not what, so comparing plan and actual meant
swapping back and forth.

- **A toggle in the date header,** first of JOBO's buttons, turns on the
  side-by-side view: Plan and Do at half the width each (`balancedWidths`),
  both as cards. There is nothing to swap, so the divider has no button.
- **Off, nothing changes.** The wide side and the narrow lane, the divider's
  swap button and the lane tap work exactly as before. Turning it off comes
  back to the side that was wide.
- **Remembered on the device** (`dg-jobo-mobile-balanced`), like JOBO's
  other view preferences. `useJoboPreference` now tells every user of a
  preference about a change, so the header's button and the view stay in
  step.
- **Compact Do cards:** at half width a Do card keeps its title, time and
  status, and drops the edit button (a tap edits) and the timing row (the
  editor shows it). The Plan cards are the timeline's own, which already
  fold their buttons into a menu when narrow.
- **Pairs still light up:** a tap on a card on either side outlines its
  counterparts on the other.
