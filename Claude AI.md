  
Now please look at the AI plan document and plan out the phase for GTD productivity blocks and AI scheduling (Phase 4). Please propose a detailed outline before you make any changes. We definitely need to keep the "Scheduling Heuristics" in mind so we don't create conflicts. The idea I originally had was to have user definable "GTD Frames" or blocks on the calendar, into which the AI scheduler could place tasks, because I may not have the same window/time blocks available every day. whaddya think?

Let me find and read the AI plan document first, and explore the current scheduling-related code.

Found AI plan document and explored scheduling codebase architecture

Found AI plan document and explored scheduling codebase architecture

Show more

Good, I have the full plan. Now let me wait for the scheduling code exploration to finish before I design the detailed outline.

Explored task data model and calendar rendering architecture in App.jsx

Explored task data model and calendar rendering architecture in App.jsx

Show more

Excellent, I now have a thorough understanding of both the plan document and the codebase architecture. Let me write up a detailed proposal.

Now let me check what the background scheduling exploration found.

Check background agent output

Check background agent output

Show more

Excellent — I now have a thorough understanding of the codebase, the plan document, and all the existing scheduling infrastructure. Let me synthesize a detailed proposal.

---

## Phase 4: GTD Frames + AI Smart Scheduling — Detailed Outline

### The Core Idea

Your instinct is right — static "productivity blocks" in Settings alone aren't enough because **real life varies day to day**. The proposal: **GTD Frames** are calendar-visible time containers that the AI scheduler fills with inbox tasks. They follow a template/instance model (exactly like your recurring tasks already work): weekly templates provide defaults, but each day's frames can be customized.

---

### Part A: GTD Frame Templates (Settings)

**Data Model** — stored in `localStorage` as `day-planner-gtd-frames`:

```js
[
  {
    id: 'uuid',
    label: 'Morning Deep Work',
    days: [1, 2, 3, 4, 5],       // Mon-Fri (0=Sun, 6=Sat)
    start: '09:00',
    end: '12:00',
    color: 'bg-indigo-200',       // Subtle background color
    tagAffinity: ['work', 'deep-focus'],  // Preferred task tags
    energyLevel: 'high',          // 'high' | 'medium' | 'low'
    bufferMinutes: 5,             // Gap between scheduled tasks
    enabled: true,
  },
  {
    id: 'uuid',
    label: 'Afternoon Tasks',
    days: [1, 2, 3, 4, 5],
    start: '14:00',
    end: '17:00',
    color: 'bg-amber-200',
    tagAffinity: [],              // No preference — general tasks
    energyLevel: 'medium',
    bufferMinutes: 5,
    enabled: true,
  },
  {
    id: 'uuid',
    label: 'Weekend Errands',
    days: [0, 6],
    start: '10:00',
    end: '14:00',
    color: 'bg-green-200',
    tagAffinity: ['errands', 'personal'],
    energyLevel: 'medium',
    bufferMinutes: 10,
    enabled: true,
  }
]
```

**Settings UI:**

