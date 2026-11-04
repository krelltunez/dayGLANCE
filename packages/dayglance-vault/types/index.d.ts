// Hand-maintained declarations for @glance-apps/dayglance-vault. The package
// is plain ESM JavaScript; a TypeScript host compiles against these, so keep
// them exact (test/exports.test.js holds the export lists equal).
//
// `data` throughout is dayGLANCE's sync payload `.data`: the synced slices
// under their payload names (tasks, recurringTasks, unscheduledTasks,
// recycleBin, todayRoutines, habits, goals, projects, areas, gtdFrames, users,
// joboRecords, dailyNotes, and every other key as a singleton bundle). The
// adapter's apply functions MUTATE it in place.

/** The payload's `.data`: slices by name. */
export type VaultData = Record<string, unknown>;

/** The wrapped entity a row carries (encrypted whole by the engine). */
export interface VaultEntity {
  _kind: string;
  _key?: string;
  _extra?: Record<string, unknown>;
  value: unknown;
}

/** One shredded row. */
export interface VaultRow {
  entityId: string;
  kind: string;
  entity: VaultEntity;
}

// ── adapter.js ───────────────────────────────────────────────────────────────

export const COLLECTION_KINDS: Readonly<Record<string, { idField: string; tsField: string }>>;
export const TASK_KINDS: readonly string[];
export const CROSS_LIST_PRIORITY: readonly string[];
export const DATE_MAP_KIND: 'dailyNotes';
export const SINGLETON_KIND: 'singleton';
export const BUNDLE_OWNS: Readonly<Record<string, readonly string[]>>;
/** The tombstone bundle keys, as a Set (TOMBSTONE_BUNDLE_KEYS). */
export const TOMBSTONE_BUNDLES: ReadonlySet<string>;

export function entityKind(entity: unknown): string | null;
/** Singletons, recurring series and JOBO records always apply (their merge runs on every pull). */
export function isInsertOnly(entity: unknown): boolean;
export function getEntityLastModified(entity: unknown): string | number | undefined;
/** `${kind}:${id}`. */
export function makeEntityId(kind: string, id: unknown): string;
/** The collection kinds whose key is missing (`undefined`) from `data`: unknown, not empty. */
export function absentCollectionKinds(data: VaultData | null | undefined): string[];
/** The entries of a previous snapshot (entityId → hash) whose kind `data` omits. */
export function carryAbsentCollections(prevHashes: Record<string, string> | null | undefined, data: VaultData): Record<string, string>;
/** Full payload `.data` → rows. */
export function shredState(data: VaultData | null | undefined): VaultRow[];
/** Rows → full payload `.data` (single device, lossless). Throws on an unroutable `_kind`. */
export function reassembleState(rows: ReadonlyArray<{ entity: VaultEntity }> | null | undefined): VaultData;
/** Shred one entity by id; null when absent. */
export function getLocalEntity(data: VaultData, entityId: string): VaultEntity | null;
/** Merge one pulled entity into `data` (in place). Returns the entityIds to re-push. */
export function applyRemoteEntity(data: VaultData, entity: VaultEntity): string[];
/** Remove one row from `data` (in place). JOBO rows and singletons are never removed. */
export function applyRemoteDelete(data: VaultData, entityId: string): void;
/** Whether a bundle keeps this device's value over a pulled one. */
export function isDeviceLocalBundle(data: VaultData, key: string): boolean;
export interface CrossListCollision {
  id: string;
  kinds: Array<{ kind: string; lastModified: unknown }>;
  winner: string;
  losers: string[];
}
/**
 * Keep one copy of a task live under more than one task kind (newest
 * lastModified, then CROSS_LIST_PRIORITY), removing the others from `data` in
 * place and reporting each removed row's entityId to `onLoser`.
 */
export function reconcileCrossList(
  data: VaultData,
  onLoser?: (entityId: string) => void,
  onCollision?: (collision: CrossListCollision) => void,
  shouldSuppress?: (id: string) => boolean,
): void;

// ── engineCallbacks.js ───────────────────────────────────────────────────────

/** The data callbacks createDbSyncEngine takes, bound to `getData()` through the adapter. */
export interface VaultEngineCallbacks {
  getLocalEntity(entityId: string): VaultEntity | null;
  applyRemoteEntity(entityId: string, entity: VaultEntity): void;
  applyRemoteDelete(entityId: string): void;
  isInsertOnly(entity: unknown): boolean;
  getEntityLastModified(entity: unknown): string | number | undefined;
}
export function vaultEngineCallbacks(getData: () => VaultData, markDirty: (entityId: string) => void): VaultEngineCallbacks;

// ── tombstoneRetention.js, tombstoneHorizon.js ───────────────────────────────

