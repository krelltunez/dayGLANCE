# App.jsx Refactoring Plan

## Why the Previous Branch Failed

The previous attempt (`claude/app-review-ltS3z`) collapsed under its own weight:

- **68 commits, 103 files touched, 25,700-line monolith → 1,587 lines** — done far too quickly
- The fatal commit was `849d386`: MobileLayout, DesktopLayout, AND DayPlannerContext were
  all created in one shot, threading ~725 state/handler variables into a context object.
  Verifying that every variable was present and correct was impossible at that scale.
- **20+ of 68 commits were pure bug-fixes** for TDZ violations, missing context values,
  missing imports, duplicate declarations, and invalid JSX — all caused by moving too fast.
- Context was split (SyncContext, FeaturesContext) before the layouts were even stable,
  compounding every problem.

## Guiding Principles for This Attempt

1. **One file per commit.** No exceptions.
2. **`npm run build` must pass after every single commit.** If it doesn't, fix it before moving on.
3. **Manual smoke test after every logical group** (end of each Phase). Don't skip this.
4. **Never move code you haven't read.** Read the source, read the destination.
5. **Map dependencies before touching code.** Know what every hook receives and returns.
6. **No context until layouts are stable.** Context is step 7, not step 1.
7. **No context splitting until everything else is done.** SyncContext/FeaturesContext is optional and last.

---

## Smoke Test Checklist

Run this at the end of every Phase. Keep it open in the browser while testing.

- [ ] App loads without any console errors or warnings
- [ ] Tasks can be created (new task form, press Enter)
- [ ] Tasks can be edited (click title, change text, save)
- [ ] Tasks can be deleted (delete key or trash icon)
- [ ] Tasks can be dragged and dropped on the timeline
- [ ] Date navigation works (forward/back arrows)
- [ ] Habits panel loads and logging a habit works
- [ ] Routines dashboard opens (`/routines` or gear icon)
- [ ] Settings modal opens and displays all tabs
- [ ] Focus mode modal opens and timer starts
- [ ] Spotlight search opens (Cmd/Ctrl+K) and finds tasks
- [ ] Mobile layout renders correctly (DevTools → responsive mode, 390px wide)
- [ ] Mobile tabs switch (Day Glance, Inbox, Habits, Settings)
- [ ] No blank screen on any route
- [ ] Browser DevTools console is clean (zero errors)

---

## Phase 0 — Groundwork (no App.jsx changes)

These are one-time setup steps that make every subsequent step safer.

### Step 0.1 — Enable source maps in production build

In `vite.config.js`, add `sourcemap: true` to the `build` section. This makes stack traces
in the browser point to real file/line numbers instead of minified output.

**Commit:** `chore: enable source maps in production build`

**Test:** `npm run build` succeeds. Open `dist/` — verify `.map` files were created.

### Step 0.2 — Create the stress-test data script (optional but useful)

If you want a script to inject many tasks for performance/layout testing, add it at
`scripts/stress-inject.js` now, before touching any source files. This way it's never
accidentally bundled.

**Commit:** `chore: add stress-test data injection script`

**Test:** Run the script manually, verify tasks appear, then clear localStorage.

---

## Phase 1 — Pure Utility Extraction

These files contain **zero React, zero hooks, zero state** — just pure functions.
They are the lowest-risk extractions possible. A mistake here shows up immediately
as a build error, not a runtime crash.

### Step 1.1 — Extract `src/utils/storage.js`

Functions: `getStorageUsage`, `formatBytes`, and any other localStorage-measurement utilities.

**Commit:** `refactor: extract storage utilities to src/utils/storage.js`

**Build:** `npm run build` ✓
**Test:** Open Settings → Storage tab. Verify it still shows correct usage numbers.

---

### Step 1.2 — Extract `src/utils/cloudSyncProviders.js`

The `CLOUD_SYNC_PROVIDERS` array and any provider-lookup helpers.

**Commit:** `refactor: extract cloud sync provider config to src/utils/cloudSyncProviders.js`

**Build:** `npm run build` ✓
**Test:** Open Settings → Cloud Sync. Verify provider dropdown shows all options.

---

### Step 1.3 — Extract `src/utils/autoBackup.js`

Constants and helpers: `autoBackupDB`, `autoBackupProviders`, backup-interval constants.

**Commit:** `refactor: extract auto-backup config to src/utils/autoBackup.js`

**Build:** `npm run build` ✓
**Test:** Open Settings → Auto-Backup. Verify provider options and intervals appear correctly.

