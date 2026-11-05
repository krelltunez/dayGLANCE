import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import GoalCard from './GoalCard.jsx';
import { GoalForm } from './GoalDashboard.jsx';
import EntityNotesBox from '../notes/EntityNotesBox.jsx';

// #2076: a goal's description is a notes box like the Project Planner's,
// on the goal's own card, and no longer a two-line field in the Edit Goal form.

let i18n;
beforeEach(async () => {
  if (i18n) return;
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const planner = (over = {}) => ({
  tasks: [], unscheduledTasks: [], recurringTasks: [], isMobile: false, isTablet: false, darkMode: false,
  use24HourClock: false, currentTime: new Date('2026-10-13T12:00:00'),
  cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
  ...over,
});
const wrap = (node, { plan = {}, sync = {} } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={planner(plan)}>
      <FeaturesContext.Provider value={{ updateGoal: vi.fn(), isVisibleForUser: () => true, areas: [], multiUserEnabled: false, users: [], goals: [], projects: [] }}>
        <SyncContext.Provider value={{ openInObsidian: vi.fn(), ...sync }}>
          {node}
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);
const card = (goal, opts) => wrap(<GoalCard goal={{ id: 'g1', title: 'Run a marathon', status: 'active', color: 'bg-blue-500', ...goal }} projects={[]} onEdit={vi.fn()} />, opts);

describe('the goal card\'s notes', () => {
  it('shows the description formatted, whole, and click-to-edit, not clamped to two lines of raw text', () => {
    const html = card({ description: '**Run** 3x a week\nLong run on Sunday' });
    expect(html).toContain('data-notes-preview');
    expect(html).toContain('<strong>Run</strong>');
    expect(html).toContain('Long run on Sunday');
    expect(html).toContain('max-h-[60vh]');
    expect(html).not.toContain('line-clamp-2');
    expect(html).not.toContain('<textarea');
  });

  it('offers a quiet prompt, not an open editor, when the goal has no notes', () => {
    const html = card({ description: '' });
    expect(html).toContain('data-notes-empty');
    expect(html).toContain('Add notes...');
    expect(html).not.toContain('<textarea');
  });

  it('reads a linked goal\'s notes from its note, with the card header naming the note once', () => {
    const html = card({ description: '', obsidianNotePath: 'Goals/Marathon.md' }, { sync: { loadNoteDescription: vi.fn(() => new Promise(() => {})) } });
    expect(html).toContain('data-notes-source="vault"');
    expect(html).toContain('Loading from the linked note');
    // The box drops its own label on the card: the header already shows the link.
    expect(html.match(/Marathon/g)).toHaveLength(1);
  });
});

describe('the goal form', () => {
  const form = (initial) => wrap(<GoalForm initial={initial} onSave={vi.fn()} onCancel={vi.fn()} />);

  it('no longer edits an existing goal\'s description', () => {
    const html = form({ id: 'g1', title: 'Run a marathon', description: 'Kept', status: 'active' });
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('Kept');
  });

  it('still takes a description for a new goal, in a box that grows and resizes', () => {
    const html = form(null);
    expect(html).toMatch(/<textarea[^>]*resize-y/);
    expect(html).not.toContain('resize-none');
  });
});

describe('the notes editor', () => {
  const editor = (isMobile) => wrap(<EntityNotesBox state={{
    notes: 'A long note', setNotes: vi.fn(), editing: true, setEditing: vi.fn(), vault: {}, vaultNotes: false, save: vi.fn(),
  }} />, { plan: { isMobile } });

  it('follows the #2067 height policy: capped at 60vh, drag-resizable on desktop only', () => {
    expect(editor(false)).toMatch(/<textarea[^>]*max-h-\[60vh\][^>]*resize-y/);
    expect(editor(true)).toMatch(/<textarea[^>]*resize-none/);
  });
});

describe('a linked note\'s section from the plugin\'s report (#2291)', () => {
  const box = (vault) => wrap(<EntityNotesBox state={{
    notes: vault.text ?? '', setNotes: vi.fn(), editing: false, setEditing: vi.fn(), save: vi.fn(),
    vault: { loading: false, unavailable: false, error: null, conflict: false, base: null, text: '', reportedAt: null, ...vault },
    vaultNotes: true, noteLink: { path: 'Goals/Marathon.md', name: 'Marathon' },
  }} />);

  it('says when Obsidian reported the text it shows', () => {
    const at = new Date(Date.now() - 2 * 3600_000).toISOString();
    const html = box({ text: 'From Obsidian', reportedAt: at });
    expect(html).toContain('From Obsidian');
    expect(html).toContain(`data-notes-reported="${at}"`);
    expect(html).toContain('As reported by Obsidian, 2 hours ago.');
  });

  it('says nothing of the kind for a section read from a file here', () => {
    expect(box({ text: 'From my copy' })).not.toContain('data-notes-reported');
  });

  it('a reported deletion is the not-found state; a note never reported keeps "lives in Obsidian"', () => {
    expect(box({ unavailable: true, error: 'not_found' })).toContain('data-notes-in-vault="missing"');
    const never = box({ unavailable: true, error: null });
    expect(never).toContain('Notes live in the linked note in Obsidian.');
    expect(never).not.toContain('data-notes-reported');
  });
});
