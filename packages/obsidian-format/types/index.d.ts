// Type surface for @glance-apps/obsidian-format. Hand-maintained beside the
// JS source; the bridge plugin (TypeScript) is the consumer that needs it.
// Types are deliberately pragmatic — precise where a consumer decision hangs
// on the shape, loose where it doesn't.

// ── identity ────────────────────────────────────────────────────────────────
export function simpleHash(str: string): string;
export function deriveBlockId(dateStr: string, rawTitle: string): string;
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
): { scheduledTasks: Record<string, unknown>[]; inboxTasks: Record<string, unknown>[] };

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
export interface ObsidianHeartbeat {
  paired: boolean; accountId: string | null; deviceId: string | null; tsMs: number;
}
export function parseObsidianHeartbeat(text: string | null | undefined): ObsidianHeartbeat | null;
export function obsidianHeartbeatState(
  heartbeat: ObsidianHeartbeat | null, nowMs?: number,
): { obsidianRunning: boolean; pluginAuthoritative: boolean };
export function heartbeatPayload(opts?: {
  deviceId?: string | null; paired?: boolean; accountId?: string | null; now?: Date;
}): { paired: boolean; accountId: string | null; deviceId: string | null; ts: string };

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
}
export function generatePairingCode(): string;
export function normalizePairingCode(code: string | null | undefined): string;
export function sealPairingOffer(credentials: BridgePairingCredentials, code: string): Promise<string>;
export function openPairingOffer(text: string, code: string): Promise<BridgePairingCredentials | null>;
export function deriveBridgeSubkey(rootKey: CryptoKey, pairingSaltBytes: Uint8Array): Promise<CryptoKey>;
export function exportBridgeSubkey(subkey: CryptoKey): Promise<string>;
export function importBridgeSubkey(subkeyB64: string): Promise<CryptoKey>;
export function pairingOfferFresh(createdAtIso: string, nowMs?: number): boolean;