---

### Step 1.4 — Extract `src/utils/textFormatting.jsx`

Functions: `renderFormattedText`, `isOnlyUrl`, `renderTitle`, `highlightMatch`,
`renderTitleWithoutTags`, and any other pure text-rendering helpers.

**Commit:** `refactor: extract text formatting utilities to src/utils/textFormatting.jsx`

**Build:** `npm run build` ✓
**Test:** Create a task with a URL and one with `#tag`. Verify both render with correct styling.

---

### Step 1.5 — Extract `src/utils/taskUtils.js`

Pure functions: `extractTags`, `getRecurrenceLabel`, time/date formatters that don't
depend on React state, inbox/tag classification helpers.

**Commit:** `refactor: extract task utility functions to src/utils/taskUtils.js`

**Build:** `npm run build` ✓
**Test:** Tags display correctly on tasks. Recurrence labels show correctly on recurring tasks.

---

### Step 1.6 — Extract `src/utils/suggestionParser.js`

The AI suggestion parsing logic (parses time/tag/date suggestions from task input text).

**Commit:** `refactor: extract suggestion parser to src/utils/suggestionParser.js`

**Build:** `npm run build` ✓
**Test:** Type `#tag` or a time like `3pm` in the new-task input. Verify autocomplete suggestions appear.

---

### Step 1.7 — Extract `src/constants/habits.js`

`HABIT_ICONS`, `HABIT_COLORS`, and any other static habit configuration arrays.

**Commit:** `refactor: extract habit constants to src/constants/habits.js`

**Build:** `npm run build` ✓
**Test:** Open the Habit modal. Verify icons and color options all appear.

---

### Step 1.8 — Extract `src/constants/frames.js`

`FRAME_COLORS`, `DAY_LABELS`, and any other GTD frames configuration constants.

**Commit:** `refactor: extract frame constants to src/constants/frames.js`

**Build:** `npm run build` ✓
**Test:** Open GTD Frames modal. Verify color options and day labels appear.

---

**→ END OF PHASE 1: Run the full Smoke Test Checklist.**

---

## Phase 2 — Simple Self-Contained Components

These components exist in App.jsx but have no dependency on App-level state.
They receive only simple props (or none at all). Safe to extract one at a time.

### Step 2.1 — Extract `src/components/ClockTimePicker.jsx`

A self-contained time-picker wheel component. Receives `value` and `onChange` props only.

**Commit:** `refactor: extract ClockTimePicker component`

**Build:** `npm run build` ✓
**Test:** Create a new scheduled task and set a start time. Verify the time picker works.

---

### Step 2.2 — Extract `src/components/HabitRing.jsx`

`HabitRing` and `MiniHabitRing`. Receive habit data as props, emit callbacks.

**Commit:** `refactor: extract HabitRing and MiniHabitRing components`

**Build:** `npm run build` ✓
**Test:** Habit rings render in the habits panel. Clicking/long-pressing shows the log popover.

---

### Step 2.3 — Extract `src/components/FrameEditor.jsx`

The frame editing form used inside the Frames modal.

**Commit:** `refactor: extract FrameEditor component`

**Build:** `npm run build` ✓
**Test:** Open Frames modal, edit a frame. Verify all fields save correctly.

---

### Step 2.4 — Extract `src/components/QuickAddFrameForm.jsx`

The quick-add form for creating a new GTD frame inline.

**Commit:** `refactor: extract QuickAddFrameForm component`

**Build:** `npm run build` ✓
**Test:** Open Frames modal, use the quick-add form. Verify a new frame is created.

---

### Step 2.5 — Extract `src/components/SmartSchedulePanel.jsx`

The AI smart scheduling panel.

**Commit:** `refactor: extract SmartSchedulePanel component`

**Build:** `npm run build` ✓
**Test:** Open the smart schedule panel. Verify it renders.

---

### Step 2.6 — Extract `src/components/SuggestionAutocomplete.jsx`

The suggestion dropdown that appears under the new-task input.

**Commit:** `refactor: extract SuggestionAutocomplete component`

**Build:** `npm run build` ✓
**Test:** Type `#` in new-task input. Verify tag suggestions drop down. Press Tab to accept one.

---

### Step 2.7 — Extract `src/components/GettingStartedChecklist.jsx`

The onboarding checklist panel.

**Commit:** `refactor: extract GettingStartedChecklist component`

**Build:** `npm run build` ✓
**Test:** If onboarding is not dismissed, verify the checklist renders. Check each item off.

