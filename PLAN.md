# Habit Tracking Feature — Implementation Plan

## Overview

Add habit tracking to dayGLANCE with two habit types:
- **"Do more"** — track progress toward a daily goal (e.g., drink 8 glasses of water, hit 10k steps)
- **"Limit"** — track consumption against a daily ceiling (e.g., max 2 sugary drinks/day)

Habits display as colored **progress rings** in the Glance tab/panel and on **past date headers** in the timeline view.

---

## 1. Data Model

### Habit Definitions
Stored in state as `habits` array, persisted to `localStorage` key `day-planner-habits`:

```js
{
  id: string,           // unique ID (crypto.randomUUID or Date.now)
  name: string,         // "Drink water", "Sugary drinks"
  icon: string,         // lucide icon name: "Droplets", "CupSoda", "Footprints", etc.
  color: string,        // tailwind color like "blue", "red", "green", "amber"
  type: "doMore" | "limit",
  target: number,       // daily goal (8 glasses) or daily ceiling (2 drinks)
  unit: string,         // "glasses", "drinks", "steps", etc.
  createdAt: string,    // ISO date
  archived: boolean     // soft-delete / hide without losing data
}
```

### Habit Logs
Stored in state as `habitLogs` object, persisted to `localStorage` key `day-planner-habit-logs`:

```js
{
  "2026-02-23": {           // date string key
    "habit-id-1": 5,        // count logged for that habit on that day
    "habit-id-2": 1
  },
  "2026-02-22": { ... }
}
```

