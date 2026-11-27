import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import DesktopHeader from './DesktopHeader.jsx';

const fixture = vi.hoisted(() => ({
  planner: {}, sync: {}, features: {}, native: false, locale: 'en',
  formatRange: vi.fn(), formatMonth: vi.fn(),
}));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.planner }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => fixture.sync }));
vi.mock('../context/FeaturesContext.jsx', () => ({
  useFeaturesCtx: () => ({ activeReminders: [{}], setShowRemindersSettings: vi.fn(), ...fixture.features }),
}));
vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => fixture.native }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key, i18n: { resolvedLanguage: fixture.locale } }),
}));
vi.mock('../utils/taskUtils.js', () => ({
  dateToString: date => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
  formatDateRange: (...args) => fixture.formatRange(...args),
}));
vi.mock('../utils/localeFormatting.js', () => ({
  formatLocalizedDate: (...args) => fixture.formatMonth(...args),
  localizedWeekdays: () => ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
}));
vi.mock('./McpStatusControls.jsx', () => ({
  useMcpStatus: () => ({}),
  McpBoltButton: () => <button title="MCP" />,
  McpStatusModal: () => null,
}));

const render = () => renderToStaticMarkup(<DesktopHeader />);
const titleButton = html => html.match(/<button[^>]*class="month-view-toggle[^>]*>[\s\S]*?<\/button>/)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  fixture.locale = 'en';
  fixture.native = false;
  fixture.formatRange.mockReturnValue('Sep 22 – 24, 2026');
  fixture.formatMonth.mockReturnValue('September 2026');
  const selectedDate = new Date(2026, 8, 22);
  fixture.planner = {
    selectedDate, viewedMonth: selectedDate,
    headerDays: 3, visibleDates: [selectedDate],
    effectiveViewMode: 'multi', dayViewColumns: [], weekViewDates: [],
    darkMode: false, showMonthView: false, monthViewActive: false,
    weatherEnabled: true, weatherTempUnit: 'celsius',
    weather: { icon: '☀️', temp: 28, high: 32, low: 24, forecast: [{ day: 'Wed', icon: '☀️', high: 30, low: 24 }] },
    dailyContentEnabled: true, dailyContent: { dadJoke: 'A sample daily item.' }, contentRotation: 0,
    cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900',
    textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
    getMonthDays: () => [null, selectedDate], getDateIndicators: () => ({}), weekStartDay: 0,
  };
  fixture.sync = {
    cloudSyncConfig: { enabled: true }, obsidianConfig: { enabled: true },
    calSyncConfigured: true, cloudSyncStatus: 'success', obsidianSyncStatus: 'success',
  };
  fixture.features = { goalsProjectsEnabled: true };
});

describe('DesktopHeader spaces', () => {
  it('puts the space switcher at the far left and keeps the date navigation in the Calendar space', () => {
    const html = render();
    const leftCell = html.match(/<div class="flex items-center gap-4 min-w-0">[\s\S]*?<\/div>/)[0];
    expect(leftCell).toContain('data-space-switcher');
    expect(html.indexOf('data-space-switcher')).toBeLessThan(html.indexOf('28°C'));
    expect(titleButton(html)).toContain('Sep 22 – 24, 2026');
    expect(html).not.toContain('data-goals-space-title');
  });

  it('drops the switcher while Goals & Projects is off, leaving the rest of the header as it was', () => {
    fixture.features = { goalsProjectsEnabled: false };
    const html = render();
    expect(html).not.toContain('data-space-switcher');
    expect(titleButton(html)).toContain('Sep 22 – 24, 2026');
    expect(html).toContain('28°C');
    expect(html).toContain('height:80px');
  });

  it('swaps only the centre for the space title in the Goals space, keeping the height and the icon cluster', () => {
    fixture.features = { goalsProjectsEnabled: true, desktopSpace: 'goals', goals: [{ id: 'g' }], projects: [{ id: 'p' }, { id: 'q' }] };
    const html = render();
    expect(html).toContain('data-space-switcher');
    expect(html).toContain('data-goals-space-title');
    expect(html).toContain('goals.dashboardTitle');
    expect(titleButton(html)).toBeUndefined();
    expect(html).not.toContain('aria-label="common.back"');
    expect(html).toContain('height:80px');
    expect(html).toContain('settings.viewCalendarDay');
    expect(html).toContain('settings.cloudSync');
    expect(html).toContain('justify-self-end');
  });
});