---

### Step 2.8 — Extract sub-panels: `NotesSubtasksPanel`, `DailyNotesModal`

These are self-contained, receive task data as props.

**Two commits, one file each.**

**Build after each:** `npm run build` ✓
**Test:** Click the notes icon on a task. Verify notes panel opens and saves. Open daily notes.

---

### Step 2.9 — Extract form-only settings components

- `src/components/CloudSyncSettingsForm.jsx`
- `src/components/AutoBackupSettingsForm.jsx`

These are pure form UIs that receive config + onChange props.

**Two commits, one file each.**

**Build after each:** `npm run build` ✓
**Test:** Open Settings → Cloud Sync, Settings → Auto-Backup. Verify forms render and save changes.

---

**→ END OF PHASE 2: Run the full Smoke Test Checklist.**

---

## Phase 3 — Leaf Hooks (no cross-hook dependencies)

These hooks are "leaf nodes" — they don't call any other custom hook from App.jsx.
They only use React primitives (`useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`).

**For each hook:**
1. Read the existing inline code in App.jsx carefully.
2. Note exactly what arguments it needs (state setters, refs, config values).
3. Note exactly what it returns.
4. Create the file in `src/hooks/`.
5. Import and call it in App.jsx, removing the inline code.
6. `npm run build` ✓
7. Test the specific feature.

---

### Step 3.1 — `useVisibleDays`

Computes the array of visible day columns. Takes no arguments from App, derives from `selectedDate`.

**Commit:** `refactor: extract useVisibleDays hook`

**Test:** Date navigation. Verify the correct days show in the calendar.

---

### Step 3.2 — `useDeviceType`

Detects phone/tablet/desktop via window width. Returns `{ isPhone, isMobile, isTablet }`.

**Commit:** `refactor: extract useDeviceType hook`

**Test:** Resize browser window. Verify layout switches between mobile and desktop.

---

### Step 3.3 — `useIsLandscape`

Detects landscape orientation via `window.matchMedia`. Returns boolean.

**Commit:** `refactor: extract useIsLandscape hook`

**Test:** Use DevTools to rotate to landscape. Verify layout adjusts.

---

### Step 3.4 — `useUndo`

Undo/redo stack for task operations. Self-contained state management.

**Commit:** `refactor: extract useUndo hook`

**Test:** Delete a task, press Cmd/Ctrl+Z. Verify it restores.

---

### Step 3.5 — `useAudio`

Audio engine: loads and plays UI sounds. Returns `playUISoundRef` and any audio helpers.

> ⚠️ **`playUISoundRef` is used by other hooks.** Before extracting, search for every
> reference to `playUISoundRef` in App.jsx and note where it is passed as an argument.
> After extraction, verify all those call sites receive it correctly.

**Commit:** `refactor: extract useAudio hook`

**Test:** Complete a task. Verify the completion sound plays (if sounds are enabled in Settings).

---

### Step 3.6 — `useWeather`

Fetches weather data based on `weatherZip` and `weatherTempUnit` settings.
Returns `{ weather, setWeather }`.

**Commit:** `refactor: extract useWeather hook`

**Test:** Open Settings, set a valid zip code. Verify weather data appears in the header.

---

### Step 3.7 — `useTagFilter`

Manages `selectedTags`, `showUntagged`, and the tag-filter panel state.

**Commit:** `refactor: extract useTagFilter hook`

**Test:** Click a tag in the tag filter. Verify tasks filter correctly. Clear the filter.

---

### Step 3.8 — `useOnboarding`

Manages `showWelcome`, `onboardingProgress`, `onboardingComplete`, `gettingStartedDismissed`.

**Commit:** `refactor: extract useOnboarding hook`

**Test:** Clear `onboardingComplete` from localStorage, reload. Verify welcome modal appears.
Complete onboarding. Verify it dismisses and doesn't reappear on reload.

---

### Step 3.9 — `useDailyContent`

Manages `dailyContent` and `contentRotation` state (motivational quotes / daily tip rotation).

**Commit:** `refactor: extract useDailyContent hook`

**Test:** Verify the daily content widget renders in the header or sidebar.

---

**→ END OF PHASE 3: Run the full Smoke Test Checklist.**

---

## Phase 4 — Feature Domain Hooks

These hooks encapsulate a complete feature's state. Each is a large blob of `useState` /
`useRef` declarations. They are more complex than Phase 3 hooks but are still largely
self-contained — they communicate with the rest of App via arguments and return values.

