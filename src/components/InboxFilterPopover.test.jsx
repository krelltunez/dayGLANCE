import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// #2232: the Inbox filter lists projects by area and goal, a goal or an area
// selects all of its projects, and every section and group folds the way the
// SCHED rail's sections do, remembered on the device.

vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal()), createPortal: (node) => node }));

let selected = [];
let features = {};
let sort = 'priority';
let hideCompleted = false;
const setInboxSort = vi.fn();
const setHideCompletedInbox = vi.fn();
vi.mock('../context/DayPlannerContext.jsx', () => ({
  useDayPlannerCtx: () => ({
    darkMode: false, textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', cardBg: 'bg-white',
    borderClass: 'border-stone-200', hoverBg: 'hover:bg-stone-100',
    unscheduledTasks: [{ id: 't', title: 'Call #phone' }],
    hideCompletedInbox: hideCompleted, setHideCompletedInbox,
    inboxSort: sort, setInboxSort,
    hideProjectTasksInbox: true, setHideProjectTasksInbox: () => {},
    hideStandaloneTasksInbox: false, setHideStandaloneTasksInbox: () => {},
    inboxTagFilter: [], setInboxTagFilter: () => {},
    inboxProjectFilter: selected, setInboxProjectFilter: () => {},
  }),
}));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => features }));

// The portal's target is read even with the portal mocked away.
globalThis.document = globalThis.document || { body: {}, addEventListener: () => {}, removeEventListener: () => {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { default: InboxFilterPopover } = await import('./InboxFilterPopover.jsx');

let i18n;
beforeEach(async () => {
  store.clear();
  selected = [];
  sort = 'priority';
  hideCompleted = false;
  setInboxSort.mockClear();
  setHideCompletedInbox.mockClear();
  features = {
    goalsProjectsEnabled: true,
    areas: [{ id: 'a-work', name: 'Work' }],
    goals: [{ id: 'g-ship', title: 'Ship v6', areaId: 'a-work' }, { id: 'g-read', title: 'Read more' }],
    projects: [
      { id: 'p-api', title: 'API', goalId: 'g-ship' },
      { id: 'p-docs', title: 'Docs', goalId: 'g-ship' },
      { id: 'p-books', title: 'Books', goalId: 'g-read' },
      { id: 'p-solo', title: 'Solo project' },
    ],
  };
  if (i18n) return;
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
const render = () => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}><InboxFilterPopover open onClose={() => {}} buttonRef={{ current: null }} /></I18nextProvider>,
);
const groupState = (html, key) => html.match(new RegExp(`data-inbox-filter-group="${key}".*?data-group-state="(\\w+)"`))[1];

describe('InboxFilterPopover: projects by area and goal (#2232)', () => {
  it('lists areas, then goals with no area, then standalone projects, each with its project count', () => {
    const html = render();
    const order = [...html.matchAll(/data-inbox-filter-group="([^"]+)"/g)].map(m => m[1]);
    expect(order).toEqual(['area-a-work', 'goal-g-ship', 'area-none', 'goal-g-read', 'standalone']);
    expect(html).toContain('Work<span class="ml-1 opacity-70">2</span>');
    expect(html).toContain('No Defined Area');
  });

  it('a goal opens folded, showing only its chip, until one of its projects is selected', () => {
    let html = render();
    expect(html).not.toContain('>API<');
    expect(html).toContain('Ship v6');
    selected = ['p-api'];
    html = render();
    expect(html).toContain('>API<');
    expect(groupState(html, 'goal-g-ship')).toBe('some');
    expect(groupState(html, 'area-a-work')).toBe('some');
  });

  it('a goal or area chip reads as selected when all of its projects are', () => {
    selected = ['p-api', 'p-docs'];
    const html = render();
    expect(groupState(html, 'goal-g-ship')).toBe('all');
    expect(groupState(html, 'area-a-work')).toBe('all');
    expect(groupState(html, 'goal-g-read')).toBe('none');
  });

  it('remembers a group the user opened, and a section the user closed', () => {
    store.set('day-planner-inbox-filter-open-goal-g-ship', 'true');
    store.set('day-planner-inbox-filter-open-section-tags', 'false');
    const html = render();
    expect(html).toContain('>API<');
    expect(html).toContain('data-inbox-filter-section="tags"');
    expect(html).not.toContain('#phone');
  });

  it('counts the selections in a section header', () => {
    selected = ['p-api', 'p-books'];
    expect(render()).toMatch(/Projects<span class="ml-1.5 text-blue-500">2<\/span>/);
  });

  it('with no areas in use, goals are listed without an area level', () => {
    features.areas = [];
    const order = [...render().matchAll(/data-inbox-filter-group="([^"]+)"/g)].map(m => m[1]);
    expect(order).toEqual(['goal-g-ship', 'goal-g-read', 'standalone']);
  });
});

// #2394: the Inbox list by priority or by deadline, chosen in the popover so
// the Inbox header gains no button.
describe('InboxFilterPopover: the sort', () => {
  const mount = () => {
    let root;
    act(() => { root = create(<I18nextProvider i18n={i18n}><InboxFilterPopover open onClose={() => {}} buttonRef={{ current: null }} /></I18nextProvider>); });
    return root.root;
  };
  const chip = (root, value) => root.find((n) => typeof n.type === 'string' && n.props['data-inbox-sort'] === value);

  it('is the first section, with Priority chosen by default and each chip saying what it does', () => {
    const html = render();
    expect([...html.matchAll(/data-inbox-filter-section="([^"]+)"/g)].map((m) => m[1])[0]).toBe('sort');
    const root = mount();
    expect(chip(root, 'priority').props['aria-checked']).toBe(true);
    expect(chip(root, 'deadline').props['aria-checked']).toBe(false);
    expect(chip(root, 'priority').children).toEqual(['Priority']);
    expect(chip(root, 'deadline').children).toEqual(['Deadline']);
    expect(chip(root, 'deadline').props.title).toBe('Soonest deadline first; tasks without a deadline after, by priority');
  });

  it('choosing a chip sets the sort, and the chosen one is shown', () => {
    const first = mount();
    act(() => { chip(first, 'deadline').props.onClick(); });
    expect(setInboxSort).toHaveBeenCalledWith('deadline');
    sort = 'deadline';
    const root = mount();
    expect(chip(root, 'deadline').props['aria-checked']).toBe(true);
    expect(chip(root, 'priority').props['aria-checked']).toBe(false);
    act(() => { chip(root, 'priority').props.onClick(); });
    expect(setInboxSort).toHaveBeenLastCalledWith('priority');
  });

  it('is not a filter: on its own it offers no Clear all, and Clear all leaves it as chosen', () => {
    sort = 'deadline';
    expect(render()).not.toContain('Clear all');
    hideCompleted = true;
    const root = mount();
    const clear = root.findAll((n) => n.type === 'button' && n.children.includes('Clear all'));
    expect(clear).toHaveLength(1);
    act(() => { clear[0].props.onClick(); });
    expect(setHideCompletedInbox).toHaveBeenCalledWith(false);
    expect(setInboxSort).not.toHaveBeenCalled();
  });
});