- New "GTD Frames" section in Settings (below AI settings, since it's usable even without AI — frames still render as visual guides)
- CRUD for frame templates: label, days-of-week checkboxes, start/end time pickers, color picker, tag affinity multi-select (from existing tags), energy level selector
- Drag-to-reorder priority (higher = AI fills first)

---

### Part B: Frame Instances on the Calendar

**How instances are derived** (same pattern as recurring tasks):

1. For each visible date, check which frame templates apply (by `days` array + `enabled`)
2. Generate frame instances: `{ frameId, templateId, date, start, end, label, ... }`
3. Subtract any existing scheduled tasks / imported calendar events to compute **available gaps** within each frame
4. Render frames as **subtle background zones** on the timeline (translucent colored regions behind tasks)

**Per-day customization:**

- Drag frame edges to resize on a specific day
- Right-click → "Skip this day" (exception)
- Right-click → "Adjust time" for one-off changes
- Stored as exceptions on the template (exactly like recurring task exceptions):
    
    ```js
    template.exceptions = {
      '2026-02-25': { start: '10:00', end: '11:30' },  // Adjusted
      '2026-02-26': { deleted: true },                   // Skipped
    }
    ```
    

**Visual rendering:**

- Light background bands on the timeline (behind tasks, low opacity)
- Small label at the top of the frame zone
- Available time within the frame shown subtly (e.g., dashed outline for unfilled gaps)
- Frames that are fully booked could show a "full" indicator

**Interaction with existing elements:**

- Frames are purely visual containers — they don't conflict with tasks
- Manually scheduled tasks inside a frame reduce its available time
- Imported calendar events inside a frame also reduce available time
- Routine chips sit on top of frames normally

---

### Part C: Available Time Computation (The Bridge)

This is the critical piece that connects frames to the AI. A pure function that computes what's actually available:

```js
function computeAvailableSlots(frameInstance, existingTasks, importedEvents, bufferMinutes) {
  // 1. Start with full frame window [start, end]
  // 2. Subtract each existing task (startTime → startTime + duration)
  // 3. Subtract each imported event
  // 4. Subtract buffer between occupied slots
  // 5. Return array of free intervals:
  //    [{ start: '09:00', end: '10:25', minutes: 85 }, ...]
}
```

This runs **client-side before the AI call** so we send the AI clean, pre-computed gaps rather than making it figure out conflicts. This is:

- More reliable (no hallucinated overlaps)
- More token-efficient (send gaps, not full task lists)
- Provider-agnostic (simpler prompt)

---

### Part D: AI Smart Scheduling

**Trigger points:**

1. "Smart Schedule" button in the inbox panel
2. Morning dayGLANCE "Schedule inbox items?" quick action (already mentioned in Phase 2)
3. Command palette (`Ctrl+K` → "Smart Schedule")

**Flow:**

1. **Gather context:**
    
    - Inbox tasks (with priority, tags, duration, deadline)
    - Available slots across the target date range (today + N days, configurable)
    - Frame metadata (label, tagAffinity, energyLevel) for each slot
2. **Build AI prompt** (new function in `ai-prompts.js`):
    
    ```
    System: You are a GTD scheduling assistant. Place inbox tasks into 
    available time slots following these heuristics:
    
    HEURISTICS:
    - Deadline-first: Tasks with approaching deadlines get earliest placement
    - Tag grouping: Batch tasks with similar tags into the same frame
    - Priority weighting: High-priority tasks go in preferred/high-energy frames
    - Energy matching: Complex tasks → high-energy frames, routine → low-energy
    - Duration fitting: Don't split tasks; find slots that fit the full duration
    - Buffer respect: Honor the buffer between tasks
    - Don't overfill: Leave some breathing room (don't fill 100% of a frame)
    
    AVAILABLE SLOTS:
    [pre-computed gaps with frame labels and energy levels]
    
    INBOX TASKS:
    [task list with all metadata]
    
    Return JSON: { placements: [{ taskId, date, time, frameLabel, reasoning }],
                    unplaceable: [{ taskId, reason }] }
    ```
    
3. **Preview UI** — a modal/overlay showing:
    
    - Calendar preview with proposed task placements highlighted
    - Each placement shows the AI's reasoning (one-liner)
    - Tasks that couldn't be placed listed with reason ("No slot fits 3-hour duration")
    - Per-task accept/reject toggles
    - "Accept All" / "Reject All" buttons
    - Option to adjust date range and re-generate
4. **Apply:**
    
    - Accepted tasks move from `unscheduledTasks` → `tasks` with assigned date/time
    - Preserve task ID (for sync continuity, same as existing inbox→calendar flow)
    - Single undo point (existing `pushUndo()` pattern)

---

### Part E: Scheduling Heuristics — Implementation Details

Rather than relying entirely on the AI to follow heuristics, we can **pre-sort and pre-filter** to guide placement:

|Heuristic|Client-side pre-processing|AI prompt guidance|
|---|---|---|
|**Deadline-first**|Sort inbox tasks by deadline (soonest first, null last)|"Place deadline tasks first, before their due date"|
|**Tag grouping**|Group inbox tasks by overlapping tags|"When multiple tasks share tags, place them consecutively"|
|**Priority weighting**|Include priority (0-3) in task metadata|"Priority 3 tasks should go in high-energy frames"|
|**Energy matching**|Include frame energyLevel with each slot|"Match task complexity to frame energy level"|
|**Duration fitting**|Filter out slots shorter than task duration|Only show slots where the task actually fits|
|**Conflict avoidance**|Pre-computed — gaps already exclude conflicts|Impossible to conflict (slots are pre-validated)|
|**Buffer time**|Gaps already shrunk by bufferMinutes|Already handled|

The key insight: by pre-computing available slots and filtering impossible placements, the AI's job becomes **optimization** (which task goes where) rather than **constraint satisfaction** (does this fit). Much more reliable.

---

### Part F: Implementation Order

|Step|What|Complexity|Depends on|
|---|---|---|---|
|**F1**|GTD Frame data model + Settings CRUD UI|Medium|Nothing|
|**F2**|Frame instance computation (template → per-day instances)|Medium|F1|
|**F3**|Calendar rendering (background zones on timeline)|Medium|F2|
|**F4**|Per-day frame exceptions (resize/skip)|Low-Medium|F2, F3|
|**F5**|Available time computation (gap calculator)|Medium|F2|
|**F6**|AI scheduling prompt + `ai-prompts.js` additions|Medium|F5|
|**F7**|Smart Schedule trigger + preview modal UI|High|F5, F6|
|**F8**|Apply/reject flow + undo integration|Medium|F7|
|**F9**|Morning dayGLANCE integration ("Schedule inbox?")|Low|F7|

**F1-F4** are useful even without AI (visual time-blocking), so they provide standalone value.

---

### Open Questions for You

A few things I want your input on before writing code:

1. **Date range for scheduling** — should "Smart Schedule" default to just today, this week, or let the user pick? (I'm leaning: default to "next 7 days" with a picker)
    
2. **Frame overlap** — should two frames be allowed to overlap on the same day? (e.g., "Morning Focus" 9-12 and "Meetings OK" 10-11). I'd say no — simpler, less confusing.
    
3. **Auto-detect free time** — in addition to template-based frames, should there be a "detect free blocks" mode that auto-creates ad-hoc frames from gaps in the calendar? (Nice-to-have, not MVP)
    
4. **Partial scheduling** — if a task is 2 hours but the largest gap is 90 min, should the AI suggest splitting it? Or just mark it "unplaceable"? (I'd lean: unplaceable for MVP, splitting as a future enhancement)
    

What do you think of this overall shape? Anything you'd add, cut, or rethink before I start building?

Initialized your session

Initialized your session

i don't understand #3 on trigger points (CTRL-K could be confusing because CMD-K is search). regarding your questions: (1) i was originally thinking just today, but i suppose it could plan tasks for the next few days - I wouldn't do more than today +2, (2) no, don't allow overlaps, (3) no, not right now (I don't want AI telling me when I should do stuff - I'm the boss), (4) agree with your recomendation - if a task is to big for the available time, it doesn't get scheduled. The only additional question I have is whether this should be done through a modal that is maybe a new fab button above the plus in the timeline, or whether it should be in the settings. I don't want the settings to get too bogged down, and that's why I'm leaning toward a modal thoughts. Oh, also, I guess if it's a modal, it should be a tab on mobile. What do you think?

Great feedback, let me refine the plan based on all your decisions:

1. **Trigger**: Drop the Ctrl+K idea — you're right, that conflicts with search. Keep "Smart Schedule" button in inbox + Morning dayGLANCE link.
    
2. **Date range**: Today + 2 days max.
    
3. **No auto-detect free time** — you define your frames, you're the boss.
    
4. **Unplaceable if too big** — no splitting.
    
5. **No frame overlap allowed** — validation enforced.
    

On your UI question about **where GTD Frame management lives** — I think you're onto something with keeping it out of Settings. Here's my thinking:

**GTD Frames management via a dedicated modal/tab (not Settings)**

This makes sense because:

- Settings is for configuration (API keys, display prefs, toggles) — Frames are _content_ you interact with regularly
- You'll want to tweak frames frequently ("this week I'm shifting my focus block to afternoons") — burying that in Settings adds friction
- It pairs naturally with the "Smart Schedule" action — manage your frames and trigger scheduling from the same place

**Proposed UI approach:**

- **FAB button** — a new button above the `+` in the timeline area (maybe a calendar-clock icon or a grid/blocks icon). Tapping it opens the GTD Frames modal.
- **Desktop**: Opens as a modal with two sections:
    - **"My Frames"** tab — CRUD for frame templates (the recurring weekly patterns)
    - **"Smart Schedule"** tab — trigger AI scheduling, see preview, accept/reject
- **Mobile**: Opens as a full-screen tab (same as how your monthly view or settings work as full-screen on mobile), with the same two tabs swipeable.
- Frames still _render_ on the calendar timeline as subtle background zones regardless of whether the modal is open.

A minimal "GTD Frames" toggle could live in Settings (just enable/disable the feature + maybe the `bufferMinutes` default), but the actual frame creation/editing lives in this modal.

Does that direction work for you? If so, I'll update the PLAN.md with the finalized Phase 4 design incorporating all these decisions, then we can start building.

yes, i agree we're not changing anything you proposed for the timeline - i still want the frames, etc. to show as you described. i don't understand your proposal for mobile.

You're right, let me clarify. On mobile, how do your existing modals work? Things like Settings, Weekly Review, etc. — do they open as full-screen panels/tabs, or as bottom sheets, or something else? Let me check.

Read App.jsx mobile tab navigation click handler logic

Read App.jsx mobile tab navigation click handler logic

Show more

Show more

Show more

Got it. Now I understand the mobile navigation pattern. On mobile, you have a **bottom tab bar** with tabs: Glance | Timeline | Inbox | Routines | Settings. Each tab renders as a full-screen view. Settings on mobile is a full tab, not a modal.

So here's what I was clumsily trying to say, made clear:

**Desktop**: The GTD Frames management + Smart Schedule is a **modal** (like Settings on desktop is a modal). Triggered by a new FAB button on the timeline.

**Mobile**: It should just be **a new tab in the bottom nav bar** — same as how Glance, Timeline, Inbox, Routines, and Settings each get their own full-screen tab. Something like a "Frames" tab with a grid/blocks icon. Inside that tab: your frame templates list at the top, and the Smart Schedule trigger + preview below.

This way it's consistent with how everything else works on mobile — no weird nested modal-within-a-tab situation. Just another first-class section.

The one concern is that the bottom bar is already 5 tabs (or 4 if Routines is disabled). Adding a 6th could get tight. An alternative would be making it a sub-section within the Inbox tab (since scheduling pulls from inbox), or accessible from a button within the Inbox tab header. What's your preference?

Initialized your session

Initialized your session

maybe if there are 6 tabs, the text labels get dropped? or we do an overflow of some sort? how do other apps deal with this?

Good question. The most common patterns I've seen in popular apps:

1. **Drop text labels** — Instagram, Twitter/X, Reddit all do 5 icon-only tabs. At 6, this is the simplest fix. Your icons are already pretty recognizable (Eye, Calendar, Inbox, Sparkles, Grid, Settings gear).
    
2. **"More" overflow tab** — YouTube, Spotify put less-used items behind a "More" (•••) tab. Downside: extra tap to reach things.
    
3. **Contextual swap** — Some apps change what a tab does based on context. Not great for discoverability though.
    

For your case, I'd recommend **option 1: drop the labels when there are 6 tabs**. You already conditionally show/hide the Routines tab, so the logic would be:

- **5 or fewer tabs** (Routines disabled): keep labels as-is
- **6 tabs** (Routines enabled + Frames): icons only, slightly larger icons to compensate

This is zero-friction — all tabs remain one tap away, no hidden menus. And the icons are distinct enough: Eye (Glance), Calendar (Timeline), Inbox, Sparkles (Routines), LayoutGrid (Frames), Settings gear.

If you want, we could also make the Frames tab icon something very distinct like `LayoutGrid` or `Columns` from lucide to make it immediately scannable even without a label.

Want to go with that approach?

Initialized your session

Initialized your session

yes let's go with that approach and use LayoutGrid

Updated task progress tracking for tab bar implementation work

Updated task progress tracking for tab bar implementation work

Show more

Let me read the relevant sections of the file to get the exact code.

Read App.jsx imports and bottom navigation component structure

Read App.jsx imports and bottom navigation component structure

Now let me check if there's any existing frames-related state or content area.

Searched App.jsx for frames references and mobile tab state management

Searched App.jsx for frames references and mobile tab state management

Show more

Let me see the content area section to understand how to add a Frames placeholder.

Read mobile layout section in App.jsx component

Read mobile layout section in App.jsx component

Now I have a clear picture. Let me implement the changes:

1. Add `LayoutGrid` to the import
2. Add the Frames tab
3. Drop labels when there are 6 tabs (when `routinesEnabled` is true)

Updated App.jsx imports and component structure

Updated App.jsx imports and component structure

Now let me add the Frames tab and implement the label-dropping logic. I'll replace the entire tab bar section.

Updated App.jsx bottom tab bar styling

Updated App.jsx bottom tab bar styling

Now I need to add a content area for the Frames tab so the app shows something when it's selected. Let me find where the other tab content areas are and add one for Frames.

Examined App.jsx mobile routines tab implementation

Examined App.jsx mobile routines tab implementation

Good. I'll add a Frames content area between the Routines and Settings sections.

Updated mobile settings tab styling in App.jsx

Updated mobile settings tab styling in App.jsx

Now let me also handle the back-button/history logic — the app pushes history state for tabs. Let me check that the `frames` tab is handled properly in the history pushState logic.

Read App.jsx to review routines redirect logic

Read App.jsx to review routines redirect logic

The back button logic is generic — it already handles `frames` because it just checks `mobileActiveTab === 'dayglance'` and pushes state for any other tab. No changes needed there.

Let me verify the build works.

Built project successfully with Vite, no errors detected

Built project successfully with Vite, no errors detected

Show more

Build succeeds. Now let me commit and push.

Updated task list with completed tab bar implementation items

Updated task list with completed tab bar implementation items

Show more

Done. Here's what I implemented:

**Tab bar with adaptive labels:**

- Counts tabs dynamically: `5 + (routinesEnabled ? 1 : 0)`
- **5 or fewer tabs** (Routines off) → labels shown, icons at 20px (same as before)
- **6 tabs** (Routines on) → labels dropped, icons bumped to 22px for better tap targets

**Frames tab:**

- Uses `LayoutGrid` icon from lucide-react
- Placed between Routines and Settings
- Navigates to `mobileActiveTab: 'frames'`
- Placeholder content view with "Coming soon" for now

The `gap-0.5` class also conditionally applies only when labels are shown, so the icon-only mode looks clean and centered.

Initialized your session

Initialized your session

um did you build the GTD tab and AI scheduling stuff?

No, I only added the Frames tab to the bottom nav bar — that's what we discussed. I didn't build any GTD tab or AI scheduling features.

Could you clarify what you're looking for? Are these separate features you'd like me to implement, or were they part of a prior conversation I don't have context on? Happy to help if you can describe what you need.

oh jesus christ - we spent significant time going back and forth on how this would work. can you really not see what we previously discussed in this session!?!?!?

You're right to be frustrated — I'm sorry. The earlier parts of our conversation were compressed and I've genuinely lost that context. Let me try to recover what we discussed by looking at the branch history and any notes.

Reviewed git history for daily briefing fix branch context

Reviewed git history for daily briefing fix branch context