**Before each extraction, do this checklist:**
- [ ] Read every `useState`, `useRef`, and `useEffect` that belongs to this feature in App.jsx
- [ ] List every variable this feature's effects read from *outside* its own state (these become arguments)
- [ ] List every variable this feature exposes that other hooks or JSX consume (these become return values)
- [ ] Search App.jsx for every reference to the return values to confirm the list is complete

---

### Step 4.1 — `useHabits`

**State it owns:** `habits`, `habitLogs`, `habitsEnabled`, `showHabitModal`, `editingHabit`,
`draggedHabitIdx`, `habitOverflowOpen`, `habitLongPressId`, `habitEditingCountId`,
`habitLongPressTimer` (ref), `editingHabitRef` (ref).

> ⚠️ **`habitLongPressTimer` is a ref.** It was missing from the context object in the
> previous branch and caused crashes. When this hook returns it, double-check every
> consumer in App.jsx (and later in layouts) destructures it explicitly.

**Commit:** `refactor: extract useHabits hook`

**Test:** Open habits panel. Log a habit (short press). Long-press a habit to see the popover.
Drag a habit to reorder it. Open the Habit settings modal and add/edit/delete a habit.

---

### Step 4.2 — `useRoutines`

**State it owns:** `routineDefinitions`, `todayRoutines`, `routinesDate`, `removedTodayRoutineIds`,
`showRoutinesDashboard`, `dashboardSelectedChips`, `routineAddingToBucket`, `routineNewChipName`,
`routineTimePickerChipId`, `routineDeleteConfirm`, `routineFocusedChipId`, `routineDurationEditId`,
`routinesEnabled`.

> ⚠️ **`routinesEnabled` is also read by other hooks** (specifically localStorage persistence
> and possibly drag/drop). Search for every reference before extracting.

**Commit:** `refactor: extract useRoutines hook`

**Test:** Open Routines Dashboard. Add a routine to a bucket. Verify it appears in today's list.
Check that toggling routines on/off in Settings works.

---

### Step 4.3 — `useFocusMode`

**State it owns:** `showFocusMode`, `focusPhase`, `focusTimerSeconds`, `focusCycleCount`,
`focusSessionStart`, `focusWorkMinutes`, `focusBreakMinutes`, `focusLongBreakMinutes`,
`focusCompletedTasks`, `focusShowStats`, `focusShowSettings`, `focusTimerRunning`,
`focusTaskMinutes`, `focusBlockTasks`, `wakeLockSentinel` (ref), `focusTimerRef` (ref),
`handleFocusTimerEndRef` (ref), `focusModeAvailableRef` (ref).

**Commit:** `refactor: extract useFocusMode hook`

**Test:** Open Focus Mode. Start the timer. Let it count for 10 seconds. Verify it counts up.
Pause it. Switch phases. Close and reopen — verify state resets correctly.

---

### Step 4.4 — `useTrmnlSync`

**State it owns:** `trmnlConfig`, `trmnlSyncStatus`, `trmnlLastSynced`, `trmnlMarkupCopied`,
`trmnlSyncTimerRef` (ref), `trmnlLastPushRef` (ref), `trmnlBackoffUntilRef` (ref),
`performTrmnlSyncRef` (ref).

**Commit:** `refactor: extract useTrmnlSync hook`

**Test:** Open Settings → TRMNL. Verify config fields load. If you have a test key, verify sync.

---

### Step 4.5 — `useObsidian`

**State it owns:** `obsidianConfig`, `obsidianSyncStatus`, `obsidianLastSynced`,
`obsidianVaultHandleRef` (ref), `obsidianSyncInProgressRef` (ref), `obsidianPrevTaskStateRef` (ref).

**Commit:** `refactor: extract useObsidian hook`

**Test:** Open Settings → Obsidian. Verify config loads. (Full sync requires a real vault, but
UI should render without errors.)

---

### Step 4.6 — `useCloudSync`

**State it owns:** `cloudSyncConfig`, `cloudSyncStatus`, `cloudSyncError`, `cloudSyncLastSynced`,
`cloudSyncConflict`, `cloudSyncDebounceRef` (ref), `suppressCloudUploadRef` (ref), and
several other cloud-sync control refs.

> ⚠️ **Cloud sync writes to localStorage.** Use the dev-folder redirect (`dayglance-dev/`)
> from the abandoned branch during testing so you don't corrupt real data.

**Commit:** `refactor: extract useCloudSync hook`

