// "Add to dayGLANCE" (src/addTask.ts): the title, the link and the block
// rules, pure. The walk through the plugin, the stream and the app is
// addTask.scenarios.test.ts.
import { describe, it, expect } from 'vitest';
import { splitBlockId, hasForeignBlockId, blockIdSuffix } from '@glance-apps/obsidian-format';
import {
  titleFromSelection, normalizeTitle, validDeadline, planBlockLink, mintBlockId,
  wikilinkFor, buildTaskTitle, buildTaskCreatePayload,
} from '../src/addTask';

describe('the title', () => {
  it('the prefill keeps the words: list and heading syntax and a trailing block id go, lines join', () => {
    expect(titleFromSelection('- [ ] Call the plumber ^dg-8w230vhc')).toBe('Call the plumber');
    expect(titleFromSelection('## Kitchen\nThe tap drips. ^k1tchn\n> quoted line')).toBe('Kitchen The tap drips. quoted line');
    expect(titleFromSelection('1. first\n2. second')).toBe('first second');
    expect(titleFromSelection('Price is 5^2 dollars')).toBe('Price is 5^2 dollars');
  });

  it('the submitted title is one trimmed line; an empty one is empty', () => {
    expect(normalizeTitle('  Buy\nmilk \r\n now ')).toBe('Buy milk now');
    expect(normalizeTitle(' \n\t ')).toBe('');
  });

  it('a deadline is a real YYYY-MM-DD or nothing', () => {
    expect(validDeadline('2026-11-20')).toBe('2026-11-20');
    for (const bad of ['2026-02-30', '20/11/2026', '', null, undefined]) expect(validDeadline(bad)).toBe(null);
  });

  it('the task title is the words then the wikilink', () => {
    expect(buildTaskTitle('Fix the gutter', wikilinkFor('Projects/House/Plan', null))).toBe('Fix the gutter [[Projects/House/Plan]]');
    expect(buildTaskTitle('Fix\nthe gutter ', wikilinkFor('Plan', 'ab12cd'))).toBe('Fix the gutter [[Plan#^ab12cd]]');
  });
});

