// Hand-maintained declarations for @glance-apps/agenda-core (the plugin's
// tsc consumes these; the app uses the JS directly).
export function getOccurrencesInRange(template: unknown, rangeStartStr: string, rangeEndStr: string, maxResults?: number): string[];
export function getNextOccurrence(template: unknown): string | null;
export function getRecurrencePresets(dateStr: string, t?: (key: string, options: Record<string, unknown> & { defaultValue: string }) => string, language?: string): unknown[];
export function getSelectedWeekdays(recurrence: unknown, dateStr: string): number[];
export function toggleRecurrenceDay(recurrence: unknown, dow: number, dateStr: string): unknown;
export function setRecurrenceFrequency(recurrence: unknown, type: string, dateStr: string): unknown;
export function weekdayOrder(weekStartDay?: number): number[];
export function editedSeriesStart(recurrence: unknown, origStart: string | undefined, dateStr: string): string;

export interface AgendaItem {
  id: string;
  title: string;
  startTime: string | null;
  duration: number | null;
  color: string | null;
  isAllDay: boolean;
  completed: boolean;
  recurring: boolean;
  imported?: boolean;
  /** An imported task-calendar to-do: imported, yet completable like a task. */
  isTaskCalendar?: boolean;
  /** True for an event that came from a device's calendar projection (read-only). */
  projected?: boolean;
  calendarName?: string;
  date: string;
  projectId?: string | null;
  templateId?: string;
  instanceDate?: string;
}
export function recurringInstanceId(templateId: string, dateStr: string): string;
export function expandRecurringTemplate(template: unknown, fromStr: string, toStr: string): AgendaItem[];
export function buildAgenda(
  data: { tasks?: unknown[]; recurringTasks?: unknown[]; calendarEvents?: unknown[] },
  opts: { from: string; to: string; includeImported?: boolean },
): Record<string, AgendaItem[]>;
export function datesWithItems(agenda: Record<string, AgendaItem[]>): Set<string>;
export function localDateStr(date: Date): string;
export function shiftDateStr(dateStr: string, days: number): string;

export interface RoutineItem {
  id: string;
  name: string;
  startTime: string | null;
  duration: number | null;
  isAllDay: boolean;
  completed: boolean;
}
export function routinesForDate(
  data: { todayRoutines?: unknown[]; routinesDate?: string | null; routineCompletions?: Record<string, string> },
  dateStr: string,
): RoutineItem[];

export type TitleSegment =
  | { type: 'text'; text: string }
  | { type: 'tag'; text: string; tag: string }
  | { type: 'link'; text: string; target: string };
export function splitTitle(title: string): TitleSegment[];

export interface CalendarProjection {
  v: number;
  kind: 'projection';
  type: 'calendar';
  deviceId: string;
  from: string;
  to: string;
  publishedAt: string;
  events: unknown[];
  /** Per-day fetch stamps (date → ISO) from the publisher's projection cache; absent on older payloads. */
  days?: Record<string, string>;
  /** The publishing device's multi-user identity; absent when single-user. */
  userSyncId?: string | null;
}
export function mergeCalendarProjections(
  projections: unknown[],
  opts: { from: string; to: string; nowMs?: number; maxAgeMs?: number },
): { events: unknown[]; freshestAt: number | null; dayAsOf: Record<string, number> };

export interface AgendaClock { today: string; nowMinutes: number }
export function isCalendarEvent(item: AgendaItem | null | undefined): boolean;
export function eventHasEnded(item: { date: string; startTime?: string | null; duration?: number | null; isAllDay?: boolean }, clock: AgendaClock): boolean;
export function agendaClock(now?: Date): AgendaClock;

// ── progress math and the maintained note block (companion §4.3) ────────────
export function calculateProjectProgress(projectId: string, allTasks: unknown[]): number | null;
export function projectProgressPercent(projectId: string, allTasks: unknown[]): number | null;
export function getProjectTotalDuration(projectId: string, allTasks: unknown[]): number;
export function isProjectStalled(projectId: string, allTasks: unknown[], project: unknown, recurringTasks?: unknown[]): boolean;
export function calculateGoalProgress(goalId: string, projects: unknown[], allTasks: unknown[]): number;
export const NOTE_BLOCK_KEY: string;
export interface ProjectNoteBlock { kind: 'project'; status: string; goal?: string }
export interface GoalNoteBlock { kind: 'goal'; status: string }
export function noteWikilink(path: string, title: string): string;
export function projectNoteBlock(project: { id: string; status?: string }, ctx?: { goal?: { title?: string } | null; goalNotePath?: string | null }): ProjectNoteBlock;
export function goalNoteBlock(goal: { id: string; status?: string }): GoalNoteBlock;
export function noteBlockChanged(prev: unknown, next: unknown): boolean;

// ── the domain rules the app and the MCP read surface share ─────────────────

