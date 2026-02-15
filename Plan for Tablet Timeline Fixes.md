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

### Issues 6, 7 & 8: Routine pills missing touch drag handlers on tablet
**Current locations:** `App.jsx` — timeline routine pills (~line 15318), all-day routine pills (~line 14647).
**Problem:** Routine pills on tablet have `draggable` + HTML5 drag handlers (desktop-only). They work on desktop but have no touch drag handlers for tablet. Timeline routine pills also have a touch *resize* handle but no touch *drag* handlers. On mobile, routine pills use touch handlers directly on the pill itself (~lines 9613 and 10075) — the entire pill is the touch target, with `handleMobileTaskTouchStart` initiating a long-press drag. No separate visible drag tab is needed since the pills are small enough to act as their own handle.
**Fix:** Add `onTouchStart`/`onTouchMove`/`onTouchEnd` handlers directly on the tablet routine pill divs (matching mobile), with `isRoutineDrag: true`. No visual changes needed.

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

### Issue 14: Dead inline editing infrastructure on tablet
**Current locations:** `App.jsx` — `editingTaskId === task.id` branches inside tablet timeline task layouts (micro-narrow ~line 15006, micro-wide ~line 15091, narrow ~line 15155). These render `<input>` fields for inline title editing.
**Problem:** Once `onDoubleClick` is removed from tablet (Issues 2 & 3), there is no way to trigger inline editing on tablet — the `editingTaskId` will never be set to a timeline task's ID via touch. These code branches become dead code on tablet. Mobile timeline tasks don't have these inline editing branches at all.
**Fix:** Wrap the `editingTaskId === task.id` ternary branches (the `<input>` rendering) in `!isTablet` checks, or restructure to skip the editing branch entirely on tablet. This keeps the code clean and avoids rendering unreachable UI.

---

## Out of Scope (Noted but not planned)

- **Sidebar inbox/overdue/recycle bin touch drag** (original Issue 12): These sidebar tasks (~lines 13183, 13660, 14102) still have `draggable` with mouse-based drag handlers and no touch handlers. This is a larger feature beyond "timeline" behavior. Deferred.
- **Inline editing on all-day tasks**: All-day tasks also have `editingTaskId` branches, but these are shared with desktop and less clearly "dead code" on tablet since all-day tasks have a simpler structure. Cleanup there can be done in a follow-up if desired.

---

## Implementation Order

1. **Issues 2 & 3** — Remove `onDoubleClick` + `cursor-text` on tablet (timeline + all-day)
2. **Issue 14** — Clean up dead inline editing branches on tablet timeline tasks
3. **Issues 9 & 10** — Add `select-none` on tablet (timeline + all-day)
4. **Issue 11** — Replace `cursor-move` with `cursor-default` on tablet
5. **Issues 6, 7 & 8** — Add touch drag handlers to routine pills on tablet (timeline + all-day)
6. Build verification + commit