export const TOMBSTONE_RETENTION_DAYS: number;
export const COMPLETED_UID_RETENTION_DAYS: number;
export const TOMBSTONE_BUNDLE_KEYS: readonly string[];
/** The day-floored cutoff for tombstones (TOMBSTONE_RETENTION_DAYS). */
export function tombstoneCutoff(nowMs?: number): Date;
export function completedUidCutoff(nowMs?: number): Date;
export function pruneCompletedTaskUids(uids: Iterable<string> | null | undefined, cutoff?: Date | null): string[];
export function pruneTombstoneMap(map: Record<string, string> | null | undefined, cutoff: Date | null): Record<string, string>;
export function unionNewerIso(a?: Record<string, string>, b?: Record<string, string>): Record<string, string>;
/** Prune every tombstone bundle on `data` in place; true when anything was dropped. */
export function pruneAllTombstones(data: VaultData, cutoff?: Date | null, uidCutoff?: Date | null): boolean;
export function floorToUtcDayIso<T extends string | null | undefined>(iso: T): T;
export function tombstoneHorizon(retentionDays: number, nowMs?: number): string | null;

// ── dayWindowSync.js ─────────────────────────────────────────────────────────

export interface DayWindowEntry { start: string | null; stop: string | null; lastModified: string }
export type DayWindowMap = Record<string, DayWindowEntry>;
export const DAY_WINDOWS_STORAGE_KEY: string;
export const DEFAULTS_KEY: 'defaults';
export function migrateDayWindows(raw: unknown): DayWindowMap;
export function mergeDayWindowMaps(local: DayWindowMap | null | undefined, remote: DayWindowMap | null | undefined): DayWindowMap;
export function dayWindowMapsEqual(a: DayWindowMap | null | undefined, b: DayWindowMap | null | undefined): boolean;
export function resolveDayWindow(map: DayWindowMap | null | undefined, dateStr: string): { start: string | null; stop: string | null } | null;

// ── recurringExceptions.js ───────────────────────────────────────────────────

export function stampExceptionDates<T>(template: T, previous: unknown, now: string): T;
export function stampExceptionChanges<T>(templates: T[], storedTemplates: unknown[] | null | undefined, now: string): T[];
export function applyExceptionStamps<T>(live: T[], stamped: unknown[] | null | undefined): T[];
export function mergeExceptions(local: unknown, remote: unknown): {
  exceptions: Record<string, unknown>;
  exceptionsTimestamps: Record<string, string>;
};
export function withMergedExceptions<T>(merged: T, local: unknown, remote: unknown): T;
export function sameOccurrenceEdits(a: unknown, b: unknown): boolean;

// ── merges.js and the field merges ───────────────────────────────────────────

export function mergeHabitLogs(
  localLogs: Record<string, Record<string, number>>,
  remoteLogs: Record<string, Record<string, number>>,
  localTs?: Record<string, string>,
  remoteTs?: Record<string, string>,
): { merged: Record<string, Record<string, number>>; mergedTimestamps: Record<string, string>; localChanged: boolean; remoteChanged: boolean };
export function mergeRoutineCompletions(
  localC?: Record<string, string>,
  remoteC?: Record<string, string>,
  localTs?: Record<string, string>,
  remoteTs?: Record<string, string>,
): { merged: Record<string, string>; mergedTimestamps: Record<string, string>; localChanged: boolean; remoteChanged: boolean };
export function mergeCompletedDates(
  localDates?: string[],
  remoteDates?: string[],
  localTs?: Record<string, string>,
  remoteTs?: Record<string, string>,
): { completedDates: string[]; completedDatesTimestamps: Record<string, string> };
export function mergeDeferrals(a: unknown, b: unknown): number | undefined;
export const TRAIL_CAP: number;
export interface PlanTrailStop { at: number; date: string; startTime: string }
export function mergePlanTrail(a: unknown, b: unknown): PlanTrailStop[] | undefined;
export function sameTrail(a: unknown, b: unknown): boolean;
export function earlierCreatedAt(a: string | null | undefined, b: string | null | undefined): string | undefined;
export interface Retirement { retiredAt: string; successor: string }
export function mergeRetiredTaskIds(local?: Record<string, Retirement>, remote?: Record<string, Retirement>): Record<string, Retirement>;
export function pruneRetiredTaskIds(
  record: Record<string, Retirement> | null | undefined,
  cutoff: Date | null,
  tombstoneBundles?: ReadonlyArray<Record<string, string> | null | undefined>,
): Record<string, Retirement>;
/** The JOBO ledger's one pick rule: newer updatedAt, then lower observedAt, then canonical JSON. */
export function pickJoboRecord<T>(a: T | null | undefined, b: T | null | undefined): T;
