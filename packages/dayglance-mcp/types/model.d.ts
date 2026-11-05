// Hand-maintained declarations for @glance-apps/dayglance-mcp/model, the read
// model and the state it answers over. The package is plain ESM JavaScript;
// a TypeScript host compiles against these, so keep them exact. Wire shapes
// are snake_case, as docs/mcp-tools-reference.md documents them.

// ── readState.js ─────────────────────────────────────────────────────────────

/** The synced slices, under their sync-payload names. */
export interface McpReadData {
  tasks?: unknown[];
  recurringTasks?: unknown[];
  unscheduledTasks?: unknown[];
  recycleBin?: unknown[];
  /** Every member's placed routines: buildMcpReadState scopes them by owner. */
  todayRoutines?: unknown[];
  routinesDate?: string | null;
  routineCompletions?: Record<string, unknown>;
  routinesEnabled?: boolean;
  /** Every member's frames: buildMcpReadState scopes them by owner. */
  gtdFrames?: unknown[];
  goals?: unknown[];
  projects?: unknown[];
  areas?: unknown[];
  dailyNotes?: Record<string, unknown>;
  bucketConfig?: unknown;
  users?: unknown[];
  multiUserEnabled?: boolean;
}

/** What the device, or a host's configuration, supplies. */
export interface McpReadStateOptions {
  /** The current instant. */
  now: Date | number;
  /**
   * The user's IANA time zone. Omit only where this machine's clock is the
   * user's (the app); a host on a server must pass it.
   */
  timeZone?: string;
  /** The user this read surface answers as, in a multi-user account. */
  userSyncId?: string | null;
  /** 0=Sunday..6, a per-device setting. */
  weekStartDay?: number;
}

/** The state the read model answers from. */
export interface McpReadState {
  tasks?: unknown[];
  recurringTasks?: unknown[];
  unscheduledTasks?: unknown[];
  /** The user's routines only. */
  routines: unknown[];
  routinesDate?: string | null;
  routineCompletions?: Record<string, unknown>;
  routinesEnabled?: boolean;
  /** Today on the user's clock, YYYY-MM-DD. */
  todayDate: string;
  /** The user's frames only. */
  frames: unknown[];
  /** Minutes since the user's local midnight. */
  nowMinutes: number;
  recycleBin?: unknown[];
  goals?: unknown[];
  projects?: unknown[];
  areas?: unknown[];
  dailyNotes?: Record<string, unknown>;
  bucketConfig?: unknown;
  isVisibleForUser: (item: { assignedUserSyncIds?: string[] | null }) => boolean;
  weekStartDay?: number;
  users?: unknown[];
  multiUserEnabled?: boolean;
  /** Present only when one was given: the zone stamps are reported in. */
  timeZone?: string;
}

export function readClock(now: Date | number, timeZone?: string): { todayDate: string; nowMinutes: number };
export function buildMcpReadState(data: McpReadData | null | undefined, opts: McpReadStateOptions): McpReadState;

// ── readModel.js ─────────────────────────────────────────────────────────────

export type McpReadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string } };

/** The read methods the bridge answers (the tool layer's requests). */
export type McpReadMethod =
  | 'ping'
  | 'get_day'
  | 'get_week'
  | 'list_unscheduled'
  | 'list_users'
  | 'list_areas'
  | 'list_bucket_list'
  | 'goal_progress';

export interface WireStamp { date: string; time: string | null }
export interface WireSubtask { id: string; title: string; completed: boolean }
export interface StampOptions {
  /** The IANA zone stamps are reported in; omitted, this machine's clock. */
  timeZone?: string;
}

