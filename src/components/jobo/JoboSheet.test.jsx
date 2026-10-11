import { describe, expect, it } from 'vitest';
import { sheetHost } from './JoboSheet.jsx';

// The phone's JOBO sheets go inside the app shell, not on <body>: the shell
// is position: fixed, so it is a stacking context of its own, and a sheet on
// <body> at z-[60] covered every task form in it, z-[80] or not. A Check
// action that opens the form (Add follow-up, Schedule…, Make a task) then
// opened it behind the sheet.
describe('sheetHost', () => {
  const doc = (shell) => ({ body: { id: 'body' }, querySelector: (sel) => (sel === '.app-shell' ? shell : null) });

  // MUTATION: return doc.body and the form opens under the Check again.
  it('is the app shell when there is one', () => {
    const shell = { id: 'shell' };
    expect(sheetHost(doc(shell))).toBe(shell);
  });

  it('falls back to <body>, and to nothing without a document', () => {
    expect(sheetHost(doc(null))).toEqual({ id: 'body' });
    expect(sheetHost(null)).toBeNull();
  });
});
