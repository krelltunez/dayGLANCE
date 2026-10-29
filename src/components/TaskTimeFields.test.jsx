import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// #2249: any duration, and an end time, in the task dialogs.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal()), createPortal: (node) => node }));
// The picker itself is tested elsewhere; here it hands back a chosen time.
let pickerProps = null;
vi.mock('./ClockTimePicker.jsx', () => ({ default: (props) => { pickerProps = props; return null; } }));

const { DurationField, EndTimeField } = await import('./TaskTimeFields.jsx');

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
beforeEach(() => { pickerProps = null; globalThis.document = { body: {}, addEventListener: () => {}, removeEventListener: () => {} }; });
afterEach(() => { delete globalThis.document; });

const render = (el) => {
  let root;
  act(() => { root = create(<I18nextProvider i18n={i18n}>{el}</I18nextProvider>); });
  return root;
};
const key = (k) => ({ key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() });

describe('DurationField', () => {
  it('shows the task\'s own duration, a resize to 75 minutes or a typed 22, among the presets', () => {
    const root = render(<DurationField value={75} onChange={vi.fn()} />);
    const select = root.root.findByType('select');
    expect(select.props.value).toBe(75);
    const options = root.root.findAllByType('option').map((o) => [o.props.value, o.props.children]);
    expect(options).toContainEqual([75, '1h 15m']);
    expect(options.at(-1)).toEqual(['custom', 'Custom…']);
  });

  it('Custom… takes any duration; Enter keeps it and does not submit the dialog', () => {
    const onChange = vi.fn();
    const root = render(<DurationField value={30} onChange={onChange} />);
    act(() => { root.root.findByType('select').props.onChange({ target: { value: 'custom' } }); });
    const input = () => root.root.findByType('input');
    act(() => { input().props.onChange({ target: { value: '1h 22' } }); });
    const enter = key('Enter');
    act(() => { input().props.onKeyDown(enter); });
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(82);
    expect(root.root.findAllByType('input')).toHaveLength(0);
  });

  it('an entry that is not a duration is marked, and changes nothing; Escape goes back', () => {
    const onChange = vi.fn();
    const root = render(<DurationField value={30} onChange={onChange} />);
    act(() => { root.root.findByType('select').props.onChange({ target: { value: 'custom' } }); });
    act(() => { root.root.findByType('input').props.onChange({ target: { value: 'soon' } }); });
    expect(root.root.findByType('input').props['aria-invalid']).toBe(true);
    act(() => { root.root.findByType('input').props.onBlur(); });
    expect(onChange).not.toHaveBeenCalled();
    act(() => { root.root.findByType('select').props.onChange({ target: { value: 'custom' } }); });
    const esc = key('Escape');
    act(() => { root.root.findByType('input').props.onKeyDown(esc); });
    expect(esc.stopPropagation).toHaveBeenCalled();
    expect(root.root.findAllByType('select')).toHaveLength(1);
  });
});

describe('EndTimeField', () => {
  const formatTime = (time) => time;
  const field = (props) => render(<EndTimeField formatTime={formatTime} onChange={vi.fn()} {...props} />);
  const text = (root) => JSON.stringify(root.toJSON());

  it('shows where the task ends, marked +1 past midnight', () => {
    expect(text(field({ startTime: '16:53', duration: 22 }))).toContain('17:15');
    const late = field({ startTime: '23:00', duration: 120 });
    expect(text(late)).toContain('01:00');
    expect(text(late)).toContain('+1');
    expect(late.root.findByType('button').props.title).toBe('Ends the next day');
  });

  it('choosing an end sets the duration, the next day when it is before the start', () => {
    const onChange = vi.fn();
    const root = field({ startTime: '16:53', duration: 22, onChange });
    act(() => { root.root.findByType('button').props.onClick(); });
    expect(pickerProps.value).toBe('17:15');
    act(() => { pickerProps.onChange('18:00'); });
    expect(onChange).toHaveBeenLastCalledWith(67);
    act(() => { pickerProps.onChange('01:00'); });
    expect(onChange).toHaveBeenLastCalledWith(487);
  });

  it('nothing to choose for an all-day or unscheduled task', () => {
    const root = field({ startTime: '09:00', duration: 30, disabled: true });
    expect(root.root.findByType('button').props.disabled).toBe(true);
    expect(text(root)).toContain('—');
  });
});