export function wireSubtasks(task: unknown): WireSubtask[] | undefined;
export function inboxItem(task: unknown, opts?: StampOptions): Record<string, unknown>;
export function dailyNoteFor(state: Partial<McpReadState>, date: string): { text: string; last_modified?: string } | null;
export function buildBucketList(state: Partial<McpReadState>): { lists: Array<{ id: string; heading: string; items: Record<string, unknown>[] }> };
export function blockType(task: unknown): 'device_calendar_event' | 'calendar_event' | 'recurring_task' | 'task';
export function isImportedEvent(task: unknown): boolean;
export function toBlock(task: unknown, opts?: StampOptions): Record<string, unknown>;
export function expandRecurringForDate(recurringTasks: unknown[] | null | undefined, date: string): Record<string, unknown>[];
/** A previous-date task's after-midnight piece as a block on `date` (#2278). */
export function continuationBlock(
  continuation: { task: unknown; fromDate: string | null; minutes: number },
  date: string,
  opts?: StampOptions,
): Record<string, unknown>;
export function buildDayBlocks(
  state: Partial<McpReadState>,
  params: { date: string; include_native?: boolean },
): { blocks: Record<string, unknown>[]; frames: FrameObject[]; daily_note: { text: string; last_modified?: string } | null };
export function weekDatesFor(dateStr: string, weekStartDay?: number): string[];
export function buildWeek(
  state: Partial<McpReadState>,
  params: { date: string; include_native?: boolean },
): { week_start_day: number; days: Array<{ date: string } & ReturnType<typeof buildDayBlocks>> };
export function buildUnscheduledItems(
  state: Partial<McpReadState>,
  filter?: { scope?: 'all' | 'standalone' | 'project'; includeCompleted?: boolean },
): { items: Record<string, unknown>[] };
export function projectItem(project: unknown, progressTasks?: unknown[]): Record<string, unknown>;
export function goalItem(goal: unknown, state: Partial<McpReadState>, progressTasks?: unknown[]): Record<string, unknown>;
export function buildAreas(state: Partial<McpReadState>): { areas: Array<{ id: unknown; name: string }> };
export function buildGoalProgress(
  state: Partial<McpReadState>,
  params?: { goal_id?: string; window?: unknown },
):
  | { notFound: false; invalid: string }
  | { notFound: true; invalid: null }
  | { notFound: false; invalid: null; goals: Record<string, unknown>[]; standalone_projects: Record<string, unknown>[] };
export function buildUsers(state: Partial<McpReadState>): { users: Array<{ id: unknown; name: string }> };
export function handleMcpRequest(
  state: Partial<McpReadState>,
  request: { method?: McpReadMethod | string; params?: Record<string, unknown> } | null | undefined,
): McpReadResult;

// ── frames.js ────────────────────────────────────────────────────────────────

export interface FrameSlot { start: string; end: string; minutes: number }
export interface FrameObject {
  id: string;
  type: 'frame';
  label: string;
  date: string;
  start: string;
  end: string;
  energy_level: string;
  buffer_minutes: number;
  tag_affinity: string[];
  available_minutes: number;
  available_slots: FrameSlot[];
  read_only: true;
}
export const FRAME_ID_PREFIX: string;
export function frameWireId(frameId: string, dateStr: string): string;
export function toFrameObject(instance: unknown, availableSlots: FrameSlot[]): FrameObject;
export function buildFrames(state: Partial<McpReadState>, date: string, opts?: { includeNative?: boolean }): FrameObject[];

// ── repeat.js, wireStamp.js ──────────────────────────────────────────────────

export interface WireRepeat {
  frequency: string;
  days_of_week?: string[];
  day_of_month?: number;
  nth_weekday?: { week: number; day: string };
  until?: string;
  count?: number;
}
export function recurrenceToWire(recurrence: unknown): WireRepeat | null;
export function wireStamp(value: unknown, timeZone?: string): WireStamp | null;

// ── noteDescriptions.js ──────────────────────────────────────────────────────

/** What a loader answers for a linked note's description section. */
export type NoteDescriptionResult =
  | { text: string; base: string; lastModified?: string | null; observedAt?: string | null }
  | { notFound: true }
  | null
  | undefined;
export type LoadNoteDescription = (path: string) => Promise<NoteDescriptionResult> | NoteDescriptionResult;
/** How many linked entities one goal-tree read opens notes for. */
export const DESCRIPTION_READ_CAP: number;
/** How long the reads may take in all, in milliseconds. */
export const DESCRIPTION_READ_BUDGET_MS: number;
/**
 * A goal_progress result with each linked goal's and project's `description`
 * filled from its note (`description_source: 'obsidian_note'`, and
 * `description_base`, the section's hash). An entity whose note cannot be read
 * keeps what it had. Returns a new object; the input is not mutated.
 */
export function enrichGoalTreeDescriptions<T>(data: T, deps?: { loadNoteDescription?: LoadNoteDescription }): Promise<T>;
