import { nativeHttpRequest } from '../native.js';
import { encryptData, decryptData, isEncryptedEnvelope } from './crypto.js';

// btoa() throws InvalidCharacterError for codepoints > 255 (CJK, emoji, etc.).
const toBase64 = (str) => btoa(unescape(encodeURIComponent(str)));

// Routes WebDAV requests through the server-side CORS proxy on web, or
// directly via the Android HTTP bridge on native.
export const webdavFetch = async (method, targetUrl, authHeaders, body, extraHeaders = {}) => {
  if (typeof window !== 'undefined' && window.DayGlanceNative?.httpRequest) {
    // On Android: call the target URL directly with a standard Authorization header.
    const headers = { ...extraHeaders };
    if (authHeaders['X-WebDAV-Auth']) {
      headers['Authorization'] = authHeaders['X-WebDAV-Auth'];
    } else {
      Object.assign(headers, authHeaders);
    }
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = extraHeaders['Content-Type'] || 'application/octet-stream';
    }
    const result = nativeHttpRequest(method, targetUrl, headers, body ?? '');
    if (!result) throw new Error('Native HTTP bridge unavailable');
    return {
      status: result.status,
      ok: result.ok,
      statusText: result.error || '',
      headers: { get: () => null }, // Android bridge doesn't return response headers
      json: async () => JSON.parse(result.body),
      text: async () => result.body,
    };
  }
  if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
    // On Electron: route through the main process (net.fetch has no CORS restrictions).
    const headers = { ...extraHeaders };
    if (authHeaders['X-WebDAV-Auth']) {
      headers['Authorization'] = authHeaders['X-WebDAV-Auth'];
    } else {
      Object.assign(headers, authHeaders);
    }
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = extraHeaders['Content-Type'] || 'application/octet-stream';
    }
    const result = await window.electronAPI.proxyFetch(method, targetUrl, headers, body ?? null);
    if (!result) throw new Error('Electron network bridge unavailable');
    return {
      status: result.status,
      ok: result.ok,
      statusText: result.statusText,
      headers: { get: () => null }, // Electron bridge doesn't return response headers
      json: async () => JSON.parse(result.body),
      text: async () => result.body,
    };
  }
  // On web: route through the server-side CORS proxy.
  return fetch(`/api/webdav-proxy/?url=${targetUrl}`, {
    method,
    headers: { ...authHeaders, ...extraHeaders },
    ...(body !== undefined && body !== null ? { body } : {}),
  });
};

// Parses and decrypts a WebDAV download response.
// Returns { payload, etag } where etag may be null if the server doesn't supply one.
const parseDownloadResponse = async (res) => {
  const parsed = await res.json();
  const payload = isEncryptedEnvelope(parsed) ? await decryptData(parsed) : parsed;
  const etag = res.headers.get('etag') || null;
  return { payload, etag };
};

// Creates a WebDAV collection and any missing intermediate collections.
// MKCOL returns 409 when the parent directory doesn't exist; in that case
// we walk up the path, create the parent first, then retry.
// Some providers (e.g. Koofr) non-standardly return 404 instead of 409 —
// treat both the same way.
const mkcolWithParents = async (dirUrl, authHeaders) => {
  const res = await webdavFetch('MKCOL', dirUrl, authHeaders);
  if (res.status === 409 || res.status === 404) {
    const parent = dirUrl.replace(/\/+$/, '').replace(/\/[^/]+$/, '/');
    if (parent && parent !== dirUrl) {
      await mkcolWithParents(parent, authHeaders);
      await webdavFetch('MKCOL', dirUrl, authHeaders);
    }
  }
};

