// Type declarations for @glance-apps/sync
//
// Covers the full public API exported from src/index.js. The JSDoc on the
// source files is the source of truth for behavior; these declarations only
// express the shape of values crossing the package boundary.

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type SyncErrorCode =
  | 'APP_ID_MISMATCH'
  | 'SCHEMA_FORWARD_INCOMPATIBLE'
  | 'PASSPHRASE_REQUIRED'
  | 'PRECONDITION_FAILED'
  | 'FORBIDDEN'
  | 'AUTH_FAILURE'
  | 'LOCKED'
  | 'NETWORK_ERROR';

export type SyncStatus = 'idle' | 'uploading' | 'downloading' | 'success' | 'error';

// ---------------------------------------------------------------------------
// Envelope shape
// ---------------------------------------------------------------------------

export interface SyncEnvelope<TData = unknown> {
  schemaVersion: number;
  appId: string;
  version: number;
  lastModified: string; // ISO 8601
  data: TData;
}

export interface EncryptedEnvelope {
  v: 1;
  enc: 'AES-GCM-256';
  data: string; // base64
}

// ---------------------------------------------------------------------------
// Transport bridges (all optional; engine selects the first non-null tier)
// ---------------------------------------------------------------------------

export interface NativeHttpResponse {
  status: number;
  ok: boolean;
  body: string;
  headers?: { etag?: string };
  error?: string;
}

export type NativeHttpRequest = (
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | null,
) => NativeHttpResponse | null;

export type ElectronProxyFetch = (
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | null,
) => Promise<{
  status: number;
  ok: boolean;
  statusText: string;
  body: string;
  headers?: { etag?: string };
}>;

// ---------------------------------------------------------------------------
// Merge engine
// ---------------------------------------------------------------------------

export interface MergeResult<T> {
  merged: T[];
  localChanged: boolean;
  remoteChanged: boolean;
}

export interface MergeArrayOptions {
  idField?: string;
  timestampField?: string;
}

export function mergeArrayById<T extends Record<string, unknown>>(
  localItems: T[],
  remoteItems: T[],
  deletedIds: Record<string, string>,
  syncHorizon?: Date | null,
  options?: MergeArrayOptions,
): MergeResult<T>;

export function mergeDailyNotes<T>(
  local: Record<string, T>,
  remote: Record<string, T>,
): { merged: Record<string, T>; localChanged: boolean; remoteChanged: boolean };

export function mergeHabits<T extends Record<string, unknown>>(
  localHabits: T[],
  remoteHabits: T[],
  localDeletedIds?: Record<string, string>,
  remoteDeletedIds?: Record<string, string>,
): {
  merged: T[];
  mergedDeletedIds: Record<string, string>;
  localChanged: boolean;
  remoteChanged: boolean;
};

export function mergeHabitLogs<T = number>(
  localLogs: Record<string, Record<string, T>>,
  remoteLogs: Record<string, Record<string, T>>,
  localTs?: Record<string, string>,
  remoteTs?: Record<string, string>,
): {
  merged: Record<string, Record<string, T>>;
  mergedTimestamps: Record<string, string>;
  localChanged: boolean;
  remoteChanged: boolean;
};

export function mergeRoutineDefinitions<T extends { id: string | number }>(
  localDefs: Record<string, T[]>,
  remoteDefs: Record<string, T[]>,
  deletedChipIds?: Record<string, string>,
): { merged: Record<string, T[]>; localChanged: boolean; remoteChanged: boolean };

export function mergeSyncData<TLocal extends Record<string, unknown>, TRemote extends Record<string, unknown>>(
  localData: TLocal,
  remoteData: TRemote,
  retentionDays?: number,
): { data: Record<string, unknown>; localChanged: boolean; remoteChanged: boolean };

export function pruneTombstones(
  tombstones: Record<string, string>,
  cutoff: Date | null,
): Record<string, string>;

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

export interface CryptoConfig {
  cryptoDBName: string;
  nativeGetSyncKey?: (() => string | null | Promise<string | null>) | null;
  nativeStoreSyncKey?: ((value: string | null) => void) | null;
}

export function initSessionKey(config: CryptoConfig): Promise<boolean>;
export function setupEncryptionKey(passphrase: string, config: CryptoConfig): Promise<void>;
export function clearEncryptionKey(config: CryptoConfig): Promise<void>;
export function setSyncPassphrase(passphrase: string | null): void;
export function getSyncPassphrase(): string | null;
export function hasEncryptionReady(): boolean;
export function encryptData<T>(data: T, config?: CryptoConfig): Promise<EncryptedEnvelope>;
export function decryptData<T = unknown>(envelope: EncryptedEnvelope, config?: CryptoConfig): Promise<T>;
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope;

// ---------------------------------------------------------------------------
// Auto-backup
// ---------------------------------------------------------------------------

export type BackupFrequency = 'hourly' | 'daily' | 'weekly';

export interface BackupRecord<TData = unknown> {
  id: string;
  timestamp: string;
  frequency: BackupFrequency;
  data: TData;
}

