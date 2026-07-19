import { describe, it, expect } from 'vitest';
import { normalizeEtag } from '@glance-apps/sync';

// ─────────────────────────────────────────────────────────────────────────────
// App.jsx's CalDAV completion sync normalizes the captured ETag before using it
// as If-Match (syncTaskCompletionToCalDAV). That depends on the exact contract
// of @glance-apps/sync's normalizeEtag (added in 1.6.1): strip a weak-validator
// prefix and Apache's content-coding suffixes, pass everything else through.
// These pin that contract so a future engine bump can't silently change it.
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeEtag (engine contract)', () => {
  it('passes clean strong ETags through unchanged', () => {
    expect(normalizeEtag('"abc123"')).toBe('"abc123"');
  });

  it('strips the weak-validator prefix (nginx gzip downgrade)', () => {
    expect(normalizeEtag('W/"abc123"')).toBe('"abc123"');
  });

  it('strips Apache mod_deflate content-coding suffixes inside the quotes', () => {
    expect(normalizeEtag('"abc123-gzip"')).toBe('"abc123"');
    expect(normalizeEtag('"abc123-br"')).toBe('"abc123"');
  });

  it('handles a weak, suffixed ETag (nginx in front of Apache)', () => {
    expect(normalizeEtag('W/"abc123-gzip"')).toBe('"abc123"');
  });

  it('passes null and undefined through (no ETag header captured)', () => {
    expect(normalizeEtag(null)).toBeNull();
    expect(normalizeEtag(undefined)).toBeUndefined();
  });
});
