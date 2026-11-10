import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// #2367: every path that makes a task takes its length from the default
// task duration setting (utils/defaultTaskDuration.js), never a literal 30.
// A new path written the old way fails here.
//
// The `task.duration || 30` fallbacks that DRAW a task with no duration are
// not creation and stay: a scheduled task with no length is drawn as 30
// everywhere, and changing that would move existing tasks.

const SRC = new URL('..', import.meta.url).pathname;

// Not tasks: a JOBO Do is a record of work done, and the vectors/fixtures are test data.
const ALLOWED = new Set(['hooks/useJoboDoActions.js']);
const isData = (path) => /Vectors\.js$|\.fixture\.js$/.test(path);

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

describe('new tasks take the default duration (#2367)', () => {
  const files = sources(SRC).map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, 'utf8') }))
    .filter(({ rel }) => !ALLOWED.has(rel) && !isData(rel));

  it('no path that makes a task writes a literal 30', () => {
    const offenders = files.flatMap(({ rel, text }) => text.split('\n')
      .map((line, i) => ({ line, at: `${rel}:${i + 1}` }))
      .filter(({ line }) => /\bduration:\s*30\b/.test(line) || /\bparsed\.duration\s*\|\|\s*30\b/.test(line))
      .map(({ at }) => at));
    expect(offenders).toEqual([]);
  });

  it('the paths that make tasks read the setting', () => {
    const reading = new Set(files.filter(({ text }) => text.includes('readDefaultTaskDuration(')).map(({ rel }) => rel));
    for (const rel of [
      'App.jsx', 'hooks/useTaskActions.js', 'hooks/useNewTaskInput.js', 'hooks/useDragDrop.js',
      'hooks/useKeyboardShortcuts.js', 'hooks/useVoiceInput.js', 'components/DayView.jsx',
      'components/sched/useSchedAgendaState.js', 'components/TrayHeader.jsx', 'components/BucketListModal.jsx',
      'jobo/carryForwardActions.js',
    ]) expect(reading, rel).toContain(rel);
  });
});
