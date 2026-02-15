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

## Proposed Solution: `touchAction: 'none'` + Programmatic Vertical Scrolling

Set `touchAction: 'none'` on all draggable/swipeable task elements so the browser never claims the touch. Then implement programmatic scrolling in the vertical swipe code path so users can still scroll through large tasks.

This gives JS full control over touch handling, enabling both features simultaneously.

### Changes

#### 1. Add a `swipeLastTouchY` ref (~line 1095, near existing swipe refs)
Tracks the last Y position for computing scroll deltas frame-by-frame.

```js
const swipeLastTouchY = useRef(0);
```

#### 2. Initialize the ref in `handleMobileTaskTouchStart` (~line 5797)
Record the initial Y alongside the existing X/Y recording:

```js
swipeLastTouchY.current = touch.clientY;
```

#### 3. Implement programmatic scrolling in `handleMobileTaskTouchMove` (~line 5876)
Currently, when vertical swipe is detected, the handler just `return`s (relying on `pan-y` for native scroll). Change this to programmatically scroll the calendar:

```js
if (swipeIsVertical.current) {
  const currentY = touch.clientY;
  const deltaY = swipeLastTouchY.current - currentY; // positive = finger up = scroll down
  if (calendarRef.current) {
    calendarRef.current.scrollTop += deltaY;
  }
  swipeLastTouchY.current = currentY;
  return;
}
```

Also sync `swipeLastTouchY` when direction is first locked to vertical, so the first scroll frame uses a correct delta:

```js
if (absDy > absDx) {
  swipeIsVertical.current = true;
  swipeLocked.current = true;
  swipeLastTouchY.current = touch.clientY; // sync for programmatic scroll start
  return;
}
```

#### 4. Change `touchAction` from `'pan-y'` to `'none'` on all swipeable task elements
This is the key change — the browser will no longer claim touches on tasks for scrolling or pull-to-refresh. Affects these locations:

| Location | Element | Current | New |
|----------|---------|---------|-----|
| ~line 9066 | Mobile all-day task | `pan-y` | `none` |
| ~line 9152 | Mobile deadline task | `pan-y` | `none` |
| ~line 9213 | Mobile routine tag | `pan-y` | `none` |
| ~line 9439 | Mobile timeline task | `pan-y` | `none` |
| ~line 9633 | Mobile timeline routine | `pan-y` | `none` |
| ~line 13943 | Tablet all-day task | `pan-y` | `none` |
| ~line 14048 | Tablet deadline task | `pan-y` | `none` |
| ~line 14377 | Tablet timeline routine | `pan-y` | `none` |
| ~line 14408 | Tablet timeline task | `pan-y` | `none` |

### Why This Works

- **`touchAction: 'none'`** — Browser completely hands off touch handling to JS. No pull-to-refresh, no native scroll from touches on task elements. (Scrolling from empty timeline areas still works normally.)
- **Programmatic scroll** — When the user swipes vertically on a task (not a long-press drag), JS manually adjusts `calendarRef.scrollTop` by the finger's Y delta each frame, replicating native scroll feel.
- **Long-press drag** — Works because the browser never steals the gesture. The 500ms timer completes, drag activates, existing drag logic handles movement.
- **Horizontal swipe** — Unchanged; already handled with `translateX` and `preventDefault`.

### What This Does NOT Change
- Horizontal swipe gestures (already handled, unaffected)
- Desktop drag-and-drop (uses mouse events, unaffected)
- The non-passive touchmove listener registered during active drag (still needed)
- `overscroll-behavior: contain` on body (stays as defense-in-depth)
- Scrolling from touches on empty timeline areas (those don't have `touchAction: none`)

### Potential Concern: Scroll Smoothness
Programmatic scrolling via `scrollTop += delta` runs on each touchmove event (~60fps), which should feel responsive. It won't have iOS's rubber-band overscroll or momentum/inertial scrolling. For task elements (which are the minority of the scroll surface), this is an acceptable trade-off since the primary scrolling surface (empty timeline) retains fully native behavior.
