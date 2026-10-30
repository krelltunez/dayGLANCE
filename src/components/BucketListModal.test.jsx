import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { normalizeBucketConfig } from '../utils/bucketList.js';
import BucketListModal from './BucketListModal.jsx';

// The Bucket List's shared notes follow the #2067 height policy like every
// other notes box: the editor opens at the note's height (autoSizeTextarea),
// both states cap at 60vh, and neither is squashed by the scrolling column.
// Before this, a long note read fine and opened as a two-row editor.

let i18n;
beforeEach(async () => {
  if (i18n) return;
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const render = (notes, { isMobile = false } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={{
      isMobile, isTablet: false, darkMode: false,
      cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
      unscheduledTasks: [], setUnscheduledTasks: () => {}, reorderUnscheduledTasks: () => {},
      scheduleTaskAtNextSlot: () => {}, moveToRecycleBin: () => {}, openMobileEditTask: () => {},
      bucketConfig: normalizeBucketConfig({ notes }), updateBucketConfig: () => {}, setShowBucketList: () => {},
      pushUndo: () => {}, setUndoToast: () => {}, colors: [],
    }}>
      <FeaturesContext.Provider value={{ isVisibleForUser: () => true, multiUserEnabled: false }}>
        <BucketListModal />
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('the Bucket List notes', () => {
  it('shows a note as a capped preview that cannot be squashed', () => {
    const html = render('Line one\nLine two');
    expect(html).toMatch(/<button[^>]*data-bucket-notes-preview[^>]*flex-shrink-0[^>]*max-h-\[60vh\]/);
    expect(html).not.toContain('<textarea');
  });

  it('edits in a box that keeps its height in the column, capped at 60vh, drag-resizable on desktop only', () => {
    expect(render('')).toMatch(/<textarea[^>]*data-bucket-notes-editor[^>]*flex-shrink-0[^>]*max-h-\[60vh\][^>]*resize-y/);
    expect(render('', { isMobile: true })).toMatch(/<textarea[^>]*resize-none/);
  });
});

// #2263: a Bucket item has the app's task menu on right-click, as every other
// task surface does. Edit and Rename open the item's own editor (the inbox
// flavour), and Notes is left out: the editor is where an item's notes live.
describe('the Bucket List task menu', () => {
  const ITEM = { id: 'k1', title: 'Learn piano', bucketId: 'b1', completed: false };
  const mount = ({ isMobile = false } = {}) => {
    const setTaskContextMenu = vi.fn();
    const openMobileEditTask = vi.fn();
    let root;
    act(() => {
      root = create(
        <I18nextProvider i18n={i18n}>
          <DayPlannerContext.Provider value={{
            isMobile, isTablet: false, darkMode: false,
            cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
            unscheduledTasks: [ITEM], setUnscheduledTasks: () => {}, reorderUnscheduledTasks: () => {},
            scheduleTaskAtNextSlot: () => {}, moveToRecycleBin: () => {}, openMobileEditTask,
            bucketConfig: normalizeBucketConfig({ notes: 'x' }), updateBucketConfig: () => {}, setShowBucketList: () => {},
            setTaskContextMenu, pushUndo: () => {}, setUndoToast: () => {}, colors: [],
          }}>
            <FeaturesContext.Provider value={{ isVisibleForUser: () => true, multiUserEnabled: false }}>
              <BucketListModal />
            </FeaturesContext.Provider>
          </DayPlannerContext.Provider>
        </I18nextProvider>,
      );
    });
    const rows = root.root.findAll((node) => node.type === 'div' && typeof node.props.onContextMenu === 'function');
    return { rows, setTaskContextMenu, openMobileEditTask };
  };

  it('opens the menu on an item, and its Edit opens the item\'s editor', () => {
    const { rows, setTaskContextMenu, openMobileEditTask } = mount();
    expect(rows).toHaveLength(1);
    act(() => { rows[0].props.onContextMenu({ preventDefault() {}, clientX: 10, clientY: 20 }); });
    const menu = setTaskContextMenu.mock.calls[0][0];
    expect(menu).toMatchObject({ taskId: 'k1', x: 10, y: 20, hideNotes: true });
    expect(menu.inlineRename).toBeFalsy();
    act(() => { menu.onEdit(); });
    expect(openMobileEditTask).toHaveBeenCalledWith(ITEM, true);
  });

  it('leaves a long-press on touch to the drag', () => {
    expect(mount({ isMobile: true }).rows).toHaveLength(0);
  });
});
