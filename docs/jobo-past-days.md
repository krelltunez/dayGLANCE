# JOBO slice 6: past days show what was done

Design note for slice 6 of #1726, agreed in review on #1881. Steps 1 to 3
of the build order are built (#1884, #1885, and MONTH after them). The
NOW-line split within today, step 4, is designed in the addendum at the
end. Slice 7 (the Check and Carry Forward) runs in parallel and does not
depend on it.

## The rule

From #1726: *a date before today shows Do where any was recorded, and
otherwise the tasks as they stood, with completed ones as the de facto
record, so the year before the ledger existed does not go blank; today and
later show the plan.* And from #1623, the original framing: actual records
prominent in the past portion, leaving the future as planning space.

Made concrete, for a date before today:

1. **A task with timed Do on that date shows its Do instead of its plan
   block.** Each timed Do slice on the date is drawn at its actual interval,
   in the task's colour, as a read-only card. Two sessions are two cards.
   The plan block for that task is not drawn. *Revised by the addendum: only
   once the task is completed. An unfinished task keeps its block beside its
   Do, so what still needs doing stays in sight.*
2. **A task with no timed Do on that date shows as it stood.** Its block is
   drawn where it was, completed or not, exactly as today. This is the case
   for every day before the ledger existed, and for a task completed without
   times (an untimed completion changes nothing here; the task's own checked
   state already says it was done).
3. **Unlinked Do on that date are shown too**, as read-only cards in a
   neutral colour: work that was done without a plan. So is a Do whose task
   has since been deleted, under the title the record captured.
4. **Only measured facts leave JOBO.** The estimated completion block that
   JOBO draws for an untimed completion (#1860) is a guess shown to be
   corrected, and it stays inside JOBO. So do comparisons and labels
   ("Started late"): the other views show what happened, JOBO shows how it
   compared.

Today and later are unchanged. "Before today" is the viewer's civil date,
as everywhere else in the app.

**Gated by the JOBO flag.** With `joboEnabled` off, every view renders
exactly as it does now. The flag gates the interface, never the data, so
the ledger is already present on every device either way.

## Where the rule lives

Every view gets a day's tasks from `getTasksForDate` (`App.jsx`), but about
forty other consumers use it too (widgets, reminders, the frame nudge,
occupancy, SCHED, mobile, and JOBO's own day model), so the rule must not
go inside it. Instead:

- **A pure rule, `src/jobo/pastDay.js`.** `pastDayItems({ dateStr, dayTasks,
  index, resolveTask, isVisibleForUser })` returns the list a past day shows:
  the day's tasks with Do-covered plan blocks removed, plus task-shaped
  read-only items for each timed Do slice. No React, no storage, tested on
  its own. It reads the ledger through the same projection JOBO uses
  (`projectJoboRecords`, `timedSliceOnDate`, `buildJoboTaskResolver`), so a
  record means the same thing in every view.
- **A per-date index, built once.** MONTH asks for 42 days per render, so
  the ledger is projected once into `dateStr → timed slices` (memoized on
  `joboRecords`) rather than rebuilding JOBO's full day model per cell.
- **One accessor beside `getTasksForDate`.** `getDayDisplayForDate(date,
  applyTagFilter)` on the planner context: for a date before today with the
  flag on, it passes `getTasksForDate`'s result through the rule; otherwise
  it returns that result unchanged. It keeps the tag-filter argument, since
  views differ on it.
- **Adopted only where a view picks its day's tasks.** Each view already
  does this in one expression per column, so swapping the accessor there
  changes what a column shows without touching layout, overlap packing or
  cards:

  | View | Call site |
  |---|---|
  | DAY timeline | `DayView.jsx`, `DayViewColumn` |
  | MULTI timeline | `TimeGrid.jsx`, the per-date loop |
  | WEEK timeline | `WeekView.jsx`, `WeekViewColumn`, and its clipped-hour counts so they agree |
  | All-day rows | `DayViewAllDaySection.jsx`, and WEEK's and MULTI's rows in `CalendarHeader.jsx` |
  | MONTH cells | `MonthView.jsx`, `useMonthItemsForDate` |

## The Do card in other views

A timed Do item is task-shaped so the existing layout takes it: the task's
title and colour, `startTime` and `duration` from the actual interval, and
`joboDo: true` with the record id. It is **read-only**: no drag, resize,
checkbox or context-menu actions, the way imported calendar events already
are. Clicking it shows what was recorded, with "Open in JOBO", which opens
the JOBO view on that date at the Do's time, where the record can be
edited.

**It is drawn with a striped fill in the task's colour**, so it never
passes for a plan block, with a tooltip giving the recorded interval
("Recorded 09:30 to 10:15"). The same striped fill carries into JOBO's own
Do cards for recorded Do, so a recorded Do looks the same everywhere. JOBO's
estimates keep their dashed outline, which stays distinct from the stripes.

How each view draws it:

- **DAY and MULTI:** the full card, striped. A click shows the same
  popover as WEEK's, beside the card.
- **WEEK:** WEEK's compact chip, striped. Its click popover, which shows
  a plan card today, shows the Do instead: the recorded interval and
  progress, read-only, and "Open in JOBO".
- **MONTH:** the cell's bars follow the Do. A task done in three one-hour
  sessions is three striped bars at the recorded times, in its colour,
  and its plan bar is not drawn. The cell has no text and is one tap
  target, so a bar opens nothing of its own; the cell's spoken label counts
  recorded sessions apart from tasks ("1 task, 3 recorded sessions").

Slice 6 is read-only, as agreed with Lcub3d on #1726: past days show what
was done, and no actions are added to other views. Carry Forward stays in
the Check panel (slice 7).

## What stays as it is

- **JOBO's Plan side.** It is DAY's own column (`DayViewColumn`), so it
  would inherit the rule. JOBO passes a prop that keeps its Plan side on the
  plan, since its Do side already shows the Do.
- **SCHED, and MONTH's day sheet and docked panel**, which render SCHED.
  SCHED is an agenda of what is planned and due, with its own past-date
  handling, so its cards stay plan cards. Since slice 7b a card carries a
  Do badge instead: a striped pill in the task's colour with the time
  recorded against the task on its date, opening each session and "Open in
  JOBO" (`DoSessionsBadge`, read from the same index as the past-day cards
  by `doSessionsByTask`). Timed Do only; none with JOBO off. On a phone, whose
  card details row has no room to spare, it is a striped dot at the end of
  the title line instead, with no JOBO link until slice 8.
- **Mobile.** Phone and portrait-tablet views are unchanged until slice 8.
  The phone renders the same `MonthView`, so MONTH's adoption is gated to
  the desktop layout.
- **MonthStats**, which reads the raw task lists, not a day's display.
- **Missed recurring occurrences.** Today, a past recurring occurrence that
  was never completed is not shown at all (`expandRecurringTasks.js`). The
  rule does not change that; a Do recorded against it still shows.
- **Multi-user.** The rule filters with `isVisibleForUser`, as JOBO does
  since #1877, so another member's Do never appear.

## Later refinement

Within today, split at the NOW line rather than at midnight: before now
shows Do, after now shows the plan. That is the original framing in #1623,
and it is where the rule earns most, but it changes today's views while
you are working in them, so it follows once the past-day version has been
lived with. It has been, since 5.5.0: see the addendum below.

## Decisions

Settled in review on #1881:

1. **Per task.** Only the task that has Do loses its plan block; a planned
   task done without being recorded still shows as it stood.
2. **No plan outline** behind the Do in other views. The JOBO view is where
   plan and Do sit side by side.
3. **A striped fill in the task's colour** for recorded Do, in every view
   including JOBO (above). To be seen in the build and adjusted there.
4. **SCHED and MONTH's day sheet keep their plan cards.** SCHED is an
   agenda. Revised after slice 7b: its cards carry a Do badge (above), so
   the agenda can still say what was done without becoming a timeline.
5. **Mobile unchanged** until slice 8.

## Build order

1. **The rule and the index**, with tests: task with timed Do, task without,
   untimed completion, unlinked Do, two sessions, a Do crossing midnight,
   another member's Do, a record for a deleted task, flag off. No UI change.
2. **DAY, MULTI and WEEK**, timed and all-day, with the striped read-only
   Do card, WEEK's popover, JOBO's opt-out, and the striped fill on JOBO's
   recorded Do.
3. **MONTH cells**, bars following the Do.
4. The NOW-line split within today: see the addendum.

## Addendum: today, split at the NOW line

Step 4 of the build order. Since 5.5.0 a past day shows what was done, but
today shows only the plan until midnight, so a morning's recorded work
appears in DAY, MULTI, WEEK and MONTH only tomorrow. This addendum brings
the rule into today, at the NOW line.

### The rule, today and on past days

Lcub3d's point on #1726: if an hour was planned and only half of it done,
the plan should not vanish, or what still needs doing is easy to overlook.
So a plan block gives way to its Do only when the task is finished:

1. **A completed task with timed Do on the date shows its Do instead of its
   plan block, once the block has ended.** On a past day every block has
   ended; today, a block has ended when its planned end is at or before
   now.
2. **A task not completed keeps its plan block, with its Do beside it.**
   Half an hour done of an hour planned shows both: the striped Do where
   the work happened and the block that is still owed, until the task is
   finished, moved or continued. On a past day this is a task left behind
   unfinished, still asking for a decision, which the Check offers
   (Continue). This changes what 5.5.0 shows on past days, where such a
   task showed only its Do.
3. **A block not yet ended stays**, under way or still to come, completed
   or not; its Do recorded today are drawn too. A task worked on this
   morning and planned again for this afternoon shows both. Where a Do
   overlaps a block still under way (worked 09:10 to 10:00 on a task
   planned 09:00 to 11:00, seen at 10:30), the two sit side by side, as
   overlapping tasks do. This is the task's real block, not the plan
   outline slice 6 decided against.
4. **A task with no Do shows as planned**, ended or not. A plan that ended
   untouched stays where it was, which is also where the Check lists it
   under Not started.
5. **Unlinked Do, and Do whose task is gone**, are drawn as before, in the
   neutral colour.
6. **Only measured facts leave JOBO**, as before: timed Do only, never an
   estimate or a comparison.
7. **A block that ran past midnight gives way on both dates** (#2278). Its
   piece after midnight is carried from its start date as that date is
   shown (`utils/continuations.js`, `continuationsForDate`), so where the
   block gave way to its Do, the next date draws the Do's own slice from
   00:00 and no plan piece; an unfinished task's piece still carries. JOBO's
   Plan side carries the plan as it stood.

It is the task's own state that decides, not the Do's progress, as in the
Check: a task whose last session was Partial but which was checked off
later is finished.

All-day tasks have no planned end before midnight, so on today they keep
their place in the all-day row, and any timed Do recorded against them is
drawn in the timeline. On a past day they follow the rule above.

### Why per task, not a cut at NOW

Cutting every plan block at NOW would draw a block that no longer matches
its task: a card from 09:00 to 10:30 for a task planned until 11:00, which
moves wrongly when dragged and hides the planned end. It would also erase
the morning's untouched plans, which are exactly what the Check asks about.
Keying on each block's own end keeps every drawn plan block a real,
editable task, and only ever takes one away when the planned time is over,
the task is done, and the Do says what happened instead.

### What moves while you watch

The split follows the clock, so a view open on today changes as plan
blocks end: at 11:00 a completed task planned until then, with Do
recorded, swaps its plan block for its Do cards. Checking off a task whose
block has already ended swaps it at once. Nothing else moves.

- **It changes only when a swap happens.** The app's clock ticks every 15
  seconds, but the views read today through a set: the completed tasks
  with Do today whose plan block has ended. That set changes only at a
  block's end or a completion, so a view, and MONTH's 42 memoized cells,
  recompute only then, not on every tick.
- **A card being dragged or resized is never taken away mid-gesture.** The
  set is held while a drag or resize is in progress, and catches up when
  the gesture ends.
- **A Do recorded into the future**, by hand, is drawn as recorded. Timed Do
  always have both ends, so there is no running Do to draw up to NOW.

### Where it lives

`pastDayDisplay` returns today's tasks unchanged at present. For today it
will apply the same `pastDayItems` with one change: a task's plan block is
replaced only if the task is in the set of ended tasks above, which
`getDayDisplayForDate` derives from the current minute. `pastDayItems`
itself changes for every date: a task's block is replaced only if the task
is completed, so past days follow the same rule. The index,
the striped read-only Do card, the views that take it and the views that
do not (JOBO's own Plan side, SCHED, MONTH's day sheet, mobile) are all as
in slice 6. No task field is added and nothing is written.

### Decisions to confirm

1. **Split per task, at the end of each plan block**, not by cutting at
   NOW, and only for a completed task.
2. **An unfinished task keeps its plan block** beside its Do, today and on
   past days (a change to past days as 5.5.0 shows them).
3. **A plan that ended with no Do stays drawn**, as on a past day.
4. **All-day tasks keep their row today.**
5. **The swap happens live**, when a block ends, never under a drag.

### Build order

1. **The rule, with tests:** each case above, completed and not, on today
   and on a past day, the boundary at exactly NOW, a completion after the
   block's end, an all-day task, a recurring occurrence, a Do crossing
   midnight from yesterday, and the flag off.
2. **The views:** the ended set through `getDayDisplayForDate`, the
   gesture guard, and a browser check of DAY, MULTI, WEEK and MONTH on a
   seeded today, before and after a plan block ends, including that the
   views do not recompute between swaps.