// bucketList.js: the Bucket List (someday/maybe), kept out of every inbox list.
export interface BucketConfig {
  headings: { b1: string; b2: string };
  secondListHidden: boolean;
  notes: string;
  updatedAt?: string;
}
export const BUCKET_LIST_IDS: string[];
export const DEFAULT_BUCKET_CONFIG: BucketConfig;
export function isBucketTask(task: { bucketId?: string | null } | null | undefined): boolean;
export function notBucketed(task: { bucketId?: string | null } | null | undefined): boolean;
export function demoteToBucket<T extends object>(task: T, listId?: string): Omit<T, 'deadline' | 'priority'> & { bucketId: string; lastModified: string };
export function promoteToInbox<T extends object>(task: T): Omit<T, 'bucketId' | 'deadline'> & { priority: 0; lastModified: string };
export function stripBucketId<T extends object>(task: T): Omit<T, 'bucketId'>;
export function normalizeBucketConfig(raw: unknown): BucketConfig;

// frameInstances.js: which GTD frames apply to a date. Callers pass frames
// already scoped to the user (frames have one owner; see userScope.js).
export interface FrameInstance {
  frameId: string;
  templateId: string;
  date: string;
  start: string;
  end: string;
  label?: string;
  color?: string;
  tagAffinity: string[];
  energyLevel: string;
  bufferMinutes: number;
}
export function dayOfWeekFor(dateStr: string | null | undefined): number | null;
export function frameAppliesTo(frame: unknown, dateStr: string, dayOfWeek: number | null): boolean;
export function frameInstancesForDate(frames: unknown[] | null | undefined, dateStr: string): FrameInstance[];

// routineBlocks.js: today's placed routines as read-only blocks. Callers pass
// routines already scoped to the user.
export interface RoutineState {
  routines?: unknown[];
  routinesDate?: string | null;
  routineCompletions?: Record<string, unknown>;
  routinesEnabled?: boolean;
  /** Today on the user's clock: routines exist for exactly this date. */
  todayDate?: string;
}
export interface RoutineBlock {
  id: string;
  type: 'routine';
  title: string;
  date: string;
  start_time: string | null;
  duration_minutes: number | null;
  all_day: boolean;
  completed: boolean;
  read_only: true;
}
export const ROUTINE_ID_PREFIX: string;
export function routineBlockId(routineId: string | number): string;
export function parseRoutineBlockId(blockId: unknown): string | null;
export function toRoutineBlock(routine: unknown, date: string, completed: unknown): RoutineBlock;
export function buildRoutineBlocks(state: RoutineState | null | undefined, date: string | null | undefined): RoutineBlock[];

// dayOccupancy.js: what occupies a day, and a frame's free slots.
export interface OccupiedInterval { start: number; end: number; label?: string; id?: string }
export interface AvailableSlot { start: string; end: string; minutes: number }
export interface SlotOptions {
  state?: RoutineState;
  tasks?: unknown[];
  dateStr?: string;
  todayStr?: string;
  nowMinutes?: number;
  defaultDuration?: number;
}
export function timeToMinutes(hhmm: string | null | undefined): number | null;
export function minutesToTime(minutes: number): string;
export function routineIntervals(state: RoutineState | null | undefined, date: string): OccupiedInterval[];
export function taskInterval(task: unknown, opts?: { defaultDuration?: number }): OccupiedInterval | null;
export function computeOccupiedIntervals(state: RoutineState | null | undefined, date: string, opts?: { tasks?: unknown[]; excludeId?: string | null; defaultDuration?: number }): OccupiedInterval[];
export function mergeIntervals(intervals: OccupiedInterval[], bufferMinutes?: number): OccupiedInterval[];
export function computeAvailableSlots(frameInstance: unknown, opts?: SlotOptions): AvailableSlot[];
export function availableMinutes(frameInstance: unknown, opts?: SlotOptions): number;
export function adjustPastConflicts(
  state: RoutineState | null | undefined,
  date: string,
  opts: { startTime: string; duration: number; tasks?: unknown[]; excludeId?: string | null; maxIterations?: number },
): { conflicted: boolean; adjustedStartTime: string; conflictingEvent: OccupiedInterval | null };
export function obstacleName(obstacle: unknown): string | null;
export function describeObstacle(obstacle: unknown): string;
export function findRoutineConflict(
  state: RoutineState | null | undefined,
  date: string,
  opts?: { startTime?: string | null; durationMinutes?: number; allDay?: boolean },
): OccupiedInterval | null;

// userScope.js: multi-user scoping. Tasks, goals and projects are broadcast
// unless assigned (isTaskVisibleForUser); routines, habits and frames have one
// owner (isOwnedBy), which isTaskVisibleForUser does not understand.
export function isTaskVisibleForUser(task: { assignedUserSyncIds?: string[] | null }, multiUserEnabled: unknown, meUserSyncId: string | null | undefined): boolean;
export function isOwnedBy(item: { ownerSyncId?: string | null }, multiUserEnabled: unknown, meUserSyncId: string | null | undefined, syncId?: string | null): boolean;

// stamps.js: a stored createdAt / completedAt stamp.
export function parseStamp(value: unknown): { date: Date; hasTime: boolean } | null;

// noteLink.js: a project's or goal's linked Obsidian note, as readers see it.
export interface NoteLink { path: string; name: string; missing: boolean; pending: boolean }
export function noteDisplayName(path: unknown): string;
export function noteLinkOf(entity: unknown): NoteLink | null;
