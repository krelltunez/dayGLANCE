// btoa() throws InvalidCharacterError for codepoints > 255 (CJK, emoji, etc.).
const toBase64 = (str) => btoa(unescape(encodeURIComponent(str)));

// Auto-backup IndexedDB wrapper
export const autoBackupDB = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('dayglance-auto-backups', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('backups')) {
          const store = db.createObjectStore('backups', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('frequency', 'frequency', { unique: false });
        }
      };
      req.onsuccess = () => { this._db = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  },
  async saveBackup(frequency, data) {
    const db = await this.open();
    const timestamp = new Date().toISOString();
    const id = `auto-${frequency}-${timestamp}`;
    const record = { id, timestamp, frequency, data };
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readwrite');
      tx.objectStore('backups').put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  },
  async listBackups(frequency) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readonly');
      const store = tx.objectStore('backups');
      const req = frequency
        ? store.index('frequency').getAll(frequency)
        : store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      req.onerror = () => reject(req.error);
    });
  },
  async getBackup(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readonly');
      const req = tx.objectStore('backups').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async deleteBackup(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readwrite');
      tx.objectStore('backups').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async pruneBackups(frequency, maxCount) {
    const all = await this.listBackups(frequency);
    if (all.length <= maxCount) return;
    const toDelete = all.slice(maxCount);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readwrite');
      const store = tx.objectStore('backups');
      toDelete.forEach(b => store.delete(b.id));
      tx.oncomplete = () => resolve(toDelete.length);
      tx.onerror = () => reject(tx.error);
    });
  }
};

