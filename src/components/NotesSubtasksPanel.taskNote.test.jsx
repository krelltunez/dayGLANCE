import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { noteTextHash } from '@glance-apps/obsidian-format';
import { loaders } from '../locales.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';

// A task's linked note on a device that may not read the vault folder
// (#2291 follow-up): the panel shows the note the Obsidian plugin reported,
// with its age, and saves it under the base of the text it showed; where
// the note cannot be shown it says why, case by case, instead of the blanket
// "not found". The loader is the hook's (loadTaskNote, asked for through
// onLoadWikiNote with { taskPanel: true }); here it is scripted.

let i18n;
let en;
beforeAll(async () => {
  en = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
});
beforeEach(() => {
  globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
  globalThis.document = { hasFocus: () => true, addEventListener: () => {}, removeEventListener: () => {} };
});
afterEach(() => { delete globalThis.requestAnimationFrame; delete globalThis.document; });

const noop = () => {};
const NOTE = 'Call the roofer.\n- [ ] Ask about gutters\n';
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function mount(loaded, { save = vi.fn(async () => ({ ok: true, mode: 'queued' })), openSettings = null, name = 'Gutter repair' } = {}) {
  const load = vi.fn(async () => loaded);
  const field = { value: '', selectionStart: 0, selectionEnd: 0, style: {}, focus: vi.fn(), setSelectionRange: vi.fn() };
  let root;
  await act(async () => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={openSettings ? { openSettings } : null}>
          <NotesSubtasksPanel
            task={{ id: 't', title: `Fix it [[${name}]]`, notes: '', subtasks: [] }} isInbox darkMode={false} noAutoFocus
            updateTaskNotes={noop} addSubtask={noop} toggleSubtask={noop} deleteSubtask={noop} updateSubtaskTitle={noop}
            wikilinks={[name]} onLoadWikiNote={load} onSaveWikiNote={save} onOpenInObsidian={noop}
          />
        </DayPlannerContext.Provider>
      </I18nextProvider>,
      { createNodeMock: (el) => (el.type === 'textarea' ? field : { style: {} }) },
    );
  });
  await flush();
  const json = () => JSON.stringify(root.toJSON());
  const find = (pred) => root.root.findAll(pred)[0];
  const unavailable = () => find((n) => n.props?.['data-linked-note-unavailable'] !== undefined);
  const editor = () => find((n) => n.type === 'textarea' && n.props['aria-label'] === `Edit “${name}”`);
  const open = () => act(() => { find((n) => n.type === 'div' && n.props.className?.includes('cursor-text') && n.props.onClick).props.onClick(); });
  const type = (value) => act(() => { editor().props.onChange({ target: { value } }); });
  const blur = () => act(async () => { editor().props.onBlur(); await new Promise((r) => setTimeout(r, 0)); });
  return { root, load, save, json, unavailable, editor, open, type, blur, find };
}
const textOf = (node) => (typeof node === 'string' ? node : (node?.children || []).map(textOf).join(''));

describe('the note from the plugin\'s report', () => {
  it('asks the task-note loader, shows the whole note and when Obsidian reported it', async () => {
    const reportedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const p = await mount({ text: NOTE, lastModified: reportedAt, observedAt: reportedAt, path: 'dayGLANCE/Gutter repair.md', source: 'report' });
    expect(p.load).toHaveBeenCalledWith('Gutter repair', { taskPanel: true });
    expect(p.json()).toContain('Call the roofer.');
    const age = p.find((n) => n.props?.['data-linked-note-reported'] !== undefined);
    expect(age.props['data-linked-note-reported']).toBe(reportedAt);
    expect(textOf(age)).toMatch(/^As reported by Obsidian, 5 minutes ago\.$/);
  });
  it('a note read from the folder has no age line', async () => {
    const p = await mount({ text: NOTE, lastModified: new Date().toISOString(), source: 'file' });
    expect(p.json()).toContain('Call the roofer.');
    expect(p.find((n) => n.props?.['data-linked-note-reported'] !== undefined)).toBeUndefined();
  });
  it('a save carries the base of the SHOWN text and asks for the task-note save; once sent, the age line goes', async () => {
    const reportedAt = new Date(Date.now() - 60_000).toISOString();
    const p = await mount({ text: NOTE, lastModified: reportedAt, observedAt: reportedAt, path: 'dayGLANCE/Gutter repair.md', source: 'report' });
    p.open();
    p.type(`${NOTE}Typed on the phone.`);
    await p.blur();
    expect(p.save).toHaveBeenCalledWith('Gutter repair', `${NOTE}Typed on the phone.`, { base: noteTextHash(NOTE), taskPanel: true });
    expect(p.find((n) => n.props?.['data-linked-note-reported'] !== undefined)).toBeUndefined();
  });
  it('a refusal reloads the newer reported text, keeps the typed text below it, and shows the newer report\'s age', async () => {
    const newer = new Date(Date.now() - 60_000).toISOString();
    const save = vi.fn(async () => ({ refused: 'changed', text: 'Edited in Obsidian.', lastModified: newer, source: 'report', observedAt: newer }));
    const p = await mount({ text: NOTE, lastModified: newer, observedAt: new Date(Date.now() - 3_600_000).toISOString(), path: 'x.md', source: 'report' }, { save });
    p.open();
    p.type('Mine.');
    await p.blur();
    expect(p.find((n) => n.props?.['data-linked-note-conflict'] !== undefined)).toBeDefined();
    expect(p.editor().props.value).toBe('Edited in Obsidian.\n\nMine.');
    expect(p.find((n) => n.props?.['data-linked-note-reported'] !== undefined).props['data-linked-note-reported']).toBe(newer);
  });
  it('an unsaved edit of a reported note is flushed on close under the shown text\'s base; a folder note flushes as before', async () => {
    const p = await mount({ text: NOTE, lastModified: null, observedAt: new Date().toISOString(), path: 'x.md', source: 'report' });
    p.open();
    p.type('Half typed.');
    act(() => p.root.unmount());
    expect(p.save).toHaveBeenLastCalledWith('Gutter repair', 'Half typed.', { base: noteTextHash(NOTE), taskPanel: true });
    const f = await mount({ text: NOTE, lastModified: null, source: 'file' });
    f.open();
    f.type('Half typed.');
    act(() => f.root.unmount());
    expect(f.save).toHaveBeenLastCalledWith('Gutter repair', 'Half typed.');
  });
});