export const cloudSyncProviders = {
  nextcloud: {
    name: 'Nextcloud / WebDAV',
    getFileUrl: (config) =>
      `${config.nextcloudUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(config.username)}/dayglance/dayglance-sync.json`,
    getDirUrl: (config) =>
      `${config.nextcloudUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(config.username)}/dayglance/`,
    getAuthHeaders: (config) => ({
      'X-WebDAV-Auth': 'Basic ' + toBase64(config.username + ':' + config.appPassword)
    }),
    async upload(config, data, etag = null) {
      const fileUrl = this.getFileUrl(config);
      const dirUrl = this.getDirUrl(config);
      const authHeaders = this.getAuthHeaders(config);
      const payload = config.encryptionEnabled ? await encryptData(data) : data;
      const body = JSON.stringify(payload);
      const extraHeaders = { 'Content-Type': 'application/json' };
      if (etag) extraHeaders['If-Match'] = etag;

      const doUpload = () =>
        webdavFetch('PUT', fileUrl, authHeaders, body, extraHeaders);

      let res = await doUpload();
      if (res.status === 404 || res.status === 409) {
        await mkcolWithParents(dirUrl, authHeaders);
        res = await doUpload();
      }
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (res.status === 412) throw new Error('PRECONDITION_FAILED');
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      return true;
    },
    async download(config) {
      const fileUrl = this.getFileUrl(config);
      const authHeaders = this.getAuthHeaders(config);

      const res = await webdavFetch('GET', fileUrl, authHeaders);

      if (res.status === 404) return null; // No remote file yet
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      return parseDownloadResponse(res);
    },
    async test(config) {
      const dirUrl = this.getDirUrl(config);
      const authHeaders = this.getAuthHeaders(config);

      const res = await webdavFetch('PROPFIND', dirUrl, authHeaders, undefined, { 'Depth': '0' });

      if (res.status === 200 || res.status === 207 || res.status === 404) return { success: true };
      if (res.status === 401) return { success: false, error: 'Invalid credentials. Check your username and app password.' };
      if (res.status === 403) return { success: false, error: 'Access forbidden (403). If using a self-hosted server, it may be blocking requests from Vercel\'s IP addresses.' };
      return { success: false, error: `Unexpected response: ${res.status}${res.statusText ? ' ' + res.statusText : ''}` };
    },
    configFields: [
      { key: 'nextcloudUrl', label: 'Nextcloud URL', type: 'url', placeholder: 'https://cloud.example.com' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username' },
      { key: 'appPassword', label: 'App Password', type: 'password', placeholder: 'xxxxx-xxxxx-xxxxx-xxxxx-xxxxx' }
    ],
    helpText: 'Go to Nextcloud Settings → Security → Devices & sessions → Create new app password'
  },
  koofr: {
    name: 'Koofr',
    getFileUrl: () => 'https://app.koofr.net/dav/Koofr/dayGLANCE/dayglance-sync.json',
    getDirUrl: () => 'https://app.koofr.net/dav/Koofr/dayGLANCE/',
    getAuthHeaders: (config) => ({
      'X-WebDAV-Auth': 'Basic ' + toBase64(config.username + ':' + config.appPassword)
    }),
    async upload(config, data, etag = null) {
      const fileUrl = this.getFileUrl();
      const dirUrl = this.getDirUrl();
      const authHeaders = this.getAuthHeaders(config);
      const payload = config.encryptionEnabled ? await encryptData(data) : data;
      const body = JSON.stringify(payload);
      const extraHeaders = { 'Content-Type': 'application/json' };
      if (etag) extraHeaders['If-Match'] = etag;
      const doUpload = () =>
        webdavFetch('PUT', fileUrl, authHeaders, body, extraHeaders);
      let res = await doUpload();
      if (res.status === 404 || res.status === 409) {
        await mkcolWithParents(dirUrl, authHeaders);
        res = await doUpload();
      }
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (res.status === 412) throw new Error('PRECONDITION_FAILED');
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      return true;
    },
    async download(config) {
      const fileUrl = this.getFileUrl();
      const authHeaders = this.getAuthHeaders(config);
      const res = await webdavFetch('GET', fileUrl, authHeaders);
      if (res.status === 404) return null;
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      return parseDownloadResponse(res);
    },
    async test(config) {
      const dirUrl = this.getDirUrl();
      const authHeaders = this.getAuthHeaders(config);
      const res = await webdavFetch('PROPFIND', dirUrl, authHeaders, undefined, { 'Depth': '0' });
      if (res.status === 200 || res.status === 207 || res.status === 404) return { success: true };
      if (res.status === 401) return { success: false, error: 'Invalid credentials. Use your Koofr email and an app password, not your account password.' };
      if (res.status === 403) {
        const onAndroid = typeof window !== 'undefined' && !!window.DayGlanceNative;
        if (!onAndroid) return { success: false, error: 'Koofr is blocking requests from the web app\'s server. Use the Android app — it connects to Koofr directly.' };
        return { success: false, error: 'Access forbidden. Check that your app password is correct and has not been revoked.' };
      }
      return { success: false, error: `Unexpected response: ${res.status}${res.statusText ? ' ' + res.statusText : ''}` };
    },
    configFields: [
      { key: 'username', label: 'Email', type: 'text', placeholder: 'you@example.com' },
      { key: 'appPassword', label: 'App Password', type: 'password', placeholder: 'your-app-password' },
    ],
    helpText: 'Go to Koofr → Preferences → App passwords → New app password. Use your Koofr email as the username. Note: sync works on the Android app (direct connection); the web app may be blocked by Koofr\'s server-side restrictions.',
  },
  webdav: {
    name: 'Generic WebDAV',
    getFileUrl: (config) =>
      `${config.webdavUrl.replace(/\/+$/, '')}/dayglance-sync.json`,
    getDirUrl: (config) =>
      `${config.webdavUrl.replace(/\/+$/, '')}/`,
    getAuthHeaders: (config) => ({
      'X-WebDAV-Auth': 'Basic ' + toBase64(config.username + ':' + config.appPassword)
    }),
    async upload(config, data, etag = null) {
      const fileUrl = this.getFileUrl(config);
      const dirUrl = this.getDirUrl(config);
      const authHeaders = this.getAuthHeaders(config);
      const payload = config.encryptionEnabled ? await encryptData(data) : data;
      const body = JSON.stringify(payload);
      const extraHeaders = { 'Content-Type': 'application/json' };
      if (etag) extraHeaders['If-Match'] = etag;
      const doUpload = () =>
        webdavFetch('PUT', fileUrl, authHeaders, body, extraHeaders);
      let res = await doUpload();
      if (res.status === 404 || res.status === 409) {
        await mkcolWithParents(dirUrl, authHeaders);
        res = await doUpload();
      }
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (res.status === 412) throw new Error('PRECONDITION_FAILED');
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      return true;
    },
    async download(config) {
      const fileUrl = this.getFileUrl(config);
      const authHeaders = this.getAuthHeaders(config);
      const res = await webdavFetch('GET', fileUrl, authHeaders);
      if (res.status === 404) return null;
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      return parseDownloadResponse(res);
    },
    async test(config) {
      // GET the sync file rather than PROPFIND — Apache mod_dav and other strict
      // servers return 400 for a bodyless PROPFIND (RFC 4918 requires XML body).
      // 404 = server reachable but no sync file yet (expected on first use).
      // 200 = file already exists. Both mean credentials and URL are good.
      const fileUrl = this.getFileUrl(config);
      const authHeaders = this.getAuthHeaders(config);
      const res = await webdavFetch('GET', fileUrl, authHeaders);
      if (res.status === 200 || res.status === 404) return { success: true };
      if (res.status === 401) return { success: false, error: 'Invalid credentials. Check your username and password.' };
      if (res.status === 403) return { success: false, error: 'Access forbidden (403). Check that the WebDAV URL and path are correct.' };
      return { success: false, error: `Unexpected response: ${res.status}${res.statusText ? ' ' + res.statusText : ''}` };
    },
    configFields: [
      { key: 'webdavUrl', label: 'WebDAV URL', type: 'url', placeholder: 'https://dav.example.com/dayGLANCE/' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username' },
      { key: 'appPassword', label: 'Password / App Password', type: 'password', placeholder: 'your-password' }
    ],
    helpText: 'Enter the full URL of the WebDAV folder where dayGLANCE should store its sync file. pCloud, Seafile, and most self-hosted WebDAV providers are supported.'
  }
};
