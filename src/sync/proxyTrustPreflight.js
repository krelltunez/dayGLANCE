// Desktop pre-flight for the Electron proxy's private-address guard (#1642,
// #2024), shared by every Test Connection that goes through `proxy-fetch`.
//
// The proxy refuses a URL that resolves to a private network address until the
// user grants its origin, and reports the refusal as a synthetic 400 that never
// reached the server. Asking the main process first lets a test say what really
// happened and offer the grant, instead of blaming the server for a 400.
//
// Off desktop there is no such guard (the browser build and the mobile native
// HTTP bridge reach a private server directly), so there is no inspector and
// every helper here is a no-op.

// The desktop proxy's private-address inspector, or null off desktop.
export const defaultInspectProxyTrust = () =>
  (typeof window !== 'undefined' && window.electronAPI?.proxyTrust?.inspect)
    ? (url) => window.electronAPI.proxyTrust.inspect(url)
    : null;

/**
 * Ask whether the desktop proxy will refuse `url`.
 *
 * @returns {Promise<null | {canGrant:boolean, origin:string}>} null when the URL
 *   will be let through, or when there is no inspector or it failed: the
 *   inspector is a diagnostic, never a gate, so the real probe classifies
 *   whatever happens next.
 */
export async function inspectPrivateAddress(url, inspect = defaultInspectProxyTrust()) {
  if (!inspect || !url) return null;
  try {
    const verdict = await inspect(url);
    if (verdict?.blocked) return { canGrant: !!verdict.canGrant, origin: verdict.origin };
  } catch {
    // Fall through: see above.
  }
  return null;
}

// The server URL the user typed for a file-tier provider: its `url` config
// field (`webdavUrl`, `nextcloudUrl`). Koofr has none, as it is a fixed public
// host, so it needs no pre-flight.
export function providerServerUrl(provider, config) {
  const field = provider?.configFields?.find((f) => f.type === 'url');
  const value = field ? (config?.[field.key] || '').trim() : '';
  return value || null;
}

export const BLOCKED_PRIVATE_ADDRESS = 'BLOCKED_PRIVATE_ADDRESS';

/**
 * WebDAV / Nextcloud Test Connection with the desktop pre-flight in front.
 *
 * @param {object} config - the form's provider config
 * @param {object} deps
 *   provider          the provider definition (for its URL field)
 *   probe             (config) => Promise<{success, error?}>, the real test
 *   inspectProxyTrust injection seam; defaults to the desktop inspector
 * @returns the probe's result, or `{success:false, code:BLOCKED_PRIVATE_ADDRESS,
 *   canGrant, origin}` when the proxy would refuse the server without a request.
 */
export async function testFileTierConnection(config, { provider, probe, inspectProxyTrust } = {}) {
  const url = providerServerUrl(provider, config);
  const blocked = url ? await inspectPrivateAddress(url, inspectProxyTrust) : null;
  if (blocked) return { success: false, code: BLOCKED_PRIVATE_ADDRESS, ...blocked };
  return probe(config);
}
