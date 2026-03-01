# Implementation Plan: Right-Click Context Menus

## Overview

Extend right-click context menu support across the app: add menus on tasks and
empty timeline areas, disable the browser default menu on unusable space, and
introduce single-day (non-recurring) "impromptu" Frames that can be created by
right-clicking an empty spot on the timeline.

---

## Part 1 — Right-click menus on tasks

### 1a. New state: `taskContextMenu`

Add state alongside the existing `frameContextMenu`:

```js
const [taskContextMenu, setTaskContextMenu] = useState(null);
// Shape: { x, y, taskId, isRecurring, isImported, isAllDay, dateStr }
```

Close it on Escape (add to the existing Escape handler chain around line 5769)
and on outside click (backdrop div, same pattern as `frameContextMenu`).

### 1b. Attach `onContextMenu` to every task element on the timeline

For each of the three layouts (mobile ~12431, tablet, desktop ~18431), wrap the
task div's existing handlers with:

```js
onContextMenu={(e) => {
  e.preventDefault();
  setTaskContextMenu({
    x: e.clientX, y: e.clientY,
    taskId: task.id,
    isRecurring: !!task.recurringConfigId,
    isImported: !!task.isImported,
    isAllDay: !!task.allDay,
    dateStr,
  });
}}
```

### 1c. Render the task context menu (near line 23099, next to the Frame menu)

Build the menu items from the existing action functions (they already exist and
are well-tested):

| Menu item | Condition | Action |
|-----------|-----------|--------|
| Edit | `!isImported` | `openMobileEditTask(task, false)` |
| Notes / subtasks | always | open notes panel |
| Move to tomorrow | `!isRecurring && !isImported` | `postponeTask(taskId)` |
| Move to inbox | `!isRecurring && !isImported && !isAllDay` | `moveToInbox(taskId)` |
| Complete / Uncomplete | `!isImported` | `toggleComplete(taskId)` |
| Delete | any | `moveToRecycleBin(taskId)` |

Each button reuses the existing handler, then calls
`setTaskContextMenu(null)`.

### 1d. Also attach to Glance-panel task rows

In each of the three Glance layouts (mobile ~13197, tablet ~16232,
desktop ~17112), add the same `onContextMenu` handler to each task row div.
This lets users right-click a task in the Glance list and get the same menu
without having to scroll to the timeline first.

---

## Part 2 — Disable right-click on blank/unusable space

### 2a. App-level default prevention

Add a single handler on the outermost app container (`<div id="app-root">`
or equivalent top-level wrapper):

```js
onContextMenu={(e) => {
  // Allow only elements that explicitly set data-ctx-menu
  if (!e.target.closest('[data-ctx-menu]')) {
    e.preventDefault();
  }
}}
```

### 2b. Mark interactive elements

Add `data-ctx-menu` attribute to elements that should allow right-click
menus:

