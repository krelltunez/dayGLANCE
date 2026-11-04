// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { noteTextHash, extractNoteDescription } from './noteDescription.js';
import { normalizeNotePath } from './identity.js';
import { sealBridgeEnvelope, encodePlainBridgeRow, observationEntityId, BRIDGE_PAIRING_META_ID, linkObservationEntityId } from './bridgeStream.js';
import { deriveBridgeSubkey } from './bridgePairing.js';
import {
  latestNoteObservation, noteDescriptionFromObservations, openNoteObservations, bridgeNoteDescriptionLoader,
} from './noteObservations.js';

// A linked note's description from the observation stream (#2280, #2291):
// the reader a host with no vault folder injects into the goal tree read.

const NOTE = '---\ndayglance-id: p1\n---\n# House\n\nKeep the roof dry.\n\n## Tasks\n- [ ] Gutters\n';
const obs = (fields) => ({ v: 1, kind: 'observation', path: 'Projects/House.md', mtime: null, ...fields });

describe('noteDescriptionFromObservations', () => {
  it('reads the opening section and hashes it as the app does', () => {
    const r = noteDescriptionFromObservations([obs({ content: NOTE, observedAt: '2026-10-21T10:00:00.000Z', mtime: Date.parse('2026-10-21T09:59:00.000Z') })], 'Projects/House.md');
    // The app's loader (src/hooks/useObsidianSync.js, loadNoteDescription):
    // text = extractNoteDescription(note.text), base = noteTextHash(text).
    const text = extractNoteDescription(NOTE);
    expect(text).toBe('Keep the roof dry.');
    expect(r).toEqual({ text, base: noteTextHash(text), observedAt: '2026-10-21T10:00:00.000Z', lastModified: '2026-10-21T09:59:00.000Z' });
  });

  it('the latest observation wins, by observedAt and not by arrival; on a tie the later one', () => {
    const v = (n, at) => obs({ content: `# House\n\nVersion ${n}.\n`, observedAt: at });
    const list = [v(2, '2026-10-21T12:00:00.000Z'), v(3, '2026-10-21T13:00:00.000Z'), v(1, '2026-10-21T11:00:00.000Z')];
    expect(noteDescriptionFromObservations(list, 'Projects/House.md').text).toBe('Version 3.');
    const tie = [v(4, '2026-10-21T14:00:00.000Z'), v(5, '2026-10-21T14:00:00.000Z')];
    expect(noteDescriptionFromObservations(tie, 'Projects/House.md').text).toBe('Version 5.');
    // Another note's newer report does not count.
    const other = obs({ path: 'Projects/Shed.md', content: '# Shed\n\nNot this.\n', observedAt: '2026-10-22T00:00:00.000Z' });
    expect(noteDescriptionFromObservations([...list, other], 'Projects/House.md').text).toBe('Version 3.');
  });

  it('a deletion or a withdrawal after the content is not found; content after them is found again', () => {
    const content = obs({ content: NOTE, observedAt: '2026-10-21T10:00:00.000Z' });
    const deleted = obs({ content: null, deleted: true, observedAt: '2026-10-21T11:00:00.000Z' });
    const withdrawn = { v: 1, kind: 'observation', path: 'Projects/House.md', withdrawn: true, observedAt: '2026-10-21T11:00:00.000Z' };
    expect(noteDescriptionFromObservations([content, deleted], 'Projects/House.md')).toEqual({ notFound: true });
    expect(noteDescriptionFromObservations([content, withdrawn], 'Projects/House.md')).toEqual({ notFound: true });
    const back = obs({ content: '# House\n\nBack.\n', observedAt: '2026-10-21T12:00:00.000Z' });
    expect(noteDescriptionFromObservations([content, deleted, back], 'Projects/House.md').text).toBe('Back.');
    // An older deletion does not hide newer content.
    expect(noteDescriptionFromObservations([back, deleted], 'Projects/House.md').text).toBe('Back.');
  });

  it('no observation of the path is no information (null), never not found', () => {
    expect(noteDescriptionFromObservations([], 'Projects/House.md')).toBeNull();
    expect(noteDescriptionFromObservations([obs({ path: 'Projects/Shed.md', content: NOTE })], 'Projects/House.md')).toBeNull();
    // A link observation names a path but reports a link, not the note.
    const link = { v: 1, kind: 'observation', link: true, targetId: 'p1', path: 'Projects/House.md', observedAt: '2026-10-21T10:00:00.000Z' };
    expect(latestNoteObservation([link], 'Projects/House.md')).toBeNull();
    expect(noteDescriptionFromObservations([link], 'Projects/House.md')).toBeNull();
    expect(noteDescriptionFromObservations([obs({ content: NOTE })], '')).toBeNull();
  });

  it('normalizes the path the way the app\'s loader does: wikilink brackets, a heading, a missing .md, slashes', () => {
    const list = [obs({ content: NOTE, observedAt: '2026-10-21T10:00:00.000Z' })];
    for (const ref of ['Projects/House.md', 'Projects/House', '[[Projects/House]]', '[[Projects/House#Tasks]]', ' Projects/House.md ', '/Projects/House.md', 'Projects\\House.md']) {
      expect(normalizeNotePath(ref), ref).toBe('Projects/House.md');
      expect(noteDescriptionFromObservations(list, ref), ref).toMatchObject({ text: 'Keep the roof dry.' });
    }
    // and on the observation's side too
    expect(noteDescriptionFromObservations([obs({ path: 'Projects\\House.md', content: NOTE })], 'Projects/House')).toMatchObject({ text: 'Keep the roof dry.' });
    // A different note is a different note: no basename matching.
    expect(noteDescriptionFromObservations(list, 'Archive/House.md')).toBeNull();
  });
});

