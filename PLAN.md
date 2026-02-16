# Plan for Desktop UI Updates

## Goal
Bring the desktop UI in line with the tablet UI for a consistent cross-device experience, while preserving desktop-appropriate interaction patterns (hover states, mouse-driven actions instead of touch/tap).

---

## Current State Summary

### Desktop Layout (current)
- **Header bar**: Date navigation (left, in sidebar column) | Weather + 5-day forecast + Daily Content (2 of 4: dad joke, fun fact, quote, history) + Action buttons (sync, settings, dark mode, cloud sync, reminders, backup) (right, in timeline column)
- **Sidebar** (left, 288px or collapsed to 59px):
  - Row of 6 blue buttons: New Scheduled Task, New Inbox Task, Routines, Weekly Review, Spotlight Search, Collapse
  - Getting Started Checklist (onboarding)
  - Overdue section (collapsible)
  - dayGLANCE Agenda section (collapsible)
  - Routines row
  - Tags section with checkboxes (collapsible)
  - Inbox section with tasks (collapsible, drag-to-schedule)
  - Daily Summary stats (collapsible)
  - All Time Summary stats (collapsible)
  - Recycle Bin (collapsible, drag-to-delete)
- **Timeline** (right): Calendar grid with time slots, all-day section, task cards

### Tablet Layout (current)
- **Header strip** (48px): dayGLANCE logo (left) | Date navigation with Today pill (center) | Action buttons (sync, cloud sync, settings, reminders, dark mode, backup) (right)
- **Side panel** (320px, always visible):
  - Portrait: Glance section (top) + Inbox section (bottom, scrolls together)
  - Landscape: Tabbed (Glance | Inbox) with tab switcher
  - Glance contains: Search + Tag Filter button, Overdue, Today's agenda, Routines row
  - Inbox contains: Priority filter, task list, "New Inbox Task" button
- **Timeline** (right): Same calendar grid as desktop
- **FABs** (floating action buttons):
  - Timeline: + New Scheduled Task (primary, bottom-right), Routines (secondary, above it)
  - Glance panel: Daily Summary ring (middle), Weekly Review (bottom), Recycle Bin (top, only when non-empty)
- **Bottom sheets**: Recycle Bin, Tag Filter, Daily Summary (slide up from bottom)
- **All Time Summary**: Accessible only through Settings > Stats

### Key Differences Identified
1. Desktop has no dayGLANCE logo in header; tablet does
2. Desktop shows weather + daily content in header; tablet has neither
3. Desktop daily content shows 2 items simultaneously; user wants 1-at-a-time rotation
4. Desktop date navigation is in the sidebar column; tablet has it centered in header
5. Desktop has a dedicated Tags sidebar section; tablet uses Filter button + bottom sheet
6. Desktop has blue action button bar (6 buttons); tablet uses FABs instead
7. Desktop has Daily Summary, All Time Summary, and Recycle Bin as inline sidebar sections; tablet uses FABs + bottom sheets
8. Desktop sidebar is collapsible (full sidebar vs icon rail); tablet panel is always 320px
9. Desktop Inbox is in the sidebar; tablet Inbox is in the side panel (same concept, different implementation)
10. Desktop has no FABs; tablet has them for quick actions
11. Desktop weekly review is a blue sidebar button; tablet has a dedicated FAB

---

## Planned Changes

### 1. Header Bar Redesign

**Layout**: `[dayGLANCE logo] [date nav] [weather] [daily content (1 item, rotating)] [action buttons]`

#### 1a. Add dayGLANCE Logo (Left)
- Insert the `dayGLANCE` logo SVG on the far left of the header, matching the tablet's implementation
- Use `darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'`
- Height ~36-40px, consistent with tablet

#### 1b. Date Navigation — Next to Logo
- Move date navigation cluster from the sidebar column to immediately right of the logo
- Include: left/right arrows, clickable date range (opens month view), "Today" button
- This gives date nav prime position as the most-used header control
- This frees the sidebar column from needing a date nav area

#### 1c. Weather — Center Area
- Move weather display from its current left-of-center position to the center of the header, after date nav
- Keep current weather (icon + temp + high/low) always visible
- 5-day forecast visible when space allows (3-day view)

#### 1d. Daily Content — Single Item Rotation
- Change from showing 2 items simultaneously to showing **1 item at a time**
- Rotate through all 4 content types (dad joke, fun fact, quote, this day in history) every 15 minutes (existing interval)
- Remove the `visibleDays === 3` condition so content shows on all desktop widths (currently only visible when 3 days are shown)
- Fade/crossfade transition between items for visual polish
- Place between weather and action buttons, flexing to fill available space
- Show on 2-day and 3-day views; hide on 1-day narrow mode for space

