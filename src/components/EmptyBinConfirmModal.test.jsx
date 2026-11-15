import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { languages, loaders } from '../locales.js';
import EmptyBinConfirmModal from './EmptyBinConfirmModal.jsx';

// The message used to be one string with a `{{plural}}` slot the modal filled
// with English's "s", so every other language got its own noun with an "s"
// stuck on: "Aufgabes", "attivitàs", "任务s". It is now a real plural, and
// these render the modal with each language's own bundle.

async function translation(language) {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: await loaders[language]() } }, interpolation: { escapeValue: false } });
  return i18n;
}

const text = (value) => renderToStaticMarkup(<>{value}</>);

function render(i18n, count) {
  const recycleBin = Array.from({ length: count }, (_, i) => ({ id: `t${i}` }));
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DayPlannerContext.Provider value={{ recycleBin, cardBg: '', borderClass: '', textPrimary: '', textSecondary: '', darkMode: false, hoverBg: '', confirmEmptyBin: () => {} }}>
        <SyncContext.Provider value={{ showEmptyBinConfirm: true, setShowEmptyBinConfirm: () => {}, setShowMobileRecycleBin: () => {} }}>
          <EmptyBinConfirmModal />
        </SyncContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
}

describe.each(languages)('%s empty-bin confirmation', (language) => {
  // 1, 2, 5 and 21 between them reach one/few/many/other in every language shipped.
  it.each([1, 2, 5, 21])('says how many tasks in its own plural form (%i)', async (count) => {
    const i18n = await translation(language);
    const html = render(i18n, count);
    const category = new Intl.PluralRules(language).select(count);
    const form = i18n.getResource(language, 'translation', `modal.emptyBinMessage_${category}`);
    expect(form, `${language} has no ${category} form`).toBeTypeOf('string');
    expect(html).toContain(text(form.replaceAll('{{count}}', String(count))));
    expect(html).toContain(String(count));
    expect(html).not.toContain('emptyBinMessage');
    expect(html).not.toContain('{{');
  });
});

describe('the nouns that used to get an English "s"', () => {
  it.each([
    ['en', 1, 'the 1 task in', '1 tasks'],
    ['en', 3, 'all 3 tasks in', '3 task in'],
    ['de', 1, '1 Aufgabe im', 'Aufgabes'],
    ['de', 3, '3 Aufgaben im', 'Aufgabes'],
    ['it', 3, '3 attività nel', 'attivitàs'],
    ['zh-CN', 1, '1 个任务吗', '任务s'],
    ['zh-CN', 3, '3 个任务吗', '任务s'],
    ['pl', 1, '1 zadanie z', 'zadania'],
    ['pl', 3, '3 zadania z', 'zadań'],
    ['pl', 5, '5 zadań z', 'zadania'],
    ['uk', 5, '5 завдань з', 'завдання'],
  ])('%s with %i', async (language, count, wanted, unwanted) => {
    const html = render(await translation(language), count);
    expect(html).toContain(text(wanted));
    expect(html).not.toContain(text(unwanted));
  });
});
