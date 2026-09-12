import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { languages, loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import StorageBreakdownModal from './StorageBreakdownModal.jsx';

beforeEach(() => {
  const keys = ['dg-todoist-state-v1:account-one', 'dg-todoist-state-v1:account-two', 'unrelated-cache'];
  vi.stubGlobal('localStorage', {
    length: keys.length,
    key: index => keys[index],
    getItem: () => 'synthetic cache data '.repeat(20),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Todoist storage breakdown label', () => {
  it.each(languages)('renders %s from the lazy app bundle without loading Todoist settings', async lng => {
    const bundle = await loaders[lng]();
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({
      lng, fallbackLng: false, resources: { [lng]: { translation: bundle } },
      react: { useSuspense: false },
    });
    // No inline Todoist namespace is registered. This modal must work on its
    // own, including before the user opens the integration's settings page.
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={{}}>
          <SyncContext.Provider value={{ showStorageBreakdown: true, setShowStorageBreakdown() {} }}>
            <StorageBreakdownModal />
          </SyncContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
    expect(bundle.storage.todoistCache).toBeTypeOf('string');
    expect(html.split(bundle.storage.todoistCache)).toHaveLength(3);
    expect(html).toContain(bundle.storage.title);
    expect(html).not.toContain('dg-todoist-state-v1');
    expect(html).not.toContain('todoist:storageCache');
    expect(html).toContain('unrelated-cache');
  });
});
