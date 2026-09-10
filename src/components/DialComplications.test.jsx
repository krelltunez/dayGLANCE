import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import DialComplications, {
  COMPLICATION_MIN_DIAL_PX, COMPLICATION_SIZES, COMPLICATION_SLOTS, complicationSize,
} from './DialComplications.jsx';

// The complication slots' contract. The component takes the dial's measured
// size as a prop, so this can pin the size gate down without a DOM — the
// same renderToStaticMarkup approach the rest of the dial's tests use.

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: language, fallbackLng: false,
    resources: { [language]: { translation: bundle } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

const habit = { id: 'h1', name: 'Water', type: 'doMore', target: 8, color: 'blue', icon: 'Droplets' };
const items = [
  { key: 'inbox', kind: 'inbox', count: 7, items: [{ id: 'u1', title: 'Call the plumber' }] },
  { key: 'deadlines', kind: 'deadlines', count: 2, items: [] },
  { key: 'habit:h1', kind: 'habit', habit, count: 5 },
];

const render = (i18n, props = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DialComplications
      items={items}
      dialPx={800}
      onOpenTask={() => {}}
      onSetHabitCount={() => {}}
      {...props}
    />
  </I18nextProvider>,
);

describe('DialComplications', () => {
  it('puts each complication in its own corner slot', async () => {
    const html = render(await i18nFor('en'));
    expect(html).toContain('aria-label="Inbox: 7"');
    expect(html).toContain('aria-label="Deadlines: 2"');
    // The habit is the app's own HabitRing, so it carries that component's
    // count label rather than a name — but it says who it is to AT.
    expect(html).toContain('5/8');
    expect(html).not.toContain('>Water<');
    expect(html).toContain('aria-label="Water: 5 of 8"');

    // Slots are placed off the dial's radius, not the container's box.
    const r = 800 / 2;
    expect(html).toContain(`calc(50% + ${COMPLICATION_SLOTS[0].x * r}px)`);
  });

  it('never shows more than the four slots', async () => {
    const five = [...items, { key: 'x', kind: 'inbox', count: 1, items: [] },
      { key: 'y', kind: 'deadlines', count: 1, items: [] }];
    const html = render(await i18nFor('en'), { items: five });
    // One `left:calc(...)` per rendered slot (each also has a `top:`).
    expect((html.match(/left:calc/g) || [])).toHaveLength(COMPLICATION_SLOTS.length);
  });

  it('stays off a face too small to carry it', async () => {
    const i18n = await i18nFor('en');
    // A phone dial is ~385px across; four corner readouts there would sit on
    // the hub's own text.
    expect(render(i18n, { dialPx: COMPLICATION_MIN_DIAL_PX - 1 })).toBe('');
    expect(render(i18n, { dialPx: COMPLICATION_MIN_DIAL_PX })).not.toBe('');
    // And before the parent has measured anything.
    expect(render(i18n, { dialPx: null })).toBe('');
    expect(render(i18n, { items: [] })).toBe('');
  });

  it('grows the readouts with the face, in three steps', async () => {
    const i18n = await i18nFor('en');
    const [sm, md, lg] = COMPLICATION_SIZES;
    // The tier is chosen from the dial's measured diameter, not a viewport
    // breakpoint: the same window gives the dial very different sizes
    // depending on what else is on screen.
    expect(complicationSize(sm.minDialPx - 1)).toBe(null);
    expect(complicationSize(sm.minDialPx)).toBe(sm);
    expect(complicationSize(md.minDialPx - 1)).toBe(sm);
    expect(complicationSize(md.minDialPx)).toBe(md);
    expect(complicationSize(lg.minDialPx)).toBe(lg);
    expect(complicationSize(lg.minDialPx + 400)).toBe(lg);
    expect(complicationSize(null)).toBe(null);

    // And the tier actually reaches the markup, for both kinds of slot.
    for (const size of COMPLICATION_SIZES) {
      const html = render(i18n, { dialPx: size.minDialPx });
      expect(html).toContain(`width:${size.dot}px`);          // the count subdial
      expect(html).toContain(`width="${size.dot}"`);          // the habit ring
      expect(html).toContain(size.count);
    }
  });

  it('dresses a count as a recessed subdial', async () => {
    const html = render(await i18nFor('en'));
    // A hairline rim and an inset shadow — the chronograph reading, and what
    // separates a count from the flat text it used to be.
    expect(html).toContain('rounded-full border border-white/10');
    expect(html).toContain('inset 0 1px 1px');
  });

  it('holds the habit ring back from the now-line\'s brightness', async () => {
    const html = render(await i18nFor('en'));
    // The ring paints a saturated brand colour that belongs in a sidebar,
    // not on a face whose brightest element must be the orange now-line.
    expect(html).toContain('opacity-65');
    expect(html).toContain('saturate-[.45]');
    expect(html).toContain('hover:saturate-100');
  });

  it('localizes its labels', async () => {
    const i18n = await i18nFor('de');
    const html = render(i18n);
    expect(html).toContain(`aria-label="${i18n.t('dial.inbox')}: 7"`);
    expect(html).toContain(i18n.t('dial.deadlines'));
  });
});