**Test:** Open Settings → Cloud Sync. Verify the config form loads. If configured, verify
sync status indicator updates.

---

### Step 4.7 — `useCalendarSync`

**State it owns:** `taskCalendarUrl`, `taskCalendarAuth`, `syncRetentionDays`, `completedTaskUids`,
`pendingImportFile`, `showImportModal`, `importColor`, `calSyncStatus`, `calSyncLastSynced`.

**Commit:** `refactor: extract useCalendarSync hook`

**Test:** Open Settings → Calendar. Verify URL and auth fields render. Test import modal opens.

---

### Step 4.8 — `useBackup`

**State it owns:** `pendingBackupFile`, `showRestoreConfirm`, `showBackupMenu`.

**Commit:** `refactor: extract useBackup hook`

**Test:** Open the backup menu. Verify download backup works. Verify restore-from-file flow
opens the confirm modal.

---

### Step 4.9 — `useGTDFrames`

**State it owns:** GTD frame definitions and the frames modal state
(`showFramesModal`, `showFrameAdjustModal`, `showFrameScheduleModal`, etc.).

> ⚠️ In the previous branch, `gtdFrames` state had to be hoisted back into App.jsx because
> `useCloudSync` needed it. Before extracting, confirm whether cloud sync needs to read frame
> data, and if so, plan how to pass it as an argument.

**Commit:** `refactor: extract useGTDFrames hook`

**Test:** Open GTD Frames modal. Create a frame, edit it, delete it. Verify frames appear on
the timeline correctly.

---

### Step 4.10 — `useVoiceAI`

**State it owns:** AI config state, voice input state, weekly review state.

**Commit:** `refactor: extract useVoiceAI hook`

**Test:** Open Voice Input modal. Verify it renders. If AI is configured, verify it accepts input.

---

**→ END OF PHASE 4: Run the full Smoke Test Checklist.**
Pay special attention to habits, routines, focus mode, and sync features since these are
the ones just extracted.

---

## Phase 5 — Core Task Logic Hooks

These are the most interconnected hooks. They share state (tasks, selectedDate) and
call each other's handlers. **Read the dependency notes carefully before each one.**

---

### Step 5.1 — `useNavigation`

**Manages:** `selectedDate`, date-forward/back handlers, spotlight selection handler.

**Receives:** `tasks`, `setSelectedDate`, and possibly `setSpotlightOpen`.

**Commit:** `refactor: extract useNavigation hook`

**Test:** Click forward/back date arrows. Verify correct date is shown. Open spotlight (Cmd+K),
click a task result — verify date jumps to that task's date.

---

### Step 5.2 — `useStats`

**Manages:** Computed statistics (inbox completed today, all-time counts, points).
Returns derived values only — no setters.

> ⚠️ In the previous branch, `inboxCompletedToday` and `allTimeInboxCompleted` from this hook
> were missing from the context object, causing crashes. When extracting, list every return value
> and grep App.jsx to confirm all consumers receive it.

**Commit:** `refactor: extract useStats hook`

**Test:** Complete several tasks. Check the stats displayed in the habits panel or header.

---

### Step 5.3 — `useComputedViews`

**Manages:** Derived views of the task list: filtered tasks, sorted inbox, tag lists.

**Commit:** `refactor: extract useComputedViews hook`

**Test:** Create tasks with different tags, times, dates. Verify they appear in the correct
sections (timeline, inbox, all-day). Apply a tag filter — verify it works.

---

### Step 5.4 — `useTaskDerived`

**Manages:** Per-task derived state: which tasks are visible, overlapping, etc.

**Commit:** `refactor: extract useTaskDerived hook`

**Test:** Create overlapping tasks on the timeline. Verify they render side-by-side without
covering each other.

---

### Step 5.5 — `useDeadlinePriority`

**Manages:** Deadline-based priority highlighting, priority timeout logic.

**Commit:** `refactor: extract useDeadlinePriority hook`

**Test:** Set a deadline on a task that is due today. Verify it shows a priority indicator.

---

### Step 5.6 — `useConflictDetection`

**Manages:** Time-conflict detection between overlapping scheduled tasks.

**Commit:** `refactor: extract useConflictDetection hook`

**Test:** Create two tasks at the same time. Verify the conflict warning appears.

---

### Step 5.7 — `useNewTaskInput`

**Manages:** The new-task input form state (`newTask`, autocomplete state, suggestion state).

**Commit:** `refactor: extract useNewTaskInput hook`

