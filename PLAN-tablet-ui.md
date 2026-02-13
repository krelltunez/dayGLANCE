# Tablet UI Plan — dayGLANCE

## Context

The app currently has a hard binary split at 768px:
- **< 768px** → Full mobile layout (bottom tabs, single-day view, touch gestures)
- **>= 768px** → Full desktop layout (sidebar, multi-day calendar, mouse/hover interactions)

Tablets (768px–1199px) currently get the **desktop layout**, which means:
- Small touch targets designed for mouse hover
- No swipe gestures or haptic feedback
- Cramped sidebar on smaller tablets (768–1024px portrait)
- No landscape/portrait adaptation

The goal is a **tablet mode** that combines the best of both worlds: mobile's touch interaction model with desktop's multi-panel spatial layout.

---

## Breakpoint Strategy

```
< 768px        → Mobile   (unchanged)
768px–1199px   → Tablet   (NEW)
>= 1200px      → Desktop  (unchanged)
```

### Implementation

1. **New `useIsTablet` hook** alongside existing `useIsMobile`:
   ```js
   const useIsTablet = () => {
     const [isTablet, setIsTablet] = useState(() =>
       window.innerWidth >= 768 && window.innerWidth < 1200
     );
     // resize listener...
   };
   ```

2. **Update `useIsMobile`** — stays as-is (< 768px). Tablet is explicitly *not* mobile.

3. **Update `useVisibleDays`** — tablet always shows **1 day** (portrait) or **2 days** (landscape):
   ```
   < 768px         → 1 day  (mobile)
   768–1023px      → 1 day  (tablet portrait)
   1024–1199px     → 2 days (tablet landscape / large tablet)
   1200–1599px     → 2 days (desktop)
   >= 1600px       → 3 days (desktop wide)
   ```

---

## Layout: Two-Panel Split

Instead of mobile's tab-based navigation or desktop's fixed sidebar, the tablet layout uses a **collapsible split view**:

```
┌──────────────────────────────────────────┐
│  Header (date nav + actions)             │
├────────────────┬─────────────────────────┤
│  Side Panel    │  Timeline / Calendar    │
│  (Inbox,       │  (1-2 day view)         │
│   Routines,    │                         │
│   DayGlance)   │                         │
│                │                         │
│  Swipe to      │  Touch gestures from    │
│  dismiss →     │  mobile (swipe, drag)   │
│                │                         │
├────────────────┴─────────────────────────┤
│  (no bottom tab bar)                     │
└──────────────────────────────────────────┘
```

### Panel behavior:
- **Side panel width**: ~300px (fixed), overlays on 768px portrait, inline on >= 1024px
- **Panel toggle**: Hamburger button in header OR swipe-from-left-edge gesture
- **Panel sections**: Stacked vertically — DayGlance summary, Inbox, Routines (collapsible accordion)
- **Default state**: Panel open on landscape, closed on portrait

---

## Touch Interactions — Reuse Mobile System

The core mobile touch system (swipe actions, long-press drag, haptics) should be enabled for tablet. This requires:

### Phase 1: Extract touch system from mobile-only guard

Currently, touch handlers (`handleMobileTaskTouchStart/Move/End`, long-press drag) are only wired up inside the `{isMobile ? (` branch. For tablet:

1. **Attach touch handlers to tablet timeline tasks** — same `onTouchStart/Move/End` props
2. **Reuse all existing refs** — `swipeTouchStartX`, `mobileDragActive`, etc. already live on the main component
3. **Adjust thresholds** — tasks are wider on tablet, so swipe activation threshold (40% of width) works naturally
4. **Haptic feedback** — works identically (navigator.vibrate API)

### Phase 2: Tablet-specific touch additions

