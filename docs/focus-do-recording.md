# Focus work in the JOBO ledger

With JOBO enabled, Focus records real work intervals as ordinary `source: 'focus'`
Do rows. Work closes on pause, phase end, skip, and exit. Resuming opens a new
segment; breaks and the settlement dialog never count as work. Notification,
widget, tray, and Stream Deck commands use the same timer/exit boundaries.
A tray settlement brings the existing main-window Focus dialog forward.

At a work phase boundary or early exit, a single captured task is selected
automatically. A multi-task block asks for one task, with the first selected.
The entire phase belongs to that task; segments are not divided across tasks.
The task title and timed plan are captured before work starts, and the next
work phase captures the then-current task state. There is no extra task picker
at session start. Deleted tasks retain their captured history but are not
recreated by the completion action. When a recurring task has no timed plan
(for example, it became all-day before the next phase), existing JOBO rules
keep its Focus rows independent: the template link alone cannot resolve an
occurrence or join its execution/notes. Its measured minutes still count, and
native completion still targets the captured occurrence action id.

“Still in progress” saves partial timed Do rows and leaves task completion alone.
“Task completed” saves those rows first, then calls the normal Focus completion
handler. Its existing completion detector independently emits an untimed
completion row. The existing task + captured-plan execution grouping and core
mixed timed/untimed comparison rules remain in force: measured minutes, gaps,
overlaps, and completion are retained, but the mixed execution is not wholly
comparable to Plan. Existing manual records are not removed or rewritten;
overlapping intervals still count only once in the day-time union.

## Minute precision

Do retains its existing civil `HH:mm` coordinates. Capture uses event instants
internally, but does **not** persist seconds or add a new sync schema. Each
uninterrupted segment rounds its start and end independently to the nearest
minute; a boundary exactly halfway rounds forward. Equal rounded endpoints
produce no timed Do row. For example, 09:00:20–09:01:40 becomes 09:00–09:02,
while 09:00:40–09:01:20 makes no row. Even a very short segment spanning a
half-minute boundary can produce a minute (09:00:29–09:00:31 becomes 09:00–09:01).

With an unchanged civil clock and time zone, rounding preserves boundary order:
segments either side of a pause may touch, but do not overlap. It does not preserve exact elapsed seconds. Each segment’s
duration can differ from captured work by up to a minute, and differences can
accumulate across segments. Two separate 62-second segments, each starting at
:29 and ending at :31 in the following minute, total 124 seconds but yield four
Do minutes. Settlement shows the minute total and whether it is higher or lower
than captured work, with the difference rounded up to a whole second. The
existing Focus counters and log do not use these rounded Do totals.

A clock/time-zone change that cannot be represented safely is reported instead
of inventing a civil interval. Dates are taken from the rounded boundaries, so
cross-midnight intervals retain an explicit end date, including when rounding
an end at 23:59:40 to the following day’s 00:00.

## Writes and recovery

Only `useJoboLedger.recordJobo` writes records. Segment identities and event
stamps are stable across repeated commands and write retries. A record already
present under an identity, including an edit or tombstone, is never recreated.
Retries cannot change task attribution after the first write attempt.

An unloaded or read-only ledger refuses the write. A failed write keeps the
settlement open and does not complete the task. If the ledger holds a failed
write for its own in-memory retry, the dialog says it has not reached storage;
continuing without waiting does not cancel that ledger retry or guarantee a
save. There is no new persistent pending queue. Closing/reloading the app can
lose an unfinished capture or an unsaved held write.

JOBO off does not collect or retrospectively import Focus work. The existing
`focusMinutes` counters and `day-planner-focus-log` remain independent of Do;
the legacy session log is wall time, not the new work-only ledger measurement.
The original phase boundary still credits its equal task split and cycle before
Do settlement. Skip retains its original cycle behavior without adding legacy
work minutes. An explicit Exit/Stop freezes its old accounting boundary so
waiting for Do storage cannot extend that exit’s log or change its recipients.
A review followed by continued work remains inside the legacy wall-time session.

## Verification

The focused suites cover raw lifecycle capture, minute conversion, ledger
identity/retry behavior, React timer command boundaries (including Android
notification polling), task completion handlers, and settlement rendering:

```sh
npm test -- --run src/jobo/focusCapture.test.js src/jobo/focusRecords.test.js \
  src/jobo/focusSession.test.js src/jobo/focusRounding.test.js \
  src/jobo/focusLegacyBoundary.test.js src/hooks/useFocusMode.test.js \
  src/hooks/useTaskActions.focus.test.js src/components/FocusDoReview.test.jsx
```

Before release, exercise the dialog on desktop and narrow screens, plus real
Android/iOS notification/widget and Electron tray/Stream Deck entry points.
Include paused exit, phase skip, task changes during work, short segments,
repeat clicks, read-only storage, failed-write retry, and JOBO off.
