// Canonical protocol contract for the dayGLANCE Desktop ↔ client WebSocket API.
// All message type string constants and wire-format types live here.
// Clients (Stream Deck plugin, future integrations) import from this file.
// Do not define these strings anywhere else in the codebase.

export const PROTOCOL_VERSION = 1 as const;

// ── Outbound message type constants (server → clients) ───────────────────
export const MSG_DAY_STATE = 'day:state' as const;

// ── Inbound command type constants (clients → server) ────────────────────
export const MSG_DAY_FOCUS_START          = 'day:focus:start'          as const;
export const MSG_DAY_FOCUS_TIMER_START    = 'day:focus:timer-start'    as const;
export const MSG_DAY_FOCUS_STOP           = 'day:focus:stop'           as const;
export const MSG_DAY_FOCUS_SKIP           = 'day:focus:skip'           as const;
export const MSG_DAY_FOCUS_SET_DURATION   = 'day:focus:set-duration'   as const;
export const MSG_DAY_FOCUS_DISMISS_STATS  = 'day:focus:dismiss-stats'  as const;
export const MSG_DAY_HG_START             = 'day:hg:start'             as const;
export const MSG_DAY_HG_TIMER_START       = 'day:hg:timer-start'       as const;
export const MSG_DAY_HG_STOP              = 'day:hg:stop'              as const;
export const MSG_DAY_HG_SKIP              = 'day:hg:skip'              as const;
export const MSG_DAY_HG_SET_DURATION      = 'day:hg:set-duration'      as const;
export const MSG_DAY_HG_COMPLETE          = 'day:hg:complete'          as const;
export const MSG_DAY_HG_TASK_COMPLETE     = 'day:hg:task-complete'     as const;
export const MSG_DAY_TASK_COMPLETE    = 'day:task:complete'    as const;
export const MSG_DAY_HABIT_INCREMENT  = 'day:habit:increment'  as const;
export const MSG_DAY_ROUTINE_COMPLETE = 'day:routine:complete' as const;

// ── Shared data types ─────────────────────────────────────────────────────
export type Task = {
  id: string;
  title: string;
  startTime: string | null;
  duration: number;
  colorHex: string;
  tags: string[];
  completed: boolean;
  isAllDay?: boolean;
  isHGSession?: boolean;
};

export type FocusState = {
  available: boolean;
  active: boolean;
  setup: boolean;          // true while the settings screen is open (before timer starts)
  showStats: boolean;      // true while the post-session stats screen is visible
  phase: string;
  secondsRemaining: number;
  running: boolean;
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cycleCount: number;      // total completed work cycles since session start
  nextFocusTask: { id: string; title: string } | null;  // first incomplete task in the focus block
};

export type HGScheduledSession = {
  projectId: string;
  title: string;
  colorHex: string;
  startTime: string;
  reachable: boolean;
  date: string;
};

export type HGActiveSession = {
  projectId: string;
  title: string;
  colorHex: string;
  setup: boolean;
  completed: boolean;
  phase: string;           // 'work' | 'shortBreak' | 'longBreak'
  secondsRemaining: number;
  running: boolean;
  cycleCount: number;
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  nextTask: { id: string; title: string } | null;
};

export type HGState = {
  scheduled: HGScheduledSession[];  // today's sessions (up to 4), sorted by time
  active: HGActiveSession | null;
};

export type Habit = {
  id: string;
  name: string;
  colorHex: string;     // habit's brand color (ring color from HABIT_COLORS)
  ringColorHex: string; // display color — same as colorHex for doMore, traffic-light for limit
  count: number;        // today's logged count
  target: number;       // daily goal or limit
  unit: string;         // e.g. "glasses", "min"
  type: 'doMore' | 'limit';
  complete: boolean;
};

export type Routine = {
  id: string;
  name: string;
  startTime: string | null;
  completed: boolean;
};

export type Goal = {
  id: string;
  title: string;
  progress: number;   // 0-100 integer
  colorHex: string;
  daysLeft: number | null;  // null if no target date
};

export type Project = {
  id: string;
  title: string;
  progress: number;   // 0-100 integer
  colorHex: string;
  goalTitle: string | null;  // parent goal name, null if standalone
};

export type DayGlanceState = {
  currentTask: Task | null;
  nextTask: Task | null;
  scheduledTasks: Task[];
  today: { total: number; completed: number; date: string };
  focus: FocusState;
  hg: HGState;
  habits: Habit[];
  nextRoutine: Routine | null;
  use24Hour: boolean;
  goals: Goal[];
  projects: Project[];
};

// ── Outbound message (server → clients) ──────────────────────────────────
export type OutboundMessage = {
  v: typeof PROTOCOL_VERSION;
  type: typeof MSG_DAY_STATE;
} & DayGlanceState;

// ── Inbound commands (clients → server) ──────────────────────────────────
export type InboundCommand =
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_FOCUS_START }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_FOCUS_TIMER_START }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_FOCUS_STOP }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_FOCUS_SKIP }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_FOCUS_SET_DURATION; workMinutes?: number; breakMinutes?: number; longBreakMinutes?: number }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_FOCUS_DISMISS_STATS }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_HG_START; projectId: string; date: string }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_HG_TIMER_START }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_HG_STOP }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_HG_SKIP }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_HG_SET_DURATION; workMinutes?: number; breakMinutes?: number; longBreakMinutes?: number }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_HG_COMPLETE }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_HG_TASK_COMPLETE; id: string }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_TASK_COMPLETE; id: string }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_HABIT_INCREMENT; id: string }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_ROUTINE_COMPLETE; id: string };
