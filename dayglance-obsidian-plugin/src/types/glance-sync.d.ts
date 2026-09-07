// Minimal ambient types for the one @glance-apps/sync module the plugin
// consumes (the package ships untyped JS). The deep import is deliberate:
// bundling only vaultClient.js keeps the rest of the sync engine — IndexedDB
// key storage, the DB engine, providers — out of main.js.
declare module '@glance-apps/sync/src/vaultClient.js' {
  export interface VaultClientResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }
  export type VaultFetchImpl = (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<VaultClientResponse>;
  export interface VaultClient {
    batch(app: string, opts: { accountId: string; rows: unknown[] }): Promise<{ written: number; maxSeq: number }>;
    list(app: string, opts: { accountId: string; since: number | string }): Promise<{ rows: unknown[]; hasMore: boolean }>;
    getRow(app: string, entityId: string, accountId: string): Promise<unknown | null>;
    deleteRow(app: string, entityId: string, accountId: string, opts?: { deletedAt?: number }): Promise<unknown | null>;
    getSalt(accountId: string): Promise<Uint8Array | null>;
    device(app: string, opts: { accountId: string; deviceId: string; lastSeenSeq: number }): Promise<{ updated: boolean }>;
  }
  export function createVaultClient(config: {
    vaultUrl: string;
    vaultToken: string;
    fetchImpl?: VaultFetchImpl;
  }): VaultClient;
}

// The per-entity crypto half (companion spec 4.2, the sidebar view): the
// plugin derives the account root key from the sync passphrase exactly like
// any dayGLANCE client and uses it to READ the data plane. It never
// encryptEntity()s a data-plane row — the single-writer boundary holds; the
// module is imported for the reader half and the key lifecycle only.
declare module '@glance-apps/sync/src/dbCrypto.js' {
  export const RESERVED_ENTITY_PREFIX: string;
  export const KEYCHECK_ENTITY_ID: string;
  export function isReservedEntityId(entityId: string): boolean;
  export function hasDbRootKey(): boolean;
  export function setupDbRootKey(
    passphrase: string, salt: Uint8Array,
    config: { cryptoDBName: string; nativeGetSyncKey?: null; nativeStoreSyncKey?: null },
  ): Promise<void>;
  export function initDbRootKey(config: { cryptoDBName: string }): Promise<boolean>;
  export function clearDbRootKey(config: { cryptoDBName: string }): Promise<void>;
  export function decryptEntity(ciphertextB64: string, entityId: string): Promise<unknown>;
}
