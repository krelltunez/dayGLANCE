import { describe, expect, it } from 'vitest';
import { addTagToTitle, collectTags, isTagEditable, normalizeTagInput, removeTagFromTitle, renameInTagList, rewriteTag, rewriteTagInList, toggleTagInTitle } from './tagManager.js';

// #2136: rename, merge and remove a tag across every task that carries it,
// by rewriting titles.

describe('rewriteTag', () => {
  it('renames a tag wherever it sits, whatever its case', () => {
    expect(rewriteTag('Fix the gutter #home', 'home', 'house')).toBe('Fix the gutter #house');
    expect(rewriteTag('#Home: fix the gutter', 'home', 'house')).toBe('#house: fix the gutter');
  });

  it('removes a tag and tidies the space it leaves', () => {
    expect(rewriteTag('Fix #home the gutter', 'home', null)).toBe('Fix the gutter');
    expect(rewriteTag('Fix the gutter #home', 'home', null)).toBe('Fix the gutter');
    expect(rewriteTag('#home Fix the gutter', 'home', null)).toBe('Fix the gutter');
  });

  it('merging into a tag the title already has keeps one', () => {
    expect(rewriteTag('Call roofer #house #home', 'home', 'house')).toBe('Call roofer #house');
    expect(rewriteTag('Call roofer #home #house', 'home', 'house')).toBe('Call roofer #house');
  });

  it('leaves a nested tag, a longer tag, and a web address alone', () => {
    expect(rewriteTag('Plan #work/deep and #workshop', 'work', 'job')).toBe('Plan #work/deep and #workshop');
    expect(rewriteTag('Read https://example.com/guide#home now #home', 'home', 'house'))
      .toBe('Read https://example.com/guide#home now #house');
  });

  it('returns the very same string when there is nothing to change', () => {
    const title = 'Nothing  to   see #else';
    expect(rewriteTag(title, 'home', 'house')).toBe(title);
  });

  it('works for any script', () => {
    expect(rewriteTag('报告 #工作', '工作', '项目')).toBe('报告 #项目');
  });

  // #2308: the tag picker removes through this rule, so a removal must not
  // leave the title mangled around the punctuation the tag sat next to.
  it('removing a tag before punctuation takes the space before it, not the punctuation', () => {
    expect(rewriteTag('Call Bob #work, then email', 'work', null)).toBe('Call Bob, then email');
    expect(rewriteTag('Email the draft #work.', 'work', null)).toBe('Email the draft.');
    expect(rewriteTag('Done #work!', 'work', null)).toBe('Done!');
  });

  it('removing a tag that opened the title takes its punctuation with it', () => {
    expect(rewriteTag('#work: plan the week', 'work', null)).toBe('plan the week');
    expect(rewriteTag('#work, #home tidy up', 'work', null)).toBe('#home tidy up');
    expect(rewriteTag('Line one #home\n#work: line two', 'work', null)).toBe('Line one #home\nline two');
  });

  it('removing a tag drops the brackets it leaves empty, and only those', () => {
    expect(rewriteTag('Buy milk (#errand)', 'errand', null)).toBe('Buy milk');
    expect(rewriteTag('Buy (#errand) milk', 'errand', null)).toBe('Buy milk');
    expect(rewriteTag('Buy milk (#errand #home)', 'errand', null)).toBe('Buy milk (#home)');
    expect(rewriteTag('Buy milk (#home #errand)', 'errand', null)).toBe('Buy milk (#home)');
    expect(rewriteTag('Buy milk [#errand]', 'errand', null)).toBe('Buy milk');
  });

  it('a removed tag between a word and punctuation glued to it is only the tag', () => {
    expect(rewriteTag('Plan#work, then', 'work', null)).toBe('Plan, then');
  });
});

