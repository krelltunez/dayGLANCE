// Canonical protocol contract for the dayGLANCE Desktop ↔ client WebSocket API.
// All message type string constants and wire-format types live here.
// Clients (Stream Deck plugin, future integrations) import from this file.
// Do not define these strings anywhere else in the codebase.

export const PROTOCOL_VERSION = 1 as const;

// ── Outbound message type constants (server → clients) ───────────────────
export const MSG_DAY_STATE = 'day:state' as const;

// ── Inbound command type constants (clients → server) ────────────────────
export const MSG_DAY_FOCUS_START      = 'day:focus:start'      as const;
export const MSG_DAY_FOCUS_STOP       = 'day:focus:stop'       as const;
export const MSG_DAY_FOCUS_SKIP       = 'day:focus:skip'       as const;
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
};

export type FocusState = {
  available: boolean;
  active: boolean;
  phase: string;
  secondsRemaining: number;
  running: boolean;
  workMinutes: number;
  breakMinutes: number;
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

export type DayGlanceState = {
  currentTask: Task | null;
  nextTask: Task | null;
  scheduledTasks: Task[];
  today: { total: number; completed: number; date: string };
  focus: FocusState;
  habits: Habit[];
  nextRoutine: Routine | null;
};

// ── Outbound message (server → clients) ──────────────────────────────────
export type OutboundMessage = {
  v: typeof PROTOCOL_VERSION;
  type: typeof MSG_DAY_STATE;
} & DayGlanceState;

// ── Inbound commands (clients → server) ──────────────────────────────────
export type InboundCommand =
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_FOCUS_START }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_FOCUS_STOP }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_FOCUS_SKIP }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_TASK_COMPLETE; id: string }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_HABIT_INCREMENT; id: string }
  | { v: typeof PROTOCOL_VERSION; type: typeof MSG_DAY_ROUTINE_COMPLETE; id: string };
