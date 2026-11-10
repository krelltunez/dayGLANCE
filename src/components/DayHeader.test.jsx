import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import DayHeaderCell, { DayHeaderActions, DayHabitRings } from './DayHeader.jsx';

// Node 25 defines a localStorage of its own that has no getItem without
// --localstorage-file, so stub unless a working one is already there.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  delete globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: () => null, length: 0 };
}

let i18nEn;
async function i18n() {
  if (i18nEn) return i18nEn;
  const bundle = await loaders.en();
  i18nEn = i18next.createInstance();
  await i18nEn.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18nEn;
}

const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(12, 0, 0, 0); return d; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const render = async (node, { planner = {}, features = {} } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{ darkMode: false, cardBg: 'bg-white', textPrimary: 'text-stone-900', dailyNotes: {}, setDailyNotesModalDate: vi.fn(), openNewAllDayTask: vi.fn(), ...planner }}>
      <FeaturesContext.Provider value={{ focusLog: {}, setFocusLogModalDate: vi.fn(), habitsEnabled: false, habitLogs: {}, activeHabits: [], setHabitDayPopup: vi.fn(), ...features }}>
        {node}
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('DayHeaderActions', () => {
  it('renders the daily-note and focus-log buttons, dimmed while the day has neither', async () => {
    const html = await render(<DayHeaderActions dateStr="2026-09-16" />);
    expect(html).toContain('aria-label="Daily Note"');
    expect(html).toContain('aria-label="Focus Log"');
    expect(html).toContain('data-day-note="empty"');
    expect(html).toContain('data-day-focus="empty"');
    expect((html.match(/opacity-50/g) || []).length).toBe(2);
  });

  it('lights a button up once the day has a note or logged focus', async () => {
    const html = await render(<DayHeaderActions dateStr="2026-09-16" />, {
      planner: { dailyNotes: { '2026-09-16': { text: 'notes' } } },
      features: { focusLog: { '2026-09-16': { totalMinutes: 25 } } },
    });
    expect(html).toContain('data-day-note="present"');
    expect(html).toContain('data-day-focus="present"');
    expect(html).not.toContain('opacity-50');
  });
});

describe('DayHeaderCell', () => {
  it('shows the short date with the actions and an add-all-day tooltip', async () => {
    const html = await render(<DayHeaderCell date={new Date(2026, 8, 16, 12)} className="flex-1" />);
    expect(html).toContain('data-day-header="2026-09-16"');
    expect(html).toContain('Wed, Sep 16');
    expect(html).toContain('data-day-header-actions="2026-09-16"');
    expect(html).toContain('title="Add task: All Day"');
    expect(html).toContain('flex-1');
    expect(html).not.toContain('data-day-habit-rings');
  });

  it('marks today and uses the compact title on the phone', async () => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const html = await render(<DayHeaderCell date={today} compact />);
    expect(html).toContain('data-today="true"');
    expect(html).toContain('text-blue-600');
    expect(html).toContain('text-sm');
  });

  it('draws habit rings only for a past day with a log, when habits are on', async () => {
    const past = yesterday();
    const features = { habitsEnabled: true, habitLogs: { [ymd(past)]: { h1: 2 } }, activeHabits: [{ id: 'h1', name: 'Water', icon: 'droplet', color: 'blue', target: 3 }] };
    const withRings = await render(<DayHabitRings dateStr={ymd(past)} />, { features });
    expect(withRings).toContain('data-day-habit-rings');
    const today = new Date(); today.setHours(12, 0, 0, 0);
    expect(await render(<DayHabitRings dateStr={ymd(today)} />, { features: { ...features, habitLogs: { [ymd(today)]: { h1: 1 } } } })).toBe('');
    expect(await render(<DayHabitRings dateStr={ymd(past)} />, { features: { ...features, habitsEnabled: false } })).toBe('');
  });
});
