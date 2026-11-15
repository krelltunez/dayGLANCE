import React from 'react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import en from '../../public/locales/en/translation.json';
import RecycleBinSheet from './RecycleBinSheet.jsx';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: en } }, interpolation: { escapeValue: false } });

let planner;
let sync;
const ui = (variant) => (
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={planner}>
      <SyncContext.Provider value={sync}><RecycleBinSheet variant={variant} /></SyncContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>
);
const html = (variant) => renderToStaticMarkup(ui(variant));
const mount = (variant) => { let root; act(() => { root = create(ui(variant)); }); return root.root; };
const button = (root, id, attr) => root
  .find((n) => typeof n.type === 'string' && n.props['data-recycle-bin-row'] === id)
  .find((n) => n.type === 'button' && n.props[attr] !== undefined);

beforeEach(() => {
  planner = {
    recycleBin: [
      { id: 'a', title: 'Write report', color: 'bg-blue-500', duration: 308, startTime: '09:00' },
      { id: 'b', title: 'Call Ana', color: 'bg-red-500', duration: 30, _deletedFrom: 'inbox' },
      { id: 'x', title: 'Example', color: 'bg-gray-500', duration: 30, isExample: true },
    ],
    cardBg: '', darkMode: false, textPrimary: '', textSecondary: '',
    formatTime: (time) => `at ${time}`,
    undeleteTask: vi.fn(), emptyRecycleBin: vi.fn(), deleteFromBin: vi.fn(),
  };
  sync = { showMobileRecycleBin: true, setShowMobileRecycleBin: vi.fn() };
});

describe('RecycleBinSheet', () => {
  it('renders nothing while closed', () => {
    sync.showMobileRecycleBin = false;
    expect(html('phone')).toBe('');
  });

  it('lists the deleted tasks, not the examples, with where and how long', () => {
    const out = html('phone');
    expect(out).toContain('Write report');
    expect(out).toContain('at 09:00 • 5h 8m');
    expect(out).toContain('Inbox • 30 min');
    expect(out).not.toContain('Example');
    expect(out).toMatch(/Recycle Bin<\/span><span[^>]*>2<\/span>/);
  });

  // The desktop copy this replaced still wrote "308min".
  it.each(['phone', 'desktop'])('writes an hour or more as hours and minutes on the %s', (variant) => {
    expect(html(variant)).toContain('5h 8m');
    expect(html(variant)).not.toContain('308');
  });

  it('gives each task a way back and a way out, both named', () => {
    const out = html('desktop');
    expect(out.match(/data-recycle-bin-restore/g)).toHaveLength(2);
    expect(out.match(/data-recycle-bin-delete/g)).toHaveLength(2);
    expect(out.match(/aria-label="Delete permanently"/g)).toHaveLength(2);
    expect(out.match(/aria-label="Restore"/g)).toHaveLength(2);
  });

  it('deletes the task whose button was pressed, and leaves the sheet open for the rest', () => {
    const root = mount('desktop');
    act(() => { button(root, 'b', 'data-recycle-bin-delete').props.onClick(); });
    expect(planner.deleteFromBin).toHaveBeenCalledTimes(1);
    expect(planner.deleteFromBin).toHaveBeenCalledWith('b');
    expect(planner.undeleteTask).not.toHaveBeenCalled();
    expect(planner.emptyRecycleBin).not.toHaveBeenCalled();
    expect(sync.setShowMobileRecycleBin).not.toHaveBeenCalled();
  });

  it('restores the task whose button was pressed', () => {
    const root = mount('phone');
    act(() => { button(root, 'a', 'data-recycle-bin-restore').props.onClick(); });
    expect(planner.undeleteTask).toHaveBeenCalledWith('a');
    expect(planner.deleteFromBin).not.toHaveBeenCalled();
  });

  it.each(['data-recycle-bin-delete', 'data-recycle-bin-restore'])('closes when the last task leaves (%s)', (attr) => {
    planner.recycleBin = planner.recycleBin.filter((task) => task.id !== 'b');
    const root = mount('phone');
    act(() => { button(root, 'a', attr).props.onClick(); });
    expect(sync.setShowMobileRecycleBin).toHaveBeenCalledWith(false);
  });

  it('says so when the bin is empty, and offers nothing to empty', () => {
    planner.recycleBin = [];
    const out = html('phone');
    expect(out).toContain('Recycle bin is empty');
    expect(out).not.toContain('data-recycle-bin-empty');
  });

  it('sits at the bottom left, 320px wide, on the desktop and full width on the phone', () => {
    expect(html('desktop')).toMatch(/data-recycle-bin-sheet="desktop" class="[^"]*items-start/);
    expect(html('desktop')).toContain('width:320px');
    expect(html('phone')).not.toContain('width:320px');
    expect(html('phone')).toContain('safe-area-inset-bottom');
  });
});

// One sheet, two homes: neither may grow its own copy of the list again.
describe('where the bin is rendered', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  it.each([
    ['../App.jsx', '<RecycleBinSheet variant="desktop" />'],
    ['./MobileBottomSheets.jsx', '<RecycleBinSheet variant="phone" />'],
  ])('%s uses the shared sheet', (path, tag) => {
    const source = read(path);
    expect(source).toContain(tag);
    expect(source).not.toContain('undeleteTask(');
    expect(source).not.toContain("t('app.recycleBinEmpty')");
  });

  it('App offers the undo for a per-task delete in the toast', () => {
    expect(read('../App.jsx')).toMatch(/onDeleted: \(said\) => setUndoToast\(\{ message: said \?\? t\('app\.deleteForever'\), actionable: true \}\)/);
  });

  it('App hands deleteFromBin to the planner context', () => {
    const source = read('../App.jsx');
    expect(source).toMatch(/confirmEmptyBin,\s*deleteFromBin,\s*\} = useRecycleBin\(/);
    expect(source).toMatch(/confirmEmptyBin, emptyRecycleBin, deleteFromBin,/);
  });
});
