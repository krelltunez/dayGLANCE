// To be merged into packages/sync/src/index.js — additions only.
// The existing exports (merge, crypto, providers, autoBackup) stay as-is.

// ADD at the bottom:
export {
  createSyncEngine,
  SCHEMA_VERSION,
  SUPPORTED_MAX_SCHEMA_VERSION,
} from './engine.js';

// AUTO_BACKUP_RETENTION and AUTO_BACKUP_INTERVALS are already re-exported from
// autoBackup.js in the existing index.js — engine.js re-exports them too for
// convenience but the canonical export remains the one from autoBackup.js. No
// duplicate-export change needed in index.js.
