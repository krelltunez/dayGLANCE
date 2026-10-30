import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// #2263: the task menu's Rename is inline only where the card it opened on
// draws its own rename field; anywhere else it opens the editor. A surface
// that claimed `inlineRename` without the field would leave an invisible
// rename open (the touch Inbox's double-click did exactly that). This pins
// each claim to the field that backs it, under the same gate.

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const sourceFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return sourceFiles(full);
  return /\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
});

// Who claims inline rename, with which gate, and the card that draws the field.
const CLAIMS = {
  'components/DayView.jsx': { gate: 'inlineRename: !isTablet', card: 'components/TimelineTaskCardContent.jsx', field: '!isTablet && editingTaskId === task.id' },
  'components/TimeGrid.jsx': { gate: 'inlineRename: !isTablet', card: 'components/TimelineTaskCardContent.jsx', field: '!isTablet && editingTaskId === task.id' },
  'components/CalendarHeader.jsx': { gate: 'inlineRename: !isTablet', card: 'components/AllDayTaskCard.jsx', field: '!isTablet && editingTaskId === task.id' },
  'components/DayViewAllDaySection.jsx': { gate: 'inlineRename: !isTablet', card: 'components/AllDayTaskCard.jsx', field: '!isTablet && editingTaskId === task.id' },
  'components/InboxTaskRow.jsx': { gate: 'inlineRename: true', card: 'components/InboxTaskRow.jsx', field: '{isEditing ? (' },
};

describe('inline rename from the task menu', () => {
  it('is claimed only by the surfaces listed here', () => {
    const root = new URL('.', import.meta.url).pathname;
    const claimants = sourceFiles(root)
      .filter((f) => /inlineRename:/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length).replace(/\\/g, '/'))
      .sort();
    expect(claimants).toEqual(Object.keys(CLAIMS).sort());
  });

  for (const [file, { gate, card, field }] of Object.entries(CLAIMS)) {
    it(`${file} claims it under the gate its card draws the field with`, () => {
      expect(read(`./${file}`)).toContain(gate);
      expect(read(`./${card}`)).toContain(field);
    });
  }

  it('the touch Inbox row, which draws no field, starts no rename', () => {
    expect(read('./components/TouchInboxTaskRow.jsx')).not.toMatch(/startEditingTask/);
  });
});

describe('the task menu on project rows (#2263)', () => {
  it('opens on every row and edits the project flavour, as the title does', () => {
    const src = read('./components/projects/ProjectCard.jsx');
    expect(src).toContain('onContextMenu={openRowMenu(task)}');
    expect(src).toContain('onEdit: () => openMobileEditTask?.(task, false)');
    expect(src).toContain('onClick={() => openMobileEditTask?.(task, false)}');
  });
});