- **Swipe-from-edge** to toggle side panel (left edge → open panel, swipe panel left → close)
- **Two-finger swipe left/right** on timeline to change day (replaces mobile's header buttons as secondary gesture)
- **Pinch-to-zoom** on timeline to scale hour height (stretch/compress the day view) — future enhancement

---

## Component Rendering Strategy

The main render split becomes a **three-way branch**:

```jsx
return (
  <div>
    {isMobile ? (
      {/* Mobile Layout — unchanged */}
    ) : isTablet ? (
      {/* Tablet Layout — NEW */}
    ) : (
      {/* Desktop Layout — unchanged */}
    )}
  </div>
);
```

### Shared rendering to extract

Several UI pieces are currently duplicated between mobile and desktop. Before adding a third layout, extract these into shared inline renderers (not separate files, to match the existing architecture):

1. **Timeline column** — the hour grid + positioned tasks. Mobile and desktop both render this, just with different widths and interaction handlers. Extract a `renderTimelineColumn(date, options)` function that accepts:
   - `touchEnabled: boolean` (mobile + tablet = true)
   - `width: string`
   - `dragHandlers: object` (desktop DnD vs touch)

2. **Task card** — the individual task rendering. Extract `renderTaskCard(task, options)` with:
   - `swipeable: boolean`
   - `compact: boolean`

3. **Inbox list** — used in mobile's inbox tab and desktop's sidebar. Extract `renderInboxSection()`.

4. **Routines list** — same story. Extract `renderRoutinesSection()`.

5. **DayGlance summary** — used in mobile's glance tab and desktop sidebar.

---

## Header Design

Tablet header blends mobile and desktop approaches:

```
┌──────────────────────────────────────────────┐
│ ☰  │  ◀  Wed, Feb 12  ▶  [Today]  │  ⚙  🔍 │
└──────────────────────────────────────────────┘
```

- **☰** Hamburger toggles side panel
- **Date navigation** centered, touch-friendly (44px tap targets)
- **Settings gear + Spotlight search** on right
- **No sidebar collapse animation** — panel slides over or pushes content
- Touch-friendly: all buttons min 44x44px tap target

---

## Modals & Overlays

- Use **centered modals** (not bottom sheets like mobile, not tiny desktop modals)
- Modal width: `max-w-lg` (~512px), vertically centered
- Backdrop tap to dismiss
- Task edit form: same as desktop but with larger touch targets
- Time picker: mobile's `ClockTimePicker` (already touch-optimized)

---

## Specific Tailwind Changes

### `tailwind.config.js` — Add custom breakpoint
```js
theme: {
  screens: {
    'tablet': '768px',
    'desktop': '1200px',
  },
  extend: {},
},
```

### Touch-friendly class adjustments
- Buttons: `min-h-[44px] min-w-[44px]` on tablet (Apple HIG touch target)
- Task rows: `py-3` instead of desktop's `py-1.5`
- Font sizes: slightly larger than desktop, slightly smaller than mobile
- Scrollbar: hidden on tablet (touch scrolling), visible on desktop

---

## Orientation Handling

```js
const useOrientation = () => {
  const [isLandscape, setIsLandscape] = useState(
    () => window.innerWidth > window.innerHeight
  );
  // Listen to resize + orientationchange events
};
```

**Portrait (768–1024px wide)**:
- Side panel overlays as a drawer (not inline)
- 1-day timeline view
- Larger task cards (more vertical space)

**Landscape (1024–1199px wide)**:
- Side panel inline (push layout, ~300px)
- 2-day timeline view
- Compact task cards

---

## Implementation Phases

### Phase 1: Foundation (detection + layout shell)
1. Add `useIsTablet` hook and `useOrientation` hook
2. Add third rendering branch (`isTablet ? ...`)
3. Create tablet layout shell: header + side panel + timeline area
4. Side panel with hamburger toggle (no gesture yet)
5. Render existing desktop timeline content in the tablet branch
6. Wire up `useVisibleDays` to new tablet breakpoints

### Phase 2: Touch enablement
7. Attach mobile touch handlers to tablet timeline tasks (swipe + long-press drag)
8. Enable haptic feedback in tablet mode
9. Use mobile's `ClockTimePicker` for tablet time inputs
10. Make task cards touch-friendly (larger tap targets, active states instead of hover)
11. Add `active:` state styles throughout tablet UI (replace `hover:` states)

### Phase 3: Side panel
12. Build slide-in drawer for portrait mode (swipe-from-left-edge to open)
13. Build inline panel for landscape mode
14. Populate panel with DayGlance, Inbox, Routines sections
15. Add swipe-to-dismiss on the drawer
16. Panel section accordion (tap to expand/collapse)

### Phase 4: Tablet-specific refinements
17. FABs: position add-task FAB at bottom-right (no bottom tab bar to avoid)
18. Tablet onboarding — adapt welcome flow (no carousel, single modal)
19. Spotlight search — centered modal with larger input
20. Settings — full-width panel (not a tab, not a tiny sidebar section)
21. Undo toast — bottom-center (no tab bar offset needed)
22. Weekly review / daily summary — centered modal, not bottom sheet

### Phase 5: Polish
23. Orientation change transitions (smooth re-layout)
24. Keyboard avoidance (iPad + external keyboard support)
25. iPad split-screen / slide-over compatibility
26. Test on common tablet sizes: iPad (1024x768), iPad Air (1180x820), iPad Pro 11" (1194x834), Galaxy Tab S (1600x2560 but scaled), Surface Go (1800x1200 scaled)

---

## Files Modified

| File | Changes |
|------|---------|
| `src/App.jsx` | New hooks, tablet render branch, extracted shared renderers, touch wiring |
| `tailwind.config.js` | Custom breakpoints |
| `src/index.css` | Tablet-specific animation, hide scrollbar utility |

No new files needed — maintains the existing single-file architecture.

---

## Risk & Complexity Notes

- **Largest risk**: The monolithic App.jsx (17K lines) makes the three-way branch verbose. Extracting shared renderers (step in Phase 1) is critical to keep this manageable.
- **Touch handler reuse**: The existing mobile touch system is well-isolated in refs and doesn't depend on `isMobile` internally — it just needs to be wired up to the JSX. Low risk.
- **No breaking changes**: Mobile and desktop layouts remain completely untouched. The tablet branch is additive.
- **Testing**: Need physical tablet testing or browser DevTools device emulation for iPad/Surface form factors.