// Auto-backup remote providers (separate from cloudSyncProviders which handles real-time sync)
export const autoBackupProviders = {
  nextcloud: {
    name: 'Nextcloud / WebDAV',
    configFields: [
      { key: 'nextcloudUrl', label: 'Nextcloud URL', type: 'url', placeholder: 'https://cloud.example.com' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username' },
      { key: 'appPassword', label: 'App Password', type: 'password', placeholder: 'xxxxx-xxxxx-xxxxx-xxxxx-xxxxx' }
    ],
    _getBackupDirUrl(config) {
      return `${config.nextcloudUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(config.username)}/dayglance/backups/`;
    },
    _getAuthHeaders(config) {
      return { 'X-WebDAV-Auth': 'Basic ' + toBase64(config.username + ':' + config.appPassword) };
    },
    async uploadBackup(config, data) {
      const dirUrl = this._getBackupDirUrl(config);
      const authHeaders = this._getAuthHeaders(config);
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      const filename = `dayglance-backup-${timestamp}.json`;
      const fileUrl = dirUrl + filename;
      const body = JSON.stringify(data);

      const doUpload = () =>
        fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body
        });

      let res = await doUpload();
      if (res.status === 404 || res.status === 409) {
        // Create /dayglance/ then /dayglance/backups/
        const parentDir = `${config.nextcloudUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(config.username)}/dayglance/`;
        await fetch(`/api/webdav-proxy/?url=${parentDir}`, { method: 'MKCOL', headers: authHeaders });
        await fetch(`/api/webdav-proxy/?url=${dirUrl}`, { method: 'MKCOL', headers: authHeaders });
        res = await doUpload();
      }
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      return filename;
    },
    async listBackups(config) {
      const dirUrl = this._getBackupDirUrl(config);
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${dirUrl}`, {
        method: 'PROPFIND',
        headers: { ...authHeaders, 'Depth': '1' }
      });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`List failed: ${res.status}`);
      const xml = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      const responses = doc.querySelectorAll('response');
      const files = [];
      responses.forEach(r => {
        const href = r.querySelector('href')?.textContent || '';
        const filename = decodeURIComponent(href.split('/').filter(Boolean).pop());
        if (filename.startsWith('dayglance-backup-') && filename.endsWith('.json')) {
          const lastModified = r.querySelector('getlastmodified')?.textContent;
          files.push({ filename, lastModified: lastModified ? new Date(lastModified).toISOString() : null });
        }
      });
      return files.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
    },
    async downloadBackup(config, filename) {
      const fileUrl = this._getBackupDirUrl(config) + filename;
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
        method: 'GET',
        headers: authHeaders
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return res.json();
    },
    async deleteBackup(config, filename) {
      const fileUrl = this._getBackupDirUrl(config) + filename;
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (!res.ok && res.status !== 404) throw new Error(`Delete failed: ${res.status}`);
    },
    async testConnection(config) {
      const dirUrl = this._getBackupDirUrl(config);
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${dirUrl}`, {
        method: 'PROPFIND',
        headers: { ...authHeaders, 'Depth': '0' }
      });
      if (res.status === 200 || res.status === 207 || res.status === 404) return { success: true };
      if (res.status === 401) return { success: false, error: 'Invalid credentials.' };
      return { success: false, error: `Unexpected response: ${res.status}` };
    }
  },
  webdav: {
    name: 'Generic WebDAV',
    configFields: [
      { key: 'webdavUrl', label: 'WebDAV URL', type: 'url', placeholder: 'https://app.koofr.net/dav/Koofr/dayGLANCE/' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username' },
      { key: 'appPassword', label: 'Password / App Password', type: 'password', placeholder: 'your-password' }
    ],
    _getBackupDirUrl(config) {
      return `${config.webdavUrl.replace(/\/+$/, '')}/`;
    },
    _getAuthHeaders(config) {
      return { 'X-WebDAV-Auth': 'Basic ' + toBase64(config.username + ':' + config.appPassword) };
    },
    async uploadBackup(config, data) {
      const dirUrl = this._getBackupDirUrl(config);
      const authHeaders = this._getAuthHeaders(config);
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      const filename = `dayglance-backup-${timestamp}.json`;
      const fileUrl = dirUrl + filename;
      const body = JSON.stringify(data);
      const doUpload = () =>
        fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body
        });
      let res = await doUpload();
      if (res.status === 404 || res.status === 409) {
        await fetch(`/api/webdav-proxy/?url=${dirUrl}`, { method: 'MKCOL', headers: authHeaders });
        res = await doUpload();
      }
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      return filename;
    },
    async listBackups(config) {
      const dirUrl = this._getBackupDirUrl(config);
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${dirUrl}`, {
        method: 'PROPFIND',
        headers: { ...authHeaders, 'Depth': '1' }
      });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`List failed: ${res.status}`);
      const xml = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      const responses = doc.querySelectorAll('response');
      const files = [];
      responses.forEach(r => {
        const href = r.querySelector('href')?.textContent || '';
        const filename = decodeURIComponent(href.split('/').filter(Boolean).pop());
        if (filename.startsWith('dayglance-backup-') && filename.endsWith('.json')) {
          const lastModified = r.querySelector('getlastmodified')?.textContent;
          files.push({ filename, lastModified: lastModified ? new Date(lastModified).toISOString() : null });
        }
      });
      return files.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
    },
    async downloadBackup(config, filename) {
      const fileUrl = this._getBackupDirUrl(config) + filename;
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
        method: 'GET',
        headers: authHeaders
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return res.json();
    },
    async deleteBackup(config, filename) {
      const fileUrl = this._getBackupDirUrl(config) + filename;
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (!res.ok && res.status !== 404) throw new Error(`Delete failed: ${res.status}`);
    },
    async testConnection(config) {
      const dirUrl = this._getBackupDirUrl(config);
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${dirUrl}`, {
        method: 'PROPFIND',
        headers: { ...authHeaders, 'Depth': '0' }
      });
      if (res.status === 200 || res.status === 207 || res.status === 404) return { success: true };
      if (res.status === 401) return { success: false, error: 'Invalid credentials.' };
      return { success: false, error: `Unexpected response: ${res.status}` };
    }
  }
};

// Auto-backup retention limits
export const AUTO_BACKUP_RETENTION = { hourly: 24, daily: 30, weekly: 12 };
export const AUTO_BACKUP_INTERVALS = { hourly: 3600, daily: 86400, weekly: 604800 };
