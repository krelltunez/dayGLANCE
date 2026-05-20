# Tablet LIST View Plan

Enable the LIST timeline view on tablet (portrait and single-column landscape),
matching the existing mobile experience but skipping the INBOX handle since the
GLANCE/Inbox sidebar is always visible on tablet.

---

## Background

Mobile has two timeline views — **GRID** (time-grid) and **LIST** (agenda-style
`MobileListView`) — toggled via `MobileViewToggle` and persisted under
`day-planner-mobile-view-mode` in localStorage. Desktop has its own `viewMode`
(multi/day/week). Neither is in the cloud sync payload; both are device-local
preferences and should stay that way.

Tablet (portrait, single timeline column) currently always renders the desktop
`TimeGrid`/`DayView`/`WeekView` stack via `DesktopLayout.jsx`. It has no access
to `mobileViewMode` at the render layer, so LIST view is effectively locked out.

---

## Changes

### 1. `src/components/MobileListView.jsx`

Add a `hideInboxHandle` prop (default `false`). The vertical INBOX handle is
rendered as a portal at line ~1743. Wrap that portal call in
`!hideInboxHandle && (...)`.

The rest of `MobileListView` (scroll container, touch handlers, inbox slide-in
panel) does not need changes — the slide-in is only reachable through the handle
button, so hiding the button makes the whole subsystem inert on tablet.

### 2. `src/components/DesktopLayout.jsx`

**2a. Calendar area (line ~815) — add the list-view branch**

The existing block:
```jsx
{effectiveViewMode === 'multi' && <TimeGrid />}
{effectiveViewMode === 'day' && <DayView />}
{effectiveViewMode === 'week' && <WeekView />}
```

Wrap in `!(isTablet && mobileViewMode === 'list')` and add the tablet list branch:

```jsx
{isTablet && mobileViewMode === 'list'
  ? <MobileListView hideInboxHandle />
  : <>
      {effectiveViewMode === 'multi' && <TimeGrid />}
      {effectiveViewMode === 'day' && <DayView />}
      {effectiveViewMode === 'week' && <WeekView />}
    </>
}
```

`mobileViewMode` is already threaded through context (`useDayPlannerCtx`) — no
new prop drilling needed.

**2b. Tablet header (line ~491) — add the view toggle**

The right side of the 56px tablet header already has sync/settings/reminders
buttons. Add `<MobileViewToggle />` to that button group (before the settings
gear is a natural position). `MobileViewToggle` reads `mobileViewMode` and
`setMobileViewMode` from `useDayPlannerCtx`, so it's self-contained.

**2c. Tablet settings panel — add view preference + end-of-day**

The settings modal opened by `setShowSettings(true)` in `DesktopLayout` is a
separate panel. Find the tablet-facing section for display/appearance settings
and add:

- **Timeline view** — GRID / LIST toggle (mirrors the section in
  `MobileSettingsPanel` around line 365)
- **End of day** — time picker visible only when `mobileViewMode === 'list'`
  (mirrors `MobileSettingsPanel` line ~381)

Exact location in the settings panel will need a quick read when implementing,
but search for "dark mode" or "24-hour" in the DesktopLayout settings section —
the display settings cluster is the right neighbourhood.

---

## What does NOT change

- `buildSyncPayload` in `App.jsx` — `mobileViewMode` and end-of-day time stay
  device-local; do not add them to the sync payload.
- `MobileViewToggle.jsx` — used as-is; it's already context-driven.
- The GRID view on tablet — `effectiveViewMode` still drives `TimeGrid` etc. when
  `mobileViewMode === 'grid'` (or any non-list value).
- Mobile layout — `MobileLayout.jsx` is untouched.

---

## Risk notes

- Verify that `MobileListView`'s scroll container fills the calendar area height
  correctly when rendered inside `DesktopLayout`'s flex child. The container is
  `style={{ height: '100%' }}` — should be fine but worth a quick visual check
  in both portrait and landscape.
- `mobileDateHeaderRef` is read by `MobileListView` for the (now-hidden) inbox
  portal anchor. Confirm the ref is still populated via `DesktopLayout`'s
  `CalendarHeader` — it should be, but verify so the ref isn't null on tablet.
