# Tablet UI Plan for dayGLANCE

## Context

The app currently has a binary responsive split at 768px:
- **Mobile (<768px):** Bottom tab nav, single-day timeline, long-press drag, swipe gestures, FAB
- **Desktop (≥768px):** Collapsible sidebar, 1-3 day view, native drag-drop, top nav bar

Tablets (768px–1199px) currently fall into the desktop bucket, getting a mouse-oriented UI on a touch device. The goal is a hybrid layout that leverages the mobile touch work (long-press drag, swipe gestures, haptic feedback) while taking advantage of the extra screen real estate.

Additionally, small desktop/laptop screens (many 1080p monitors, laptops) can have widths under 1200px — we must not accidentally give them the tablet UI. Width alone is insufficient; we combine it with touch-primary detection.

---

## Device detection strategy

Detection uses **touch-primary input** (`pointer: coarse` + `hover: none`) combined with **viewport width** to distinguish phones, tablets, and desktops. This correctly handles:

- Laptops/desktops with narrow windows → desktop UI (not touch-primary)
- Touch-enabled laptops (Surface, etc.) → desktop UI (mouse/trackpad is primary input)
- Tablets without keyboard → tablet UI (touch-primary + tablet-sized viewport)
- Phones → mobile UI (always, via landscape blocker for landscape)

### Detection logic

```javascript
const touchPrimary = matchMedia('(pointer: coarse) and (hover: none)').matches;
const isPhone = touchPrimary && Math.min(width, height) < 600;
const isMobile = isPhone || width < 768;
const isTablet = !isPhone && touchPrimary && width >= 768 && width < 1200;
// desktop = !isMobile && !isTablet
```

- **`isPhone`**: touch-primary AND the smaller viewport dimension < 600px. This catches all phones (largest phone portrait width is ~440px) while excluding the smallest tablet (iPad Mini at 744px). Phones always stay phones regardless of orientation.
- **`isMobile`**: phones (any orientation) + any viewport narrower than 768px (iPad Mini portrait at 744px, narrow desktop windows).
- **`isTablet`**: touch-primary, NOT a phone, width in the 768–1199px range. This catches tablets in portrait and landscape while excluding laptops (not touch-primary) and phones (caught by `isPhone`).

### Landscape blocker

The existing landscape blocker overlay uses `isPhone && isLandscape` (not `isMobile`) so it only blocks phones, not narrow desktop windows or tablets.

### Device/orientation matrix

| Device & orientation | isPhone | isMobile | isTablet | Result |
|---|---|---|---|---|
| Phone portrait (~390px) | yes | yes | — | Mobile layout |
| Phone landscape (~850px) | yes | yes | — | Landscape blocker |
| iPad Mini portrait (744px) | — | yes | — | Mobile layout |
| iPad Mini landscape (1133px) | — | — | yes | Tablet layout |
| iPad portrait (810px) | — | — | yes | Tablet layout |
| iPad landscape (1080px) | — | — | yes | Tablet layout |
| iPad Pro 11" portrait (834px) | — | — | yes | Tablet layout |
| iPad Pro 12.9" portrait (1024px) | — | — | yes | Tablet layout |
| iPad Pro 12.9" landscape (1366px) | — | — | — | Desktop layout |
| Laptop 1080p (~1080px) | — | — | — | Desktop layout |
| Desktop (≥1200px) | — | — | — | Desktop layout |

---

## Step 1: Refactor device detection hooks

**File:** `src/App.jsx` — near `useIsMobile()` / `useVisibleDays()` hooks

Replace the current `useIsMobile()` with a unified `useDeviceType()` hook that returns `{ isPhone, isMobile, isTablet }`:

- Listen to `resize`, `orientationchange`, and `matchMedia` change events for `(pointer: coarse) and (hover: none)`
- `isPhone`: touch-primary AND `Math.min(width, height) < 600`
- `isMobile`: `isPhone` OR `width < 768`
- `isTablet`: NOT phone, touch-primary, `width >= 768 && width < 1200`
- Update landscape blocker to use `isPhone && isLandscape` instead of `isMobile && isLandscape`
- Expose all three flags in the DayPlanner component

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

Derived from hooks (not separate state):
- Orientation is already tracked by `useIsLandscape()` (existing hook)
- Visible days for tablet derived from orientation: 2 portrait, 3 landscape

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
| Detection | `isPhone` OR width < 768 | Touch-primary + 768–1199px | Everything else |
| Navigation | Bottom tabs | Sidebar rail + slide-over | Collapsible sidebar |
| Calendar days | 1 | 2 (portrait) / 3 (landscape) | 2–3 (by width) |
| Drag method | Long-press touch | Long-press touch | Mouse drag |
| Task actions | Swipe strips | Swipe strips | Hover buttons |
| Task editing | Full-screen overlay | Centered dialog | Inline / modal |
| Header | Per-tab sticky | Slim date strip | Full top nav |
| Safe areas | Yes | Yes | No |

### Key edge cases
- **iPad Mini portrait (744px):** Gets mobile layout — too narrow for comfortable 2-column
- **iPad Mini landscape (1133px):** Gets tablet layout — plenty of room for 2-column
- **iPad Pro 12.9" landscape (1366px):** Gets desktop layout — wide enough for full desktop UI
- **Touch-enabled laptops:** Get desktop layout — `pointer: fine` when keyboard/trackpad is primary
- **Phones in landscape:** Blocked by portrait-only overlay — never reach tablet/desktop layouts
