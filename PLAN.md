# AI Features Plan — dayGLANCE

## Philosophy

All AI features are **opt-in behind a toggle** and **BYO (Bring Your Own) API key**. dayGLANCE remains fully functional without AI — no vendor lock-in, no subscriptions, no data leaving the device unless the user explicitly configures it. Users provide their own API key (OpenAI, Anthropic, Gemini, local/Ollama, etc.) and all processing uses that key directly from the browser.

---

## Phase 0 — AI Settings Foundation

### Global AI Toggle & Provider Config

Add an **"AI Features"** section to Settings with:

- **Master toggle** — enables/disables all AI features globally
- **Provider selector** — OpenAI / Anthropic / Google Gemini / Ollama (local) / Custom OpenAI-compatible endpoint
- **API key input** — stored in localStorage (encrypted with a user-defined passphrase, or at minimum `day-planner-ai-config`)
- **Model selector** — populated based on provider (e.g. `gpt-4o-mini`, `claude-sonnet-4-5-20250514`, `gemini-2.0-flash`, local model name)
- **Test connection** button — verifies the key works before enabling features
- **Per-feature toggles** — each AI feature can be independently enabled/disabled

### Data Model

```js
// localStorage key: 'day-planner-ai-config'
{
  enabled: false,                    // master toggle
  provider: 'openai',               // 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom'
  apiKey: '...',                     // user's API key
  model: 'gpt-4o-mini',             // selected model
  baseUrl: '',                       // for ollama/custom endpoints
  features: {
    voiceTaskInput: true,
    morningSummary: true,
    weeklySummary: true,
    smartScheduling: true,
  }
}
```

### Unified AI Service Layer

Create a small abstraction (`src/ai.js`) that:

- Accepts a prompt + context and returns a response
- Routes to the configured provider's API (all calls made client-side via `fetch`)
- Handles errors gracefully (quota exceeded, network issues, invalid key)
- Never sends data anywhere except the user-configured endpoint
- Provides a consistent interface regardless of provider

```js
// src/ai.js
export async function aiComplete(systemPrompt, userMessage, config) { ... }
export async function aiJSON(systemPrompt, userMessage, schema, config) { ... }
```

---

## Phase 1 — Voice Task Input ("Ramble")

### Overview

A microphone button that lets users speak naturally to add tasks. The AI parses the ramble into structured task(s) with title, tags, date, time, duration, priority, and deadline — similar to Todoist's Ramble feature but fully local/BYO.

### UX Flow

1. User taps/clicks a **microphone icon** (in the header bar, near the + button, and/or in the inbox)
2. Browser's **Web Speech API** (`SpeechRecognition`) captures audio → text in real-time
3. Live transcript shown in a modal/overlay as the user speaks
4. On stop (manual or silence detection), the transcript is sent to the configured AI
5. AI returns structured task(s) as JSON
6. User sees a **preview card** with parsed task(s) — title, tags, time, date, duration, priority
7. User can **edit/confirm** each field before adding, or just tap "Add All"
8. Tasks land in the **inbox** (or on the specified date if the AI detected one)

### Technical Details

- **Speech-to-text**: Use the browser-native `webkitSpeechRecognition` / `SpeechRecognition` API (free, no API calls needed). Falls back to a "type your ramble" text input on unsupported browsers.
- **AI parsing prompt**: Send the transcript along with context (today's date, existing tags, user's timezone) and ask the AI to return JSON matching the task schema:
  ```json
  [
    {
      "title": "Review quarterly report",
      "tags": ["work", "review"],
      "date": "2026-02-25",
      "time": "14:00",
      "duration": 30,
      "priority": 2,
      "deadline": null,
      "notes": ""
    }
  ]
  ```
- **Context injection**: Include the user's existing tag list so the AI reuses consistent tags rather than inventing new ones
- **Multi-task support**: "I need to call mom tomorrow at 3, and also pick up groceries on the way home" → 2 tasks
- **No AI fallback**: If AI is disabled, the voice transcript is used as-is for a single inbox task title (still useful!)

### Components

- `VoiceInputButton` — mic icon, starts/stops recording
- `VoiceInputModal` — shows live transcript, parsed preview, confirm/edit UI
- New function in `ai.js`: `parseVoiceToTasks(transcript, context)`

---

## Phase 2 — Morning dayGLANCE (AI Morning Summary)

### Overview

A daily morning briefing that summarizes what's ahead — tasks, deadlines, calendar events, weather — in a natural-language summary. Shown as a dismissible card/modal when the user opens the app in the morning.

### UX Flow

1. When the app loads (or at a configured morning time), if not already dismissed today:
   - Gather today's scheduled tasks, inbox items with today's deadline, recurring tasks, weather, and calendar events
   - Send to AI with a prompt: "Generate a friendly, concise morning briefing"
2. Display as a **card at the top of the day view** or as a **modal** (user-configurable)
3. Includes:
   - Natural-language overview ("You have 6 tasks today, 2 are high priority...")
   - Key highlights (deadlines, back-to-back meetings, gaps in schedule)
   - A motivational nudge or observation (optional, toggleable)
   - Quick actions: "Schedule inbox items?" → links to smart scheduling
4. Dismissible — stores `day-planner-morning-glance-{date}` to not show again that day

### Settings

- **Trigger**: On app open / at specific time / manual only
- **Style**: Card (inline) / Modal (overlay)
- **Include weather**: yes/no
- **Include motivational note**: yes/no
- **Cache**: Generated once per day, cached locally to avoid repeat API calls

---

