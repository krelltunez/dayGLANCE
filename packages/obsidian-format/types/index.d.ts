// Type surface for @glance-apps/obsidian-format. Hand-maintained beside the
// JS source; the bridge plugin (TypeScript) is the consumer that needs it.
// Types are deliberately pragmatic — precise where a consumer decision hangs
// on the shape, loose where it doesn't.

// ── identity ────────────────────────────────────────────────────────────────
export function simpleHash(str: string): string;
/** noteKey: the note's date for a daily note, noteKeyForPath(path) for any other note (companion §6, ruling A). */
export function deriveBlockId(noteKey: string, rawTitle: string): string;
export function noteKeyForPath(path: string): string;
export function noteTaskId(noteKey: string, rawTitle: string): string;
export function appIdForBlockId(blockId: string): string;
export function legacyObsidianId(taskDate: string, rawTitle: string): string;
export function splitBlockId(text: string): { text: string; blockId: string | null };
export function hasForeignBlockId(text: string): boolean;
export function blockIdSuffix(blockId: string | null, writtenTitle: string): string;

// ── completion markers ──────────────────────────────────────────────────────
export function splitCompletionMarker(text: string): { text: string; completedAt: string | null };
export function completionMarkerSuffix(
  completed: boolean, completedAt: string | null,
  format: 'tasks' | 'dataview' | null, writtenTitle: string,
): string;

// ── Tasks metadata ──────────────────────────────────────────────────────────
export interface TasksMetadataFields {
  due: string | null;
  scheduled: string | null;
  priority: number | null;
  recurrence: boolean;
}
export function splitTasksMetadata(input: string): {
  text: string; metaText: string; fields: TasksMetadataFields;
};
export function reattachTasksMetadata(displayTitle: string, rawTitle: string): string;
export function withScheduledMetadata(rawTitle: string, dateStr: string | null, format?: 'tasks' | 'dataview'): string;

// ── task lines ──────────────────────────────────────────────────────────────
export function taskLineSortKey(line: string, noteDate: string): string;
export function sortTaskLinesInSection(lines: string[], headingStr: string, noteDate: string): string[];
export function buildObsidianTaskLine(task: Record<string, unknown>, noteDate: string): string;
export function parseLeadingTime(text: string): { startTime: string; duration: number | null; rest: string } | null;
export function buildTimePrefix(startTime: string | null, duration: number | null): string;
export function stripLinePrefixes(text: string): { bareTitle: string; datePrefix: string };
export function updateTaskLines(lines: string[], opts: {
  obsidianRawTitle: string;
  completed: boolean;
  startTime: string | null;
  newRawTitle?: string;
  duration: number | null;
  targetDate?: string;
  blockId?: string | null;
  onTitleConflict?: ((info: { lineTitle: string }) => void) | null;
  completedAt?: string | null;
  completionFormat?: 'tasks' | 'dataview' | null;
}): boolean;
export function parseTasksFromMarkdown(
  content: string, dateStr: string, seenBlockIds?: Set<string>,
  opts?: { notePath?: string | null; completedSince?: string | null },
): { scheduledTasks: Record<string, unknown>[]; inboxTasks: Record<string, unknown>[] };
export function completionDateOfLine(body: string): string | null;
export function completedLineInWindow(body: string, completedSince: string): boolean;
/** noteKey: the note's date for a daily note, noteKeyForPath(path) otherwise; completedSince windows completed lines (non-daily). */
export function stampUntaggedTaskLines(
  content: string, noteKey: string, opts?: { completedSince?: string | null },
): { text: string; changed: boolean; stamped: Array<{ blockId: string; rawTitle: string }> };
export function planStampInsertions(
  content: string, noteKey: string, opts?: { completedSince?: string | null },
): Array<{ line: number; fromCh: number; toCh: number; insert: string; blockId: string; rawTitle: string }>;

// ── vault task scope (companion §6, rulings D and E) ────────────────────────
export interface VaultScope { folders: string[]; tags: string[]; completionWindowDays: number }
export const SCOPE_WINDOW_MIN_DAYS: number;
export const SCOPE_WINDOW_MAX_DAYS: number;
export const SCOPE_WINDOW_DEFAULT_DAYS: number;
export function normalizeScope(scope: Partial<VaultScope> | null | undefined): VaultScope;
export function scopeIsActive(scope: Partial<VaultScope> | null | undefined): boolean;
export function noteInScope(path: string, tags: string[] | null | undefined, scope: Partial<VaultScope> | null | undefined): boolean;
export function completedSinceFor(scope: Partial<VaultScope> | null | undefined, today: string): string;
export function partitionStampPlan<T extends { line: number }>(
  plan: T[], heldLines: Set<number> | null | undefined,
): { apply: T[]; deferred: T[] };
export const STAMP_SETTLE_FLOOR_MS: number;
export function settleStampPlan<T extends { line: number }>(
  plan: T[], lines: string[], prior: Map<string, number> | null | undefined, nowMs: number,
): { apply: T[]; deferred: T[]; nextState: Map<string, number> };

// ── completion log (companion spec 4.1) ─────────────────────────────────────
export const DEFAULT_COMPLETION_LOG_HEADING: string;
export function formatCompletionLogEntry(fields: {
  title: string; completedAt?: string | null; fallbackDate: string;
  projectName?: string | null; priority?: number | null;
  deadline?: string | null; recurring?: boolean;
}): string;
export function completionLogDate(completedAt: string | null | undefined, localToday: string): string;

