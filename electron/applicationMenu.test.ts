import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { buildApplicationMenuTemplate, normalizeMenuLanguage } from './applicationMenu.js';

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

describe('normalizeMenuLanguage', () => {
  it.each(['zh', 'zh-CN', 'zh_CN', 'ZH-cn', 'zh-Hans-CN'])('normalizes %s to Simplified Chinese', (language) => {
    expect(normalizeMenuLanguage(language)).toBe('zh-CN');
  });

  it.each(['en', 'de-DE', 'pt-BR', ''])('falls back to English for %s', (language) => {
    expect(normalizeMenuLanguage(language)).toBe('en');
  });
});

describe('buildApplicationMenuTemplate', () => {
  it('builds the complete Simplified Chinese menu', () => {
    const template = buildApplicationMenuTemplate('zh-CN');

    expect(template.map((item) => item.label)).toEqual(['文件', '编辑', '查看', '窗口']);
    expect(labelledRoles(submenu(template, 0))).toEqual([
      ['关闭', 'close'],
    ]);
    expect(labelledRoles(submenu(template, 1))).toEqual([
      ['撤销', 'undo'],
      ['重做', 'redo'],
      ['剪切', 'cut'],
      ['复制', 'copy'],
      ['粘贴', 'paste'],
      ['删除', 'delete'],
      ['全选', 'selectAll'],
    ]);
    expect(labelledRoles(submenu(template, 2))).toEqual([
      ['重新加载', 'reload'],
      ['强制重新加载', 'forceReload'],
      ['切换开发者工具', 'toggleDevTools'],
      ['实际大小', 'resetZoom'],
      ['放大', 'zoomIn'],
      ['缩小', 'zoomOut'],
      ['切换全屏', 'togglefullscreen'],
    ]);
    expect(labelledRoles(submenu(template, 3))).toEqual([
      ['最小化', 'minimize'],
      ['缩放', 'zoom'],
      ['关闭', 'close'],
    ]);
  });

  it('builds English labels for any non-Chinese language', () => {
    const template = buildApplicationMenuTemplate('fr-FR');

    expect(template.map((item) => item.label)).toEqual(['File', 'Edit', 'View', 'Window']);
    expect(labelledRoles(submenu(template, 0))).toEqual([
      ['Close', 'close'],
    ]);
    expect(labelledRoles(submenu(template, 1))).toEqual([
      ['Undo', 'undo'],
      ['Redo', 'redo'],
      ['Cut', 'cut'],
      ['Copy', 'copy'],
      ['Paste', 'paste'],
      ['Delete', 'delete'],
      ['Select All', 'selectAll'],
    ]);
    expect(labelledRoles(submenu(template, 2))).toEqual([
      ['Reload', 'reload'],
      ['Force Reload', 'forceReload'],
      ['Toggle Developer Tools', 'toggleDevTools'],
      ['Actual Size', 'resetZoom'],
      ['Zoom In', 'zoomIn'],
      ['Zoom Out', 'zoomOut'],
      ['Toggle Full Screen', 'togglefullscreen'],
    ]);
    expect(labelledRoles(submenu(template, 3))).toEqual([
      ['Minimize', 'minimize'],
      ['Zoom', 'zoom'],
      ['Close', 'close'],
    ]);
  });
});
