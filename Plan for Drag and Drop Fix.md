# Plan: Fix Mobile/Tablet Drag-and-Drop (Pull-to-Refresh Interference)

## Problem Analysis

The core tension is between two competing needs on task elements:

1. **Drag-and-drop** (long-press then move): Requires the browser to NOT claim the touch for scrolling, so JS can handle it
2. **Scrolling past large tasks**: When a task covers the entire visible timeline, the user needs to be able to scroll through it

Currently, task elements have `touchAction: 'pan-y'`, which tells the browser to handle vertical scrolling natively. This means:
- When the user puts a finger on a task and drags downward, the browser immediately claims the touch for native scrolling
- If the calendar is already at the top of its scroll, the browser interprets this as pull-to-refresh / overscroll
- The 500ms long-press timer gets cancelled because finger movement >10px triggers cancellation
- Net result: can't initiate a downward drag without first going up (to avoid the pull-to-refresh direction)

The prior workaround (`touchAction: 'none'`) fixed drag but broke scrolling through large tasks. The revert to `pan-y` (to allow native scrolling) reintroduced the drag issue.

---

## ~~Alternative 1: `touchAction: 'none'` + Programmatic Vertical Scrolling~~

~~Set `touchAction: 'none'` on all draggable/swipeable task elements so the browser never claims the touch. Then implement programmatic scrolling in the vertical swipe code path.~~

**Rejected** — Programmatic scrolling can't match native scroll feel (no momentum, no rubber-band, no overscroll). Every touch on a task element would feel "off" compared to native scrolling on empty areas.

---

## Proposed Solution: Drag Handles

Instead of fighting the browser's scroll behavior, **add dedicated drag-handle grip zones** to task elements. Only the grip zone has `touchAction: 'none'` — the rest of the card retains `touchAction: 'pan-y'` for fully native scrolling.

This cleanly separates the two gestures: grip = drag, everything else = scroll/swipe.

### Design: Where Drag Handles Go

**Card-style elements** (all-day tasks, deadline tasks, timeline tasks):
- A narrow `GripVertical` icon (16px) inserted as the **leftmost element** in the flex row, before the checkbox
- The grip has generous touch padding (min 40px touch target via padding) for reliable finger targeting
- `touchAction: 'none'` on the grip element only
- Card body keeps `touchAction: 'pan-y'`

**Routine pills** (small `rounded-full` tags):
- Too small for a dedicated grip area
- The **entire pill** gets `touchAction: 'none'` since its only interactive purpose is dragging
- Users scroll by touching surrounding empty space

**Timeline routines** (cross-hair positioned elements):
- Same as routine pills — the **entire element** keeps its existing behavior
- Set `touchAction: 'none'` on the pill itself

### Implementation

#### 1. Gate long-press timer on drag handle in `handleMobileTaskTouchStart` (~line 5793)

Add a check at the start of the long-press timer logic: only start the timer if the touch originated from an element with `data-drag-handle` (or if the task is a routine):

```js
const isFromDragHandle = e.target.closest('[data-drag-handle]');
const isRoutine = task.isRoutineDrag;

if ((taskType === 'timeline' || taskType === 'allday' || taskType === 'deadline')
    && !task.imported && (isFromDragHandle || isRoutine)) {
  // ... existing long-press timer logic
}
```

This means touches on the card body still trigger swipe detection (horizontal swipe-to-postpone) but never start a drag.

#### 2. Add drag handle to each card-style element

Insert a grip icon before the checkbox in each element's flex row:

```jsx
{/* Drag handle */}
<div data-drag-handle style={{ touchAction: 'none' }}
  className="flex items-center justify-center flex-shrink-0 opacity-40 -ml-1 cursor-grab active:opacity-70">
  <GripVertical size={16} />
</div>
```

Applies to these elements (9 locations):

| Location | Element | Grip Placement |
|----------|---------|---------------|
| ~line 9075 | Mobile all-day task | Before checkbox in flex row |
| ~line 9161 | Mobile deadline task | Before checkbox in flex row |
| ~line 9467 | Mobile timeline task (normal height) | Before checkbox in flex row |
| ~line 9467 | Mobile timeline task (micro height) | Before checkbox in flex row (smaller icon) |
| ~line 13980 | Tablet all-day task | Before checkbox in flex row |
| ~line 14085 | Tablet deadline task | Before checkbox in flex row |
| ~line 14452 | Tablet timeline task (normal height) | Before checkbox in flex row |
| ~line 14452 | Tablet timeline task (micro height) | Before checkbox (smaller icon) |

#### 3. Set `touchAction: 'none'` on routine pills

For routine pills (no grip icon — the whole pill is the drag target):

| Location | Element | Change |
|----------|---------|--------|
| ~line 9241 | Mobile all-day routine pill | `touchAction: 'pan-y'` → `'none'` |
| ~line 9661 | Mobile timeline routine | `touchAction: 'pan-y'` → `'none'` |

Tablet timeline routines already have `touchAction` set conditionally; same change.

#### 4. Keep `touchAction: 'pan-y'` on card bodies (no change)

The card divs that currently have `touchAction: 'pan-y'` **keep it** — this is what enables native scrolling. The grip element's `touchAction: 'none'` (set inline via `style`) overrides the parent's `pan-y` for touches that start on the grip.

### Why This Works

- **Grip zone (`touchAction: 'none'`)** — Browser hands off touch to JS. Long-press timer fires, drag activates. No pull-to-refresh.
- **Card body (`touchAction: 'pan-y'`)** — Browser handles vertical scroll natively. Full momentum, rubber-band, overscroll. Horizontal swipe still handled by JS.
- **No programmatic scrolling needed** — The browser does all scrolling natively for non-grip touches. No degraded scroll feel.
- **Routine pills (`touchAction: 'none'`)** — Entire pill is drag target. These are small inline elements; users scroll via surrounding whitespace.

### What This Does NOT Change
- Horizontal swipe gestures (still work from card body)
- Desktop drag-and-drop (uses mouse events + HTML5 `draggable`, unaffected)
- The non-passive touchmove listener during active drag (still needed)
- `overscroll-behavior: contain` on body (stays as defense-in-depth)
- Scrolling from touches on empty timeline areas (always native)

### Trade-offs
- **Visual change**: A small grip icon appears on each task card — adds ~16px of width
- **Discoverability**: Users need to know to use the grip for dragging (but grip icons are a widely understood pattern)
- **Micro-height timeline tasks**: Space is tight; grip icon must be small (12px) but still usable
