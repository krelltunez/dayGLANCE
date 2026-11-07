import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// #2075, the quick part: the desktop Settings dialog keeps a Close control in
// reach from anywhere in its long list, and grows with a large window. Read at
// the source level like the other SettingsModal tests (the dialog needs most
// of App's state to render).
const source = readFileSync(new URL('./SettingsModal.jsx', import.meta.url), 'utf8');
const tagAt = (marker) => {
  const i = source.indexOf(marker);
  expect(i, marker).toBeGreaterThan(-1);
  return source.slice(source.lastIndexOf('<', i), source.indexOf('>', i) + 1);
};

describe('Settings dialog header', () => {
  it('sits above the scrolling page, so it never scrolls away', () => {
    const header = tagAt('data-settings-header');
    expect(header).toContain('flex-shrink-0');
    expect(header).toContain('${cardBg}');
    // The page scrolls in its own container below the header, not the dialog.
    expect(tagAt('data-settings-scroll')).toContain('overflow-y-auto');
    expect(source.indexOf('data-settings-header')).toBeLessThan(source.indexOf('data-settings-scroll'));
    expect(tagAt('data-settings-dialog')).toContain('overflow-hidden');
  });

  it('carries a labelled Close button that closes the dialog', () => {
    const start = source.indexOf('data-settings-close');
    const button = source.slice(source.lastIndexOf('<button', start), source.indexOf('</button>', start));
    expect(button).toContain('onClick={() => setShowSettings(false)}');
    expect(button).toContain("aria-label={t('common.close')}");
    // In the header, ahead of the topic list and the page.
    expect(start).toBeGreaterThan(source.indexOf('data-settings-header'));
    expect(start).toBeLessThan(source.indexOf('data-settings-scroll'));
  });

  it('is a labelled modal dialog', () => {
    const dialog = tagAt('data-settings-dialog');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-labelledby="settings-dialog-title"');
    expect(source).toContain('id="settings-dialog-title"');
  });

  it('keeps one height across topics and grows with large screens', () => {
    const dialog = tagAt('data-settings-dialog');
    expect(dialog).toContain('h-[85vh] lg:h-[90vh]');
    expect(dialog).toContain('lg:max-w-4xl');
    expect(dialog).toContain('xl:max-w-5xl');
  });
});

describe('Escape closes Settings', () => {
  // The issue read the dialog's own handlers only; the app-wide one closes it.
  it('through the shared modal Escape handler', () => {
    const hook = readFileSync(new URL('../hooks/useModalClose.js', import.meta.url), 'utf8');
    expect(hook).toMatch(/if \(showSettings\) \{\s*e\.preventDefault\(\);\s*setShowSettings\(false\);/);
  });
});

// GLANCElauncher's one-time card (utils/launcherPromo.js): Android tablets in
// landscape open this dialog, not the phone's Settings page, so it carries the
// card too, above the topic page and only while not searching. Whether it
// shows at all is useLauncherPromo's rule, the same as on the phone.
describe('Settings dialog: the GLANCElauncher card', () => {
  it('shows the one-time card from the shared hook, above the topic page', () => {
    expect(source).toContain("import { LauncherPromoCard, useLauncherPromo } from './LauncherPromo.jsx'");
    expect(source).toContain('const launcherPromo = useLauncherPromo()');
    const card = source.indexOf('data-settings-launcher-promo');
    expect(source.slice(source.lastIndexOf('{', card), card)).toContain('launcherPromo.showCard');
    expect(card).toBeGreaterThan(source.indexOf('data-settings-scroll'));
    expect(card).toBeLessThan(source.indexOf('<SettingsTopicPage'));
    expect(card).toBeGreaterThan(source.indexOf('settingsQuery ? ('));
    expect(source).toContain('onDismiss={launcherPromo.dismiss}');
  });
});

