import React, { useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { loaders } from '../locales.js';
import CalendarFilterProjects, { useCalendarFilterSummary } from './CalendarFilterProjects.jsx';
import useTagFilter from '../hooks/useTagFilter.js';
import { HIDDEN_PROJECTS_KEY, liveHiddenProjectIds } from '../utils/calendarFilter.js';

// The calendar filter's Hide projects (#2307), clicked: through the real
// useTagFilter, so the per-device key is what is checked. How the section
// sits in the popover and the sheet is CalendarFilter.test.jsx.

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
beforeEach(() => store.clear());

const goal = { id: 'g1', title: 'Home life', color: 'bg-emerald-500', status: 'active' };
const projects = [
  { id: 'p-home', title: 'Household', goalId: 'g1', status: 'active' },
  { id: 'p-work', title: 'Day job', status: 'active' },
  { id: 'p-old', title: 'Old stuff', status: 'archived' },
];

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

describe('ticking a project', () => {
  function Harness() {
    const filter = useTagFilter();
    const [features] = useState({ goals: [goal], projects, areas: [], goalsProjectsEnabled: true });
    const planner = {
      darkMode: false, textPrimary: '', textSecondary: '',
      ...filter,
      liveHiddenProjects: liveHiddenProjectIds(filter.hiddenProjects, projects),
    };
    return (
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <Groups />
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    );
  }
  function Groups() {
    const { groups } = useCalendarFilterSummary();
    return <CalendarFilterProjects variant="popover" groups={groups} />;
  }
  const mount = () => {
    let root;
    act(() => { root = create(<I18nextProvider i18n={i18n}><Harness /></I18nextProvider>); });
    return root;
  };
  const find = (root, prop, value) => root.root.find((node) => node.type === 'button' && node.props[prop] === value);
  const open = (root, key) => act(() => { find(root, 'data-calendar-filter-group', key).props.onClick(); });
  const row = (root, id) => find(root, 'data-hide-project', id);
  const saved = () => JSON.parse(store.get(HIDDEN_PROJECTS_KEY));

  it('hides it, saves it per device, and unhides it', () => {
    const root = mount();
    // Folded under its goal until opened, as in the task editor's picker.
    expect(root.root.findAll((node) => node.props['data-hide-project'] === 'p-home')).toHaveLength(0);
    open(root, 'goal-g1');
    act(() => { row(root, 'p-home').props.onClick(); });
    expect(row(root, 'p-home').props['aria-pressed']).toBe(true);
    expect(saved()).toEqual(['p-home']);
    act(() => { row(root, 'p-home').props.onClick(); });
    expect(row(root, 'p-home').props['aria-pressed']).toBe(false);
    expect(saved()).toEqual([]);
  });

  it('keeps a stale id saved, and Show all clears everything', () => {
    store.set(HIDDEN_PROJECTS_KEY, JSON.stringify(['p-old']));
    const root = mount();
    expect(root.root.findAll((node) => node.props['data-show-all-projects'] !== undefined)).toHaveLength(0);
    open(root, 'goal-g1');
    act(() => { row(root, 'p-home').props.onClick(); });
    expect(saved()).toEqual(['p-old', 'p-home']);
    act(() => { root.root.find((node) => node.props['data-show-all-projects'] !== undefined).props.onClick(); });
    expect(saved()).toEqual([]);
  });
});

// #2332: an area, a goal or the standalone projects hidden in one click, as
// the Inbox filter selects them, without opening the group first.
describe('hiding a whole group', () => {
  const area = { id: 'a-life', name: 'Life' };
  const lists = {
    areas: [area],
    goals: [
      { id: 'g-home', title: 'Home life', color: 'bg-emerald-500', status: 'active', areaId: 'a-life' },
      { id: 'g-fit', title: 'Fitness', color: 'bg-sky-500', status: 'active', areaId: 'a-life' },
    ],
    projects: [
      { id: 'p-house', title: 'Household', goalId: 'g-home', status: 'active' },
      { id: 'p-garden', title: 'Garden', goalId: 'g-home', status: 'active' },
      { id: 'p-run', title: 'Marathon', goalId: 'g-fit', status: 'active' },
      { id: 'p-work', title: 'Day job', status: 'active' },
    ],
  };
  function Harness() {
    const filter = useTagFilter();
    const [features] = useState({ ...lists, goalsProjectsEnabled: true });
    const planner = {
      darkMode: false, textPrimary: '', textSecondary: '',
      ...filter,
      liveHiddenProjects: liveHiddenProjectIds(filter.hiddenProjects, lists.projects),
    };
    return (
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <Groups />
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    );
  }
  function Groups() {
    const { groups } = useCalendarFilterSummary();
    return <CalendarFilterProjects variant="sheet" groups={groups} />;
  }
  const mount = () => {
    let root;
    act(() => { root = create(<I18nextProvider i18n={i18n}><Harness /></I18nextProvider>); });
    return root;
  };
  const group = (root, key) => root.root.find((node) => node.type === 'button' && node.props['data-hide-group'] === key);
  const fold = (root, key) => root.root.find((node) => node.type === 'button' && node.props['data-calendar-filter-group'] === key);
  const click = (node) => act(() => { node.props.onClick(); });
  const projectRows = (root) => root.root.findAll((node) => node.type === 'button' && node.props['data-hide-project'] !== undefined)
    .map((node) => node.props['data-hide-project']);
  const saved = () => JSON.parse(store.get(HIDDEN_PROJECTS_KEY));

  it('hides every project of a folded goal, and leaves the goal folded', () => {
    const root = mount();
    expect(fold(root, 'goal-g-home').props['aria-expanded']).toBe(false);
    click(group(root, 'goal-g-home'));
    expect(saved()).toEqual(['p-house', 'p-garden']);
    expect(group(root, 'goal-g-home').props['data-group-state']).toBe('all');
    expect(group(root, 'goal-g-home').props['aria-pressed']).toBe(true);
    expect(fold(root, 'goal-g-home').props['aria-expanded']).toBe(false);
    expect(projectRows(root)).not.toContain('p-house');
    // The area reads partly hidden: Fitness is not.
    expect(group(root, 'area-a-life').props['data-group-state']).toBe('some');
    expect(group(root, 'area-a-life').props['aria-pressed']).toBe('mixed');
    click(group(root, 'goal-g-home'));
    expect(saved()).toEqual([]);
    expect(group(root, 'goal-g-home').props['data-group-state']).toBe('none');
  });

  it('hides a whole area, its goals and their projects, and nothing outside it', () => {
    const root = mount();
    click(group(root, 'area-a-life'));
    expect(saved()).toEqual(['p-house', 'p-garden', 'p-run']);
    expect(group(root, 'goal-g-home').props['data-group-state']).toBe('all');
    expect(group(root, 'goal-g-fit').props['data-group-state']).toBe('all');
    expect(group(root, 'standalone').props['data-group-state']).toBe('none');
    click(group(root, 'area-a-life'));
    expect(saved()).toEqual([]);
  });

  it('a partly hidden goal reads as such, and a click hides the rest of it', () => {
    store.set(HIDDEN_PROJECTS_KEY, JSON.stringify(['p-garden']));
    const root = mount();
    // Opened on first sight, so the one hidden project is not folded away.
    expect(fold(root, 'goal-g-home').props['aria-expanded']).toBe(true);
    expect(group(root, 'goal-g-home').props['data-group-state']).toBe('some');
    click(group(root, 'goal-g-home'));
    expect(saved()).toEqual(['p-garden', 'p-house']);
    // Still open: hiding a group never folds the row the user just clicked.
    expect(fold(root, 'goal-g-home').props['aria-expanded']).toBe(true);
  });

  it('a goal hidden whole opens folded next time: its own box says it is hidden', () => {
    store.set(HIDDEN_PROJECTS_KEY, JSON.stringify(['p-house', 'p-garden']));
    const root = mount();
    expect(fold(root, 'goal-g-home').props['aria-expanded']).toBe(false);
    expect(group(root, 'goal-g-home').props['data-group-state']).toBe('all');
  });

  it('a single project still toggles on its own inside a hidden goal', () => {
    const root = mount();
    click(fold(root, 'goal-g-home'));
    click(group(root, 'goal-g-home'));
    click(root.root.find((node) => node.type === 'button' && node.props['data-hide-project'] === 'p-house'));
    expect(saved()).toEqual(['p-garden']);
    expect(group(root, 'goal-g-home').props['data-group-state']).toBe('some');
  });
});
