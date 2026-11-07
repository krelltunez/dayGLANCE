// The plugin's CSS is in styles.css, which Obsidian loads with the plugin
// (the community directory asks for that over <style> elements injected at
// runtime). The class names live in the code, so this pins the two together:
// a class renamed on one side only would silently stop hiding block ids or
// styling the agenda. Read as text, since CI does not install the plugin's
// CodeMirror dependencies that editorHiding.ts imports.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const css = read('../styles.css');

const constant = (source: string, name: string): string => {
  const m = new RegExp(`const ${name} = '([^']+)'`).exec(source);
  if (!m) throw new Error(`${name} not found`);
  return m[1];
};

describe('styles.css', () => {
  it('carries the editor-hiding rules for the classes editorHiding.ts applies', () => {
    const src = read('../src/editorHiding.ts');
    const hideIds = constant(src, 'BODY_HIDE_BLOCK_IDS');
    const hideDone = constant(src, 'BODY_HIDE_COMPLETED');
    const blockId = constant(src, 'BLOCK_ID_CLASS');
    const done = constant(src, 'DONE_LINE_CLASS');
    expect(css).toContain(`body.${hideIds} .markdown-source-view.is-live-preview .cm-line:not(.cm-active) .${blockId} { display: none; }`);
    expect(css).toContain(`body.${hideDone} .markdown-source-view.is-live-preview .cm-line.${done}:not(.cm-active) { display: none; }`);
    expect(css).toContain(`body.${hideDone} .markdown-reading-view li.task-list-item.${done} { display: none; }`);
  });

  it('styles exactly the agenda classes agendaView.ts uses', () => {
    const used = new Set(read('../src/agendaView.ts').match(/dg-agenda[a-z-]*/g));
    const styled = new Set([...css.matchAll(/\.(dg-agenda[a-z-]*)/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual([...styled].sort());
  });

  it('styles the pairing modal classes pairing.ts uses', () => {
    const src = read('../src/pairing.ts');
    for (const cls of ['dg-pairing-input', 'dg-pairing-button']) {
      expect(src).toContain(`'${cls}'`);
      expect(css).toContain(`.${cls} {`);
    }
  });

  it('styles the "Add to dayGLANCE" form\'s status line addTaskModal.ts uses', () => {
    const src = read('../src/addTaskModal.ts');
    expect(src).toContain("'dg-add-task-status'");
    expect(css).toContain('.dg-add-task-status {');
    expect(css).toContain('.dg-add-task-status.is-blocked {');
  });

  it('is the only stylesheet: no source file injects a <style> element', () => {
    for (const file of ['agendaView.ts', 'editorHiding.ts', 'main.ts', 'pairing.ts', 'settingsTab.ts', 'linkModal.ts', 'addTaskModal.ts']) {
      expect(read(`../src/${file}`)).not.toMatch(/createElement\(['"]style['"]\)|createEl\(['"]style['"]\)/);
    }
  });
});
