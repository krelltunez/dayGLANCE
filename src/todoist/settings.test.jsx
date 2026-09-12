import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { normalizeSettings } from './core.js';
// The Todoist strings live in the normal lazy locale bundles, so these tests
// read the shipped JSON rather than a feature-local module.
import enBundle from '../../public/locales/en/translation.json';
import zhBundle from '../../public/locales/zh-CN/translation.json';
const en = enBundle.todoist;
const zh = zhBundle.todoist;
import TodoistSettings from '../components/TodoistSettings.jsx';

async function translator(lng = 'en') {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng, fallbackLng: 'en', defaultNS: 'translation',
    resources: { en: { translation: enBundle }, 'zh-CN': { translation: zhBundle } },
    react: { useSuspense: false } });
  return i18n;
}
const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([key, value]) => {
  const path = prefix ? `${prefix}.${key}` : key;
  return typeof value === 'object' ? flatten(value, path) : [[path, value]];
});
const mockSync = patch => ({ settings: normalizeSettings(), connected: false, selected: [],
  catalog: null, status: 'idle', error: '', pending: 0, conflicts: [], blockedWrites: [],
  updateSettings() {}, connect() {}, disconnect() {}, syncNow() {}, preview() {}, ...patch });
async function render(sync, { lng = 'en', variant = 'page', collapsed } = {}) {
  // Content assertions use the full settings page. Desktop collapse behavior
  // is exercised separately with an explicit section variant and shared state.
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
  it('covers every literal todoist call in the settings components', () => {
    const keys = new Set(flatten(en).map(([key]) => key));
    for (const path of ['src/components/TodoistSettings.jsx', 'src/components/MobileSettingsPanel.jsx']) {
      for (const match of readFileSync(path, 'utf8').matchAll(/\bt\(\s*['"]todoist\.([^'"]+)['"]/g)) expect(keys.has(match[1]), match[1]).toBe(true);
    }
  });
  it('falls back to English for languages without the Todoist block', async () => {
    const i18n = await translator('en');
    i18n.addResourceBundle('xx', 'translation', {}, true, true);
    await i18n.changeLanguage('xx');
    expect(i18n.t('todoist.title')).toBe(en.title);
  });
  it('renders a masked token input and safe defaults before connecting', async () => {
    const html = await render(mockSync());
    expect(html).toContain('type="password"'); expect(html).toContain(en.title);
    expect(html).toContain(en.modes.today); expect(html).toContain(en.security);
  });
  it('renders the Chinese connected view and safely escapes task titles', async () => {
    const html = await render(mockSync({ connected: true, account: 'u1', catalog: { user: { full_name: 'Test' }, projects: {}, labels: {} },
      selected: [{ id: 'task', content: '<img src=x onerror=alert(1)>', priority: 4 }] }), { lng: 'zh-CN' });
    expect(html).toContain(zh.title); expect(html).not.toContain('type="password"');
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x');
  });
  it('keeps manual sync available with automatic sync off', async () => {
    const html = await render(mockSync({ connected: true }), { variant: 'section', collapsed: false });
    const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) || [];
    const manual = buttons.find(button => button.includes(en.sync));
    expect(manual).toBeDefined();
    expect(manual).not.toMatch(/\sdisabled(?:=|>|\s)/);
    expect(html).toContain('aria-expanded="true"');
  });
  it('shows advanced filters only in the appropriate mode', async () => {
    const today = await render(mockSync());
    const filtered = await render(mockSync({ settings: normalizeSettings({ mode: 'filtered' }) }));
    expect(today).not.toContain(en.advanced);
    expect(filtered).toContain(en.advanced);
    expect(filtered).toContain(en.ruleHelp);
  });
  it('uses the shared neutral border for advanced filters', async () => {
    const html = await render(mockSync({ settings: normalizeSettings({ mode: 'filtered' }) }));
    const sections = html.match(/<details\b[^>]*>\s*<summary\b[^>]*>[\s\S]*?<\/summary>/g) || [];
    const advanced = sections.find(section => section.includes(en.advanced));
    expect(advanced).toBeDefined();
    const openingTag = advanced.match(/^<details\b[^>]*>/)[0];
    const classes = openingTag.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/) || [];
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
    for (const collapsed of [true, undefined, null]) {
      const html = await render(mockSync(), { variant: 'section', collapsed });
      expect(html).toContain('aria-expanded="false"');
      expect(html).not.toContain('type="password"');
    }
    const expanded = await render(mockSync(), { variant: 'section', collapsed: false });
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('type="password"');
    const source = readFileSync('src/components/TodoistSettings.jsx', 'utf8');
    expect(source).toContain("toggleSettingsSection('todoist')");
    expect(source.includes('[&+hr]:hidden')).toBe(false);
    expect(source).not.toContain('setExpanded');
  });
  it('shows the dedicated mobile page independently of desktop collapse state', async () => {
    const html = await render(mockSync(), { variant: 'page', collapsed: true });
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('hidden=""');
    expect(html).toContain('type="password"');
    expect(html).toContain(en.title);
  });
  it('disables connecting and syncing in multi-user mode on the visible page', async () => {
    const html = await render(mockSync({ multiUserEnabled: true }));
    expect(html).toContain(en.errors.multiUser);
    const token = (html.match(/<input\b[^>]*>/g) || []).find(tag => tag.includes('type="password"'));
    expect(token).toBeDefined();
    expect(token).toMatch(/\sdisabled(?:=|>|\s)/);
    const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) || [];
    for (const label of [en.connect, en.sync]) {
      const button = buttons.find(item => item.includes(label));
      expect(button).toBeDefined();
      expect(button).toMatch(/\sdisabled(?:=|>|\s)/);
    }
  });
  it('is wired to both settings entries and an always-mounted hook', () => {
    expect(readFileSync('src/App.jsx', 'utf8')).toContain('const todoist = useTodoistSync(');
    expect(readFileSync('src/components/SettingsModal.jsx', 'utf8')).toContain('<TodoistSettings />');
    expect(readFileSync('src/components/MobileSettingsPanel.jsx', 'utf8')).toContain("mobileSettingsView === 'todoist'");
  });
});
