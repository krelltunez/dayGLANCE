import { describe, expect, it } from 'vitest';
import { collectTags } from './tagManager.js';
import { SIDE_EFFECT_TAGS, enterTagChoice, tagPickerOptions, titleTags } from './tagPicker.js';

// #2308: what the task editor's tag picker lists for one title.

const collected = collectTags({
  tasks: [{ id: 't1', title: 'Fix gutter #home #urgent' }, { id: 'e1', title: 'Meeting #calendar', imported: true }],
  unscheduledTasks: [{ id: 'u1', title: 'Plan #workshop and #work' }, { id: 'u2', title: 'Write it up #obsidian' }],
  recurringTasks: [{ id: 'r1', title: 'Water plants #Home' }],
});
const tags = (out) => out.options.map((o) => o.tag);

describe('tagPickerOptions', () => {
  it('lists the tags in use by name, as the tag manager orders them, none picked on an untagged title', () => {
    const out = tagPickerOptions({ collected, title: 'Call Bob' });
    expect(tags(out)).toEqual(['home', 'urgent', 'work', 'workshop']);
    expect(out.options.every((o) => !o.selected)).toBe(true);
    expect(out.selected).toEqual([]);
    expect(out.create).toBeNull();
  });

  it('marks the title\'s tags as picked, whatever their case, and no longer tag as a prefix of it', () => {
    const out = tagPickerOptions({ collected, title: 'Call Bob #Work' });
    expect(out.options.filter((o) => o.selected).map((o) => o.tag)).toEqual(['work']);
    expect(out.selected).toEqual(['work']);
  });

  it('lists a tag typed into this title that no task carries yet, picked', () => {
    const out = tagPickerOptions({ collected, title: 'Call Bob #brandnew' });
    expect(out.options).toContainEqual({ tag: 'brandnew', selected: true });
    expect(tags(out)).toEqual(['brandnew', 'home', 'urgent', 'work', 'workshop']);
  });

  // MUTATION: drop the side-effect filter and #obsidian is a chip like any other.
  it('does not offer #obsidian, whose save writes to the daily note, unless the title has it', () => {
    expect(SIDE_EFFECT_TAGS).toContain('obsidian');
    expect(tags(tagPickerOptions({ collected, title: 'Call Bob' }))).not.toContain('obsidian');
    expect(tagPickerOptions({ collected, title: 'Call Bob #obsidian' }).options).toContainEqual({ tag: 'obsidian', selected: true });
    expect(tagPickerOptions({ collected, title: 'Call Bob', query: 'obsidian' }).create).toBeNull();
  });

  it('filters as the tag manager\'s search does: a substring, without case or a leading #', () => {
    expect(tags(tagPickerOptions({ collected, title: '', query: 'WORK' }))).toEqual(['work', 'workshop']);
    expect(tags(tagPickerOptions({ collected, title: '', query: '#shop' }))).toEqual(['workshop']);
    expect(tags(tagPickerOptions({ collected, title: '', query: '  rg ' }))).toEqual(['urgent']);
  });

  it('offers to add a valid tag nobody uses yet, normalised as the tag manager does', () => {
    expect(tagPickerOptions({ collected, title: '', query: '#Errands' }).create).toBe('errands');
    expect(tagPickerOptions({ collected, title: '', query: 'work' }).create).toBeNull();
    expect(tagPickerOptions({ collected, title: '', query: 'two words' }).create).toBeNull();
    expect(tagPickerOptions({ collected, title: '', query: '9lives' }).create).toBeNull();
    expect(tagPickerOptions({ collected, title: 'x #errands', query: 'errands' }).create).toBeNull();
  });

  it('counts every tag it could list, for the field\'s wording', () => {
    expect(tagPickerOptions({ collected, title: '#new', query: 'zzz' }).total).toBe(5);
  });

  it('takes plain names as well as the tag manager\'s entries', () => {
    expect(tags(tagPickerOptions({ collected: ['Beta', 'alpha'], title: '' }))).toEqual(['alpha', 'beta']);
  });
});

describe('enterTagChoice', () => {
  const enter = (title, query) => enterTagChoice(tagPickerOptions({ collected, title, query }), query);

  it('adds the tag typed, else the first unpicked tag it starts, else the new tag on offer', () => {
    expect(enter('', 'work')).toBe('work');
    expect(enter('', 'wo')).toBe('work');
    expect(enter('x #work', 'wo')).toBe('workshop');
    expect(enter('', 'errands')).toBe('errands');
    expect(enter('', 'rg')).toBe('rg');
  });

  it('never removes, never swaps a picked tag for a longer one, and adds nothing for an empty field', () => {
    expect(enter('x #work', 'work')).toBeNull();
    expect(enter('', '')).toBeNull();
    expect(enter('', 'two words')).toBeNull();
  });
});

describe('titleTags', () => {
  it('each tag once, lower-cased, in title order', () => {
    expect(titleTags('#B a #a #b')).toEqual(['b', 'a']);
  });
});