**Test:** Type in the new-task field. Verify autocomplete suggestions appear for `#` and time.
Tab to accept. Press Enter to create the task.

---

### Step 5.8 — `useTaskFormHelpers`

**Manages:** Shared helpers used across new-task and edit-task forms (tag parsing, time parsing,
input ref management).

> ⚠️ In the previous branch, `useDragDrop` depended on `useTaskFormHelpers`. Extract this
> one BEFORE `useDragDrop`.

**Commit:** `refactor: extract useTaskFormHelpers hook`

**Test:** Edit an existing task. Verify the input populates correctly and saves on blur/Enter.

---

### Step 5.9 — `useTaskActions`

**Manages:** Task CRUD: create, update, delete, complete, move, schedule. The largest and most
important hook.

**Before extracting:** Map every function this exposes and grep for each one in App.jsx.
There will be many — don't miss any.

**Commit:** `refactor: extract useTaskActions hook`

**Test (comprehensive):**
- Create a task → verify it appears
- Edit task title → verify it saves
- Complete a task → verify it moves to completed state
- Delete a task → verify it's gone
- Move a task to the inbox → verify it appears there
- Schedule an inbox task → verify it appears on the timeline

---

### Step 5.10 — `useRecycleBin`

**Manages:** Recycle bin state, restore/empty operations.

**Commit:** `refactor: extract useRecycleBin hook`

**Test:** Delete a task. Open the recycle bin. Verify the task is there. Restore it.
Verify it reappears. Empty the bin. Verify it's cleared.

---

### Step 5.11 — `useReminderEngine`

**Manages:** Reminder scheduling, toast triggers, reminder refs.

**Commit:** `refactor: extract useReminderEngine hook`

**Test:** Set a reminder on a task for 1 minute from now. Wait. Verify the toast appears.

---

### Step 5.12 — `useReminders`

**Manages:** Reminder CRUD and settings state.

**Commit:** `refactor: extract useReminders hook`

**Test:** Open Reminders settings. Add a reminder. Verify it saves and appears in the list.

---

### Step 5.13 — `useMobileEdit`

**Manages:** Mobile-specific task editing flow (`mobileEditingTask`, `mobileEditIsInbox`).

**Commit:** `refactor: extract useMobileEdit hook`

**Test (mobile viewport):** Tap a task to open mobile edit view. Change the title. Verify it saves.

---

### Step 5.14 — `useDragDrop`

**Manages:** All drag/drop/resize/swipe handlers. This is the most complex hook.

> ⚠️ **Read this carefully before extracting:**
> - In the previous branch, `useDragDrop` and `useRoutines` had a circular dependency that
>   required manual untangling. Search for any `routineDefinitions` or routine-related
>   references inside drag handlers.
> - `useTaskFormHelpers` must already be extracted (Step 5.8) since drag/drop uses its helpers.
> - All `autoScrollInterval`, `stickyHeaderRef`, `mobileDrag*` refs belong here.

**Commit:** `refactor: extract useDragDrop hook`

**Test (thorough):**
- Drag a task to a new time on the desktop timeline → verify it moves
- Drag a task to a different date → verify it moves
- Drag an inbox task to the timeline → verify it becomes scheduled
- Resize a task by dragging its bottom edge → verify duration changes
- On mobile: long-press a task to initiate drag → verify it follows the finger

---

**→ END OF PHASE 5: Run the full Smoke Test Checklist.**
This is the most important checkpoint. Every core interaction should work.

---

## Phase 6 — Remaining Infrastructure Hooks

These hooks handle persistence, initialization, and global UI behavior.

---

### Step 6.1 — `useDataPersistence`

**Manages:** `loadData` and `saveData` functions (reads/writes localStorage).

**Commit:** `refactor: extract useDataPersistence hook`

**Test:** Reload the page. Verify all tasks, settings, and habits are restored from storage.
Create a task, reload — verify it persists.

---

### Step 6.2 — `useLocalStoragePersist`

**Manages:** `useEffect` hooks that sync individual settings (darkMode, tags, etc.) to localStorage.

> ⚠️ In the previous branch this hook was moved multiple times due to TDZ — it depended on
> `routinesEnabled` (from `useRoutines`) and other values. Ensure all its dependencies are
> already defined in App.jsx before this hook is called.

**Commit:** `refactor: extract useLocalStoragePersist hook`

**Test:** Toggle dark mode. Reload. Verify dark mode persists. Change a setting. Reload. Verify it persists.

---

