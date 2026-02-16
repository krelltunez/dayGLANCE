# Plan: Unify Side Panel Across Desktop, Tablet Portrait & Tablet Landscape

**Goal:** Make the desktop and tablet portrait side panels match tablet landscape. Tablet landscape is the reference implementation.

---

## 1. Add 2-Tab Navigation to Desktop & Tablet Portrait Side Panels

**Current state:**
- **Tablet landscape:** Has Glance/Inbox tab bar with blue active indicator + badge count on Inbox tab. Only one section visible at a time.
- **Tablet portrait:** Shows both Glance and Inbox stacked vertically (always visible, separated by `border-t`). Has its own "Glance" header.
- **Desktop:** Shows both Glance and Inbox stacked vertically (always visible, separated by `border-t` divider). Has its own "Glance" header.

**Changes:**
- Add the same tab bar header (Glance / Inbox with icons, blue active state, badge count) to the **desktop** side panel (~line 12840).
- Change **tablet portrait** to also use the tab bar instead of showing both sections.
- Make Glance/Inbox visibility conditional on active tab for both desktop and tablet portrait (same as landscape does: `tabletActiveTab === 'glance'` / `'inbox'`).
- Remove the "Glance" `<h2>` section header from desktop (it's redundant with the tab).
- Remove the divider between Glance and Inbox on desktop (no longer needed with tabs).
- Desktop will reuse the existing `tabletActiveTab` state (or a new `desktopActiveTab` state — will use `tabletActiveTab` since the behavior is identical).

## 2. Glance Section FABs — Reduce to 3 (Matching Tablet Landscape)

**Current state (tablet landscape FABs at `left: 248px`):**
- Recycle bin (bottom: 9.5rem) — hidden when empty ✓
- Daily ring FAB with chevron (bottom: 5.5rem) ✓
- Weekly review (bottom: 1.5rem) ✓

**Current state (desktop FABs — `absolute bottom-4 right-4` cluster):**
- Daily Summary (BarChart3 icon, no ring, no chevron) ✗
- Recycle Bin (always shown, even when empty) ✗
- Weekly Review (TrendingUp icon) ✗
- Routines (Sparkles icon) — **should NOT be here** ✗

**Changes for desktop:**
- Replace the existing 4-FAB cluster (`absolute bottom-4 right-4` ~line 13279-13324) with the tablet landscape pattern: 3 fixed-position FABs.
- **Recycle bin:** Hidden when empty (already correct on tablet). Add red count badge like tablet.
- **Daily ring FAB:** Show SVG completion ring with chevron-up icon (matching tablet landscape exactly). Currently desktop just shows a plain BarChart3 icon with no ring.
- **Weekly review:** Use BarChart3 icon (matching tablet). Currently desktop uses TrendingUp icon.
- **Remove Routines FAB** from the side panel cluster (routines are already on the timeline FABs on the right side, and also shown in the Glance agenda section).
- Position the 3 FABs relative to the side panel, same layout as tablet landscape (`left: 248px`, stacked vertically with 4rem gaps).
- These FABs should only show when the Glance tab is active (matching tablet landscape behavior).

**Changes for tablet portrait:**
- Currently tablet portrait shows the same 3 FABs as landscape (via the `!isLandscape || tabletActiveTab === 'glance'` condition at line 15331). With the tab change above, portrait will now correctly show/hide them based on tab selection.

## 3. Inbox Panel — No FABs, Just "New Inbox Task" Button

**Current state (tablet landscape):**
- When Inbox tab is active, the header shows a blue "New Inbox Task" button on the left + filter controls on the right. No FABs overlay the inbox.

**Current state (tablet portrait):**
- Shows "Inbox" heading with badge + a small "New" button on the right.

**Current state (desktop):**
- Shows "Inbox" heading with badge + filter controls. Has a separate "New Inbox Task" button concept but it's not styled like the tablet landscape version.

**Changes:**
- Desktop inbox header: Replace the current Inbox `<h2>` heading with the blue "New Inbox Task" button (matching tablet landscape, ~line 12627-12633). Keep filter controls on the right.
- Tablet portrait inbox header: Same change — switch from the "Inbox" heading + small "New" button to the blue "New Inbox Task" button (matching landscape).
- The Glance FABs are already hidden when Inbox tab is active (due to tab switching logic), so no FABs will overlay the inbox.

## 4. Timeline FABs — Add More Spacing

**Current state (tablet):**
- New Task FAB: `right: 1rem, bottom: 1.5rem` (w-14 h-14)
- Routines FAB: `right: 1rem, bottom: 5.5rem` (w-12 h-12)
- Gap between them: ~4rem (5.5rem - 1.5rem), but the FABs are 3.5rem and 3rem tall so that's only ~0.5rem of visual gap.

**Current state (desktop):**
- New Task FAB: `right: 1.5rem, bottom: 1.5rem` (w-14 h-14)
- Routines FAB: `right: 1.75rem, bottom: 5rem` (w-12 h-12)
- Similar tight spacing.

**Changes:**
- Increase the bottom offset of the Routines FAB from `5.5rem` to `6rem` on tablet (giving ~1rem visual gap instead of ~0.5rem).
- Match on desktop: Routines FAB from `5rem` to `6rem`.
- This gives a clear visual separation without being too far apart.

## 5. Header Panel — Add Top/Bottom Spacing

**Current state:**
- Desktop header: `height: 48px`, `px-4`, `flex items-center`. Content is vertically centered but the bar itself has no padding above/below.
- Tablet header: `height: 48px`, `px-4`, same.

**Changes:**
- Add vertical padding to the desktop header: Change from `height: 48px` to `height: 56px` (or add `py-1` padding) to give breathing room.
- Apply same to tablet header.
- This gives the header elements more visual breathing room on top and bottom.

## 6. Weather Forecast — Show Days That Fit Based on Visible Day Columns

**Current state:**
- Weather forecast is **only** shown when `visibleDays === 3` (desktop ≥1600px).
- At 2-day view (1200-1599px), no forecast is shown — wasted space.
- Tablet has no weather display at all (this is intentional per user — weather is desktop-only).

**Changes:**
- When `visibleDays === 3`: Show 5 forecast days (current behavior).
- When `visibleDays === 2`: Show 2 forecast days (first 2 from the forecast array).
- When `visibleDays === 1`: Show current weather only (no forecast, space is tight).
- Change the condition at line 11969 from `visibleDays === 3` to `visibleDays >= 2`, and slice the forecast array: `weather.forecast.slice(0, visibleDays === 3 ? 5 : 2)`.

## 7. Daily Summary — 2-Panel View (Daily Stats + All Time) on ALL Platforms

**Current state:**
- **Mobile** daily summary (line 11698): Shows daily stats only (ring, completion count, time stats). No "All Time" section.
- **Desktop/Tablet** daily summary (line 15528): Shows both daily stats AND "All Time" section in a single scrollable modal.

**Changes:**
- Add the "All Time" section to the **mobile** daily summary bottom sheet (matching what desktop/tablet already has at line 15594-15645).
- This makes all platforms consistent: daily stats panel first, then all-time stats panel below, separated by a border-top divider.

---

## Summary of Files Changed
- `src/App.jsx` — all changes are in this single file

## Order of Implementation
1. Desktop side panel: Add tab bar, make sections conditional
2. Tablet portrait: Switch to tab-based navigation
3. Desktop Glance FABs: Replace 4-FAB cluster with 3-FAB layout matching tablet landscape
4. Inbox header: Unify to "New Inbox Task" button pattern
5. Timeline FABs: Increase spacing
6. Header panel: Add vertical spacing
7. Weather forecast: Show proportional forecast days
8. Mobile daily summary: Add All Time stats section
