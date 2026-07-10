// GLANCEvault URL transport-security policy (shared by the settings form's Save +
// Test Connection paths). The native Android/iOS shells enforce the SAME rule as a
// belt-and-braces check before opening a stream (see VaultSseClient.kt /
// VaultSseBridge.swift), so keep this logic and theirs in agreement.
//
// RULE: the Bearer device token must not travel over cleartext on the public
// internet. Require https://, EXCEPT allow http:// for loopback and LAN hosts
// (localhost, 127.0.0.0/8, ::1, RFC1918 ranges, *.local) — self-hosters running a
// vault on their own network are a real audience — but flag that http:// case with
// a warning so it is a deliberate, informed choice. A plain-internet http:// URL is
// rejected outright.

/**
 * True when an http:// host is a loopback or private-LAN address for which
 * cleartext is acceptable. Mirrors isLocalOrLanHost in the native shells.
 * @param {string} rawHost hostname (no scheme/port), IPv6 may be bracketed
 */
export function isLocalOrLanHost(rawHost) {
  let host = (rawHost || '').trim().toLowerCase();
  if (!host) return false;
  // Strip IPv6 brackets: new URL('http://[::1]').hostname yields '[::1]'.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  if (host.endsWith('.local')) return true; // mDNS / Bonjour LAN names
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (m.slice(1).some((o) => Number(o) > 255)) return false;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  return false;
}

/**
 * Classify a vault URL for the settings form.
 * @param {string} rawUrl the URL the user typed
 * @returns {{ok: boolean, warning?: boolean, messageKey?: string}}
 *   ok=false      → block save/test; messageKey names the error to show.
 *   ok=true,warning=true → allowed, but show messageKey as an inline warning.
 *   ok=true (no warning) → https:// (or another accepted secure form): no message.
 */
export function classifyVaultUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) return { ok: false, messageKey: 'sync.vaultUrl.invalid' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, messageKey: 'sync.vaultUrl.invalid' };
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme === 'https:') return { ok: true };
  if (scheme !== 'http:') return { ok: false, messageKey: 'sync.vaultUrl.invalid' };
  // http:// — acceptable only for loopback/LAN hosts, and even then with a warning.
  if (isLocalOrLanHost(parsed.hostname)) {
    return { ok: true, warning: true, messageKey: 'sync.vaultUrl.insecureLanWarning' };
  }
  return { ok: false, messageKey: 'sync.vaultUrl.httpRejected' };
}
