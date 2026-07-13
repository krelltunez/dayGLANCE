import { describe, expect, it } from 'vitest';
import { deriveReviewerCode, sha256Hex } from '../src/reviewer.js';
import { BillingEngine } from '../src/engine.js';
import type { StorageLike } from '../src/types.js';

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

describe('reviewer bypass', () => {
  it('derives a stable 12-hex-char code per secret+month', async () => {
    const a = await deriveReviewerCode('secret-a', '2026-07');
    const b = await deriveReviewerCode('secret-a', '2026-07');
    const c = await deriveReviewerCode('secret-a', '2026-08');
    const d = await deriveReviewerCode('secret-b', '2026-07');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c); // rotates monthly
    expect(a).not.toBe(d); // app-specific
  });

  it('parity with the reference implementation (HMAC-SHA256, 6 bytes hex)', async () => {
    // Independently computed with node:crypto:
    //   createHmac('sha256', 'ref-secret').update('2026-01').digest() first 6 bytes
    const { createHmac } = await import('node:crypto');
    const expected = createHmac('sha256', 'ref-secret').update('2026-01')
      .digest().subarray(0, 6).toString('hex');
    expect(await deriveReviewerCode('ref-secret', '2026-01')).toBe(expected);
  });

  it('engine: validates the current code, persists a hash, restores on next start', async () => {
    const storage = new MemStorage();
    const engine = new BillingEngine({ adapter: null, storage, reviewerSecret: 's3cret' });
    engine.start();

    expect(await engine.setReviewerUnlocked('wrong-code')).toBe(false);
    expect(engine.getSnapshot().reviewerUnlocked).toBe(false);

    const code = await deriveReviewerCode('s3cret');
    expect(await engine.setReviewerUnlocked(code)).toBe(true);
    expect(engine.getSnapshot().reviewerUnlocked).toBe(true);
    // Stored as a hash, never the raw code.
    expect(storage.getItem('glance-billing.reviewer-unlock')).toBe(await sha256Hex(code));

    // A fresh engine on the same storage restores the unlock.
    const engine2 = new BillingEngine({ adapter: null, storage, reviewerSecret: 's3cret' });
    engine2.start();
    await new Promise((r) => setTimeout(r, 0)); // let the async validation settle
    await new Promise((r) => setTimeout(r, 0));
    expect(engine2.getSnapshot().reviewerUnlocked).toBe(true);
  });

  it('engine: disabled entirely when no secret is configured', async () => {
    const engine = new BillingEngine({ adapter: null, storage: new MemStorage() });
    engine.start();
    expect(await engine.setReviewerUnlocked('anything')).toBe(false);
  });
});
