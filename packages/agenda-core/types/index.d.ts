// Hand-maintained declarations for @glance-apps/agenda-core (the plugin's
// tsc consumes these; the app uses the JS directly).
export function getOccurrencesInRange(template: unknown, rangeStartStr: string, rangeEndStr: string, maxResults?: number): string[];
export function getNextOccurrence(template: unknown): string | null;
export function getRecurrencePresets(dateStr: string): unknown[];
export function getSelectedWeekdays(recurrence: unknown, dateStr: string): number[];
export function toggleRecurrenceDay(recurrence: unknown, dow: number, dateStr: string): unknown;
export function setRecurrenceFrequency(recurrence: unknown, type: string, dateStr: string): unknown;
export function weekdayOrder(weekStartDay?: number): number[];

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
}
export function mergeCalendarProjections(
  projections: unknown[],
  opts: { from: string; to: string; nowMs?: number; maxAgeMs?: number },
): { events: unknown[]; freshestAt: number | null };