describe('the tag picker\'s title edits (#2308)', () => {
  it('adds a tag at the end with one space before it and none after', () => {
    expect(addTagToTitle('Call Bob', 'work')).toBe('Call Bob #work');
    expect(addTagToTitle('Call Bob   ', 'work')).toBe('Call Bob #work');
    expect(addTagToTitle('Call Bob #home', 'work')).toBe('Call Bob #home #work');
    expect(addTagToTitle('', 'work')).toBe('#work');
    expect(addTagToTitle('   ', 'work')).toBe('#work');
  });

  it('adds a tag with the tag manager\'s normalisation, and nothing when it is not a tag', () => {
    expect(addTagToTitle('Call Bob', '#Work')).toBe('Call Bob #work');
    expect(addTagToTitle('Call Bob', 'two words')).toBe('Call Bob');
    expect(addTagToTitle('Call Bob', '')).toBe('Call Bob');
  });

  it('adds nothing when the title already carries the tag, in any case', () => {
    expect(addTagToTitle('Call Bob #Work', 'work')).toBe('Call Bob #Work');
  });

  it('a longer tag or a nested one is not the tag being added', () => {
    expect(addTagToTitle('Plan #workshop', 'work')).toBe('Plan #workshop #work');
    expect(addTagToTitle('Plan #work/deep', 'work')).toBe('Plan #work/deep #work');
    expect(addTagToTitle('See https://x.test/a#work', 'work')).toBe('See https://x.test/a#work #work');
  });

  it('removes a tag at the start, in the middle and at the end', () => {
    expect(removeTagFromTitle('#work Call Bob', 'work')).toBe('Call Bob');
    expect(removeTagFromTitle('Call #work Bob', 'work')).toBe('Call Bob');
    expect(removeTagFromTitle('Call Bob #work', 'work')).toBe('Call Bob');
    expect(removeTagFromTitle('#work', 'work')).toBe('');
  });

  it('removes every occurrence, whatever its case, leaving no double space', () => {
    expect(removeTagFromTitle('#Work Call #work Bob #WORK', 'work')).toBe('Call Bob');
    expect(removeTagFromTitle('Call #work #work Bob', '#work')).toBe('Call Bob');
  });

  it('removing #work leaves #workshop, #work/deep, #work-life and a web address alone', () => {
    const title = 'Plan #workshop #work/deep #work-life #work https://x.test/a#work';
    expect(removeTagFromTitle(title, 'work')).toBe('Plan #workshop #work/deep #work-life https://x.test/a#work');
    expect(removeTagFromTitle('Plan #workshop', 'work')).toBe('Plan #workshop');
  });

  it('toggles: adds what is missing, removes what is there', () => {
    expect(toggleTagInTitle('Call Bob', 'work')).toBe('Call Bob #work');
    expect(toggleTagInTitle('Call Bob #Work, today', 'work')).toBe('Call Bob, today');
    expect(toggleTagInTitle('Call Bob #workshop', 'work')).toBe('Call Bob #workshop #work');
    expect(toggleTagInTitle(toggleTagInTitle('Call Bob', 'work'), 'work')).toBe('Call Bob');
  });
});

describe('rewriteTagInList', () => {
  it('rewrites the rows it may, keeps every other row (and the list) as it was', () => {
    const plain = { id: 'a', title: 'Fix gutter #home' };
    const untouched = { id: 'b', title: 'Groceries #errands' };
    const event = { id: 'c', title: 'Dentist #home', imported: true };
    const todoist = { id: 'd', title: 'Pay rent #home', todoist: { id: '9' } };
    const out = rewriteTagInList([plain, untouched, event, todoist], 'home', 'house');
    expect(out[0].title).toBe('Fix gutter #house');
    expect(out[1]).toBe(untouched);
    expect(out[2]).toBe(event);
    expect(out[3]).toBe(todoist);
    const none = [untouched];
    expect(rewriteTagInList(none, 'home', 'house')).toBe(none);
  });

  it('rewrites a recurring series and its per-date title overrides', () => {
    const series = { id: 'r', title: 'Water plants #home', exceptions: { '2026-10-20': { title: 'Water plants early #home' }, '2026-10-21': { deleted: true } } };
    const [out] = rewriteTagInList([series], 'home', null, { recurring: true });
    expect(out.title).toBe('Water plants');
    expect(out.exceptions['2026-10-20'].title).toBe('Water plants early');
    expect(out.exceptions['2026-10-21']).toBe(series.exceptions['2026-10-21']);
  });
});

describe('collectTags', () => {
  it('lists each tag once, case folded, with what can and cannot be rewritten', () => {
    const tags = collectTags({
      tasks: [
        { id: 'a', title: 'Fix gutter #Home' },
        { id: 'e', title: 'Dentist #home', imported: true },
        { id: 'n', title: 'Native #home', _native: true },
      ],
      unscheduledTasks: [{ id: 'b', title: 'Paint #home #errands' }, { id: 't', title: 'Rent #home', todoist: { id: '1' } }],
      recurringTasks: [{ id: 'r', title: 'Water plants', exceptions: { '2026-10-20': { title: 'Water plants #home' } } }],
    });
    expect(tags.map(t => t.tag)).toEqual(['errands', 'home']);
    const home = tags.find(t => t.tag === 'home');
    expect(home.count).toBe(3);
    expect(home.locked).toBe(1);
    expect(home.tasks.map(x => [x.task.id, x.where])).toEqual([['a', 'calendar'], ['b', 'inbox'], ['t', 'inbox'], ['r', 'recurring']]);
  });
});

describe('renameInTagList', () => {
  it('renames or drops a tag in a selection, without duplicates, or says it held none', () => {
    expect(renameInTagList(['home', 'errands'], 'home', 'house')).toEqual(['house', 'errands']);
    expect(renameInTagList(['home', 'house'], 'home', 'house')).toEqual(['house']);
    expect(renameInTagList(['home', 'errands'], 'Home', null)).toEqual(['errands']);
    expect(renameInTagList(['errands'], 'home', 'house')).toBeNull();
  });
});

describe('normalizeTagInput and isTagEditable', () => {
  it('takes one valid tag word, with or without #', () => {
    expect(normalizeTagInput('#House')).toBe('house');
    expect(normalizeTagInput('  work/deep ')).toBe('work/deep');
    expect(normalizeTagInput('two words')).toBe('');
    expect(normalizeTagInput('9lives')).toBe('');
  });

  it('only tasks dayGLANCE owns the titles of', () => {
    expect(isTagEditable({ id: 'a' })).toBe(true);
    expect(isTagEditable({ id: 'a', imported: true })).toBe(false);
    expect(isTagEditable({ id: 'a', todoist: { id: '1' } })).toBe(false);
  });
});
