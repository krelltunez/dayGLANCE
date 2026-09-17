import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { languages, loaders } from '../locales.js';

describe('mobile Plan / Do terminology', () => {
  it.each(languages)('%s shares the desktop Plan / Do labels', async (language) => {
    const bundle = await loaders[language]();
    const i18n = createInstance();
    await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } } });
    expect(i18n.t('joboMobile.view')).toBe(`${i18n.t('jobo.plan')} / ${i18n.t('jobo.do')}`);
    expect(bundle.joboMobile).not.toHaveProperty('actual');
    expect(i18n.t('joboMobile.view')).not.toContain('Actual');
    expect(i18n.t('joboMobile.toggle')).not.toContain('Actual');
    expect(i18n.t('jobo.do')).toBe(language === 'zh-CN' ? '执行' : 'Do');
  });

  it('uses the shared Do heading instead of a separate Actual label', () => {
    const source = readFileSync(new URL('../components/jobo/MobileJoboView.jsx', import.meta.url), 'utf8');
    expect(source).toContain("<b>{t('jobo.do')}</b>");
    expect(source).not.toContain('joboMobile.actual');
  });
});
