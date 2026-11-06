// Type surface for @glance-apps/obsidian-format. Hand-maintained beside the
// JS source; the bridge plugin (TypeScript) is the consumer that needs it.
// Types are deliberately pragmatic — precise where a consumer decision hangs
// on the shape, loose where it doesn't.

// ── identity ────────────────────────────────────────────────────────────────
export function simpleHash(str: string): string;
/** noteKey: the note's date for a daily note, noteKeyForPath(path) for any other note (companion §6, ruling A). */
export function deriveBlockId(noteKey: string, rawTitle: string): string;
export function noteKeyForPath(path: string): string;
/** A user-typed note reference (`Goals/Home`, `[[Goals/Home#Plan]]`) → a normalized vault path ending in .md, or ''. */
export function normalizeNotePath(input: unknown): string;
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
export function withProjectMetadata(rawTitle: string, ref: string | null): string;
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
  noteDate?: string | null;
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
/** Split note text into '\r'-free lines (CRLF and bare CR accepted) and report the note's own line ending for a rewrite. */
export function splitNoteLines(content: string): { lines: string[]; eol: '\n' | '\r\n' };

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
export function dailyNoteCreationBody(template: string | null | undefined, date: string, path?: string | null): string;

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
  /** The pairing generation the plugin holds, and its verdict that it is older than the vault's (2026-09-29). */
  generation: string | null;
  pairingStale: boolean;
}
export function parseObsidianHeartbeat(text: string | null | undefined): ObsidianHeartbeat | null;
export function obsidianHeartbeatState(
  heartbeat: ObsidianHeartbeat | null, nowMs?: number,
): { obsidianRunning: boolean; pluginAuthoritative: boolean; stamping: BridgeStampingState | null; generation: string | null; pairingStale: boolean };
export function heartbeatPayload(opts?: {
  deviceId?: string | null; paired?: boolean; accountId?: string | null;
  stamping?: BridgeStampingState | null; generation?: string | null; pairingStale?: boolean; now?: Date;
}): { paired: boolean; accountId: string | null; deviceId: string | null; ts: string; stamping?: BridgeStampingState; generation?: string; pairingStale?: true };

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
export const BRIDGE_APPLIER_META_ID: string;
export const BRIDGE_CONFIG_META_ID: string;
export const BRIDGE_INTENT_PREFIX: string;
export const BRIDGE_OBSERVATION_PREFIX: string;
export const BRIDGE_ACTION_PREFIX: string;
export const BRIDGE_CREATE_ACTION_PREFIX: string;
export const BRIDGE_PROJECTION_PREFIX: string;
export const BRIDGE_COPY_PREFIX: string;
export function bridgeCopyStatusId(deviceId: string): string;
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
  /** This consumer's namespace: a tagged nudge from another app drains nothing; an untagged one drains as before the tag. */
  app?: string | null;
  debounceMs?: number;
  /** Own-ack memory: acks older than this are forgotten (default 10 minutes). */
  ackTtlMs?: number;
  /** Memory backstop on the own-ack ring, not the guard (default 4096). */
  ackCapacity?: number;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): SseNudgeGate;
export function mintIntentId(): string;
export function observationEntityId(path: string): Promise<string>;
export const PROJECT_NOTE_ID_KEY: string;
export function linkObservationEntityId(targetId: string): string;
/** `generation` (the pairing generation the subkey derives from) rides in the clear as the envelope's `gen` tag. */
export function sealBridgeEnvelope(subkey: CryptoKey, payload: unknown, generation?: string | null): Promise<string>;
/** The decrypted payload, or null when the envelope does not open under this subkey. */
export function openBridgeEnvelope(subkey: CryptoKey, text: string): Promise<unknown>;
/** The clear `gen` tag of an envelope, or null (untagged writer, or not an envelope). Needs no key. */
export function readBridgeEnvelopeGeneration(text: string): string | null;
export function encodePlainBridgeRow(payload: unknown): string;
/** The decoded payload, or null when the text is not a plain bridge row. */
export function decodePlainBridgeRow(text: string): unknown;
export function noteContainsBlock(text: string, body: string): boolean;
export function applyBridgeIntent(
  currentText: string | null, intent: unknown,
): { text: string | null; changed: boolean }
 | { error: 'unportable_name'; reason: string }
 | { unsupported: true };

