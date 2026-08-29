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
    device(app: string, opts: { accountId: string; deviceId: string; lastSeenSeq: number }): Promise<{ updated: boolean }>;
  }
  export function createVaultClient(config: {
    vaultUrl: string;
    vaultToken: string;
    fetchImpl?: VaultFetchImpl;
  }): VaultClient;
}