describe('when the note cannot be shown: why', () => {
  const message = (p) => textOf(p.unavailable());
  it('NOT SET UP (no folder, no paired vault): says so, with the way to the integration settings', async () => {
    const openSettings = vi.fn();
    const p = await mount({ unavailable: 'not_set_up' }, { openSettings });
    expect(p.unavailable().props['data-linked-note-unavailable']).toBe('not_set_up');
    expect(message(p)).toContain(en.task.wikiNoteNotSetUp);
    const button = p.find((n) => n.props?.['data-linked-note-settings'] !== undefined);
    act(() => button.props.onClick({ stopPropagation: noop }));
    expect(openSettings).toHaveBeenCalledWith('integrations', 'obsidian');
    expect(p.editor()).toBeUndefined();
    // Outside a planner (no route to settings): the message alone.
    const bare = await mount({ unavailable: 'not_set_up' });
    expect(bare.find((n) => n.props?.['data-linked-note-settings'] !== undefined)).toBeUndefined();
  });
  it('NOT SHARED: this device cannot read the folder and the plugin does not share the note; the new-notes folder hint when it applies', async () => {
    const p = await mount({ unavailable: 'not_shared', newNotesFolderOutsideScope: true, newNotesFolder: 'dayGLANCE' });
    expect(message(p)).toContain(en.task.wikiNoteNotShared);
    expect(message(p)).toContain('Notes dayGLANCE creates go in the "dayGLANCE" folder');
    // "Open in Obsidian" stays.
    expect(p.json()).toContain('Open in Obsidian');
    const plain = await mount({ unavailable: 'not_shared' });
    expect(plain.find((n) => n.props?.['data-linked-note-scope-hint'] !== undefined)).toBeUndefined();
  });
  it('AMBIGUOUS names the note and how to link it with its folder', async () => {
    const p = await mount({ unavailable: 'ambiguous' }, { name: 'Gutter repair#Quotes' });
    expect(message(p)).toContain('More than one note in your vault is named "Gutter repair"');
    expect(message(p)).toContain('[[Folder/Gutter repair]]');
  });
  it('DELETED and UNREACHABLE each say what happened', async () => {
    expect(message(await mount({ unavailable: 'deleted' }))).toBe(en.task.wikiNoteDeleted);
    expect(message(await mount({ unavailable: 'unreachable' }))).toBe(en.task.wikiNoteUnreachable);
  });
  it('A FOLDER whose read failed (or a loader that answers null): today\'s "not found", no editor', async () => {
    expect(message(await mount({ unavailable: 'read_failed' }))).toBe(en.task.wikiNoteNotFound);
    const p = await mount(null);
    expect(message(p)).toBe(en.task.wikiNoteNotFound);
    expect(p.editor()).toBeUndefined();
  });
  it('a reachable folder without the note keeps the create-on-type editor', async () => {
    const p = await mount({ notFound: true });
    expect(p.unavailable()).toBeUndefined();
    expect(p.editor()).toBeDefined();
  });
});
