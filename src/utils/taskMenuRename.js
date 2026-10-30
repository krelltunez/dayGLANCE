// The task menu's Rename (#2263): one way to rename a task that works on every
// surface the menu opens on. A card that draws its own rename field says so
// with `inlineRename` on the menu, and the title is renamed in place there.
// Anywhere else the editor opens, as Edit opens it (a surface's own `onEdit`
// included), with the title selected, so typing replaces it.
//
// Pure apart from the callbacks, so the routing is tested without mounting App.

/**
 * @param {object} menu  the taskContextMenu state ({ inlineRename, onEdit, ... })
 * @param {{ task: object, isInbox: boolean, startEditingTask: Function,
 *   openEditor: Function, selectEditorTitle: Function }} deps
 * @returns {'inline'|'editor'|null} which way it went
 */
export function renameFromMenu(menu, { task, isInbox, startEditingTask, openEditor, selectEditorTitle }) {
  if (!menu || !task || task.imported) return null;
  if (menu.inlineRename) {
    startEditingTask(task, isInbox);
    return 'inline';
  }
  if (menu.onEdit) menu.onEdit();
  else openEditor(task, isInbox);
  selectEditorTitle();
  return 'editor';
}

/**
 * Focus the editor's title and select it, once the editor has mounted. The
 * phone editor does not focus its title when it opens for an edit, so this
 * focuses it as well as selecting.
 */
export function selectTitleWhenReady(inputRef, raf = globalThis.requestAnimationFrame) {
  if (typeof raf !== 'function') return;
  raf(() => {
    const input = inputRef?.current;
    if (!input) return;
    input.focus?.();
    input.select?.();
  });
}
