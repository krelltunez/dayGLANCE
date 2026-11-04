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