describe('the stream-backed loader', () => {
  const rootKey = () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(9), 'HKDF', false, ['deriveKey']);
  const SALT = new Uint8Array(16).fill(3);
  const saltB64 = btoa(String.fromCharCode(...SALT));
  const row = async (subkey, payload, entityId) => ({
    entityId: entityId ?? await observationEntityId(payload.path),
    envelope: await sealBridgeEnvelope(subkey, payload, 'gen-1'),
    seq: 1,
    deleted: false,
  });
  const metaRow = { entityId: BRIDGE_PAIRING_META_ID, envelope: encodePlainBridgeRow({ v: 1, kind: 'pairing-meta', generation: 'gen-1', pairingSalt: saltB64 }), deleted: false };

  it('derives the subkey from the root key and the pairing salt, opens the observations, and answers per path', async () => {
    const subkey = await deriveBridgeSubkey(await rootKey(), SALT);
    const rows = [
      metaRow,
      await row(subkey, obs({ content: NOTE, observedAt: '2026-10-21T10:00:00.000Z' })),
      await row(subkey, obs({ path: 'Goals/Home.md', content: null, deleted: true, observedAt: '2026-10-21T10:00:00.000Z' })),
      await row(subkey, { v: 1, kind: 'observation', link: true, targetId: 'p1', path: 'Projects/House.md', observedAt: '2026-10-21T10:00:00.000Z' }, linkObservationEntityId('p1')),
      { entityId: 'obs:gone', envelope: null, deleted: true, seq: 2 },
      { entityId: 'int:abc', envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'intent', type: 'x' }), deleted: false },
    ];
    expect((await openNoteObservations(rows, subkey)).map((o) => o.path)).toEqual(['Projects/House.md', 'Goals/Home.md', 'Projects/House.md']);
    const load = await bridgeNoteDescriptionLoader(rows, { rootKey: await rootKey() });
    expect(await load('Projects/House')).toMatchObject({ text: 'Keep the roof dry.', base: noteTextHash('Keep the roof dry.') });
    expect(await load('Goals/Home.md')).toEqual({ notFound: true });
    expect(await load('Elsewhere.md')).toBeNull();
    // A caller holding the subkey passes it.
    expect(await (await bridgeNoteDescriptionLoader(rows, { subkey }))('Projects/House.md')).toMatchObject({ text: 'Keep the roof dry.' });
  });

  it('reads nothing it cannot open: another pairing\'s rows, and an unpaired namespace', async () => {
    const stale = await deriveBridgeSubkey(await rootKey(), new Uint8Array(16).fill(8));
    const rows = [metaRow, await row(stale, obs({ content: NOTE, observedAt: '2026-10-21T10:00:00.000Z' }))];
    expect(await (await bridgeNoteDescriptionLoader(rows, { rootKey: await rootKey() }))('Projects/House.md')).toBeNull();
    const subkey = await deriveBridgeSubkey(await rootKey(), SALT);
    const unpaired = [await row(subkey, obs({ content: NOTE }))];
    expect(await (await bridgeNoteDescriptionLoader(unpaired, { rootKey: await rootKey() }))('Projects/House.md')).toBeNull();
    expect(await (await bridgeNoteDescriptionLoader([metaRow], {}))('Projects/House.md')).toBeNull();
  });
});