This flat date→{habitId→count} structure allows O(1) lookups for any date/habit combo and is efficient for both the Glance panel (today's data) and date headers (past days).

---

## 2. Ring Color Logic

### "Do more" habits (e.g., drink 8 glasses of water)
| Progress       | Ring color | Meaning              |
|---------------|------------|----------------------|
| 0%            | Gray       | Not started          |
| 1–99%         | Habit color (partial fill) | In progress |
| 100%          | Habit color (full) + checkmark | Goal met! |

### "Limit" habits (e.g., max 2 sugary drinks)
| Count vs Target | Ring color | Meaning                        |
|----------------|------------|--------------------------------|
| 0              | Green (full ring) | Clean — no consumption  |
| 1 to target    | Yellow/amber (full ring) | Warning zone — within limit but approaching |
| > target       | Red (full ring) | Busted — exceeded limit |

For limit habits, the ring is always full (not a progress ring) — it acts as a **status indicator** whose color shifts through green → yellow → red as the count rises. Specifically:
- 0 logged: green ring
- 1 to `target` logged: yellow/amber ring (graduated — the closer to target, the darker/warmer the amber)
- Above `target` logged: red ring with an X or broken visual

---

## 3. UI Components

### A. `HabitRing` — SVG circular progress ring (new inline component)
- Props: `size`, `progress` (0–1 for doMore), `status` (for limit), `color`, `icon`, `count`, `target`, `type`
- Small (18px) variant for date headers, medium (40px) variant for Glance panel
- Uses SVG `<circle>` with `stroke-dasharray`/`stroke-dashoffset` for the progress arc
- Icon rendered inside using a lucide icon or emoji fallback
- Tap handler for quick increment (Glance panel only)

### B. Glance Panel — Habit Rings Row
- Location: `mobileActiveTab === 'dayglance'` section (line ~10871), after search bar, before overdue tasks
- Also in tablet Glance panel (`tabletActiveTab === 'glance'`, line ~13237)
- Renders a **fixed-width row** showing up to **3–4 `HabitRing` components** for today (no horizontal scrolling)
- If the user has more than 4 active habits, the extra rings are hidden behind a **"+N" overflow button** that opens a dropdown/popover showing the remaining habits as a compact list (ring + name + count, tappable to increment)
- Each ring: medium size, shows icon + count label below
- **Tap** a ring → increment count by 1
- **Long-press** a ring → open a small popover to set exact count or decrement

### C. Date Headers — Mini Habit Rings
- Location: Desktop date header row (line ~14466) and mobile date header (line ~10095)
- Only show for **past dates** (not today, not future)
- Render as a row of tiny (16-18px) rings next to the date text
- No interaction (display only for past days)
- Skip if no habits were defined on that date (check `habitLogs[dateStr]`)

### D. Habit Management FAB + Modal
- A **FAB (Floating Action Button)** is added to the existing FAB array at the bottom of the Glance panel/tab (e.g., a gear or list icon) — tapping it opens the habit management modal
- CRUD operations: add, edit, reorder, archive habits
- Per habit: name, icon picker (subset of lucide icons), color picker, type toggle (do more / limit), target number, unit label
- Max ~8 active habits to keep the UI compact

### E. Settings Toggle
- A **"Habit Tracking" toggle** in the Settings panel allows the user to enable/disable the entire habit system
- When disabled: habit rings row, overflow menu, date header mini-rings, and the habit management FAB are all hidden
- Habit data (definitions + logs) is **preserved** when disabled — turning it back on restores everything
- Defaults to **enabled** (on) so the feature is discoverable out of the box

---

## 4. State Management

### New useState hooks (in main `DayPlanner` component, around line ~1200):
```js
const [habits, setHabits] = useState([]);
const [habitLogs, setHabitLogs] = useState({});
const [habitsEnabled, setHabitsEnabled] = useState(true);
```

### localStorage keys:
- `day-planner-habits` — habit definitions array
- `day-planner-habit-logs` — date-keyed log object
- `day-planner-habits-enabled` — boolean toggle (persisted with other settings)

### Load in `loadData()` (~line 2759):
```js
const habitsData = localStorage.getItem('day-planner-habits');
if (habitsData) setHabits(JSON.parse(habitsData));
const habitLogsData = localStorage.getItem('day-planner-habit-logs');
if (habitLogsData) setHabitLogs(JSON.parse(habitLogsData));
```

### Save in `saveData()` (~line 3015):
```js
localStorage.setItem('day-planner-habits', JSON.stringify(habits));
localStorage.setItem('day-planner-habit-logs', JSON.stringify(habitLogs));
```

### Include in cloud sync payload (`buildSyncPayload`, ~line 8389):
```js
habits: JSON.parse(localStorage.getItem('day-planner-habits') || '[]'),
habitLogs: JSON.parse(localStorage.getItem('day-planner-habit-logs') || '{}'),
```

### Include in backup export/import (`exportBackup` ~line 7958, `buildAutoBackupPayload` ~line 7992):
Add `habits` and `habitLogs` to both payload objects.

### Include in `applyRemoteData` (~line 8444):
```js
if (data.habits) { localStorage.setItem('day-planner-habits', JSON.stringify(data.habits)); setHabits(data.habits); }
if (data.habitLogs) { localStorage.setItem('day-planner-habit-logs', JSON.stringify(data.habitLogs)); setHabitLogs(data.habitLogs); }
```

### Include in `saveData` dependency array (~line 2584).

---

## 5. Interaction Design

### Logging a habit (Glance panel):
1. Tap the ring → `setHabitLogs(prev => ({ ...prev, [todayStr]: { ...prev[todayStr], [habitId]: (prev[todayStr]?.[habitId] || 0) + 1 } }))`
2. Play a subtle UI sound (`playUISound`)
3. Ring animates: progress fill increases (doMore) or color shifts (limit)
4. When doMore goal reached: brief celebration animation (ring pulses green + checkmark)
5. When limit busted: ring flashes red briefly

### Long-press on ring:
- Opens a small bottom sheet / popover with:
  - Current count display
  - +/- buttons for fine control
  - "Reset" to set back to 0

### Undo support:
- Habit log changes call `pushUndo()` before mutation
- Undo toast shows "Habit logged" / "Habit reset"

---

## 6. Files to Modify

All changes are in `src/App.jsx` (monolithic single-file app) plus minor additions:

1. **`src/App.jsx`** — All logic and UI:
   - New state declarations (~line 1200)
   - Load/save in `loadData`/`saveData`
   - Cloud sync + backup payloads
   - `HabitRing` SVG component (inline, near top with other utility components)
   - Habit management modal + FAB entry point
   - Glance panel habit row with overflow menu (mobile + tablet)
   - Date header mini rings (mobile + desktop)
   - Habit logging functions
   - Settings toggle for enabling/disabling habit tracking
   - Undo integration

No new files needed — follows the existing single-file architecture.

---

## 7. Implementation Order

### Phase 1: Foundation
1. Add data model: `habits`/`habitLogs` state, localStorage load/save, cloud sync
2. Build `HabitRing` SVG component with both doMore and limit rendering modes

### Phase 2: Glance Panel
3. Add habit rings row to mobile Glance tab
4. Add habit rings row to tablet Glance panel
5. Implement tap-to-increment and long-press controls

### Phase 3: Date Headers
6. Add mini rings to desktop date headers (past days only)
7. Add mini rings to mobile date headers (past days only)

### Phase 4: Management
8. Build habit management modal (add/edit/reorder/archive)
9. Add habit management FAB to Glance panel FAB array
10. Add "Habit Tracking" on/off toggle to Settings panel (gates all habit UI)

### Phase 5: Polish
11. Add undo support for habit logging
12. Include habits in backup export/import
13. Add keyboard shortcut for quick habit log (optional)
14. Test across mobile, tablet, desktop breakpoints
