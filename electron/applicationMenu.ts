import type { MenuItemConstructorOptions } from 'electron';

export type MenuLanguage = 'en' | 'zh-CN';

const labels = {
  en: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    close: 'Close',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    delete: 'Delete',
    selectAll: 'Select All',
    reload: 'Reload',
    forceReload: 'Force Reload',
    toggleDevTools: 'Toggle Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    toggleFullScreen: 'Toggle Full Screen',
    minimize: 'Minimize',
    zoom: 'Zoom',
  },
  'zh-CN': {
    file: '文件',
    edit: '编辑',
    view: '查看',
    window: '窗口',
    close: '关闭',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    delete: '删除',
    selectAll: '全选',
    reload: '重新加载',
    forceReload: '强制重新加载',
    toggleDevTools: '切换开发者工具',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    toggleFullScreen: '切换全屏',
    minimize: '最小化',
    zoom: '缩放',
  },
} as const;

export function normalizeMenuLanguage(language: string): MenuLanguage {
  return /^zh(?:[-_]|$)/i.test(language.trim()) ? 'zh-CN' : 'en';
}

export function buildApplicationMenuTemplate(language: string): MenuItemConstructorOptions[] {
  const text = labels[normalizeMenuLanguage(language)];

  return [
    {
      label: text.file,
      submenu: [
        { label: text.close, role: 'close' },
      ],
    },
    {
      label: text.edit,
      submenu: [
        { label: text.undo, role: 'undo' },
        { label: text.redo, role: 'redo' },
        { type: 'separator' },
        { label: text.cut, role: 'cut' },
        { label: text.copy, role: 'copy' },
        { label: text.paste, role: 'paste' },
        { label: text.delete, role: 'delete' },
        { type: 'separator' },
        { label: text.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: text.view,
      submenu: [
        { label: text.reload, role: 'reload' },
        { label: text.forceReload, role: 'forceReload' },
        { label: text.toggleDevTools, role: 'toggleDevTools' },
        { type: 'separator' },
        { label: text.resetZoom, role: 'resetZoom' },
        { label: text.zoomIn, role: 'zoomIn' },
        { label: text.zoomOut, role: 'zoomOut' },
        { type: 'separator' },
        { label: text.toggleFullScreen, role: 'togglefullscreen' },
      ],
    },
    {
      label: text.window,
      submenu: [
        { label: text.minimize, role: 'minimize' },
        { label: text.zoom, role: 'zoom' },
        { label: text.close, role: 'close' },
      ],
    },
  ];
}