describe('DesktopHeader layout', () => {
  it('reserves grid tracks for weather, dates and the full action cluster instead of overlaying dates', () => {
    const html = render();
    expect(html).toContain('grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)]');
    expect(html).not.toContain('absolute inset-0');
    expect(html).not.toContain('max-[950px]:pr-36');
    expect(html).not.toContain('pointer-events-none');
    expect(html).toContain('justify-self-end');
    expect(html).toContain('28°C');
    expect(html).toContain('title="MCP"');
    expect(html).toContain('settings.cloudSync');
    expect(html).toContain('settings.obsidian');
    expect(html).toContain('settings.viewCalendarDay');
    expect(html).toContain('height:80px');
  });

  it.each(['en', 'de', 'zh-CN'])('lets the %s date label shrink while retaining the full text and tooltip', locale => {
    fixture.locale = locale;
    fixture.formatRange.mockReturnValue('28. September – 4. Oktober 2026');
    const button = titleButton(render());
    expect(button).toContain('w-52 basis-52 shrink min-w-0 truncate');
    expect(button).not.toContain('min-w-[13rem]');
    expect(button).toContain('title="28. September – 4. Oktober 2026"');
    expect(button).toContain('>28. September – 4. Oktober 2026</button>');
    expect(fixture.formatRange).toHaveBeenCalledWith(fixture.planner.visibleDates, expect.any(Function), locale);
  });

  it('retains the month popup without clipping it to the 80px header', () => {
    fixture.planner.showMonthView = true;
    const html = render();
    expect(html).toContain('month-view-container absolute top-full');
    expect(html).toContain('z-50');
    expect(html.match(/^<div[^>]*>/)[0]).not.toContain('overflow-hidden');
    expect(html).toContain('aria-label="common.back"');
    expect(html).toContain('aria-label="common.next"');
  });

  it('still renders navigation and the Day Dial when weather and optional sync are off', () => {
    fixture.planner.weatherEnabled = false;
    fixture.sync = {};
    fixture.native = true;
    const html = render();
    expect(html).not.toContain('28°C');
    expect(html).not.toContain('settings.cloudSync');
    expect(html).toContain('settings.viewCalendarDay');
    expect(titleButton(html)).toContain('Sep 22 – 24, 2026');
  });

  it('keeps DAY deduplication, WEEK dates, JOBO single-day dates and MONTH labels unchanged', () => {
    const date = fixture.planner.selectedDate;
    fixture.planner.effectiveViewMode = 'day';
    fixture.planner.dayViewColumns = [{ dateStr: '2026-09-22', date }, { dateStr: '2026-09-22', date }];
    render();
    expect(fixture.formatRange).toHaveBeenLastCalledWith([date], expect.any(Function), 'en');
    fixture.planner.effectiveViewMode = 'week';
    fixture.planner.weekViewDates = [date, new Date(2026, 8, 23)];
    render();
    expect(fixture.formatRange).toHaveBeenLastCalledWith(fixture.planner.weekViewDates, expect.any(Function), 'en');
    fixture.planner.effectiveViewMode = 'jobo';
    render();
    expect(fixture.formatRange).toHaveBeenLastCalledWith([date], expect.any(Function), 'en');
    fixture.planner.monthViewActive = true;
    expect(titleButton(render())).toContain('title="September 2026"');
    expect(fixture.formatMonth).toHaveBeenCalledWith(date, { month: 'long', year: 'numeric' }, 'en');
  });

  it('keeps navigation hit targets non-shrinking beside the flexible date label', () => {
    const html = render();
    expect(html.match(/<button[^>]*aria-label="common.back"[^>]*>/)?.[0]).toContain('flex-shrink-0');
    expect(html.match(/<button[^>]*aria-label="common.next"[^>]*>/)?.[0]).toContain('flex-shrink-0');
    expect(html.match(/<button[^>]*>common\.today<\/button>/)?.[0]).toContain('flex-shrink-0');
  });

  it('compiles the layout with the project Tailwind version', async () => {
    const raw = readFileSync(new URL('./DesktopHeader.jsx', import.meta.url), 'utf8');
    const result = await postcss([tailwindcss({ content: [{ raw, extension: 'jsx' }], corePlugins: { preflight: false } })])
      .process('@tailwind utilities;', { from: undefined });
    const grids = [];
    result.root.walkDecls('grid-template-columns', decl => grids.push(decl.value.replace(/\s/g, '')));
    expect(grids).toContain('minmax(max-content,1fr)minmax(0,auto)minmax(max-content,1fr)');
    // Width stabilizes the auto grid track's intrinsic size; basis alone still
    // contracts around short labels. Neither restores a rigid minimum width.
    for (const [selector, property, expected] of [
      ['.w-52', 'width', '13rem'],
      ['.basis-52', 'flex-basis', '13rem'],
      ['.shrink', 'flex-shrink', '1'],
      ['.min-w-0', 'min-width', '0px'],
    ]) {
      const values = [];
      result.root.walkRules(selector, rule => {
        rule.walkDecls(property, declaration => values.push(declaration.value));
      });
      expect(values).toContain(expected);
    }
  });
});

// #2407: the button that shows or hides the side panel lives in the header,
// because once the panel is hidden nothing inside it can bring it back.
describe('the side panel toggle', () => {
  const toggle = html => html.match(/<button[^>]*data-side-panel-toggle[^>]*>/)?.[0];

  it('is offered where the panel can be hidden, first in the header, and says what it will do', () => {
    fixture.planner = { ...fixture.planner, sidePanelCollapsible: true, sidePanelCollapsed: false, toggleSidePanel: vi.fn() };
    const html = render();
    const button = toggle(html);
    expect(button).toBeTruthy();
    expect(button).toContain('aria-expanded="true"');
    expect(button).toContain('aria-label="shortcuts.sidePanelHide"');
    expect(button).toMatch(/title="shortcuts\.sidePanelHide \((Ctrl\+B|⌘B)\)"/);
    // Before the weather and everything else on the left.
    expect(html.indexOf('data-side-panel-toggle')).toBeLessThan(html.indexOf('28°'));
  });

  it('says Show, and is still there, when the panel is hidden', () => {
    fixture.planner = { ...fixture.planner, sidePanelCollapsible: true, sidePanelCollapsed: true, toggleSidePanel: vi.fn() };
    const button = toggle(render());
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-label="shortcuts.sidePanelShow"');
  });

  it('is absent where the panel cannot be hidden', () => {
    expect(toggle(render())).toBeUndefined();
    fixture.planner = { ...fixture.planner, sidePanelCollapsible: false, sidePanelCollapsed: false };
    expect(toggle(render())).toBeUndefined();
  });
});
