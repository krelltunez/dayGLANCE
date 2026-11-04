// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { paginate, decodeCursor } from '@glance-apps/mcp-host';
import { CURSOR_PREFIX } from '../src/readTools.js';

// dayGLANCE's pagination cursors on the host kit's paginate (§5.1). The paging
// rules are tested with @glance-apps/mcp-host
// (packages/mcp-host/test/pagination.test.js); what is dayGLANCE's is the
// prefix, which is wire format: a client may hold a cursor across an update.

const F = 'scope=all;completed=1';
const LIST = Array.from({ length: 120 }, (_, i) => ({ id: `t${i}` }));
/** encodeCursor(50, F) as electron/mcpPagination.ts minted it before the host kit. */
const MINTED_BEFORE = 'dgc1.eyJvIjo1MCwiZiI6InNjb3BlPWFsbDtjb21wbGV0ZWQ9MSJ9';

describe('dayGLANCE cursors', () => {
  it('keep the dgc1. prefix ("dayGLANCE cursor, version 1")', () => {
    expect(CURSOR_PREFIX).toBe('dgc1.');
  });

  it('mint byte-identical cursors, and accept ones minted before the host kit', () => {
    const first = paginate(LIST, { filterKey: F, cursorPrefix: CURSOR_PREFIX });
    if (!first.ok) throw new Error(first.reason);
    expect(first.nextCursor).toBe(MINTED_BEFORE);
    const second = paginate(LIST, { filterKey: F, cursorPrefix: CURSOR_PREFIX, cursor: MINTED_BEFORE });
    if (!second.ok) throw new Error(second.reason);
    expect(second.items[0]).toEqual({ id: 't50' });
  });

  it('still refuse a pre-filter dgc1 cursor (offset only) and another version', () => {
    const legacy = 'dgc1.' + Buffer.from(JSON.stringify({ o: 50 })).toString('base64url');
    expect(paginate(LIST, { filterKey: F, cursorPrefix: CURSOR_PREFIX, cursor: legacy }).ok).toBe(false);
    expect(paginate(LIST, { filterKey: F, cursorPrefix: CURSOR_PREFIX, cursor: 'dgc2.eyJvIjowfQ' }).ok).toBe(false);
    expect(decodeCursor(MINTED_BEFORE)).toBeNull(); // not under the kit's default prefix
  });
});