export interface AutoBackupDB {
  open(): Promise<IDBDatabase>;
  saveBackup<TData>(frequency: BackupFrequency, data: TData): Promise<BackupRecord<TData>>;
  listBackups<TData>(frequency?: BackupFrequency): Promise<BackupRecord<TData>[]>;
  getBackup<TData>(id: string): Promise<BackupRecord<TData> | undefined>;
  deleteBackup(id: string): Promise<void>;
  pruneBackups(frequency: BackupFrequency, maxCount: number): Promise<number | undefined>;
}

export interface AutoBackupProvider {
  name: string;
  uploadBackup(providerConfig: Record<string, unknown>, data: unknown): Promise<string>;
  listBackups(providerConfig: Record<string, unknown>): Promise<Array<{ filename: string; lastModified: string | null }>>;
  downloadBackup(providerConfig: Record<string, unknown>, filename: string): Promise<unknown>;
  deleteBackup(providerConfig: Record<string, unknown>, filename: string): Promise<void>;
  testConnection(providerConfig: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
}

export interface AutoBackupRetention {
  hourly: number;
  daily: number;
  weekly: number;
}

export interface AutoBackupIntervals {
  hourly: number;
  daily: number;
  weekly: number;
}

export const AUTO_BACKUP_RETENTION: AutoBackupRetention;
export const AUTO_BACKUP_INTERVALS: AutoBackupIntervals;

export function createAutoBackupDB(config: { autoBackupDBName: string }): AutoBackupDB;
export function createAutoBackupProviders(config: {
  backupFilenamePrefix: string;
  appFolderName: string;
  webdavFetch: WebdavFetch;
}): Record<string, AutoBackupProvider>;

// ---------------------------------------------------------------------------
// Providers / transport
// ---------------------------------------------------------------------------

export type WebdavFetch = (
  method: string,
  url: string,
  authHeaders: Record<string, string>,
  body?: string | null,
  extraHeaders?: Record<string, string>,
) => Promise<{
  status: number;
  ok: boolean;
  statusText?: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface CloudSyncProvider {
  name: string;
  configFields: Array<{ key: string; label: string; type: string; placeholder?: string }>;
  helpText?: string;
  upload(config: Record<string, unknown>, envelope: SyncEnvelope, etag?: string | null): Promise<boolean>;
  download(config: Record<string, unknown>): Promise<{ payload: unknown; etag: string | null } | null>;
  test(config: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
}

export function webdavFetch(config: SyncEngineConfig): WebdavFetch;
export function createProviders(config: SyncEngineConfig): Record<string, CloudSyncProvider>;

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface SyncEngineConfig {
  // Identity
  storageKeyPrefix: string;
  cryptoDBName: string;
  autoBackupDBName: string;
  syncFilename: string;
  appFolderName: string;
  backupFilenamePrefix: string;
  appId: string;
  appName: string;

  // Transport bridges (optional, listed in priority order)
  nativeHttpRequest?: NativeHttpRequest | null;
  electronProxyFetch?: ElectronProxyFetch | null;
  proxyUrl?: string;

  // Crypto bridges (forwarded to crypto.js)
  nativeGetSyncKey?: (() => string | null | Promise<string | null>) | null;
  nativeStoreSyncKey?: ((value: string | null) => void) | null;

  // Data lifecycle callbacks
  buildPayload: () => unknown | Promise<unknown>;
  buildBackupPayload?: () => unknown | Promise<unknown>;
  applyPayload: (data: unknown, opts: { allowEmpty: boolean }) => void | Promise<void>;
  mergePayloads: (local: unknown, remote: unknown) => {
    data: unknown;
    localChanged: boolean;
    remoteChanged: boolean;
  };
  validateUploadPayload?: (payload: SyncEnvelope) => ValidationResult | Promise<ValidationResult>;
  validateApplyPayload?: (payload: SyncEnvelope) => ValidationResult | Promise<ValidationResult>;

  // Event callbacks
  onStatusChange?: (status: SyncStatus, hints?: { from?: SyncStatus }) => void;
  onError?: (message: string | null, code: SyncErrorCode | null, isHardStop: boolean) => void;
  onLastSyncedChange?: (isoString: string) => void;
  onConflict?: (remoteData: unknown, remoteModified: string, etag: string | null) => void;
  onPassphraseRequired?: () => void;
  onFirstSyncReload?: () => void;

  // Retention
  retentionDays?: number;
}

export interface SyncEngine {
  sync(): Promise<void>;
  upload(opts?: {
    prebuiltPayload?: unknown;
    etag?: string | null;
    skipLockCheck?: boolean;
  }): Promise<void>;
  download(): Promise<void>;
  runBackup(frequency: BackupFrequency): Promise<void>;
  test(config: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;

  getConfig(): Record<string, unknown> | null;
  setConfig(config: Record<string, unknown> | null): void;
  getLastSynced(): string | null;

  isSyncing(): boolean;
  isHardStopped(): boolean;
  clearHardStop(): void;
  hasEncryptionReady(): boolean;
  getUploadBackoffUntil(): number;
  getDownloadBackoffUntil(): number;

  providers: Record<string, CloudSyncProvider>;
  autoBackupDB: AutoBackupDB;
  autoBackupProviders: Record<string, AutoBackupProvider>;
  webdavFetch: WebdavFetch;
}

export function createSyncEngine(config: SyncEngineConfig): SyncEngine;

export const SCHEMA_VERSION: number;
export const SUPPORTED_MAX_SCHEMA_VERSION: number;
