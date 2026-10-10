import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import FocusDoReview from './FocusDoReview.jsx';
import en from '../../public/locales/en/translation.json';
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key, values = {}) => key.split('.').reduce((value, part) => value?.[part], en)
    .replace(/{{(\w+)}}/g, (_, name) => values[name]),
}) }));
const review = {
  capture: { id: 'phase', candidates: [{ actionId: 'a', title: 'Write <draft>' }] },
  summary: { recordedMinutes: 1, recordedDifferenceMilliseconds: -80000, clockChanged: false }, busy: false, error: null,
};
const render = over => renderToStaticMarkup(<FocusDoReview review={{ ...review, ...over }} onSave={vi.fn()} onDismiss={vi.fn()} />);
describe('Focus settlement presentation', () => {
  it('auto attributes one task and discloses a lower Do total', () => {
    const html = render();
    expect(html).toContain('Write &lt;draft&gt;'); expect(html).not.toContain('<select');
    expect(html).toContain('1 min to record'); expect(html).toContain('80 seconds less');
    expect(html).not.toContain('round to the nearest minute');
    expect(html).toContain('Task completed'); expect(html).toContain('Still in progress');
  });
  it('also discloses a higher Do total after rounding', () => {
    expect(render({ summary: { ...review.summary, recordedDifferenceMilliseconds: 116000 } })).toContain('116 seconds more');
  });
  it('omits a difference warning when work and Do totals match', () => {
    const html = render({ summary: { ...review.summary, recordedDifferenceMilliseconds: 0 } });
    expect(html).not.toContain('seconds more'); expect(html).not.toContain('seconds less');
  });
  it('multiple tasks use one labelled select with the first candidate selected', () => {
    const html = render({ capture: { ...review.capture, candidates: [...review.capture.candidates, { actionId: 'b', title: 'Read' }] } });
    expect(html).toContain('Which task did you work on?'); expect(html).toContain('<option value="a" selected="">');
    expect(html).toContain('<option value="b">');
  });
  it('a held write is never presented as saved and offers a way to continue', () => {
    const html = render({ error: 'held', choice: { actionId: 'a' } });
    expect(html).toContain('role="alert"'); expect(html).toContain('Not saved yet');
    expect(html).toContain('Continue without waiting');
  });
  it('both decision buttons are disabled during a write', () => {
    expect((render({ busy: true }).match(/<button disabled=""/g) || []).length).toBe(2);
  });
});
