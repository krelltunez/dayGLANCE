import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import TrayNowBar from './TrayNowBar.jsx';
import { buildTodayAgenda } from '../utils/todayAgenda.js';
import { buildTrayCurrentTask } from '../utils/streamDeckPayload.js';

// The tray's NOW bar gets an open-book button when the running task has a
// vault note (pushed as `note` by the main window, title already stripped),
// and nothing extra when it does not.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const render = async (currentTask) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <TrayNowBar darkMode={false} currentTask={currentTask} />
  </I18nextProvider>,
);

describe('TrayNowBar', () => {
  it('shows the open-book button for a task with a vault note', async () => {
    const html = await render({ id: 'a', title: 'Prepare #obsidian', note: 'Projects/dayGLANCE/NEXT- Prepare', startTime: '09:00', duration: 30 });
    expect(html).toContain('Now: Prepare #obsidian  ·  9am–9:30am');
    expect(html).toContain('lucide-book-open');
    expect(html).toContain('aria-label="Open “Projects/dayGLANCE/NEXT- Prepare” in Obsidian"');
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it('renders only the bar for a task without one', async () => {
    const html = await render({ id: 'b', title: 'Plain task', note: null, startTime: '09:00', duration: 30 });
    expect(html).not.toContain('lucide-book-open');
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('renders nothing when no task is running', async () => {
    expect(await render(null)).toBe('');
  });
});

// #2278: the owner's scenario. A Friday 23:00 task of two hours, Saturday
// 00:08. The main window's push (buildTrayCurrentTask, over the real agenda)
// makes it the running task, and the bar prints its own range through the
// shared formatter, the end marked "+1".
describe('TrayNowBar, the night before’s task still running', () => {
  const FRI = '2026-11-06';
  const SAT = '2026-11-07';
  const night = { id: 'night', title: 'Two-Hour Task', date: FRI, startTime: '23:00', duration: 120, color: 'bg-blue-500' };
  const late = { id: 'late', title: 'Night reading', date: SAT, startTime: '01:15', duration: 45, color: 'bg-green-500' };
  const pushedAt = (hhmm, tasks) => {
    const currentTime = new Date(`${SAT}T${hhmm}:00`);
    const todayAgenda = buildTodayAgenda({
      todayStr: SAT, nowMinutes: currentTime.getHours() * 60 + currentTime.getMinutes(),
      tasks, expandedRecurringTasks: [], unscheduledTasks: [], isVisibleForUser: () => true,
    });
    return buildTrayCurrentTask({ currentTime, todayAgenda, todayHGSessions: [] });
  };

  it('at 00:08 it is now, until 1am, marked as ending the next day', async () => {
    const pushed = pushedAt('00:08', [night]);
    expect(pushed).toMatchObject({ id: 'night', startTime: '23:00', duration: 120 });
    const html = await render(pushed);
    expect(html).toMatch(/Now: Two-Hour Task {2}· {2}11pm–1am<sup data-next-day="true"[^>]*title="Ends the next day"[^>]*>\+1<\/sup>/);
  });

  it('at 01:30 it is over: the next task is now, or nothing is', async () => {
    expect(pushedAt('01:30', [night])).toBeNull();
    const html = await render(pushedAt('01:30', [night, late]));
    expect(html).toContain('Now: Night reading  ·  1:15am–2am');
    expect(html).not.toContain('data-next-day');
  });
});
