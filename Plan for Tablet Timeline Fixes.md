# Plan: Make Tablet Timeline Behave Like Mobile Timeline

## Summary

The tablet timeline currently lives inside the desktop rendering branch and inherits many desktop-only interaction patterns that don't make sense on a touch device. This plan identifies all inconsistencies between tablet and mobile timeline behavior and proposes fixes.

---

## Issues & Proposed Fixes

### Issue 1: Resize handles on timeline tasks (user-reported)
**Location:** `App.jsx:14737-14746`
**Problem:** Timeline tasks on tablet show a mouse-based drag resize handle at the bottom (`onMouseDown → handleResizeStart`, `cursor-ns-resize`). This is a desktop interaction — mobile has no resize handle at all.
**Fix:** Wrap the resize handle in `!isTablet && (...)` so it only appears on desktop, matching mobile behavior. (Tablet already has the swipe-to-edit flow and the edit modal for changing duration.)

### Issue 2: Double-click to edit title/tags (user-reported)
**Location:** `App.jsx:14496-14501`, `14556-14561`, `14641-14646`, `14705-14710`
**Problem:** Four separate `onDoubleClick` handlers on task title text allow inline editing on tablet. Double-click is a mouse-only interaction; on touch devices it causes awkward text selection and accidental edits. Mobile has no `onDoubleClick` at all — it uses the swipe-to-edit flow instead.
**Fix:** Wrap all four `onDoubleClick` handlers in `!isTablet` checks. Also remove the `cursor-text` class on tablet (lines 14495, 14555, 14640, 14704).

### Issue 3: Double-click to edit title on all-day tasks
**Location:** `App.jsx:14002-14007`
**Problem:** Same as Issue 2 but for all-day tasks in the desktop/tablet view. The title div has `onDoubleClick` and `cursor-text`.
**Fix:** Wrap `onDoubleClick` in `!isTablet` check and remove `cursor-text` on tablet.

### Issue 4: `draggable` attribute on timeline tasks
**Location:** `App.jsx:14407`
**Problem:** Timeline tasks have `draggable={!isImported || task.isTaskCalendar}` which enables HTML5 drag-and-drop. This is a mouse/desktop API. On tablet, tasks use touch-based drag (`handleMobileTaskTouchStart/Move/End`), so `draggable` is redundant and can interfere with touch gestures. Mobile timeline tasks have no `draggable` attribute.
**Fix:** Change to `draggable={!isTablet && (!isImported || task.isTaskCalendar)}`, plus guard the `onDragStart`/`onDragEnd`/`onDragOver`/`onDrop` handlers with `!isTablet`.

### Issue 5: `draggable` attribute on all-day tasks
**Location:** `App.jsx:13946`
**Problem:** Same as Issue 4 but for all-day tasks. `draggable={!isImported || task.isTaskCalendar}` with `onDragStart`/`onDragEnd`. Tablet all-day tasks already use touch handlers (line 13974-13977).
**Fix:** Change to `draggable={!isTablet && (!isImported || task.isTaskCalendar)}` and guard drag event handlers with `!isTablet`.

### Issue 6: `draggable` on tablet timeline routine pills
**Location:** `App.jsx:14835`
**Problem:** Timeline routine pills have `draggable` + `onDragStart`/`onDragEnd`/`onDragOver`/`onDrop`. This is desktop-only; mobile routine pills use touch handlers. Tablet routine pills already have their own touch handlers (no touch handlers currently though — see Issue 8).
**Fix:** Change to `draggable={!isTablet}` and guard the drag event handlers with `!isTablet`.

### Issue 7: `draggable` on tablet all-day routine pills
**Location:** `App.jsx:14192`
**Problem:** All-day routine pills in the desktop/tablet view have `draggable` + `onDragStart`/`onDragEnd`, with no touch handler equivalent. On mobile, all-day routine pills have touch drag handlers.
**Fix:** Change to `draggable={!isTablet}` and guard drag handlers. Add touch handlers for tablet (`handleMobileTaskTouchStart/Move/End` with `isRoutineDrag: true`).