- Frame blocks on the timeline (already have `onContextMenu`)
- Task elements on the timeline
- Task rows in the Glance panel
- Habit rings (already have `onContextMenu`)
- Empty timeline background (Part 3 below)
- Text inputs / textareas (so the browser's native Copy/Paste menu still works)

This approach is a whitelist: everything else (sidebar chrome, tab bar, header,
bottom nav, modals' non-interactive areas, etc.) silently swallows the
right-click.

### 2c. Inputs / textareas

Make sure `<input>`, `<textarea>`, and `[contenteditable]` elements are
**not** blocked. The simplest way is to check `e.target.tagName` in the
top-level handler:

```js
if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
    || e.target.isContentEditable) {
  return; // allow native browser context menu
}
```

---

## Part 3 — Right-click empty timeline area to "Add a Frame"

### 3a. New state: `timelineContextMenu`

```js
const [timelineContextMenu, setTimelineContextMenu] = useState(null);
// Shape: { x, y, dateStr, timeMinutes }
```

`timeMinutes` is the minute-of-day derived from the click's Y position on the
timeline grid (same math used by the existing drag-to-create-task feature:
`positionToMinutes()`). Snap to 15-minute intervals.

### 3b. Attach `onContextMenu` to the timeline background

The timeline background div (the click-away area behind tasks and frames) is
the target. In each layout:

- Mobile/tablet: around line 12343 (the day-grid container)
- Desktop: around line 18213

```js
onContextMenu={(e) => {
  // Only fire on the background itself, not on task/frame children
  if (e.target !== e.currentTarget) return;
  e.preventDefault();
  const rect = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - rect.top + e.currentTarget.scrollTop;
  const minutes = Math.round(positionToMinutes(y) / 15) * 15;
  setTimelineContextMenu({ x: e.clientX, y: e.clientY, dateStr, timeMinutes: minutes });
}}
```

Mark these elements with `data-ctx-menu` so Part 2's blanket handler allows
them through.

### 3c. Render the timeline context menu

A small popup at `(x, y)` with one item:

```
+  Add a Frame (HH:MM – HH:MM)
```

The default time range is `timeMinutes` to `timeMinutes + 60` (1-hour block),
clamped to `[0, 1440]`. Show the formatted range in the label so the user
knows what they're creating.

On click, this opens a **simplified Frame creation modal** (see 3e).

### 3d. Extend the Frame data model for single-day Frames

Add one new optional property to the Frame object:

```js
{
  ...existingProperties,
  singleDate: '2026-03-02'   // YYYY-MM-DD string, or undefined for recurring
}
```

When `singleDate` is set:
- The `days` array is **ignored** (can be set to `[]` or the day-of-week of `singleDate` for consistency).
- `getFrameInstancesForDate()` (~line 11179) only returns this frame when
  `dateStr === frame.singleDate`.
- The FrameEditor shows a date indicator ("March 2, 2026 only") instead of the
  day-of-week picker.
- The Frames management list groups single-day frames separately, or shows a
  badge like "one-time" next to the label.

### 3e. Simplified "quick-add" Frame modal

Rather than opening the full FrameEditor, show a compact modal pre-filled with:

| Field | Pre-filled value |
|-------|-----------------|
| Label | empty (auto-focus) |
| Date | the right-clicked date (read-only display) |
| Start | `timeMinutes` (editable time input) |
| End | `timeMinutes + 60` (editable time input) |
| Color | first available from `FRAME_COLORS` not already used on that date |
| Energy | `medium` (default) |
| Buffer | `5` min (default) |
| Tag affinity | empty |

A "Save" button calls the existing `saveFrame()` with the `singleDate` field
set. The modal validates that:
- Label is non-empty.
- Start < End.
- No overlap with existing frames on that date (reuse FrameEditor's conflict
  check logic).

### 3f. Update `getFrameInstancesForDate()` (line 11179)

Current logic:
```js
.filter(f => f.enabled && f.days.includes(dayOfWeek))
```

New logic:
```js
.filter(f => {
  if (!f.enabled) return false;
  if (f.singleDate) return f.singleDate === dateStr;
  return f.days.includes(dayOfWeek);
})
```

### 3g. Update cloud sync & persistence

No schema migration needed — `singleDate` is just a new optional field.
Existing frames without it continue to work as recurring. The
`localStorage` persistence and cloud sync code already serializes the full
frame object, so this is automatically handled.

### 3h. FrameEditor: handle single-day frames gracefully

When `editingFrame.singleDate` is set:
- Replace the 7-day picker row with a static display: "Scheduled for [date]"
  with a small "Make recurring" link that clears `singleDate` and enables the
  day picker.
- Keep all other fields (color, energy, buffer, tags) editable as normal.

### 3i. Cleanup of expired single-day Frames

Add a cleanup step (in the same `useEffect` that runs on app start or date
change) that removes single-day frames whose `singleDate` is more than 7 days
in the past. This prevents clutter without losing frames the user might still
want to review.

---

## Implementation order

1. **Part 2** first (disable default right-click) — it's the foundation and
   prevents the browser menu from interfering while testing Parts 1 and 3.
2. **Part 1** (task context menus) — uses the existing action functions, low
   risk.
3. **Part 3** (Add a Frame on empty timeline) — the most complex piece; builds
   on the `data-ctx-menu` whitelist from Part 2.

---

## Files modified

Only `src/App.jsx` — the app is a single-file architecture.

## Testing notes

- Verify right-click on a scheduled task shows the menu with correct items.
- Verify right-click on a recurring task hides "Move to tomorrow" / "Move to
  inbox".
- Verify right-click on imported calendar events hides edit/reschedule options.
- Verify right-click on blank sidebar / tab bar / header shows nothing (no
  browser menu, no custom menu).
- Verify right-click on text inputs still shows the browser's native
  Copy/Paste menu.
- Verify right-click on empty timeline opens the "Add a Frame" option with
  correct snapped time.
- Verify creating a single-day Frame from the context menu works and the frame
  appears on the timeline.
- Verify single-day Frames do NOT appear on other dates.
- Verify single-day Frames can be edited, skipped, adjusted, and deleted like
  recurring frames.
- Verify the cleanup removes old single-day frames after 7 days.
- Build passes (`npx vite build`).
