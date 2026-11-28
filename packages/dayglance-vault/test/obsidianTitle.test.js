// The Obsidian title carry (src/obsidianTitle.js): a copy holding the text of
// a damaged vault line never replaces a clean title elsewhere (2026-11-28: a
// device without the damaged-line guard took `ZZ tick test five ^dg-abcd1234
// extra` from the line, stamped it, and its newer copy won on every device).
import { describe, expect, it } from 'vitest';
import { carriedObsidianTitle, carriesStrayBlockToken } from '../src/obsidianTitle.js';
import { applyRemoteEntity, makeEntityId } from '../src/adapter.js';

const CLEAN = 'ZZ tick test five';
const DAMAGED = 'ZZ tick test five ^dg-abcd1234 extra';
const row = (raw, extra = {}) => ({
  id: 'obsidian-dg-brm75m7z', importSource: 'obsidian', obsidianBlockId: 'brm75m7z',
  title: `${raw} #obsidian`, obsidianRawTitle: raw, completed: true, ...extra,
});

describe('carriesStrayBlockToken', () => {
  it('is a title with our marker left inside it', () => {
    expect(carriesStrayBlockToken(DAMAGED)).toBe(true);
    expect(carriesStrayBlockToken(CLEAN)).toBe(false);
    expect(carriesStrayBlockToken(undefined)).toBe(false);
  });
});

describe('carriedObsidianTitle', () => {
  it('a damaged winner takes the clean copy\'s title and raw title', () => {
    expect(carriedObsidianTitle(row(DAMAGED), row(CLEAN))).toEqual({ title: `${CLEAN} #obsidian`, obsidianRawTitle: CLEAN });
    expect(carriedObsidianTitle(row(DAMAGED), undefined, row(CLEAN))).toEqual({ title: `${CLEAN} #obsidian`, obsidianRawTitle: CLEAN });
  });

  it('decides each field on its own', () => {
    const rawOnly = { ...row(DAMAGED), title: `${CLEAN} #obsidian` };
    expect(carriedObsidianTitle(rawOnly, row('Older base'))).toEqual({ title: `${CLEAN} #obsidian`, obsidianRawTitle: 'Older base' });
  });

  it('never replaces a clean winner, so a real retitle propagates', () => {
    expect(carriedObsidianTitle(row('ZZ tick test six'), row(CLEAN))).toEqual({ title: 'ZZ tick test six #obsidian', obsidianRawTitle: 'ZZ tick test six' });
  });

  it('leaves two damaged copies, and tasks that are not Obsidian tasks, alone', () => {
    expect(carriedObsidianTitle(row(DAMAGED), row(`${DAMAGED} 2`))).toEqual({ title: `${DAMAGED} #obsidian`, obsidianRawTitle: DAMAGED });
    const plain = { id: 'a', title: 'Note ^dg-x' };
    expect(carriedObsidianTitle(plain, { id: 'a', title: 'Note' }).title).toBe('Note ^dg-x');
    expect(carriedObsidianTitle(row(DAMAGED), { ...row(CLEAN), importSource: undefined }).obsidianRawTitle).toBe(DAMAGED);
  });

  it('gives the clean text whichever copy wins, and again changes nothing', () => {
    const a = row(CLEAN);
    const b = row(DAMAGED);
    expect(carriedObsidianTitle(a, b)).toEqual(carriedObsidianTitle(b, a));
    const once = { ...b, ...carriedObsidianTitle(b, a) };
    expect(carriedObsidianTitle(once, a)).toEqual({ title: a.title, obsidianRawTitle: a.obsidianRawTitle });
  });
});

describe('the vault apply', () => {
  const pull = (data, value) => applyRemoteEntity(data, { entityId: makeEntityId('unscheduledTasks', value.id), _kind: 'unscheduledTasks', value });

  it('a newer damaged copy keeps the local clean title and is re-pushed', () => {
    const data = { unscheduledTasks: [row(CLEAN, { lastModified: '2026-11-28T16:07:13.000Z' })] };
    const repush = pull(data, row(DAMAGED, { lastModified: '2026-11-28T16:09:17.173Z' }));
    expect(data.unscheduledTasks[0]).toMatchObject({ title: `${CLEAN} #obsidian`, obsidianRawTitle: CLEAN, lastModified: '2026-11-28T16:09:17.173Z' });
    expect(repush).toEqual([makeEntityId('unscheduledTasks', 'obsidian-dg-brm75m7z')]);
  });

  it('a newer clean retitle wins, and nothing is re-pushed', () => {
    const data = { unscheduledTasks: [row(CLEAN, { lastModified: '2026-11-28T16:07:13.000Z' })] };
    const repush = pull(data, row('ZZ tick test six', { lastModified: '2026-11-28T16:10:00.000Z' }));
    expect(data.unscheduledTasks[0].obsidianRawTitle).toBe('ZZ tick test six');
    expect(repush).toEqual([]);
  });
});