### Issue 8: Missing touch drag handlers on tablet timeline routine pills
**Location:** `App.jsx:14832-14870`
**Problem:** Tablet timeline routine pills have `draggable` + mouse-based drag handlers, but **no touch handlers** (`onTouchStart`/`onTouchMove`/`onTouchEnd`). Compare mobile routine pills (line 9669-9671) which use `handleMobileTaskTouchStart/Move/End`. This means timeline routines can't be drag-repositioned on tablet via touch.
**Fix:** Add `onTouchStart`, `onTouchMove`, `onTouchEnd` handlers to tablet timeline routine pills, matching mobile behavior.

### Issue 9: Missing `select-none` on tablet timeline tasks
**Location:** `App.jsx:14451`
**Problem:** The tablet timeline task content div does not have `select-none`. Compare mobile timeline tasks (line 9466) which have `select-none` to prevent text selection during touch interactions.
**Fix:** Add `select-none` to the tablet timeline task content wrapper className at line 14451.

### Issue 10: Missing `select-none` on tablet all-day tasks
**Location:** `App.jsx:13979`
**Problem:** Tablet all-day task content div lacks `select-none`. Mobile all-day tasks (line 9074) have `select-none`.
**Fix:** Add `select-none` to the className on tablet.

### Issue 11: `cursor-move` on tablet tasks
**Location:** `App.jsx:14412`, `13979`
**Problem:** Tablet timeline and all-day tasks show `cursor-move` which is a desktop cursor style. On touch devices this is irrelevant and confusing.
**Fix:** Use `cursor-default` instead of `cursor-move` on tablet for both timeline and all-day tasks.

### Issue 12: `draggable` on tablet inbox/overdue/recycle-bin tasks
**Location:** `App.jsx:12771`, `13248`, `13690`
**Problem:** Inbox, overdue, and recycle bin tasks in the sidebar have `draggable` with mouse-based drag handlers. These are desktop-only APIs.
**Note:** These are sidebar tasks, not timeline tasks. The user's request focuses on "tablet timeline." These tasks do already have touch handlers on some (deadline tasks at line 14081-14083), but the main inbox tasks and overdue tasks don't have touch handlers in the desktop/tablet branch. This is a broader scope issue and may be out of scope for this plan. **Recommend deferring** unless the user wants to address it.

### Issue 13: `draggable` on tablet deadline tasks in all-day area
**Location:** `App.jsx:14071`
**Problem:** Deadline tasks rendered in the all-day area have `draggable` for desktop drag. They do already have touch handlers (14081-14083), so the fix is just to disable `draggable` on tablet.
**Fix:** Change to `draggable={!isTablet}` and guard `onDragStart`/`onDragEnd` with `!isTablet`.

---

## Out of Scope (Noted but not planned)

- **Sidebar inbox/overdue/recycle bin touch drag**: These sidebar tasks lack touch drag handlers on tablet. This is a larger feature that goes beyond "timeline" behavior. Deferred.
- **Inline editing infrastructure**: The code has `editingTaskId` checks and input fields for inline editing inside timeline tasks (both mobile and tablet/desktop). On mobile these are apparently never triggered (no `onDoubleClick`). On tablet, removing `onDoubleClick` means these editing input branches become dead code on tablet. They can be left as-is (they won't trigger) or cleaned up in a follow-up.

---

## Implementation Order

1. **Issue 1** — Remove resize handle on tablet timeline tasks
2. **Issues 2 & 3** — Remove `onDoubleClick` + `cursor-text` on tablet (timeline + all-day)
3. **Issues 9 & 10** — Add `select-none` on tablet (timeline + all-day)
4. **Issue 11** — Replace `cursor-move` with `cursor-default` on tablet
5. **Issues 4, 5, 6, 7, 13** — Disable `draggable` + HTML5 drag handlers on tablet
6. **Issues 7 & 8** — Add touch handlers to routine pills on tablet
7. Build verification + commit