// ── project and goal note workspaces (companion §4.3, rulings D and E) ─────
export type ProjectNoteLayout = 'note' | 'folder' | 'nested';
export const PROJECT_NOTE_LAYOUTS: ProjectNoteLayout[];
export interface ProjectNoteSettings { layout: ProjectNoteLayout; projectsFolder: string; goalsFolder: string; projectTemplate: string; goalTemplate: string; dailyTemplate: string }
export function normalizeProjectNoteSettings(s: Partial<ProjectNoteSettings> | null | undefined): ProjectNoteSettings;
export function noteNameFromTitle(title: string): string;
export function projectNotePath(a: { kind: 'project' | 'goal'; title: string; layout?: string; projectsFolder?: string; goalsFolder?: string; goalFolder?: string | null }): string;
export function uniqueNotePath(path: string, exists: (path: string) => boolean): string;
export function templateNeedsUser(text: string): boolean;
export function renderNoteTemplateSubset(text: string, vars?: { title?: string; date?: string; goal?: string; description?: string }): string;
export function projectCompletionsQuery(dailyFolder?: string): string;
export function goalProjectsQuery(): string;
export function goalProgressQuery(dailyFolder?: string): string;
export function defaultProjectNote(a: { title: string; date: string; hasDataview?: boolean; dailyFolder?: string; description?: string }): string;
export function defaultGoalNote(a: { title: string; date: string; hasDataview?: boolean; dailyFolder?: string; description?: string }): string;

// ── the description section (noteDescription.js, owner ruling 2026-10-03) ──
export const DESCRIPTION_PLACEHOLDERS: readonly string[];
export function noteTextHash(text: string): string;
export function splitNoteDescription(text: string): { head: string; section: string; tail: string };
export function extractNoteDescription(text: string): string;
export function replaceNoteDescription(text: string, content: string): string;
export function mergeNoteDescription(text: string, content: string): { text: string; changed: boolean };
export function appendDescriptionConflict(text: string, content: string, at: string): { text: string; changed: boolean };

// ── linked notes' descriptions from the observation stream (noteObservations.js) ──
/** A decrypted observation payload (bridgeStream.js). */
export interface NoteObservation {
  v: 1;
  kind: 'observation';
  path: string;
  content?: string | null;
  deleted?: boolean;
  withdrawn?: boolean;
  scoped?: boolean;
  link?: boolean;
  mtime?: number | null;
  observedAt?: string;
}
export type ObservedNoteDescription =
  | { text: string; base: string; observedAt: string | null; lastModified: string | null }
  | { notFound: true };
export function latestNoteObservation(observations: ReadonlyArray<unknown> | null | undefined, path: string): NoteObservation | null;
/** null when no observation names the path (no information); notFound when the latest says deleted or withdrawn. */
export function noteDescriptionFromObservations(observations: ReadonlyArray<unknown> | null | undefined, path: string): ObservedNoteDescription | null;
export function openNoteObservations(
  rows: ReadonlyArray<{ entityId: string; envelope?: string | null; deleted?: boolean }> | null | undefined,
  subkey: CryptoKey,
): Promise<NoteObservation[]>;
export function bridgeNoteDescriptionLoader(
  rows: ReadonlyArray<{ entityId: string; envelope?: string | null; deleted?: boolean }> | null | undefined,
  keys?: { rootKey?: CryptoKey | null; subkey?: CryptoKey | null },
): Promise<(path: string) => Promise<ObservedNoteDescription | null>>;
