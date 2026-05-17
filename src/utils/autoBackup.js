// Shim: re-exports auto-backup module from @glance-apps/sync with dayGLANCE-pinned config.
// Callers use the same autoBackupDB, autoBackupProviders, AUTO_BACKUP_RETENTION,
// and AUTO_BACKUP_INTERVALS exports as before.
import { webdavFetch } from './cloudSyncProviders.js';
import {
  createAutoBackupDB,
  createAutoBackupProviders,
  AUTO_BACKUP_RETENTION,
  AUTO_BACKUP_INTERVALS,
} from '@glance-apps/sync';

export { AUTO_BACKUP_RETENTION, AUTO_BACKUP_INTERVALS };

export const autoBackupDB = createAutoBackupDB({
  autoBackupDBName: 'dayglance-auto-backups',
});

export const autoBackupProviders = createAutoBackupProviders({
  backupFilenamePrefix: 'dayglance-backup-',
  appFolderName: 'dayglance',
  webdavFetch,
});