describe('the block', () => {
  const note = [
    '---',            // 0
    'tags: [x]',      // 1
    '---',            // 2
    '# Heading',      // 3
    'First line of a',// 4
    'paragraph here.',// 5
    '',               // 6
    '- a list item',  // 7
    '  continued',    // 8
    '- [ ] Buy milk', // 9
    '- [ ] Fix tap ^dg-8w230vhc', // 10
    'Quote me ^q1',   // 11
    '',               // 12
    '```',            // 13
    'code',           // 14
    '```',            // 15
    '> a quote',      // 16
    '- [ ] Pay bill', // 17
    '  details here', // 18
    '',               // 19
  ];

  it('a paragraph takes its id at the end of its last line, wherever the selection starts in it', () => {
    expect(planBlockLink(note, 4, 4)).toEqual({ kind: 'mint', line: 5 });
    expect(planBlockLink(note, 5, 9)).toEqual({ kind: 'mint', line: 5 });
  });

  it('a list item takes it at the end of its own lines (continuations included)', () => {
    expect(planBlockLink(note, 7, 7)).toEqual({ kind: 'mint', line: 8 });
    expect(planBlockLink(note, 8, 8)).toEqual({ kind: 'mint', line: 8 });
  });

  it('an id already at the end of the block is reused, a dayGLANCE stamp included', () => {
    // Line 11 follows the item without a blank line: a lazy continuation of
    // it, as Markdown reads it, so the block's id is the one on line 11.
    expect(planBlockLink(note, 10, 10)).toEqual({ kind: 'reuse', id: 'q1' });
    const stamped = ['- [ ] Fix tap ^dg-8w230vhc', '', 'Quote me ^q1'];
    expect(planBlockLink(stamped, 0, 0)).toEqual({ kind: 'reuse', id: 'dg-8w230vhc' });
    expect(planBlockLink(stamped, 2, 2)).toEqual({ kind: 'reuse', id: 'q1' });
  });

  it('an unstamped task line (or its continuation) never gets an id: the parser would fold it into the title and the stamper would refuse the line', () => {
    expect(planBlockLink(note, 9, 9)).toEqual({ kind: 'none', reason: 'task-line' });
    expect(planBlockLink(note, 18, 18)).toEqual({ kind: 'none', reason: 'task-line' });
    // What that refusal protects, in the shared format:
    const id = 'ab12cd';
    expect(splitBlockId(`Buy milk ^${id}`)).toEqual({ text: `Buy milk ^${id}`, blockId: null });
    expect(hasForeignBlockId(`Buy milk ^${id}`)).toBe(true);
    expect(blockIdSuffix('8w230vhc', `Buy milk ^${id}`)).toBe('');
  });

  it('frontmatter, headings, code, quotes and blank selections link to the note', () => {
    expect(planBlockLink(note, 1, 1)).toEqual({ kind: 'none', reason: 'unsupported' });
    expect(planBlockLink(note, 2, 2)).toEqual({ kind: 'none', reason: 'unsupported' });
    expect(planBlockLink(note, 3, 3)).toEqual({ kind: 'none', reason: 'unsupported' });
    expect(planBlockLink(note, 14, 14)).toEqual({ kind: 'none', reason: 'unsupported' });
    expect(planBlockLink(note, 13, 13)).toEqual({ kind: 'none', reason: 'unsupported' });
    expect(planBlockLink(note, 16, 16)).toEqual({ kind: 'none', reason: 'unsupported' });
    expect(planBlockLink(note, 6, 6)).toEqual({ kind: 'none', reason: 'empty' });
    expect(planBlockLink(note, 12, 13)).toEqual({ kind: 'none', reason: 'unsupported' });
  });

  it('a minted id is six lowercase letters and digits, never a dayGLANCE id, never one the note holds', () => {
    for (let i = 0; i < 200; i++) {
      const id = mintBlockId(() => false);
      expect(id).toMatch(/^[a-z0-9]{6}$/);
      expect(`^${id}`.startsWith('^dg-')).toBe(false);
    }
    // The worst random source: always the first letters ('d', 'g' …) still cannot form `dg-`.
    const seq = [3 / 36, 6 / 36, 0, 0, 0, 0];
    let n = 0;
    expect(mintBlockId(() => false, () => seq[n++ % seq.length])).toBe('dgaaaa');
    // Taken ids are skipped.
    const taken = new Set(['aaaaaa']);
    let m = 0;
    const id = mintBlockId((x) => taken.has(x), () => (m++ < 6 ? 0 : 1 / 36));
    expect(id).not.toBe('aaaaaa');
  });
});

describe('the payload', () => {
  it('carries the required fields and only the optional ones that are set', () => {
    const base = { actionId: 'a-0f8b7c2e', title: 'T [[N]]', notePath: 'N.md', deadline: null, priority: 0, projectId: null, viewer: null, createdAt: '2026-11-06T12:00:00+00:00' };
    expect(buildTaskCreatePayload(base)).toEqual({
      v: 1, kind: 'action', type: 'task_create', actionId: 'a-0f8b7c2e', title: 'T [[N]]', notePath: 'N.md', createdAt: '2026-11-06T12:00:00+00:00',
    });
    expect(buildTaskCreatePayload({ ...base, deadline: '2026-11-20', priority: 2, projectId: 'p1', viewer: 'u1' }))
      .toMatchObject({ deadline: '2026-11-20', priority: 2, projectId: 'p1', viewer: 'u1' });
    expect(buildTaskCreatePayload({ ...base, deadline: 'soon', priority: 7 })).not.toHaveProperty('deadline');
    expect(buildTaskCreatePayload({ ...base, priority: 7 })).not.toHaveProperty('priority');
  });
});
