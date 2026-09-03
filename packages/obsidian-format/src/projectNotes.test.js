import { describe, it, expect } from 'vitest';
import {
  normalizeProjectNoteSettings, noteNameFromTitle, projectNotePath, uniqueNotePath, templateNeedsUser, renderNoteTemplateSubset,
} from './index.js';

describe('normalizeProjectNoteSettings / noteNameFromTitle', () => {
  it('defaults the layout and folders; makes any title portable', () => {
    expect(normalizeProjectNoteSettings(null)).toEqual({ layout: 'note', projectsFolder: 'Projects', goalsFolder: 'Goals', projectTemplate: '', goalTemplate: '' });
    expect(normalizeProjectNoteSettings({ layout: 'nested', projectsFolder: '/Work/Projects/', goalsFolder: '' }).projectsFolder).toBe('Work/Projects');
    expect(normalizeProjectNoteSettings({ layout: 'bogus' }).layout).toBe('note');
    expect(noteNameFromTitle('iOS App: v2 / launch?')).toBe('iOS App- v2 - launch-');
    expect(noteNameFromTitle('  ..hidden..  ')).toBe('hidden');
    expect(noteNameFromTitle('')).toBe('Untitled');
    expect(noteNameFromTitle('CON')).toBe('CON note');
  });
});

describe('projectNotePath (rulings D and E)', () => {
  it('note, folder, and nested layouts; a standalone project never nests', () => {
    expect(projectNotePath({ kind: 'project', title: 'House', layout: 'note' })).toBe('Projects/House.md');
    expect(projectNotePath({ kind: 'goal', title: 'Home', layout: 'note' })).toBe('Goals/Home.md');
    expect(projectNotePath({ kind: 'project', title: 'House', layout: 'folder' })).toBe('Projects/House/House.md');
    expect(projectNotePath({ kind: 'goal', title: 'dayGLANCE Development', layout: 'nested' })).toBe('Goals/dayGLANCE Development/dayGLANCE Development.md');
    expect(projectNotePath({ kind: 'project', title: 'iOS App', layout: 'nested', goalFolder: 'Goals/dayGLANCE Development' })).toBe('Goals/dayGLANCE Development/iOS App/iOS App.md');
    expect(projectNotePath({ kind: 'project', title: 'Loose', layout: 'nested' })).toBe('Projects/Loose/Loose.md');
    // The goal's folder is honored wherever the goal note actually lives.
    expect(projectNotePath({ kind: 'project', title: 'iOS App', layout: 'nested', goalFolder: 'Areas/Work/dayGLANCE' })).toBe('Areas/Work/dayGLANCE/iOS App/iOS App.md');
  });
  it('uniqueNotePath suffixes past taken paths', () => {
    const taken = new Set(['Projects/House.md', 'Projects/House 2.md']);
    expect(uniqueNotePath('Projects/House.md', (p) => taken.has(p))).toBe('Projects/House 3.md');
    expect(uniqueNotePath('Projects/Garden.md', (p) => taken.has(p))).toBe('Projects/Garden.md');
  });
});

describe('templates (the §4.4 ladder pieces)', () => {
  it('flags interactive templates and renders the subset, leaving everything else visible', () => {
    expect(templateNeedsUser('<% tp.system.prompt("x") %>')).toBe(true);
    expect(templateNeedsUser('<% tp.date.now() %>')).toBe(false);
    expect(renderNoteTemplateSubset('# {{title}}\nGoal: {{ goal }}\n{{date}} <% tp.date.now() %>', { title: 'House', date: '2026-09-03', goal: 'Home' }))
      .toBe('# House\nGoal: Home\n2026-09-03 <% tp.date.now() %>');
  });
});
