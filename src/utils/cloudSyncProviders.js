import { nativeHttpRequest } from '../native.js';

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
    async upload(config, data) {
      const fileUrl = this.getFileUrl(config);
      const dirUrl = this.getDirUrl(config);
      const authHeaders = this.getAuthHeaders(config);
      const body = JSON.stringify(data);

      const doUpload = () =>
        webdavFetch('PUT', fileUrl, authHeaders, body, { 'Content-Type': 'application/json' });

      let res = await doUpload();
      if (res.status === 404 || res.status === 409) {
        // Directory doesn't exist, create it
        await webdavFetch('MKCOL', dirUrl, authHeaders);
        res = await doUpload();
      }
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      return true;
    },
    async download(config) {
      const fileUrl = this.getFileUrl(config);
      const authHeaders = this.getAuthHeaders(config);

      const res = await webdavFetch('GET', fileUrl, authHeaders);

      if (res.status === 404) return null; // No remote file yet
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      return res.json();
    },
    async test(config) {
      const dirUrl = this.getDirUrl(config);
      const authHeaders = this.getAuthHeaders(config);

      const res = await webdavFetch('PROPFIND', dirUrl, authHeaders, undefined, { 'Depth': '0' });

      if (res.status === 200 || res.status === 207 || res.status === 404) return { success: true };
      if (res.status === 401) return { success: false, error: 'Invalid credentials. Check your username and app password.' };
      return { success: false, error: `Unexpected response: ${res.status}${res.statusText ? ' ' + res.statusText : ''}` };
    },
    configFields: [
      { key: 'nextcloudUrl', label: 'Nextcloud URL', type: 'url', placeholder: 'https://cloud.example.com' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username' },
      { key: 'appPassword', label: 'App Password', type: 'password', placeholder: 'xxxxx-xxxxx-xxxxx-xxxxx-xxxxx' }
    ],
    helpText: 'Go to Nextcloud Settings → Security → Devices & sessions → Create new app password'
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
    async upload(config, data) {
      const fileUrl = this.getFileUrl(config);
      const dirUrl = this.getDirUrl(config);
      const authHeaders = this.getAuthHeaders(config);
      const body = JSON.stringify(data);
      const doUpload = () =>
        webdavFetch('PUT', fileUrl, authHeaders, body, { 'Content-Type': 'application/json' });
      let res = await doUpload();
      if (res.status === 404 || res.status === 409) {
        await webdavFetch('MKCOL', dirUrl, authHeaders);
        res = await doUpload();
      }
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      return true;
    },
    async download(config) {
      const fileUrl = this.getFileUrl(config);
      const authHeaders = this.getAuthHeaders(config);
      const res = await webdavFetch('GET', fileUrl, authHeaders);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      return res.json();
    },
    async test(config) {
      const dirUrl = this.getDirUrl(config);
      const authHeaders = this.getAuthHeaders(config);
      const res = await webdavFetch('PROPFIND', dirUrl, authHeaders, undefined, { 'Depth': '0' });
      if (res.status === 200 || res.status === 207 || res.status === 404) return { success: true };
      if (res.status === 401) return { success: false, error: 'Invalid credentials. Check your username and password.' };
      return { success: false, error: `Unexpected response: ${res.status}${res.statusText ? ' ' + res.statusText : ''}` };
    },
    configFields: [
      { key: 'webdavUrl', label: 'WebDAV URL', type: 'url', placeholder: 'https://app.koofr.net/dav/Koofr/dayGLANCE/' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username' },
      { key: 'appPassword', label: 'Password / App Password', type: 'password', placeholder: 'your-password' }
    ],
    helpText: 'Enter the full URL of the WebDAV folder where dayGLANCE should store its sync file. Koofr, pCloud, Seafile, and most WebDAV providers are supported.'
  }
};
