import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import ClockTimePicker from './ClockTimePicker.jsx';

// #2249: any minute in the clock picker. The face offers 5-minute marks; a
// drag on it, the arrow keys, or a typed time reach every other minute.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
let keydown = null;
beforeEach(() => {
  keydown = null;
  globalThis.document = { addEventListener: (type, fn) => { if (type === 'keydown') keydown = fn; }, removeEventListener: () => {} };
});
afterEach(() => { delete globalThis.document; });

function mount(value = '16:00', props = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <ClockTimePicker value={value} onChange={onChange} onClose={onClose} darkMode={false} isTablet={false} use24HourClock={false} {...props} />
      </I18nextProvider>,
      // The minute face is 240px square at the origin: its centre is (120, 120).
      { createNodeMock: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 240 }) }) },
    );
  });
  const find = (attr) => root.root.findAll((n) => n.props[attr] !== undefined && typeof n.type === 'string')[0];
  const ok = () => root.root.findAll((n) => n.type === 'button' && n.props.children === 'OK')[0];
  const minuteButton = () => root.root.findAll((n) => n.type === 'button' && n.props.children === '00')[0];
  return { root, onChange, onClose, find, ok, minuteButton };
}

describe('ClockTimePicker: any minute (#2249)', () => {
  it('a drag on the minute face sets the minute it points at, 53 included', () => {
    const p = mount('16:00');
    act(() => { p.minuteButton().props.onClick(); });
    const face = p.find('data-minute-face');
    const at = (minute) => ({ clientX: 120 + Math.sin(minute * Math.PI / 30) * 97, clientY: 120 - Math.cos(minute * Math.PI / 30) * 97, pointerId: 1, currentTarget: {} });
    act(() => { face.props.onPointerDown(at(40)); });
    act(() => { face.props.onPointerMove(at(53)); });
    act(() => { face.props.onPointerUp(at(53)); });
    act(() => { face.props.onPointerMove(at(10)); }); // released: no longer follows
    act(() => { p.ok().props.onClick(); });
    expect(p.onChange).toHaveBeenCalledWith('16:53');
  });

  it('the arrow keys step the minute, or the hour, by one', () => {
    const p = mount('16:00');
    const press = (key) => act(() => { keydown({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() }); });
    press('ArrowUp');                         // hour mode first
    act(() => { p.minuteButton().props.onClick(); });
    press('ArrowDown'); press('ArrowDown');
    act(() => { p.ok().props.onClick(); });
    expect(p.onChange).toHaveBeenCalledWith('17:58');
  });

  it('types a time: Enter keeps it; the 12-hour clock\'s AM/PM fills in a bare "4:53"', () => {
    const p = mount('16:00');
    act(() => { p.find('data-time-type-toggle').props.onClick(); });
    expect(p.find('data-time-typed').props.value).toBe('4:00 PM');
    act(() => { p.find('data-time-typed').props.onChange({ target: { value: '4:53' } }); });
    act(() => { p.find('data-time-typed').props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() }); });
    expect(p.onChange).toHaveBeenCalledWith('16:53');
    expect(p.onClose).toHaveBeenCalled();
  });

  it('a typed entry that is not a time is marked, and nothing is set', () => {
    const p = mount('16:00');
    act(() => { p.find('data-time-type-toggle').props.onClick(); });
    act(() => { p.find('data-time-typed').props.onChange({ target: { value: '25:99' } }); });
    act(() => { p.ok().props.onClick(); });
    expect(p.onChange).not.toHaveBeenCalled();
    expect(p.find('data-time-typed').props['aria-invalid']).toBe(true);
  });

  it('back to the clock carries a typed time onto it; the arrows leave a typed field alone', () => {
    const p = mount('09:00', { use24HourClock: true });
    act(() => { p.find('data-time-type-toggle').props.onClick(); });
    act(() => { p.find('data-time-typed').props.onChange({ target: { value: '07:41' } }); });
    act(() => { keydown({ key: 'ArrowUp', preventDefault: vi.fn(), stopPropagation: vi.fn() }); });
    act(() => { p.find('data-time-type-toggle').props.onClick(); });
    act(() => { p.ok().props.onClick(); });
    expect(p.onChange).toHaveBeenCalledWith('07:41');
  });
});
