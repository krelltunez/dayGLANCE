import type { MenuItemConstructorOptions } from 'electron';

export const APPLICATION_MENU_LABEL_KEYS = [
  'file',
  'edit',
  'view',
  'window',
  'quit',
  'close',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'delete',
  'selectAll',
  'reload',
  'forceReload',
  'toggleDevTools',
  'resetZoom',
  'zoomIn',
  'zoomOut',
  'toggleFullScreen',
  'minimize',
  'zoom',
] as const;

export type ApplicationMenuLabelKey = typeof APPLICATION_MENU_LABEL_KEYS[number];
export type ApplicationMenuLabels = Record<ApplicationMenuLabelKey, string>;

export function isApplicationMenuLabels(value: unknown): value is ApplicationMenuLabels {
  if (!value || typeof value !== 'object') return false;
  const labels = value as Record<string, unknown>;
  return APPLICATION_MENU_LABEL_KEYS.every((key) => typeof labels[key] === 'string');
}

export function supportsCustomApplicationMenu(platform: string): boolean {
  return platform === 'win32' || platform === 'linux';
}

export function buildApplicationMenuTemplate(text: ApplicationMenuLabels): MenuItemConstructorOptions[] {
  return [
    {
      label: text.file,
      submenu: [
        { label: text.quit, role: 'quit', accelerator: 'CommandOrControl+Q' },
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