## Phase 3 — Enhanced Weekly dayGLANCE (AI Weekly Summary)

### Overview

Enhance the existing Weekly Review modal with AI-generated insights. The current weekly review already shows completion stats — this adds narrative analysis, pattern recognition, and suggestions.

### Enhancements over current Weekly Review

The existing weekly review shows basic stats (tasks completed, etc.). The AI-enhanced version adds:

1. **Narrative summary** — "This week you completed 23 of 28 tasks (82%). Your most productive day was Wednesday..."
2. **Pattern recognition** — "You tend to skip #exercise tasks on Mondays. Consider rescheduling to a day with fewer meetings."
3. **Tag analysis** — Time/completion breakdown by tag with AI commentary
4. **Priority insights** — "3 high-priority tasks were rolled over from last week — consider breaking them down"
5. **Suggestions for next week** — Based on patterns and incomplete tasks
6. **Streak tracking** — "You've completed all #meditation tasks 3 weeks in a row!"

### Data Gathering

- Pull completed/incomplete tasks for the past 7 days
- Pull recurring task completion rates
- Pull tag usage and completion rates
- Pull time-tracking data from focus mode sessions
- All data stays local — only the summary prompt + anonymized stats go to the AI

### Integration

- Extends the existing `showWeeklyReview` modal
- AI section appears below the existing stats, clearly labeled as AI-generated
- Works without AI enabled (existing stats remain unchanged)

---

## Phase 4 — Smart Scheduling

### Overview

AI-powered scheduling that takes unscheduled inbox tasks and suggests optimal placement in the user's timeline, filling "productivity blocks" (user-defined open time slots) with tasks based on priority, tags, estimated duration, and deadlines.

### Productivity Blocks

Users define blocks of available time in Settings:

```js
// localStorage key: 'day-planner-productivity-blocks'
[
  { id: '...', label: 'Morning Focus', days: [1,2,3,4,5], start: '09:00', end: '12:00', tags: ['work', 'deep-focus'] },
  { id: '...', label: 'Afternoon Tasks', days: [1,2,3,4,5], start: '14:00', end: '17:00', tags: [] },
  { id: '...', label: 'Weekend Errands', days: [0,6], start: '10:00', end: '14:00', tags: ['errands', 'personal'] },
]
```

### Scheduling Algorithm

1. User triggers "Smart Schedule" (button in inbox or via command palette)
2. System gathers:
   - All unscheduled inbox tasks (with priorities, tags, deadlines, durations)
   - Existing scheduled tasks for the target date range
   - Productivity blocks for those dates
   - Available gaps (block time minus already-scheduled tasks)
3. AI receives this context and returns a proposed schedule:
   ```json
   [
     { "taskId": "...", "date": "2026-02-25", "time": "09:00", "reasoning": "High priority #work task fits your Morning Focus block" },
     { "taskId": "...", "date": "2026-02-25", "time": "14:30", "reasoning": "Groups well with other #errands tasks" }
   ]
   ```
4. User sees a **preview** of the proposed schedule overlaid on their timeline
5. User can accept all, accept individual suggestions, or adjust and re-generate
6. Accepted tasks move from inbox to the scheduled timeline

### Scheduling Heuristics (provided to AI as system prompt context)

- **Deadline-first**: Tasks with approaching deadlines get priority placement
- **Tag grouping**: Batch similar-tagged tasks together (context switching reduction)
- **Priority weighting**: Higher priority tasks get placed in preferred blocks
- **Energy matching**: If user has tagged blocks (e.g. "deep focus" mornings), match task complexity
- **Duration fitting**: Don't overfill blocks; leave buffer time between tasks
- **Conflict avoidance**: Never double-book or overlap with existing tasks/calendar events

---

## Future Ideas (Not Yet Planned)

- **Natural language task editing** — "Move my dentist appointment to Thursday at 2pm"
- **AI-suggested tags** — Auto-detect and suggest tags for new tasks
- **Smart recurrence** — "You've done this task every Monday for 3 weeks, want to make it recurring?"
- **Daily journal prompts** — AI-generated reflection prompts in daily notes
- **Focus mode coaching** — AI suggests which task to focus on next based on energy/time
- **Habit insights** — Deeper analysis of routine completion patterns over time

---

## Technical Architecture

### File Structure

```
src/
  ai.js              — Unified AI service layer (provider routing, error handling)
  ai-prompts.js      — System prompts for each feature (voice parsing, summaries, scheduling)
  App.jsx            — Existing app (add AI toggle state, voice button, morning card)
```

### Key Principles

1. **Zero cost without AI** — No API calls unless user has configured and enabled AI
2. **Client-side only** — All API calls go directly from browser to provider (no proxy server)
3. **Graceful degradation** — Every AI feature has a non-AI fallback or simply doesn't appear
4. **Minimal token usage** — Send only necessary context, cache responses where possible
5. **Privacy-first** — User controls what data is sent; task titles/notes are the only content shared with the AI provider
6. **Provider-agnostic** — Same features work across OpenAI, Anthropic, Gemini, Ollama, etc.

### Implementation Order

| Phase | Feature | Complexity | Dependencies |
|-------|---------|-----------|--------------|
| 0 | AI Settings + Service Layer | Medium | None |
| 1 | Voice Task Input | Medium | Phase 0 |
| 2 | Morning dayGLANCE | Low-Medium | Phase 0 |
| 3 | Enhanced Weekly dayGLANCE | Low | Phase 0, existing weekly review |
| 4 | Smart Scheduling | High | Phase 0, productivity blocks UI |
