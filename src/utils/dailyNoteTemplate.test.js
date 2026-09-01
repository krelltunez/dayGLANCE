import { describe, expect, it, vi } from 'vitest';
import {
  ENGLISH_DAILY_NOTE_TEMPLATE,
  buildLocalizedDailyNoteTemplate,
  localizeDefaultDailyNoteTemplate,
  localizeEmptyDailyNote,
} from './dailyNoteTemplate.js';

describe('daily note template localization', () => {
  it('builds the default Markdown headings from the active locale', () => {
    const translations = {
      'dailyNotes.quickNotes': '快速笔记',
      'dailyNotes.thoughts': '想法',
      'dailyNotes.accomplished': '已完成',
      'dailyNotes.tasks': '任务',
    };
    const translate = vi.fn((key) => translations[key]);

    expect(buildLocalizedDailyNoteTemplate(translate)).toBe(
      '## 快速笔记\n## 想法\n## 已完成\n## 任务\n',
    );
  });

  it('migrates the original English default and the previous locale default', () => {
    const chinese = '## 快速笔记\n## 想法\n## 已完成\n## 任务\n';
    const german = '## Kurznotizen\n## Gedanken\n## Erledigt\n## Aufgaben\n';

    expect(localizeDefaultDailyNoteTemplate(ENGLISH_DAILY_NOTE_TEMPLATE, ENGLISH_DAILY_NOTE_TEMPLATE, chinese)).toBe(chinese);
    expect(localizeDefaultDailyNoteTemplate(chinese, chinese, german)).toBe(german);
  });

  it('preserves a user-customized template', () => {
    const custom = '## 我的固定模板\n';
    expect(localizeDefaultDailyNoteTemplate(custom, ENGLISH_DAILY_NOTE_TEMPLATE, '## 快速笔记\n')).toBe(custom);
  });

  it('localizes an existing untouched English note without rewriting user content', () => {
    const chinese = '## 快速笔记\n## 想法\n## 已完成\n## 任务\n';

    expect(localizeEmptyDailyNote(ENGLISH_DAILY_NOTE_TEMPLATE, chinese)).toBe(chinese);
    expect(localizeEmptyDailyNote(`${ENGLISH_DAILY_NOTE_TEMPLATE}My note`, chinese)).toBe(
      `${ENGLISH_DAILY_NOTE_TEMPLATE}My note`,
    );
  });
});
