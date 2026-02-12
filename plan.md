# Tablet UI Plan for dayGLANCE

## Context

The app currently has a binary responsive split at 768px:
- **Mobile (<768px):** Bottom tab nav, single-day timeline, long-press drag, swipe gestures, FAB
- **Desktop (≥768px):** Collapsible sidebar, 1-3 day view, native drag-drop, top nav bar

Tablets (768px–1199px) currently fall into the desktop bucket, getting a mouse-oriented UI on a touch device. The goal is a hybrid layout that leverages the mobile touch work (long-press drag, swipe gestures, haptic feedback) while taking advantage of the extra screen real estate.

---

## Step 1: Add tablet detection hook

**File:** `src/App.jsx` — near `useIsMobile()` / `useVisibleDays()` hooks

- Add a `useIsTablet()` hook: `window.innerWidth >= 768 && window.innerWidth < 1200`
- Update `useIsMobile()` so mobile stays `< 768`
- Expose `isTablet` alongside `isMobile` in the main component state
- Tablets get **2-day visible** view (portrait) or **2-3 day** (landscape)

---

## Step 2: Create tablet layout shell (split-pane)

**File:** `src/App.jsx` — main render return

Instead of the binary `isMobile ? <Mobile/> : <Desktop/>`, add a third branch:

```
isMobile ? <MobileLayout/>
: isTablet ? <TabletLayout/>
: <DesktopLayout/>
```

**Tablet layout structure:**
- **No bottom tab bar** — use a compact sidebar rail instead (icon-only, ~60px)
- **No top nav bar** — merge key actions into the sidebar rail and a slim top date strip
- **Main area:** 2-column split pane
  - Left pane: collapsible sidebar content (inbox, overdue, tags, summaries) — slides in as an overlay or side panel when a rail icon is tapped
  - Right pane: multi-day calendar timeline (2 days default)

---

## Step 3: Tablet sidebar rail

**File:** `src/App.jsx` — new tablet sidebar section

A fixed left rail (~60px) with icon buttons stacked vertically:
- dayGLANCE logo/home (top)
- Add task (+ icon)
- Inbox (with badge)
- Routines
- Search
- Settings (bottom)
- Dark mode toggle (bottom)

Tapping an icon opens a **slide-over panel** (~320px) from the left with the relevant content (inbox list, routines dashboard, settings, etc.), overlaying the calendar. Tapping outside or the same icon again closes it.

This reuses the existing collapsed sidebar icon buttons and the mobile overlay pattern.

---

## Step 4: Tablet date/header strip

**File:** `src/App.jsx` — new tablet header section

A slim top bar (~48px) containing:
- Left/right date navigation arrows
- Current date range label (e.g., "Feb 12–13, 2026")
- Weather summary (compact, icon + temp only)
- Sync status indicator

This is a simplified version of the desktop top nav, touch-friendly with larger tap targets (min 44px).

---

## Step 5: Enable touch interactions on tablet

**File:** `src/App.jsx` — touch handler sections

The mobile touch system (long-press drag, swipe actions on tasks, haptic feedback) is currently gated behind `isMobile`. Changes needed:

- Update touch event handlers to activate on `isMobile || isTablet`
- Keep long-press drag (500ms) for task rearrangement on the calendar
- Keep swipe-to-reveal actions on task items in the sidebar panel
- Keep haptic feedback (`navigator.vibrate`)
- Add **two-finger swipe** or **edge swipe** for date navigation (left/right to change days)
- Increase all tap targets to minimum 44×44px for touch friendliness

---

## Step 6: Tablet calendar view adjustments

**File:** `src/App.jsx` — calendar rendering section

- Default to **2-day view** in portrait, **3-day view** in landscape
- Use `window.matchMedia('(orientation: portrait)')` listener to adapt
- Slightly increase hour-row height for easier touch targeting (from current 160px to ~176px)
- Keep the current time indicator line
- Keep conflict detection rings
- Widen minimum task block height for touch (min 40px)

---

## Step 7: Tablet task editing

**File:** `src/App.jsx` — task modal/form sections

- Reuse the mobile full-screen modal pattern but as a **centered dialog** (max-w-lg, ~80% viewport height)
- Add a slide-up panel variant for quick edits (notes, time adjustment)
- Keep the mobile-style form layout (stacked fields, large inputs) rather than desktop compact forms
- Ensure date/time pickers are touch-friendly

---

## Step 8: Tablet-specific CSS and spacing

**File:** `src/index.css` and inline Tailwind classes

- Add safe-area inset support (tablets can have notches/rounded corners)
- Increase padding on interactive elements: buttons get `p-3` minimum
- Ensure scrollable areas have `-webkit-overflow-scrolling: touch`
- Add `touch-action: manipulation` to prevent double-tap zoom on interactive elements
- Smooth transitions for sidebar panel open/close (`transition-transform duration-200`)

---

## Step 9: Tablet-specific state variables

**File:** `src/App.jsx` — state declarations

New state needed:
- `tabletSidePanel` — which panel is open (`null | 'inbox' | 'routines' | 'settings' | 'search' | 'overdue'`)
- `tabletOrientation` — `'portrait' | 'landscape'` (drives visible days)

Reuse from mobile:
- `mobileDragActive`, `mobileDragTaskId`, etc. (rename or alias to `touchDrag*`)
- Swipe gesture refs

---

## Step 10: Testing and polish

- Test on iPad Safari (most common tablet browser)
- Test touch interactions: long-press drag, swipe, pinch (should be no-op)
- Test orientation changes (portrait ↔ landscape transitions)
- Test slide-over panel behavior with keyboard visible
- Verify PWA behavior on tablet (home screen install, offline mode)
- Ensure no hover-dependent UI — all hover states should have touch alternatives

---

## Summary of architectural approach

| Aspect | Mobile | Tablet (new) | Desktop |
|--------|--------|--------------|---------|
| Breakpoint | <768px | 768–1199px | ≥1200px |
| Navigation | Bottom tabs | Sidebar rail + slide-over | Collapsible sidebar |
| Calendar days | 1 | 2 (portrait) / 3 (landscape) | 2–3 (by width) |
| Drag method | Long-press touch | Long-press touch | Mouse drag |
| Task actions | Swipe strips | Swipe strips | Hover buttons |
| Task editing | Full-screen overlay | Centered dialog | Inline / modal |
| Header | Per-tab sticky | Slim date strip | Full top nav |
| Safe areas | Yes | Yes | No |
