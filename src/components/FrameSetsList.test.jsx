import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import FrameSetsList from './FrameSetsList.jsx';
import FrameEditor from './FrameEditor.jsx';

// Frame sets in the Frames UI (#2305): the list groups frames by set, each set
// header switches it for today, and the frame editor picks a frame's set.

let i18n;
beforeEach(async () => {
  if (i18n) return;
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const TODAY = '2026-11-07';
const F = (id, over = {}) => ({ id, label: id, enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', color: 'bg-indigo-200', ...over });
const work = { id: 'work', name: 'Work', periods: [{ from: null, until: null }] };
const holiday = { id: 'hol', name: 'Holiday', periods: [{ from: '2027-01-20', until: '2027-02-20' }] };
const classes = { id: 'cls', name: 'Classes', periods: [{ from: '2026-09-01', until: '2026-12-20' }] };

const props = (over = {}) => ({
  frames: [F('free'), F('desk', { setId: 'work' }), F('beach', { setId: 'hol' }), F('lost', { setId: 'not-synced-yet' })],
  frameSets: [work, holiday, classes],
  frameSetsLoaded: true,
  todayStr: TODAY,
  onEditFrame: vi.fn(), onAddFrame: vi.fn(),
  onSwitchSet: vi.fn(), onRenameSet: vi.fn(), onSetPeriods: vi.fn(), onDeleteSet: vi.fn(), onCreateSet: vi.fn(),
  darkMode: false, textPrimary: '', textSecondary: '', borderClass: '', hoverBg: '',
  formatTime: (t) => t, dayLabels: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], offLabel: 'Off',
  ...over,
});

const mount = (element) => {
  let root;
  act(() => { root = create(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>); });
  return root;
};
const byData = (root, attr, value) => root.root.findAll((n) => typeof n.type === 'string' && n.props[attr] === value);
const text = (node) => (typeof node === 'string' ? node : (node.children || []).map(text).join(''));

describe('FrameSetsList', () => {
  it('groups frames: no set and unknown sets under Always, then one section per set', () => {
    const root = mount(<FrameSetsList {...props()} />);
    const ids = (setId) => byData(root, 'data-frame-set-section', setId)[0]
      .findAll((n) => n.props['data-frame-row'] !== undefined && typeof n.type === 'string').map((n) => n.props['data-frame-row']);
    expect(ids('')).toEqual(['free', 'lost']);
    expect(ids('work')).toEqual(['desk']);
    expect(ids('hol')).toEqual(['beach']);
    expect(ids('cls')).toEqual([]);
  });

  it('each header says whether the set is on today, and when it changes', () => {
    const root = mount(<FrameSetsList {...props()} />);
    const status = (id) => text(byData(root, 'data-frame-set-section', id)[0].find((n) => n.props['data-frame-set-status'] !== undefined));
    expect(status('work')).toBe('On today');
    expect(status('cls')).toBe('On until Dec 20, 2026');
    expect(status('hol')).toBe('Off today · next: Jan 20, 2027 – Feb 20, 2027');
  });

  it('the header switch reads the set\'s state today and flips it', () => {
    const p = props();
    const root = mount(<FrameSetsList {...p} />);
    const [workSwitch] = byData(root, 'data-frame-set-switch', 'work');
    const [holSwitch] = byData(root, 'data-frame-set-switch', 'hol');
    expect(workSwitch.props['aria-checked']).toBe(true);
    expect(holSwitch.props['aria-checked']).toBe(false);
    expect(workSwitch.props['aria-label']).toBe('Work: on today');
    act(() => workSwitch.props.onClick({ stopPropagation() {} }));
    act(() => holSwitch.props.onClick({ stopPropagation() {} }));
    expect(p.onSwitchSet.mock.calls).toEqual([['work', false], ['hol', true]]);
  });

  it('disables the switch and set edits while the sets could not be read', () => {
    const p = props({ frameSetsLoaded: false });
    const root = mount(<FrameSetsList {...p} />);
    const [workSwitch] = byData(root, 'data-frame-set-switch', 'work');
    expect(workSwitch.props.disabled).toBe(true);
    act(() => workSwitch.props.onClick({ stopPropagation() {} }));
    expect(p.onSwitchSet).not.toHaveBeenCalled();
    expect(root.root.findAll((n) => n.props['data-frame-set-new'] !== undefined)).toHaveLength(0);
    expect(root.root.findAll((n) => n.props['data-frame-sets-unavailable'] !== undefined).length).toBeGreaterThan(0);
  });

  it('adds a frame into the section it was added from', () => {
    const p = props();
    const root = mount(<FrameSetsList {...p} />);
    act(() => byData(root, 'data-frame-add', 'work')[0].props.onClick());
    act(() => byData(root, 'data-frame-add', '')[0].props.onClick());
    expect(p.onAddFrame.mock.calls).toEqual([['work'], [null]]);
  });

  it('creates a set from its name', () => {
    const p = props();
    const root = mount(<FrameSetsList {...p} />);
    act(() => root.root.find((n) => n.props['data-frame-set-new'] !== undefined && typeof n.type === 'string').props.onClick());
    const input = root.root.find((n) => n.props['data-frame-set-new-name'] !== undefined && typeof n.type === 'string');
    act(() => input.props.onChange({ target: { value: '  Exams ' } }));
    act(() => root.root.find((n) => n.props['data-frame-set-create'] !== undefined && typeof n.type === 'string').props.onClick());
    expect(p.onCreateSet).toHaveBeenCalledWith('Exams');
  });

  it('the set editor saves its name and planned dates, and deletes', () => {
    const p = props();
    const root = mount(<FrameSetsList {...p} />);
    act(() => byData(root, 'data-frame-set-edit', 'hol')[0].props.onClick());
    const editor = byData(root, 'data-frame-set-editor', 'hol')[0];
    const dates = editor.findAll((n) => n.type === 'input' && n.props.type === 'date');
    expect(dates.map((n) => n.props.value)).toEqual(['2027-01-20', '2027-02-20']);
    act(() => dates[1].props.onChange({ target: { value: '2027-02-27' } }));
    act(() => editor.find((n) => n.props['data-frame-set-save'] !== undefined && typeof n.type === 'string').props.onClick());
    expect(p.onRenameSet).toHaveBeenCalledWith('hol', 'Holiday');
    expect(p.onSetPeriods).toHaveBeenCalledWith('hol', [{ from: '2027-01-20', until: '2027-02-27' }]);

    act(() => byData(root, 'data-frame-set-edit', 'hol')[0].props.onClick());
    act(() => byData(root, 'data-frame-set-editor', 'hol')[0].find((n) => n.props['data-frame-set-delete'] !== undefined && typeof n.type === 'string').props.onClick());
    expect(p.onDeleteSet).toHaveBeenCalledWith('hol');
  });

  it('refuses dates that end before they start', () => {
    const p = props();
    const root = mount(<FrameSetsList {...p} />);
    act(() => byData(root, 'data-frame-set-edit', 'hol')[0].props.onClick());
    const editor = byData(root, 'data-frame-set-editor', 'hol')[0];
    const dates = editor.findAll((n) => n.type === 'input' && n.props.type === 'date');
    act(() => dates[1].props.onChange({ target: { value: '2027-01-01' } }));
    act(() => editor.find((n) => n.props['data-frame-set-save'] !== undefined && typeof n.type === 'string').props.onClick());
    expect(p.onSetPeriods).not.toHaveBeenCalled();
    expect(text(byData(root, 'data-frame-set-editor', 'hol')[0])).toContain('Dates have to end on or after the day they start.');
  });
});

describe('FrameEditor set picker', () => {
  const editorProps = (over = {}) => ({
    onSave: vi.fn(), onDelete: vi.fn(), onCancel: vi.fn(), allTags: [],
    darkMode: false, textPrimary: '', textSecondary: '', borderClass: '', cardBg: '', hoverBg: '',
    existingFrames: [], use24HourClock: true, frameSets: [work, holiday], ...over,
  });
  const picker = (root) => root.root.find((n) => n.type === 'select' && n.props['data-frame-set-picker'] !== undefined);
  const save = (root) => act(() => root.root.find((n) => n.type === 'button' && text(n) === 'Save Changes').props.onClick());

  it('offers no set plus each set, and shows the frame\'s', () => {
    const root = mount(<FrameEditor {...editorProps()} frame={F('desk', { setId: 'work' })} />);
    const options = picker(root).findAllByType('option').map((o) => [o.props.value, text(o)]);
    expect(options).toEqual([['', 'No set (always)'], ['work', 'Work'], ['hol', 'Holiday']]);
    expect(picker(root).props.value).toBe('work');
  });

  it('saves the picked set as an edit, and "no set" as no setId at all', () => {
    const p = editorProps();
    const root = mount(<FrameEditor {...p} frame={F('desk', { setId: 'work', lastModified: '2026-01-01T00:00:00.000Z' })} />);
    act(() => picker(root).props.onChange({ target: { value: 'hol' } }));
    save(root);
    expect(p.onSave.mock.calls[0][0].setId).toBe('hol');
    expect(p.onSave.mock.calls[0][0].lastModified).not.toBe('2026-01-01T00:00:00.000Z');

    act(() => picker(root).props.onChange({ target: { value: '' } }));
    save(root);
    expect(p.onSave.mock.calls[1][0]).not.toHaveProperty('setId');
  });

  it('a new frame starts in the set it was added from', () => {
    const root = mount(<FrameEditor {...editorProps()} frame={null} defaultSetId="hol" />);
    expect(picker(root).props.value).toBe('hol');
  });

  it('keeps a set this device does not know yet rather than dropping it', () => {
    const p = editorProps();
    const root = mount(<FrameEditor {...p} frame={F('desk', { setId: 'not-synced-yet' })} />);
    expect(picker(root).props.value).toBe('not-synced-yet');
    save(root);
    expect(p.onSave.mock.calls[0][0].setId).toBe('not-synced-yet');
  });

  it('lets frames in two different sets overlap, but not a frame in no set', () => {
    const existing = [F('desk', { setId: 'work', start: '09:00', end: '12:00' })];
    const inHoliday = editorProps({ existingFrames: existing });
    const r1 = mount(<FrameEditor {...inHoliday} frame={F('beach', { setId: 'hol', start: '10:00', end: '11:00' })} />);
    save(r1);
    expect(inHoliday.onSave).toHaveBeenCalledTimes(1);

    const inNoSet = editorProps({ existingFrames: existing });
    const r2 = mount(<FrameEditor {...inNoSet} frame={F('gym', { start: '10:00', end: '11:00' })} />);
    save(r2);
    expect(inNoSet.onSave).not.toHaveBeenCalled();
  });

  it('shows no picker while there are no sets', () => {
    const root = mount(<FrameEditor {...editorProps({ frameSets: [] })} frame={F('desk')} />);
    expect(root.root.findAll((n) => n.type === 'select')).toHaveLength(0);
  });
});
