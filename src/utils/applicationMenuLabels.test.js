import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { languages, loaders } from '../locales.js';
import en from '../../public/locales/en/translation.json';
import { buildApplicationMenuLabels } from './applicationMenuLabels.js';
import { buildApplicationMenuTemplate, isApplicationMenuLabels } from '../../electron/applicationMenu.ts';

describe('locale JSON to Electron menu', () => {
  it.each(languages)('uses the complete %s bundle and preserves Quit / Close roles', async (lng) => {
    const translation = await loaders[lng]();
    const i18n = i18next.createInstance();
    await i18n.init({ lng, fallbackLng: 'en', resources: {
      en: { translation: en }, [lng]: { translation },
    } });
    const labels = buildApplicationMenuLabels(i18n.t.bind(i18n));
    expect(isApplicationMenuLabels(labels)).toBe(true);
    expect(labels).toEqual(translation.menu);
    const template = buildApplicationMenuTemplate(labels);
    expect(template[0].submenu[0]).toMatchObject({ label: translation.menu.quit, role: 'quit', accelerator: 'CommandOrControl+Q' });
    expect(template[3].submenu.at(-1)).toMatchObject({ label: translation.menu.close, role: 'close' });
  });

  it('rebuilds from the changed language and uses English defaults for missing keys', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', fallbackLng: false, resources: {
      en: { translation: en }, de: { translation: { menu: { file: 'Datei' } } },
    } });
    let labels = buildApplicationMenuLabels(i18n.t.bind(i18n));
    i18n.on('languageChanged', () => { labels = buildApplicationMenuLabels(i18n.t.bind(i18n)); });
    expect(labels.file).toBe('File');
    await i18n.changeLanguage('de');
    expect(labels.file).toBe('Datei');
    expect(labels.quit).toBe('Quit');
  });
});
