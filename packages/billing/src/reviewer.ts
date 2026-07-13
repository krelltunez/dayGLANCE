// Reviewer bypass for Play Console App-access policy and Apple App Review
// Guideline 2.1. A hard-gated app that App Review cannot get past the paywall
// fails review — every gated app must expose this, with its own secret.
//
// The code is time-based: HMAC-SHA256 over the current calendar month (UTC,
// "YYYY-MM"), keyed by an app-specific secret, truncated to 6 bytes of hex.
// It rotates on the 1st of each month; publish the current month's code in the
// store review notes.

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error('WebCrypto (crypto.subtle) is not available');
  return c.subtle;
}

/**
 * Derives the reviewer bypass code for [period] (default: the current UTC
 * month). The default period expression intentionally reads the clock via
 * `new Date().toISOString()` so callers that pin the clock for previews keep
 * working.
 */
export async function deriveReviewerCode(
  secret: string,
  period: string = new Date().toISOString().slice(0, 7),
): Promise<string> {
  const enc = new TextEncoder();
  const key = await subtle().importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await subtle().sign('HMAC', key, enc.encode(period));
  const bytes = new Uint8Array(sig).slice(0, 6);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await subtle().digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
