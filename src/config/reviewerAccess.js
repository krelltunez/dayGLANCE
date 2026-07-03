// Reviewer bypass for Play Console App access policy and Apple App Review Guideline 2.1.
// Derives a time-based unlock code used only for store App Review access.

const _S = 'dg-r3v13w-' + 'a9f2c741b8e05d3';

export async function deriveReviewerCode() {
  const period = new Date().toISOString().slice(0, 7);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(_S),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(period));
  const bytes = new Uint8Array(sig).slice(0, 6);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