#### 1e. Action Buttons — Far Right
- Keep existing action buttons (sync, cloud sync, settings, reminders, dark mode, backup) grouped on the far right
- These already match the tablet's right-side button cluster

**Result**: Header becomes `[Logo] [Date Nav] [Weather] [Daily Content x1 rotating] [Actions]`
Date nav gets prime placement next to the logo. Weather and daily content fill the middle, gracefully degrading at narrower widths. Action buttons anchor the right edge.

---

### 2. Side Panel — Adopt Tablet Design

Replace the current desktop sidebar with a fixed-width side panel modeled on the tablet's portrait design.

#### 2a. Panel Structure
- **Width**: 320px (matching tablet), no collapse functionality (remove the collapsible behavior and the icon rail mode)
- **Layout**: Glance section (top) + Inbox section (below), scrolling together (portrait tablet model)
- No tabs needed on desktop (sufficient vertical space for both sections to be visible)

#### 2b. Glance Section Content
- **Search bar** + **Tag Filter button** (replaces dedicated Tags sidebar section)
  - Search opens Spotlight (existing `Ctrl+K` shortcut still works)
  - Filter button opens a **popover/dropdown** (not a bottom sheet, since we're on desktop) showing tag checkboxes with Select All/Clear
- **Overdue tasks** from past days (collapsible, matching current behavior)
- **Today's Agenda** (dayGLANCE) with now-marker, relative times, focus mode entry points
- **Routines row** showing today's routines as pills

#### 2c. Inbox Section Content
- Section header with count badge, priority filter, and hide-completed toggle (existing functionality)
- Draggable inbox task list (preserve drag-to-schedule capability since desktop supports drag-and-drop)
- "New Inbox Task" button (matching tablet)
- Priority prompt for unprioritized inbox items (existing)

#### 2d. Remove Tags Sidebar Section
- The dedicated Tags section with checkbox list is removed
- Tag filtering is now handled by the Filter button in the Glance section (opening a desktop popover rather than a bottom sheet)
- The tag filter bottom sheet code can remain for the tablet path; desktop gets a popover version

---

### 3. FABs — Adopt Tablet FAB Pattern

#### 3a. Timeline FABs
- **Primary FAB** (bottom-right of timeline): `+` New Scheduled Task (blue, 56px circle)
- **Secondary FAB** (above primary): Routines (teal, 48px circle)
- Use `position: fixed` anchored to the right edge of the viewport, above any bottom padding
- Show on desktop when `!isTablet` (i.e., the same FAB pattern works for both)

#### 3b. Glance Panel FABs
- **Daily Summary FAB** (ring with completion percentage): anchored to the right edge of the side panel, bottom area
- **Weekly Review FAB** (bar chart icon): below daily summary FAB
- **Recycle Bin FAB** (trash icon with count badge): above daily summary FAB, only shown when bin is non-empty
- These FABs are positioned along the right edge of the 320px side panel, matching the tablet's `left: 248px` positioning

---

### 4. Remove Blue Sidebar Buttons

The row of 6 blue action buttons (New Scheduled Task, New Inbox Task, Routines, Weekly Review, Spotlight Search, Collapse) becomes redundant:
- **New Scheduled Task** → Primary FAB on timeline
- **New Inbox Task** → "New Inbox Task" button in Inbox section of side panel
- **Routines** → Secondary FAB on timeline
- **Weekly Review** → FAB on Glance panel
- **Spotlight Search** → Search bar in Glance section (+ `Ctrl+K` shortcut persists)
- **Collapse sidebar** → Removed (sidebar is no longer collapsible)
- Delete the entire blue button bar (both expanded and collapsed icon versions)

---

### 5. Daily Summary, Recycle Bin, Weekly Review — FAB + Sheet/Modal Pattern

#### 5a. Daily Summary
- Remove the inline "Daily Summary" card from the sidebar
- The Daily Summary FAB (completion ring) opens a **modal/popover** near the FAB showing the same stats (tasks scheduled, completed, time spent, time planned, focus time, completion rate, incomplete task drill-down)
- On desktop, use a positioned popover or small modal rather than a bottom sheet

#### 5b. Recycle Bin
- Remove the inline "Recycle Bin" card from the sidebar
- The Recycle Bin FAB opens a **modal/popover** showing the bin contents with restore and empty actions
- **Important**: Preserve the drag-to-Recycle-Bin capability — the Recycle Bin FAB should accept dropped tasks (add `onDragOver`/`onDrop` handlers to the FAB itself, or add a drop zone that appears when dragging)

#### 5c. Weekly Review
- Already triggered via the blue button row or `setShowWeeklyReview(true)`
- Now triggered via the Weekly Review FAB (same handler)
- The weekly review reminder badge transfers to the FAB (pulsing blue when reminder is active)

---

### 6. All Time Summary — Solve for Both Desktop and Tablet

**Current state**:
- Desktop: Inline card in sidebar, always accessible
- Tablet: Hidden inside Settings > Stats (non-obvious location)

**Proposed solution**: Add All Time Summary as an expandable section within the Daily Summary modal/popover:
- When the Daily Summary FAB is tapped/clicked, the popover shows today's daily summary at the top
- Below it, an "All Time" toggle or accordion expands to show the all-time stats
- This makes it accessible on **both** desktop and tablet without taking permanent screen real estate
- Alternative: Add a small link/button in the Daily Summary popover that says "View All Time Stats" which navigates to the all-time stats view

---

### 7. Additional Consistency Changes

#### 7a. Getting Started Checklist (Onboarding)
- Currently shows in the desktop sidebar as an inline card
- Move to a one-time **modal overlay** on first launch (already has `desktopWelcomeStep` wizard)
- Or position it at the top of the Glance section when `showOnboarding` is true (above the search bar)
- Once dismissed, it disappears. This matches the tablet experience where onboarding is handled differently

#### 7b. Collapsible Sections
- Desktop currently uses `minimizedSections` for toggling Overdue, dayGLANCE, Tags, Inbox, Daily Summary, All Time Summary, Recycle Bin
- In the new design, most of these are removed from inline display (Daily Summary, All Time Summary, Recycle Bin become FAB-triggered)
- Keep `minimizedSections` for Overdue toggle within the Glance panel (matching tablet behavior)
- The dayGLANCE (agenda) section in Glance should always be visible (remove collapse toggle, matching tablet)

#### 7c. Sidebar Collapse State Cleanup
- Remove `sidebarCollapsed` state and localStorage persistence
- Remove the collapsed icon-rail mode entirely
- Remove the ChevronsLeft/ChevronsRight collapse/expand buttons

#### 7d. Keyboard Shortcut Preservation
- `Ctrl+K` / `Cmd+K` for Spotlight Search must continue to work (now triggers from Search bar in Glance + keyboard shortcut)
- All other keyboard shortcuts (arrow keys for date nav, Ctrl+Z for undo, etc.) remain unchanged

#### 7e. Desktop-Specific Interaction Preservation
- Hover states on buttons (desktop has hover, tablet has active/tap)
- Drag-and-drop for tasks (sidebar → timeline, timeline → recycle bin, inbox → timeline)
- Right-click context menus if any exist
- Mouse-driven task resizing on timeline
- Tooltip titles on buttons

#### 7f. FAB Desktop Styling
- Use `hover:` states instead of `active:` for FAB interactions on desktop
- Slightly larger FABs acceptable since there's more space (match tablet sizes: 56px primary, 48px secondary)
- Add tooltips (`title` attributes) to all FABs for desktop discoverability

#### 7g. Daily Content in Header — Width-Responsive Behavior
- 3-day view: Show daily content + weather + 5-day forecast
- 2-day view: Show daily content + current weather only (no forecast)
- 1-day narrow: Hide daily content, show current weather only
- This graceful degradation ensures the header doesn't overflow at narrower widths

---

## Implementation Order

1. **Header bar redesign** (1a-1e) — restructure the header layout
2. **Side panel creation** — build the new Glance + Inbox panel (2a-2d)
3. **FABs for timeline** — add New Task and Routines FABs (3a)
4. **FABs for Glance panel** — add Daily Summary, Weekly Review, Recycle Bin FABs (3b)
5. **Daily Summary popover/modal** — create the FAB-triggered summary view (5a)
6. **Recycle Bin popover/modal** — create the FAB-triggered recycle bin (5b, ensure drag-drop works)
7. **All Time Summary integration** — add to Daily Summary popover (6)
8. **Remove old sidebar** — delete blue buttons, tags section, inline summary/bin cards, collapse logic (4, 7c)
9. **Tag filter popover** — desktop-appropriate tag filter UI (2d)
10. **Onboarding adjustment** — reposition Getting Started checklist (7a)
11. **Polish** — hover states, tooltips, responsive width behavior, keyboard shortcuts verification (7d-7g)
12. **Testing** — verify all functionality works across different window widths

---

## Out of Scope
- Touch-specific tablet interactions (swipe gestures, haptic feedback, touch target sizing)
- Phone/mobile layout changes (completely different UI paradigm)
- New features or functionality changes (this is purely a layout/UI consistency effort)
