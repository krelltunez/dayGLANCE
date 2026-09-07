import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import {
  APPLICATION_MENU_LABEL_KEYS,
  buildApplicationMenuTemplate,
  isApplicationMenuLabels,
  supportsCustomApplicationMenu,
  type ApplicationMenuLabels,
} from './applicationMenu.js';

const labels = Object.fromEntries(
  APPLICATION_MENU_LABEL_KEYS.map((key) => [key, `translated:${key}`]),
) as ApplicationMenuLabels;

function submenu(template: MenuItemConstructorOptions[], index: number): MenuItemConstructorOptions[] {
  const items = template[index]?.submenu;
  if (!Array.isArray(items)) throw new Error(`Expected submenu at index ${index}`);
  return items;
}

function labelledRoles(items: MenuItemConstructorOptions[]): Array<[string | undefined, string | undefined]> {
  return items
    .filter((item) => item.type !== 'separator')
    .map((item) => [item.label, item.role]);
}

describe('application menu labels', () => {
  it('accepts a complete translated label set', () => {
    expect(isApplicationMenuLabels(labels)).toBe(true);
  });

  it('rejects missing or non-string labels from IPC', () => {
    expect(isApplicationMenuLabels({ ...labels, quit: undefined })).toBe(false);
    expect(isApplicationMenuLabels({ ...labels, quit: 42 })).toBe(false);
    expect(isApplicationMenuLabels(null)).toBe(false);
  });
});

describe('supportsCustomApplicationMenu', () => {
  it.each(['win32', 'linux'])('enables the translated menu on %s', (platform) => {
    expect(supportsCustomApplicationMenu(platform)).toBe(true);
  });

  it.each(['darwin', 'freebsd'])('keeps the native menu on %s', (platform) => {
    expect(supportsCustomApplicationMenu(platform)).toBe(false);
  });
});

describe('buildApplicationMenuTemplate', () => {
  it('maps translated labels to the complete menu roles', () => {
    const template = buildApplicationMenuTemplate(labels);

    expect(template.map((item) => item.label)).toEqual([
      'translated:file',
      'translated:edit',
      'translated:view',
      'translated:window',
    ]);
    expect(labelledRoles(submenu(template, 1))).toEqual([
      ['translated:undo', 'undo'],
      ['translated:redo', 'redo'],
      ['translated:cut', 'cut'],
      ['translated:copy', 'copy'],
      ['translated:paste', 'paste'],
      ['translated:delete', 'delete'],
      ['translated:selectAll', 'selectAll'],
    ]);
    expect(labelledRoles(submenu(template, 2))).toEqual([
      ['translated:reload', 'reload'],
      ['translated:forceReload', 'forceReload'],
      ['translated:toggleDevTools', 'toggleDevTools'],
      ['translated:resetZoom', 'resetZoom'],
      ['translated:zoomIn', 'zoomIn'],
      ['translated:zoomOut', 'zoomOut'],
      ['translated:toggleFullScreen', 'togglefullscreen'],
    ]);
    expect(labelledRoles(submenu(template, 3))).toEqual([
      ['translated:minimize', 'minimize'],
      ['translated:zoom', 'zoom'],
      ['translated:close', 'close'],
    ]);
  });

  it('uses Quit with Ctrl+Q while retaining Close in the Window menu', () => {
    const template = buildApplicationMenuTemplate(labels);
    expect(submenu(template, 0)[0]).toMatchObject({
      label: 'translated:quit',
      role: 'quit',
      accelerator: 'CommandOrControl+Q',
    });
    expect(submenu(template, 3).at(-1)).toMatchObject({
      label: 'translated:close',
      role: 'close',
    });
  });
});