### Step 6.3 — `useAppInit`

**Manages:** One-time initialization effects (data load on mount, initial welcome check).

**Commit:** `refactor: extract useAppInit hook`

**Test:** Clear localStorage. Reload. Verify the welcome/onboarding modal appears. Add some tasks,
reload — verify data loads correctly.

---

### Step 6.4 — `useTaskMeasurement`

**Manages:** `taskElementRefs`, `taskWidths` — measures rendered task DOM elements for layout.

**Commit:** `refactor: extract useTaskMeasurement hook`

**Test:** Create several tasks at the same time. Verify they lay out side-by-side with correct widths.

---

### Step 6.5 — `useSaveOnChange`

**Manages:** The effect that triggers `saveData` whenever task state changes.

**Commit:** `refactor: extract useSaveOnChange hook`

**Test:** Create a task, immediately close and reopen the tab. Verify the task persisted.

---

### Step 6.6 — `useTimelineScroll`

**Manages:** `timelineScrolledAway` state, scroll-position detection for the sticky header.

**Commit:** `refactor: extract useTimelineScroll hook`

**Test:** Scroll down the timeline. Verify the sticky header appears. Scroll back up. Verify it hides.

---

### Step 6.7 — `useModalClose`

**Manages:** The `Escape` key listener that closes the topmost open modal.

**Commit:** `refactor: extract useModalClose hook`

**Test:** Open a modal. Press Escape. Verify it closes. Open nested modals. Press Escape repeatedly.
Verify they close one at a time.

---

### Step 6.8 — `useMobileInteractions`

**Manages:** Mobile swipe-to-delete, long-press, and touch gesture state.

**Commit:** `refactor: extract useMobileInteractions hook`

**Test (mobile viewport):** Swipe left on a task — verify delete affordance appears. Swipe right
to cancel. Long-press a task — verify the context menu appears.

---

### Step 6.9 — `useKeyboardShortcuts`

**Manages:** Global keyboard shortcut handlers.

**Commit:** `refactor: extract useKeyboardShortcuts hook`

**Test:** Press `N` to open new task. Press `Cmd/Ctrl+K` for spotlight. Press `?` for shortcut help.
Verify all keyboard shortcuts in the help modal still work.

---

**→ END OF PHASE 6: Run the full Smoke Test Checklist.**

At this point, App.jsx should consist almost entirely of:
- Import statements
- `const` declarations calling the extracted hooks
- A large `return (...)` block with the JSX

---

## Phase 7 — DayPlannerContext

This is the architectural change that enables layout extraction. It is also the riskiest
remaining step, so it must be done with maximum care.

### Step 7.1 — Audit the context object

Before creating any file, list every variable that the JSX in App.jsx's return statement
uses. This list is the context object. It will be long (100+ items). Write it down.

For each variable, note its type:
- **State value** → goes in context, consumers can read it
- **State setter** → goes in context, consumers call it
- **Ref** → goes in context as-is; consumers must not destructure `.current` at render time
- **Handler function** → goes in context

---

### Step 7.2 — Create `src/context/DayPlannerContext.jsx`

```jsx
import { createContext, useContext } from 'react';
export const DayPlannerContext = createContext(null);
export const useDayPlannerCtx = () => useContext(DayPlannerContext);
```

Just the context definition — nothing else.

**Commit:** `refactor: create DayPlannerContext`

**Build:** `npm run build` ✓ (no behavior change)

---

### Step 7.3 — Wrap App.jsx return with the Provider

Add `useMemo` to build the context value. Wrap `<DayPlannerContext.Provider value={ctx}>`.
Keep all JSX inline in App.jsx for now — do NOT move it to layout files yet.

> ⚠️ **Double-check refs.** Every ref (`habitLongPressTimer`, `autoScrollInterval`, etc.)
> must be explicitly included in the context object. Search App.jsx for every `useRef`
> return value and confirm it is in the context.

**Commit:** `refactor: wrap App.jsx return in DayPlannerContext.Provider`

**Build:** `npm run build` ✓
**Test:** Full smoke test. The app must behave identically to before this step.

---

## Phase 8 — Extract Layout Files

Only proceed here if Phase 7 smoke test is completely clean.

### Step 8.1 — Extract `DesktopLayout.jsx`

Copy the desktop JSX branch from App.jsx's return statement into a new component.
Have it call `useDayPlannerCtx()` at the top.

**Before submitting the commit:**
1. List every variable the desktop JSX uses
2. Verify every one is in the context object from Step 7.3
3. Verify every import used by extracted JSX is included in DesktopLayout.jsx

