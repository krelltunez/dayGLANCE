import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { LauncherPromoCard, LauncherPromoEntry, useLauncherPromo } from './LauncherPromo.jsx';
import { LAUNCHER_PROMO_FIRST_SEEN_KEY, LAUNCHER_PROMO_DISMISSED_KEY } from '../utils/launcherPromo.js';

// The GLANCElauncher card at the top of mobile Settings and its permanent
// Integrations entry (utils/launcherPromo.js decides who sees them).

let i18n;
beforeEach(async () => {
  if (i18n) return;
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const GITHUB = 'https://github.com/krelltunez/GLANCElauncher/releases/latest';
const PLAY = 'https://play.google.com/store/apps/details?id=app.glance.launcher';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T09:00:00Z');

const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    map,
  };
};

const mount = (element) => {
  let root;
  act(() => { root = create(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>); });
  return root;
};
const byData = (root, attr) => root.root.findAll((n) => typeof n.type === 'string' && n.props[attr] !== undefined);
const text = (node) => (typeof node === 'string' ? node : (node.children || []).map(text).join(''));

// What Settings does with the hook: the card on the main page while it shows,
// the entry under Integrations wherever the launcher is offered.
function SettingsHarness({ storage, now, info }) {
  const promo = useLauncherPromo({ readInfo: () => info, storage, now });
  return (
    <div>
      {promo.showCard && <LauncherPromoCard url={promo.url} onDismiss={promo.dismiss} />}
      {promo.url && <LauncherPromoEntry url={promo.url} />}
    </div>
  );
}

const offered = { sdk: 34, installed: false, url: GITHUB };
const seenDaysAgo = (days) => ({
  storage: memoryStorage({ [LAUNCHER_PROMO_FIRST_SEEN_KEY]: new Date(T0).toISOString() }),
  now: T0 + days * DAY,
});

describe('LauncherPromoCard', () => {
  it("renders the owner's copy, a link to the launcher and Not now", () => {
    const onDismiss = vi.fn();
    const root = mount(<LauncherPromoCard url={GITHUB} onDismiss={onDismiss} />);
    const all = text(root.toJSON());
    expect(all).toContain('GLANCElauncher');
    expect(all).toContain('A home screen launcher built around your day: your dayGLANCE tasks and routines and your lastGLANCE chores and people, right where you will see it when you unlock your device.');
    const [link] = byData(root, 'data-launcher-promo-link');
    expect(link.props.href).toBe(GITHUB);
    // An external anchor, as every link in the app: the Android shell opens it
    // in a Custom Tab rather than navigating the WebView (MainActivity).
    expect(link.props.target).toBe('_blank');
    expect(link.props.rel).toContain('noopener');
    expect(text(link)).toBe('View on GitHub');
    const [dismiss] = byData(root, 'data-launcher-promo-dismiss');
    expect(text(dismiss)).toBe('Not now');
    act(() => dismiss.props.onClick());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('names Google Play for a Play link, and says Get it for anything else', () => {
    expect(text(byData(mount(<LauncherPromoCard url={PLAY} />), 'data-launcher-promo-link')[0])).toBe('Get it on Google Play');
    expect(text(byData(mount(<LauncherPromoCard url="https://example.com/l" />), 'data-launcher-promo-link')[0])).toBe('Get it');
  });
});

describe('the card and the entry in Settings', () => {
  it('shows both once the wait is over', () => {
    const root = mount(<SettingsHarness {...seenDaysAgo(3)} info={offered} />);
    expect(byData(root, 'data-launcher-promo-card')).toHaveLength(1);
    expect(byData(root, 'data-settings-card')).toHaveLength(1);
  });

  it('shows only the entry during the first days', () => {
    const root = mount(<SettingsHarness {...seenDaysAgo(1)} info={offered} />);
    expect(byData(root, 'data-launcher-promo-card')).toHaveLength(0);
    expect(byData(root, 'data-settings-card')).toHaveLength(1);
  });

  it('dismisses the card for good, and the entry stays with the same link', () => {
    const { storage, now } = seenDaysAgo(4);
    const root = mount(<SettingsHarness storage={storage} now={now} info={offered} />);
    const [dismiss] = byData(root, 'data-launcher-promo-dismiss');
    act(() => dismiss.props.onClick());
    expect(byData(root, 'data-launcher-promo-card')).toHaveLength(0);
    expect(storage.getItem(LAUNCHER_PROMO_DISMISSED_KEY)).not.toBeNull();

    // Settings opened again, later: no card, the entry still there.
    const again = mount(<SettingsHarness storage={storage} now={now + 30 * DAY} info={offered} />);
    expect(byData(again, 'data-launcher-promo-card')).toHaveLength(0);
    const [entry] = byData(again, 'data-settings-card');
    expect(entry.props['data-settings-card']).toBe('glanceLauncher');
    // The entry is collapsible: opened, it shows the copy and the link.
    act(() => byData(again, 'data-settings-card-toggle')[0].props.onClick());
    const [link] = byData(again, 'data-launcher-promo-link');
    expect(link.props.href).toBe(GITHUB);
    expect(text(byData(again, 'data-launcher-promo-entry')[0])).toContain('lastGLANCE chores and people');
  });

  it('shows neither where the launcher is not offered', () => {
    for (const info of [null, { ...offered, sdk: 30 }, { ...offered, installed: true }, { ...offered, url: '' }]) {
      const root = mount(<SettingsHarness {...seenDaysAgo(30)} info={info} />);
      expect(byData(root, 'data-launcher-promo-card')).toHaveLength(0);
      expect(byData(root, 'data-settings-card')).toHaveLength(0);
    }
  });
});

describe('where Settings places them', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('puts the card on the mobile Settings page, gated on the hook, above the quick toggles', () => {
    const panel = read('./MobileSettingsPanel.jsx');
    expect(panel).toContain('const launcherPromo = useLauncherPromo();');
    const card = panel.indexOf('{launcherPromo.showCard && (');
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(panel.indexOf('{/* Quick toggles */}'));
  });

  it('lists the entry under Integrations, shown wherever the launcher is offered', () => {
    const topic = read('./settings/topics/useIntegrationsTopic.jsx');
    expect(topic).toMatch(/glanceLauncher: \{\n {6}show: !!launcherPromo\.url,/);
  });
});
