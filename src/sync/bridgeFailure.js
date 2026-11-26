// The native and desktop HTTP bridges report "the request never got an answer"
// as a RESULT, not a throw: { status: 0, ok: false, error | statusText }
// (Android/iOS HttpBridge, electron main's proxyFetch). Status 0 is not an HTTP
// status. Passed on as one, the vault client turns it into a VaultError
// carrying status 0, and every surface above it reads that as the server
// answering: Test Connection said "The vault rejected the request (status 0)"
// for a port nobody listened on (#2445).
//
// Browser fetch throws a TypeError for the same failure, and everything above
// the transport already treats "threw, no status" as unreachable. So a bridge's
// failure shape is turned into that throw here, keeping the bridge's own reason
// ("Failed to connect to /10.0.0.5:8080", a TLS error, the http:// refusal) as
// the message instead of dropping it.

/**
 * Return the bridge result unchanged, or throw a TypeError when it is the
 * bridge's "no response" shape (null, or status 0).
 *
 * @param {object|null|undefined} r  the bridge's { status, ok, body, ... } result
 * @returns {object} r
 */
export function throwIfBridgeFailure(r) {
  if (!r) throw new TypeError('Failed to fetch');
  if (r.status === 0) {
    const reason = (typeof r.error === 'string' && r.error.trim())
      || (typeof r.statusText === 'string' && r.statusText.trim())
      || 'Failed to fetch';
    const err = new TypeError(reason);
    // Only a bridge has a reason worth showing; browser fetch's own messages
    // ("Failed to fetch", "Load failed") say nothing the UI does not.
    if (reason !== 'Failed to fetch') err.bridgeReason = reason;
    throw err;
  }
  return r;
}
