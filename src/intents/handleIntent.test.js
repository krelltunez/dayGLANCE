import { describe, it, expect } from 'vitest';
import { createKey, TABS, QUERY_RETURN_VARS } from '@glance-apps/intents';
import { handleIntent } from './handleIntent.js';

// ─── create ────────────────────────────────────────────────────────────────

describe('handleIntent create', () => {
  it('succeeds with a minimal valid payload', async () => {
    const r = await handleIntent('create', { title: 'Buy milk' });
    expect(r.success).toBe(true);
    expect(r.error).toBe('');
    expect(r._normalized.title).toBe('Buy milk');
  });

  it('fails when title is missing', async () => {
    const r = await handleIntent('create', {});
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('fails on unknown fields (strict schema)', async () => {
    const r = await handleIntent('create', { title: 'Test', bogus: true });
    expect(r.success).toBe(false);
  });

  it('normalizes priority from string to number', async () => {
    const r = await handleIntent('create', { title: 'Test', priority: 'HIGH' });
    expect(r.success).toBe(true);
    expect(r._normalized.priority).toBe(3);
  });

  it('normalizes priority from integer', async () => {
    const r = await handleIntent('create', { title: 'Test', priority: 2 });
    expect(r._normalized.priority).toBe(2);
  });

  it('parses inline #tags from title and merges with tags field', async () => {
    const r = await handleIntent('create', { title: 'Buy milk #groceries', tags: 'errands' });
    expect(r._normalized.title).toBe('Buy milk');
    expect(r._normalized.tags).toContain('groceries');
    expect(r._normalized.tags).toContain('errands');
  });

  it('deduplicates tags across title and tags field', async () => {
    const r = await handleIntent('create', { title: 'Task #home', tags: 'home,work' });
    const count = r._normalized.tags.filter(t => t === 'home').length;
    expect(count).toBe(1);
    expect(r._normalized.tags).toContain('work');
  });

  it('normalizes a date-only due to all_day', async () => {
    const r = await handleIntent('create', { title: 'Test', due: '2026-05-21' });
    expect(r._normalized.due).toBe('2026-05-21');
    expect(r._normalized.all_day).toBe(true);
  });

  it('normalizes a datetime due to timed task', async () => {
    const r = await handleIntent('create', { title: 'Test', due: '2026-05-21T10:00:00Z' });
    expect(r._normalized.all_day).toBe(false);
  });

  it('explicit all_day overrides the inferred value', async () => {
    const r = await handleIntent('create', { title: 'Test', due: '2026-05-21', all_day: false });
    expect(r._normalized.all_day).toBe(false);
  });

  it('expands recurring shorthand to a FREQ= rule string', async () => {
    const r = await handleIntent('create', { title: 'Test', recurring: 'daily' });
    expect(r._normalized.recurring).toBe('FREQ=DAILY');
  });

  it('passes through raw FREQ= strings unchanged', async () => {
    const rrule = 'FREQ=WEEKLY;BYDAY=MO,WE,FR';
    const r = await handleIntent('create', { title: 'Test', recurring: rrule });
    expect(r._normalized.recurring).toBe(rrule);
  });

  it('fails on invalid recurring strings', async () => {
    const r = await handleIntent('create', { title: 'Test', recurring: 'RRULE:FREQ=DAILY' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('recurring');
  });

  it('omits intentKey when source_app is absent', async () => {
    const r = await handleIntent('create', { title: 'Test' });
    expect(r._intentKey).toBeNull();
  });

  it('computes intentKey when source_app and source_entity_id are present', async () => {
    const r = await handleIntent('create', {
      title: 'Test',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_1',
      due: '2026-06-01',
    });
    expect(r._intentKey).toBeTruthy();
    expect(typeof r._intentKey).toBe('string');
  });

  it('produces a stable intentKey for the same inputs', async () => {
    const payload = { title: 'T', source_app: 'app.lastglance', source_entity_id: 'c1', due: '2026-06-01' };
    const r1 = await handleIntent('create', payload);
    const r2 = await handleIntent('create', payload);
    expect(r1._intentKey).toBe(r2._intentKey);
  });

  it('warns when a matching non-completed task already exists', async () => {
    const key = await createKey('app.lastglance', 'chore_42', '2026-06-01');
    const existing = { id: 'tsk_1', _intentKey: key, completed: false };

    const r = await handleIntent('create', {
      title: 'Existing chore',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_42',
      due: '2026-06-01',
    }, { tasks: [existing] });

    expect(r.success).toBe(true);
    expect(r.warning).toContain('tsk_1');
  });

  it('does not warn when the matching task is already completed', async () => {
    const key = await createKey('app.lastglance', 'chore_42', '2026-06-01');
    const existing = { id: 'tsk_1', _intentKey: key, completed: true };

    const r = await handleIntent('create', {
      title: 'Existing chore',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_42',
      due: '2026-06-01',
    }, { tasks: [existing] });

    expect(r.warning).toBe('');
  });
});

// ─── complete ──────────────────────────────────────────────────────────────

describe('handleIntent complete', () => {
  it('succeeds with a valid title', async () => {
    const r = await handleIntent('complete', { title: 'Feed cat' });
    expect(r.success).toBe(true);
    expect(r._normalized.title).toBe('Feed cat');
  });

  it('fails when title is missing', async () => {
    const r = await handleIntent('complete', {});
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('accepts an optional completed_at timestamp', async () => {
    const r = await handleIntent('complete', {
      title: 'Feed cat',
      completed_at: '2026-05-21T09:00:00Z',
    });
    expect(r.success).toBe(true);
    expect(r._normalized.completed_at).toBe('2026-05-21T09:00:00Z');
  });

  it('fails on unknown fields', async () => {
    const r = await handleIntent('complete', { title: 'Feed cat', bogus: true });
    expect(r.success).toBe(false);
  });
});

// ─── open ──────────────────────────────────────────────────────────────────

describe('handleIntent open', () => {
  it('succeeds with a recognised tab name', async () => {
    const r = await handleIntent('open', { tab: 'inbox' });
    expect(r.success).toBe(true);
    expect(r._normalized.tab).toBe(TABS.INBOX);
  });

  it('falls back to glance for an unrecognised tab', async () => {
    const r = await handleIntent('open', { tab: 'does-not-exist' });
    expect(r.success).toBe(true);
    expect(r._normalized.tab).toBe(TABS.GLANCE);
  });

  it('falls back to glance when tab is omitted', async () => {
    const r = await handleIntent('open', {});
    expect(r.success).toBe(true);
    expect(r._normalized.tab).toBe(TABS.GLANCE);
  });

  it('accepts every valid tab value', async () => {
    for (const tab of Object.values(TABS)) {
      const r = await handleIntent('open', { tab });
      expect(r._normalized.tab).toBe(tab);
    }
  });
});

// ─── query ─────────────────────────────────────────────────────────────────

describe('handleIntent query', () => {
  it('succeeds with an empty payload', async () => {
    const r = await handleIntent('query', {});
    expect(r.success).toBe(true);
  });

  it('returns all 10 query return variables', async () => {
    const r = await handleIntent('query', {});
    for (const key of Object.values(QUERY_RETURN_VARS)) {
      expect(key in r).toBe(true);
    }
  });

  it('returns zero-values for integer vars and empty string for string vars', async () => {
    const r = await handleIntent('query', {});
    expect(r['%dg_count_today']).toBe(0);
    expect(r['%dg_in_progress_title']).toBe('');
    expect(r['%dg_next_title']).toBe('');
  });

  it('fails on unknown fields', async () => {
    const r = await handleIntent('query', { scope: 'all' });
    expect(r.success).toBe(false);
  });
});

// ─── unknown action ────────────────────────────────────────────────────────

describe('handleIntent unknown action', () => {
  it('returns failure for an unrecognised action', async () => {
    const r = await handleIntent('destroy_everything', {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('Unknown action');
  });
});
