import { describe, it, expect } from 'vitest';
import { deterministicTaskIdFromSeed } from './mcpIdempotency.js';

// The create-side half of §5.2: a replayed create derives the same id. The
// replay store, key validation and store-key scoping are tested with
// @glance-apps/mcp-host (packages/mcp-host/test/idempotency.test.js).

describe('deterministicTaskIdFromSeed', () => {
  it('is stable, seed-sensitive, and UUIDv4-shaped (the handleIntent precedent)', () => {
    const a = deterministicTaskIdFromSeed('token|create_task|k1');
    expect(a).toBe(deterministicTaskIdFromSeed('token|create_task|k1'));
    expect(a).not.toBe(deterministicTaskIdFromSeed('token|create_task|k2'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// The synchronous twin of @glance-apps/intents' deterministicTaskId (1.5.0):
// main derives a create's id with node:crypto because its callers are
// synchronous, and the package's is async (WebCrypto). Both must give every
// seed the same id, or an id changes depending on which side made it.
describe('deterministicTaskIdFromSeed matches the package', () => {
  it('gives the id @glance-apps/intents gives, for any seed', async () => {
    const { deterministicTaskId } = await import('@glance-apps/intents');
    for (const seed of ['token|create_task|k1', '', 'ünïcödé|seed', 'app.lastglance|33333333-3333-3333-3333-333333333333|2026-11-15']) {
      expect(deterministicTaskIdFromSeed(seed), seed).toBe(await deterministicTaskId(seed));
    }
  });
});
