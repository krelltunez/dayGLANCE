// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createKey, SOURCE_APPS, taskIdFor } from '@glance-apps/intents';
import { deterministicTaskId } from './handleIntent.js';

// The ids dayGLANCE gives tasks made from a create are in users' data: a
// re-delivered create finds its task by them, and lastGLANCE names the task
// before dayGLANCE has seen the intent. These are the ids dayGLANCE produced
// before the calculation moved into @glance-apps/intents (1.5.0); if one of
// them changes, a re-delivery makes a duplicate. The package pins the same
// values, and lastGLANCE's dayglanceTaskId test does too.
describe('task ids made from a create are unchanged', () => {
  const CHORE = '33333333-3333-3333-3333-333333333333';
  const cases = [
    ['a timed create', '2026-11-15T09:00:00-07:00', 'fd071633-95dc-4088-a29f-6ccd56ea72e1'],
    ['an all-day create', '2026-11-15', 'ad49bb95-aaa1-4dd1-9fa5-14d82a98362f'],
    ['an undated (inbox) create', undefined, 'f25285b0-e601-4900-bbea-c4a8c8915b5f'],
  ];

  it.each(cases)('%s', async (_name, due, expected) => {
    // handleIntent's own path: createKey, then deterministicTaskId.
    expect(await deterministicTaskId(await createKey(SOURCE_APPS.LASTGLANCE, CHORE, due))).toBe(expected);
    expect(await taskIdFor(SOURCE_APPS.LASTGLANCE, CHORE, due)).toBe(expected);
  });
});
