import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The Daily Notes modal is twice as wide from the app's 1600px breakpoint
// up, and unchanged below it (a tablet in portrait keeps max-w-lg).
describe('Daily Notes modal width', () => {
  it('doubles at 1600px and above, and only there', () => {
    const source = readFileSync(new URL('./DailyNotesModal.jsx', import.meta.url), 'utf8');
    expect(source).toContain('w-full max-w-lg min-[1600px]:max-w-5xl mx-4');
  });
});
