import { describe, expect, it } from 'vitest';
import {
  cardShowsSubtasks, cardTitleClamp, cardTitleLines, cardTitleTooltip,
  desktopCardTitleLines, mobileCardTitleLines,
} from './cardTitle.js';

describe('cardTitleLines (#2368)', () => {
  it('a short card keeps one line', () => {
    expect(cardTitleLines({ height: 30, linePx: 17.5 })).toBe(1);
    // Room for one and a half lines is still one.
    expect(cardTitleLines({ height: 8 + 30, linePx: 17.5 })).toBe(1);
  });

  it('a tall card wraps onto the lines that fit above the rows below the title', () => {
    expect(cardTitleLines({ height: 8 + 35, linePx: 17.5 })).toBe(2);
    expect(cardTitleLines({ height: 120, linePx: 17.5 })).toBe(6);
    expect(cardTitleLines({ height: 120, linePx: 17.5, belowPx: 36 })).toBe(4);
  });

  it('a card that lists subtasks keeps one line however tall it is', () => {
    expect(cardTitleLines({ height: 400, linePx: 17.5, showsSubtasks: true })).toBe(1);
  });

  it('maxLines caps the wrap', () => {
    expect(cardTitleLines({ height: 400, linePx: 17.5, maxLines: 3 })).toBe(3);
  });

  it('a height that is not a number is one line', () => {
    expect(cardTitleLines({ height: undefined, linePx: 17.5 })).toBe(1);
    expect(cardTitleLines({ height: NaN, linePx: 17.5 })).toBe(1);
  });
});

describe('the desktop and phone cards', () => {
  it('desktop: the tags/project row and the time row come off the room', () => {
    // 80px: 72 inside the padding. Alone: 4 lines; under a time row: 3; and a tags row: 2.
    expect(desktopCardTitleLines({ height: 80, hasMetaRow: false, hasTimeRow: false })).toBe(4);
    expect(desktopCardTitleLines({ height: 80, hasMetaRow: false, hasTimeRow: true })).toBe(3);
    expect(desktopCardTitleLines({ height: 80, hasMetaRow: true, hasTimeRow: true })).toBe(2);
    expect(desktopCardTitleLines({ height: 80, hasMetaRow: true, hasTimeRow: true, showsSubtasks: true })).toBe(1);
  });

  it('phone: the project row (with the time) or, from 55px, the time row alone', () => {
    expect(mobileCardTitleLines({ height: 100, hasProjectRow: true })).toBe(3);
    expect(mobileCardTitleLines({ height: 100, hasProjectRow: false })).toBe(3);
    expect(mobileCardTitleLines({ height: 50, hasProjectRow: false })).toBe(2);
    expect(mobileCardTitleLines({ height: 100, hasProjectRow: false, showsSubtasks: true })).toBe(1);
  });
});

describe('cardShowsSubtasks', () => {
  it('needs the setting on and a subtask with a title', () => {
    const task = { subtasks: [{ id: 's', title: 'Buy nails' }] };
    expect(cardShowsSubtasks(task, true)).toBe(true);
    expect(cardShowsSubtasks(task, undefined)).toBe(true);
    expect(cardShowsSubtasks(task, false)).toBe(false);
    expect(cardShowsSubtasks({ subtasks: [{ id: 's', title: '  ' }] }, true)).toBe(false);
    expect(cardShowsSubtasks({ subtasks: [] }, true)).toBe(false);
    expect(cardShowsSubtasks({}, true)).toBe(false);
  });
});

describe('cardTitleClamp', () => {
  it('one line is the ellipsis; more is a line clamp', () => {
    expect(cardTitleClamp(1)).toEqual({ className: 'truncate', style: undefined });
    const three = cardTitleClamp(3);
    expect(three.className).not.toContain('truncate');
    expect(three.style).toMatchObject({ display: '-webkit-box', WebkitLineClamp: 3, overflow: 'hidden' });
  });
});

describe('cardTitleTooltip', () => {
  it('is the full title, with the hint on a second line when there is one', () => {
    expect(cardTitleTooltip('Call the roofer about the leak #home')).toBe('Call the roofer about the leak #home');
    expect(cardTitleTooltip('Call the roofer', 'Double-click to rename')).toBe('Call the roofer\nDouble-click to rename');
  });

  it('reads like the card: a wikilink is the task\'s note, not its words, unless it is the whole title', () => {
    expect(cardTitleTooltip('Read [[Roof notes|the notes]]')).toBe('Read');
    expect(cardTitleTooltip('[[Roof notes|the notes]]')).toBe('the notes');
  });

  it('is nothing for an empty title', () => {
    expect(cardTitleTooltip('')).toBeUndefined();
    expect(cardTitleTooltip(undefined, null)).toBeUndefined();
  });
});
