import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { normalizeSettings } from './core.js';
// Avoid booting the application's browser language detector in node tests.
vi.mock('../i18n.js', () => ({ default: { addResourceBundle() {} } }));
import { en, zh } from './strings.js';
import TodoistSettings from '../components/TodoistSettings.jsx';

async function translator(lng = 'en') {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng, fallbackLng: 'en', defaultNS: 'todoist',
    resources: { en: { todoist: en }, 'zh-CN': { todoist: zh } }, react: { useSuspense: false } });
  return i18n;
}
const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([key, value]) => {
  const path = prefix ? `${prefix}.${key}` : key;
  return typeof value === 'object' ? flatten(value, path) : [[path, value]];
});
const mockSync = patch => ({ settings: normalizeSettings(), connected: false, selected: [],
  catalog: null, status: 'idle', error: '', pending: 0, conflicts: [], blockedWrites: [],
  updateSettings() {}, connect() {}, disconnect() {}, syncNow() {}, preview() {}, ...patch });
async function render(sync, lng = 'en', collapsed = false, variant) {
  return renderToStaticMarkup(<I18nextProvider i18n={await translator(lng)}>
    <DayPlannerContext.Provider value={{ darkMode: true, borderClass: 'border-gray-600', textPrimary: '', textSecondary: '', collapsedSettings: { todoist: collapsed }, toggleSettingsSection() {} }}>
      <SyncContext.Provider value={{ todoist: sync }}><TodoistSettings variant={variant} /></SyncContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>);
}
describe('Todoist namespace and settings', () => {
  it('has matching English/Chinese keys and placeholders', () => {
    const english = new Map(flatten(en)); const chinese = new Map(flatten(zh));
    expect([...chinese.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, text] of english) {
      const placeholders = value => [...value.matchAll(/{{(.*?)}}/g)].map(m => m[1]).sort();
      expect(placeholders(chinese.get(key))).toEqual(placeholders(text));
    }
  });
  it('covers every literal call in this explicitly named namespace', () => {
    const keys = new Set(flatten(en).map(([key]) => key));
    for (const path of ['src/components/TodoistSettings.jsx', 'src/components/MobileSettingsPanel.jsx']) {
      for (const match of readFileSync(path, 'utf8').matchAll(/todoistText\(\s*['"]([^'"]+)['"]/g)) expect(keys.has(match[1]), match[1]).toBe(true);
    }
  });
  it('uses English fallback for the beta namespace in other app languages', async () => {
    expect((await translator('de')).t('title')).toBe(en.title);
  });
  it('renders a masked token input and safe defaults before connecting', async () => {
    const html = await render(mockSync());
    expect(html).toContain('type="password"'); expect(html).toContain(en.title);
    expect(html).toContain(en.modes.today); expect(html).toContain(en.security);
  });
  it('renders the Chinese connected view and safely escapes task titles', async () => {
    const html = await render(mockSync({ connected: true, account: 'u1', catalog: { user: { full_name: 'Test' }, projects: {}, labels: {} },
      selected: [{ id: 'task', content: '<img src=x onerror=alert(1)>', priority: 4 }] }), 'zh-CN');
    expect(html).toContain(zh.title); expect(html).not.toContain('type="password"');
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x');
  });
  it('keeps manual sync available with automatic sync off', async () => {
    const html = await render(mockSync({ connected: true }));
    const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g);
    const manual = buttons.find(button => button.includes(en.sync));
    expect(manual).not.toMatch(/\sdisabled(?:=|>|\s)/);
    expect(html).toContain('aria-expanded="true"');
  });
  it('shows advanced filters only in the appropriate mode', async () => {
    const today = await render(mockSync());
    const filtered = await render(mockSync({ settings: normalizeSettings({ mode: 'filtered' }) }));
    expect(today).not.toContain(en.advanced);
    expect(filtered).toContain(en.ruleHelp);
  });
  it('uses the shared neutral border for advanced filters', async () => {
    const html = await render(mockSync({ settings: normalizeSettings({ mode: 'filtered' }) }));
    // Locate the rendered control by its label, not generated IDs or attribute order.
    const sections = html.match(/<details\b[^>]*>\s*<summary\b[^>]*>[\s\S]*?<\/summary>/g) || [];
    const advanced = sections.find(section => section.includes(en.advanced));
    expect(advanced).toBeDefined();
    const openingTag = advanced.match(/^<details\b[^>]*>/)[0];
    // Require an attribute boundary so data-theme-class is not read as class.
    const classes = openingTag.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/) || [];
    // A shared theme may supply the neutral border directly or with dark:.
    const utilities = classes.map(name => name.replace(/^dark:/, ''));
    expect(utilities).toEqual(expect.arrayContaining(['border', 'border-gray-600']));
    expect(utilities.some(name => name.startsWith('bg-primary-'))).toBe(false);
  });
  it('exposes only the three import modes', async () => {
    const html = await render(mockSync({ connected: true }));
    expect(html).not.toContain('value="mirror"');
    expect(Object.keys(en.modes)).toEqual(['today', 'all', 'filtered']);
    expect(Object.keys(en.modeHelp)).toEqual(['today', 'all', 'filtered']);
    expect(en.errors).not.toHaveProperty('mirrorConsent');
  });
  it('uses app-owned collapse state and defaults an unset section to collapsed', async () => {
    const collapsed = await render(mockSync(), 'en', true);
    const unset = await render(mockSync(), 'en', null);
    expect(collapsed).toContain('aria-expanded="false"');
    expect(unset).toContain('aria-expanded="false"');
    expect(await render(mockSync(), 'en', false)).toContain('aria-expanded="true"');
    const source = readFileSync('src/components/TodoistSettings.jsx', 'utf8');
    expect(source).toContain("toggleSettingsSection('todoist')");
    // The reviewer requested structural dividers, not a sibling-hiding CSS workaround.
    expect(source.includes('[&+hr]:hidden')).toBe(false);
    expect(source).not.toContain('setExpanded');
  });
  it('shows the dedicated mobile page without a collapsible section header', async () => {
    const html = await render(mockSync(), 'en', true, 'page');
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('hidden=""');
    expect(html).toContain('type="password"');
    expect(html).toContain(en.title);
  });
  it('is wired to both settings entries and an always-mounted hook', () => {
    expect(readFileSync('src/App.jsx', 'utf8')).toContain('const todoist = useTodoistSync(');
    expect(readFileSync('src/components/SettingsModal.jsx', 'utf8')).toContain('<TodoistSettings />');
    expect(readFileSync('src/components/MobileSettingsPanel.jsx', 'utf8')).toContain("mobileSettingsView === 'todoist'");
  });
});