**Commit:** `refactor: extract DesktopLayout component`

**Build:** `npm run build` ✓
**Test (desktop-focused):** Every part of the desktop UI must work. Open every modal. Drag tasks.
Use keyboard shortcuts. Check settings.

---

### Step 8.2 — Extract `MobileLayout.jsx`

Same process as DesktopLayout.

**Before submitting the commit:**
1. List every variable the mobile JSX uses
2. Verify every one is in the context object
3. Verify imports

**Commit:** `refactor: extract MobileLayout component`

**Build:** `npm run build` ✓
**Test (mobile viewport, 390px):** All tabs work. Swipe gestures work. Tap to edit. Settings panel opens.

---

### Step 8.3 — Extract layout sub-components (one at a time)

After both layouts are stable, extract sub-components from within them:
- `DesktopHeader` from DesktopLayout
- `MobileTabBar` from MobileLayout
- `MobileSettingsPanel` from MobileLayout
- `MobileRoutinesTab` from MobileLayout

One commit per file. Build and test after each.

---

**→ END OF PHASE 8: Run the full Smoke Test Checklist. Use both desktop and mobile viewports.**

---

## Phase 9 — Extract Modal Components

With stable layouts and a working context, modals are safe to extract one at a time.

**For each modal:**
1. Identify which context values it reads (usually 5–20 values)
2. Decide: does it call `useDayPlannerCtx()` internally, or receive props from its layout?
   **Pick one pattern and use it consistently.**
3. Extract the component
4. Verify its imports include all utilities it uses (these were previously in App.jsx scope)

**Suggested order (simpler to more complex):**

1. `ShortcutHelpModal` — purely informational, no state
2. `DesktopWelcomeModal` / `MobileWelcomeModal`
3. `SpotlightModal`
4. `HabitModal`
5. `FocusModeModal`
6. `RoutinesDashboardModal`
7. `FramesModal`, `FrameAdjustModal`, `FrameScheduleModal`
8. `SettingsModal`
9. `RemindersSettingsModal`
10. `VoiceInputModal`
11. `WeeklyReviewModal`, `WeeklyReviewReminderCard`
12. `IncompleteTasksModal`
13. `BackupMenuModal`, `RestoreConfirmModal`, `AutoBackupManagerModal`
14. `ImportCalendarModal`
15. `StorageBreakdownModal`
16. `EmptyBinConfirmModal`, `RecurringDeleteModal`, `EditRecurrenceModal`
17. `ReminderToasts`
18. `DesktopNewTaskModal`, `MobileNewTaskModal`
19. `DatePicker`, `DeadlinePickerPopover`

**One commit per modal. Build + test after each.**

---

**→ END OF PHASE 9: Final full Smoke Test Checklist.**

---

## Phase 10 — Context Splitting (Optional)

Only attempt this after Phase 9 is completely stable and you've used the app for a few
days without issues.

Splitting DayPlannerContext into SyncContext + FeaturesContext is a **performance
optimization**, not a correctness requirement. Skip it if the app feels fast enough.

If you proceed:
1. Create `SyncContext` (cloud sync, calendar sync, Obsidian, TRMNL, backup state)
2. Migrate sync-domain modals one at a time to `useSyncCtx()`
3. Full smoke test — especially all sync features
4. Create `FeaturesContext` (habits, routines, GTD frames, focus mode, reminders, AI/voice)
5. Migrate features-domain modals one at a time to `useFeaturesCtx()`
6. Full smoke test — especially all feature modals
7. Reduce the main DayPlannerContext to only task/navigation/core state

---

## Quick Reference: What Went Wrong Before

| Symptom | Root Cause | How to Prevent |
|---|---|---|
| `ReferenceError: X is not defined` | Variable extracted to hook but not added to context object | Audit context object completely before wrapping in Provider |
| TDZ crash (`cannot access X before initialization`) | Hook A's return value used as arg to Hook B, but B called before A | Map hook dependency order explicitly; never reorder hooks without re-reading all deps |
| Blank screen on mobile | Layout component missing an import or variable | Read every import the JSX uses; verify all are present in the extracted file |
| Duplicate `const` declarations | Reordering hooks left stale declarations | After any reorder, search for the variable name to find duplicates |
| Missing imports in modals | Modal extracted without carrying over utilities that were in App.jsx scope | Before extracting a modal, list every non-React identifier it uses and ensure each is imported |
