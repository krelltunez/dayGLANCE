import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
import { UNDO_LABELS, shortTitle, findTaskTitle, describeUndoLabel } from './undoLabels.js';

const LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk', 'zh-CN', 'zh-TW'];
const bundle = (lng) => JSON.parse(readFileSync(join(process.cwd(), 'public', 'locales', lng, 'translation.json'), 'utf8'));

let t;
beforeAll(async () => {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: bundle('en') } }, interpolation: { escapeValue: false } });
  t = i18n.t.bind(i18n);
});

describe('shortTitle', () => {
  it('quotes a title as plain text', () => {
    expect(shortTitle('Read [[Project brief]] #work')).toBe('Read Project brief');
    expect(shortTitle('Call [[people/Ana|Ana]]')).toBe('Call Ana');
  });

  it('cuts a long title to one line', () => {
    const quoted = shortTitle('Draft the quarterly report for the board and send it round');
    expect(quoted.length).toBeLessThanOrEqual(40);
    expect(quoted.endsWith('…')).toBe(true);
  });

  it('is empty for no title', () => {
    expect(shortTitle(undefined)).toBe('');
    expect(shortTitle('   ')).toBe('');
  });
});

describe('findTaskTitle', () => {
  const lists = {
    tasks: [{ id: 1, title: 'Scheduled one' }],
    unscheduledTasks: [{ id: 'inbox-1', title: 'In the Inbox' }],
    recycleBin: [{ id: 'gone', title: 'Binned' }],
    recurringTasks: [{ id: 'abc-123', title: 'Standup' }],
  };

  it('finds a task in any list the undo step covers', () => {
    expect(findTaskTitle(1, lists)).toBe('Scheduled one');
    expect(findTaskTitle('1', lists)).toBe('Scheduled one');
    expect(findTaskTitle('inbox-1', lists)).toBe('In the Inbox');
    expect(findTaskTitle('gone', lists)).toBe('Binned');
  });

  it('names a recurring occurrence by its series', () => {
    expect(findTaskTitle('recurring-abc-123-2026-10-15', lists)).toBe('Standup');
  });

  it('is empty when nothing has it', () => {
    expect(findTaskTitle('missing', lists)).toBe('');
    expect(findTaskTitle(undefined, lists)).toBe('');
  });
});

describe('describeUndoLabel', () => {
  const lists = { tasks: [{ id: 't1', title: 'Write report' }] };

  it('says what the step did, naming the task', () => {
    expect(describeUndoLabel(t, { key: 'completed', taskId: 't1' }, lists)).toBe('Completed "Write report"');
    expect(describeUndoLabel(t, { key: 'deadlinePostponed', taskId: 't1', date: 'Fri, Oct 16' }, lists))
      .toBe('Moved the deadline of "Write report" to Fri, Oct 16');
  });

  it('takes a title given outright over a lookup', () => {
    expect(describeUndoLabel(t, { key: 'frameSkipped', title: 'Deep work' }, lists)).toBe('Skipped the "Deep work" Frame for the day');
  });

  it('counts where the step moved several tasks', () => {
    expect(describeUndoLabel(t, { key: 'rescheduled', count: 1 }, lists)).toBe('Rescheduled 1 task');
    expect(describeUndoLabel(t, { key: 'rescheduled', count: 3 }, lists)).toBe('Rescheduled 3 tasks');
  });

  it('calls a task it cannot name "Untitled" rather than showing empty quotes', () => {
    expect(describeUndoLabel(t, { key: 'deleted', taskId: 'missing' }, lists)).toBe('Deleted "Untitled"');
  });

  it('says nothing for no label, an unknown key, or no t', () => {
    expect(describeUndoLabel(t, undefined, lists)).toBeNull();
    expect(describeUndoLabel(t, { key: 'nope' }, lists)).toBeNull();
    // An event handed to pushUndo by an onClick is not a label.
    expect(describeUndoLabel(t, { type: 'click', target: {} }, lists)).toBeNull();
    expect(describeUndoLabel(undefined, { key: 'completed', taskId: 't1' }, lists)).toBeNull();
  });
});

// Labels are looked up by key at run time, so locales.test.js's scan for
// literal t('…') calls cannot see them. This holds every label to a real
// entry in every language, with the same placeholders as English.
describe('undo strings in every language', () => {
  const placeholders = (text) => [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const en = bundle('en').undo;

  it.each(LANGUAGES)('%s has the wrappers and every label', (lng) => {
    const undo = bundle(lng).undo;
    expect(placeholders(undo.undone)).toEqual(['action']);
    expect(placeholders(undo.redone)).toEqual(['action']);
    expect(undo.untitled).toBeTruthy();
    expect(undo.nothingToUndo).toBeTruthy();
    expect(undo.nothingToRedo).toBeTruthy();
    for (const key of UNDO_LABELS) {
      const plural = `${key}_other` in en.action;
      const forms = plural ? Object.keys(en.action).filter((k) => k.startsWith(`${key}_`)) : [key];
      if (plural) expect(undo.action, `${lng} ${key}_other`).toHaveProperty(`${key}_other`);
      for (const form of forms) {
        const text = undo.action[form] ?? undo.action[`${key}_other`];
        expect(text, `${lng} undo.action.${form}`).toBeTruthy();
        expect(placeholders(text), `${lng} undo.action.${form}`).toEqual(placeholders(en.action[form]));
      }
    }
  });

  it('has no English label the code does not know', () => {
    const known = new Set(UNDO_LABELS);
    for (const key of Object.keys(en.action)) expect(known.has(key.replace(/_(one|other)$/, ''))).toBe(true);
  });
});
