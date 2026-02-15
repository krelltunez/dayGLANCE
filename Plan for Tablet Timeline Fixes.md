# Plan: Make Tablet Timeline Behave Like Mobile Timeline

## Summary

The tablet timeline lives inside the desktop rendering branch and inherits some desktop-only interaction patterns that don't make sense on a touch device. This plan identifies remaining inconsistencies between tablet and mobile timeline behavior and proposes fixes.

**Note:** The drag-and-drop overhaul (branches `mobile-tablet-drag-drop` and `add-daily-notes-feature`) resolved several of the original issues. See "Already Resolved" below.

---

## Already Resolved

### ~~Issue 1: Resize handles on timeline tasks~~ (DONE)
Resolved by adding touch-based resize (`handleTouchResizeStart` / `handleTouchRoutineResizeStart`) to both mobile and tablet. The desktop `onMouseDown` handle remains for mouse users. Tablet and mobile now both have white-bar touch resize handles.

### ~~Issues 4, 5, 13: `draggable` on timeline tasks, all-day tasks, and deadline tasks~~ (DONE)
Resolved with a different approach than originally planned. Instead of disabling `draggable` on tablet, protruding drag tabs (`data-drag-handle` + `GripVertical` icon) were added. Tablet tasks now have dedicated touch handlers (`handleMobileTaskTouchStart/Move/End`) on the drag tabs. The `draggable` HTML attribute and `onDragStart`/`onDragEnd` handlers remain for desktop mouse drag, which is fine — the two don't conflict because touch events go through the drag tab, not the HTML5 DnD API.

---

## Outstanding Issues & Proposed Fixes

### Issue 2: Double-click to edit title/tags on timeline tasks
**Current locations:** `App.jsx` — four `onDoubleClick` handlers on tablet timeline task title text (in micro-narrow, micro-wide, narrow, and wide layout branches, approximately lines 14975, 15035, 15120, 15184).
**Problem:** Double-click is a mouse-only interaction; on touch devices it causes awkward text selection and accidental edits. Mobile has no `onDoubleClick` at all — it uses the swipe-to-edit flow instead. Also, `cursor-text` is applied to these title divs on tablet.
**Fix:** Wrap all four `onDoubleClick` handlers in `!isTablet` checks. Also change `cursor-text` to not apply on tablet.

### Issue 3: Double-click to edit title on all-day tasks
**Current location:** `App.jsx` — `onDoubleClick` on the all-day task title div (approximately line 14438).
**Problem:** Same as Issue 2 but for all-day tasks. The title div has `onDoubleClick` and `cursor-text`.
**Fix:** Wrap `onDoubleClick` in `!isTablet` check and remove `cursor-text` on tablet.

### Issue 6: `draggable` on tablet timeline routine pills (no touch drag)
**Current location:** `App.jsx` — timeline routine pills (approximately line 15318).
**Problem:** Timeline routine pills have unconditional `draggable` + `onDragStart`/`onDragEnd`/`onDragOver`/`onDrop`. These are desktop-only HTML5 DnD APIs. On mobile, routine pills use touch handlers (`handleMobileTaskTouchStart/Move/End` with `isRoutineDrag: true`). Tablet timeline routine pills have a touch *resize* handle but **no touch drag handlers** — meaning you can resize them via touch but can't drag-reposition them.
**Fix:** Add touch drag handlers to tablet timeline routine pills (matching mobile at ~line 10075), and optionally guard `draggable` with `!isTablet`.

### Issue 7: `draggable` on tablet all-day routine pills (no touch drag)
**Current location:** `App.jsx` — all-day routine pills (approximately line 14647).
**Problem:** All-day routine pills have unconditional `draggable` + `onDragStart`/`onDragEnd`, with no touch handler equivalent. On mobile, all-day routine pills have touch drag handlers (~line 9613).
**Fix:** Add touch drag handlers (`handleMobileTaskTouchStart/Move/End` with `isRoutineDrag: true`) and optionally guard `draggable` with `!isTablet`.

### Issue 8: Missing touch drag handlers on tablet timeline routine pills
**Note:** This is the same underlying problem as Issue 6 — listed separately in the original plan but they share a single fix. See Issue 6.

### Issue 9: Missing `select-none` on tablet timeline tasks
**Current location:** `App.jsx` — the tablet timeline task content/swipe div (approximately line 14929).
**Problem:** The div does not have `select-none`. Mobile timeline tasks (~line 9855) have `select-none` to prevent text selection during touch interactions.
**Fix:** Add `select-none` to the tablet timeline task content wrapper className.

### Issue 10: Missing `select-none` on tablet all-day tasks
**Current location:** `App.jsx` — the tablet all-day task div (approximately line 14415).
**Problem:** Lacks `select-none`. Mobile all-day tasks (~line 9429) have `select-none`.
**Fix:** Add `select-none` to the className on tablet.

### Issue 11: `cursor-move` on tablet tasks
**Current locations:** `App.jsx` — tablet timeline tasks (~line 14868) and all-day tasks (~line 14415).
**Problem:** Tablet tasks show `cursor-move` which is a desktop cursor style. With the new drag-tab approach, dragging is initiated from the protruding tab, not the task body — so `cursor-move` on the task body is misleading. Mobile tasks have no `cursor-move`.
**Fix:** Use `cursor-default` instead of `cursor-move` on tablet for both timeline and all-day tasks.

---

## Out of Scope (Noted but not planned)

- **Sidebar inbox/overdue/recycle bin touch drag** (original Issue 12): These sidebar tasks (~lines 13183, 13660, 14102) still have `draggable` with mouse-based drag handlers and no touch handlers. This is a larger feature beyond "timeline" behavior. Deferred.
- **Inline editing infrastructure**: The code has `editingTaskId` checks and input fields for inline editing inside timeline tasks. On mobile these are never triggered (no `onDoubleClick`). On tablet, removing `onDoubleClick` means these editing input branches become dead code on tablet. They can be left as-is (they won't trigger) or cleaned up in a follow-up.

---

## Implementation Order

1. **Issues 2 & 3** — Remove `onDoubleClick` + `cursor-text` on tablet (timeline + all-day)
2. **Issues 9 & 10** — Add `select-none` on tablet (timeline + all-day)
3. **Issue 11** — Replace `cursor-move` with `cursor-default` on tablet
4. **Issues 6, 7 & 8** — Add touch drag handlers to routine pills on tablet (timeline + all-day), optionally guard `draggable` with `!isTablet`
5. Build verification + commit