// ── note naming ─────────────────────────────────────────────────────────────
export function assertSafeDateStr(dateStr: string): void;
export function formatDatePattern(date: Date, pattern?: string): string;
export function buildDateParser(pattern: string): unknown;
export function parseDateFromFilename(filename: string, parser: unknown): string | null;
export function dailyNoteFilename(dateStr: string, pattern?: string): string;

// ── frontmatter ─────────────────────────────────────────────────────────────
export function hasFrontmatter(text: string): boolean;
export function dgFrontmatter(dateIso?: string): string;
export function withCreationFrontmatter(content: string, dateIso?: string): string;

// ── filename portability ────────────────────────────────────────────────────
export function validateVaultNameSegment(segment: string): string | null;
export function validateWikiNoteName(name: string): string | null;
export function validateVaultFolderSetting(folder: string): string | null;
export function validateDailyNotePattern(
  pattern: string, formatDatePatternFn: typeof formatDatePattern,
): string | null;

// ── heartbeat ───────────────────────────────────────────────────────────────
export const OBSIDIAN_HEARTBEAT_STALE_MS: number;
export type BridgeStampingState = 'armed' | 'off' | 'no-config';
export interface ObsidianHeartbeat {
  paired: boolean; accountId: string | null; deviceId: string | null; tsMs: number;
  stamping: BridgeStampingState | null;
}
export function parseObsidianHeartbeat(text: string | null | undefined): ObsidianHeartbeat | null;
export function obsidianHeartbeatState(
  heartbeat: ObsidianHeartbeat | null, nowMs?: number,
): { obsidianRunning: boolean; pluginAuthoritative: boolean; stamping: BridgeStampingState | null };
export function heartbeatPayload(opts?: {
  deviceId?: string | null; paired?: boolean; accountId?: string | null;
  stamping?: BridgeStampingState | null; now?: Date;
}): { paired: boolean; accountId: string | null; deviceId: string | null; ts: string; stamping?: BridgeStampingState };

// ── bridge pairing (vault dead-drop) ────────────────────────────────────────
export const PAIRING_DIR: string;
export const PAIRING_PATH: string;
export const PAIRING_OFFER_TTL_MS: number;
export const BRIDGE_HKDF_INFO: string;
export interface BridgePairingCredentials {
  v: number;
  vaultUrl: string;
  accountId: string;
  deviceToken: string;
  subkeyB64: string;
  pairingSalt: string;
  generation: string;
  createdAt: string;
  /** The pairing device's current multi-user identity; the plugin's default viewer. Absent/null when single-user. */
  userSyncId?: string | null;
}
export function generatePairingCode(): string;
export function normalizePairingCode(code: string | null | undefined): string;
export function sealPairingOffer(credentials: BridgePairingCredentials, code: string): Promise<string>;
export function openPairingOffer(text: string, code: string): Promise<BridgePairingCredentials | null>;
export function deriveBridgeSubkey(rootKey: CryptoKey, pairingSaltBytes: Uint8Array): Promise<CryptoKey>;
export function exportBridgeSubkey(subkey: CryptoKey): Promise<string>;
export function importBridgeSubkey(subkeyB64: string): Promise<CryptoKey>;
export function pairingOfferFresh(createdAtIso: string, nowMs?: number): boolean;

// ── bridge intent stream ────────────────────────────────────────────────────
export const BRIDGE_VAULT_APP: string;
export const BRIDGE_PAIRING_META_ID: string;
export const BRIDGE_CONFIG_META_ID: string;
export const BRIDGE_INTENT_PREFIX: string;
export const BRIDGE_OBSERVATION_PREFIX: string;
export const BRIDGE_ACTION_PREFIX: string;
export const BRIDGE_PROJECTION_PREFIX: string;
export function bridgeCalendarProjectionId(deviceId: string): string;
export function bridgeConfigAllowsStamping(config: { blockIdWrites?: unknown } | null | undefined): boolean;

// ── bridge SSE (Phase 7 — pure half of the plugin's live-sync transport) ────
export const SSE_BACKOFF_BASE_MS: number;
export const SSE_BACKOFF_MAX_MS: number;
export const SSE_READ_TIMEOUT_MS: number;
export function sseBackoffMs(consecutiveFailures: number): number;
export function parseSseFrame(block: string): { seq?: number } | null;
export function drainSseBuffer(buffer: string, onEvent: (evt: { seq?: number }) => void): string;
export interface SseArming {
  noteDrainSuccess(): void;
  noteAuthFailure(): void;
  noteUnpaired(): void;
  isProven(): boolean;
  shouldConnect(inputs: { desktop: boolean; paired: boolean }): boolean;
}
export function createSseArming(): SseArming;
export interface SseNudgeGate {
  recordOwnSeq(seq: unknown): void;
  handleEvent(evt: { seq?: number } | null | undefined): boolean;
  cancel(): void;
  getCursor(): number;
}
export function createSseNudgeGate(opts?: {
  onDrain?: () => void;
  debounceMs?: number;
  ackCapacity?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): SseNudgeGate;
export function mintIntentId(): string;
export function observationEntityId(path: string): Promise<string>;
export function sealBridgeEnvelope(subkey: CryptoKey, payload: unknown): Promise<string>;
export function openBridgeEnvelope(subkey: CryptoKey, text: string): Promise<unknown | null>;
export function encodePlainBridgeRow(payload: unknown): string;
export function decodePlainBridgeRow(text: string): unknown | null;
export function applyBridgeIntent(
  currentText: string | null, intent: unknown,
): { text: string | null; changed: boolean }
 | { error: 'unportable_name'; reason: string }
 | { unsupported: true };
