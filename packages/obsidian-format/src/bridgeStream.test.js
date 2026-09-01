import { describe, it, expect } from 'vitest';
import {
  sealBridgeEnvelope,
  openBridgeEnvelope,
  encodePlainBridgeRow,
  decodePlainBridgeRow,
  applyBridgeIntent,
  mintIntentId,
  observationEntityId,
  BRIDGE_INTENT_PREFIX,
  BRIDGE_OBSERVATION_PREFIX,
} from './bridgeStream.js';

// The stream's load-bearing claims: envelopes round-trip and fail closed;
// applyBridgeIntent is PURE and IDEMPOTENT per type (idempotent replay is
// the crash story — a re-applied batch must be a no-op); appends dedupe by
// block id; unknown types are skipped, not failed.

const subkey = () => crypto.subtle.importKey(
  'raw', new Uint8Array(32).fill(3), 'AES-GCM', false, ['encrypt', 'decrypt'],
);
const otherKey = () => crypto.subtle.importKey(
  'raw', new Uint8Array(32).fill(4), 'AES-GCM', false, ['encrypt', 'decrypt'],
);

// THE SERVER'S ENVELOPE SEMANTICS, emulated exactly: GLANCEvault decodes
// the wire envelope with Buffer.from(s, 'base64'), stores the bytes, and
// serves them back with .toString('base64'). A non-base64 envelope is not
// rejected — it is silently shredded. Every wire string this module emits
// must survive this round trip byte-exactly.
const serverRoundTrip = (envelope) => Buffer.from(envelope, 'base64').toString('base64');

describe('row envelopes', () => {
  it('round-trip; wrong key, tampered, and malformed are ALL null (rotation makes old rows unreadable)', async () => {
    const key = await subkey();
    const sealed = await sealBridgeEnvelope(key, { kind: 'intent', type: 'daily_note_write' });
    expect(sealed).not.toContain('daily_note_write');
    expect(await openBridgeEnvelope(key, sealed)).toEqual({ kind: 'intent', type: 'daily_note_write' });
    expect(await openBridgeEnvelope(await otherKey(), sealed)).toBe(null);
    expect(await openBridgeEnvelope(key, sealed.slice(0, -8) + 'AAAAAAAA')).toBe(null);
    expect(await openBridgeEnvelope(key, 'junk')).toBe(null);
  });

  it('every wire string SURVIVES the server (base64 bytes in, base64 bytes out) — the regression that shipped as raw JSON', async () => {
    const key = await subkey();
    const sealed = await sealBridgeEnvelope(key, { kind: 'observation', path: 'a.md', content: 'body' });
    // Byte-exact through the server's Buffer round trip, and still opens.
    expect(serverRoundTrip(sealed)).toBe(sealed);
    expect(await openBridgeEnvelope(key, serverRoundTrip(sealed))).toMatchObject({ path: 'a.md' });
    // The plaintext meta row rides the same wire and must survive it too.
    const meta = encodePlainBridgeRow({ v: 1, kind: 'pairing-meta', generation: 'g', pairingSalt: 's' });
    expect(serverRoundTrip(meta)).toBe(meta);
    expect(decodePlainBridgeRow(serverRoundTrip(meta))).toMatchObject({ kind: 'pairing-meta' });
    expect(decodePlainBridgeRow('not base64 json {')).toBe(null);
    // The OLD wire format (raw JSON) does NOT survive — pinned so nobody
    // reintroduces it: the server mangles it rather than rejecting it.
    expect(serverRoundTrip('{"v":1,"iv":"aa","ct":"bb"}')).not.toBe('{"v":1,"iv":"aa","ct":"bb"}');
  });

  it('a whole-note-sized payload seals without blowing the argument limit (chunked base64)', async () => {
    const key = await subkey();
    const big = { kind: 'observation', path: 'big.md', content: 'x'.repeat(300_000) };
    const sealed = await sealBridgeEnvelope(key, big);
    expect(serverRoundTrip(sealed)).toBe(sealed);
    expect(await openBridgeEnvelope(key, sealed)).toEqual(big);
  });

  it('ids: intent ids are unique; observation ids are stable per path and prefixed', async () => {
    expect(mintIntentId()).not.toBe(mintIntentId());
    expect(BRIDGE_INTENT_PREFIX).toBe('int:');
    const a = await observationEntityId('Daily/2026-08-29.md');
    expect(a).toBe(await observationEntityId('Daily/2026-08-29.md'));
    expect(a).not.toBe(await observationEntityId('Daily/2026-08-30.md'));
    expect(a.startsWith(BRIDGE_OBSERVATION_PREFIX)).toBe(true);
  });
});

describe('applyBridgeIntent — task_state / task_retitle', () => {
  const NOTE = '# Day\n\n## Tasks\n- [ ] 09:00 Write report ^dg-abc12345\n- [ ] Other\n';
  const stateIntent = {
    type: 'task_state', path: '2026-08-29.md', date: '2026-08-29',
    obsidianRawTitle: 'Write report', completed: true, startTime: '09:00',
    duration: null, taskHeading: '## Tasks', blockId: 'abc12345',
    completedAt: null, completionFormat: null,
  };

  it('applies, and re-applying the SAME intent to its own output changes nothing', () => {
    const first = applyBridgeIntent(NOTE, stateIntent);
    expect(first.changed).toBe(true);
    expect(first.text).toContain('- [x] 09:00 Write report ^dg-abc12345');
    const replay = applyBridgeIntent(first.text, stateIntent);
    expect(replay.changed).toBe(false);
    expect(replay.text).toBe(first.text);
  });

  it('missing file is the benign no-op; a vanished line is too', () => {
    expect(applyBridgeIntent(null, stateIntent)).toEqual({ text: null, changed: false });
    const gone = applyBridgeIntent('# Day\n\n## Tasks\n- [ ] Other\n', stateIntent);
    expect(gone.changed).toBe(false);
  });

  it('task_retitle rewrites the line and carries the state in the same intent', () => {
    const out = applyBridgeIntent(NOTE, {
      ...stateIntent, type: 'task_retitle', newRawTitle: 'Write the report',
    });
    expect(out.changed).toBe(true);
    expect(out.text).toContain('- [x] 09:00 Write the report ^dg-abc12345');
    expect(out.text).not.toContain('Write report ^');
    const replay = applyBridgeIntent(out.text, { ...stateIntent, type: 'task_retitle', newRawTitle: 'Write the report' });
    expect(replay.changed).toBe(false);
  });
});

describe('applyBridgeIntent — task_append', () => {
  const appendIntent = {
    type: 'task_append', path: '2026-08-29.md', date: '2026-08-29',
    task: { title: 'New thing #obsidian', startTime: null, duration: null, isAllDay: true, date: '2026-08-29', blockId: 'def67890' },
    heading: '## Tasks', template: '# My day\n',
  };

  it('creates the note from the template with creation frontmatter when absent', () => {
    const out = applyBridgeIntent(null, appendIntent);
    expect(out.changed).toBe(true);
    expect(out.text.startsWith('---\n')).toBe(true); // creation frontmatter
    expect(out.text).toContain('# My day');
    expect(out.text).toContain('- [ ] New thing #obsidian ^dg-def67890');
    expect(out.text).toContain('## Tasks');
  });

  it('inserts under an existing heading; REPLAY is a no-op via the block-id guard', () => {
    const note = '# Day\n\n## Tasks\n- [ ] Existing\n';
    const out = applyBridgeIntent(note, appendIntent);
    expect(out.changed).toBe(true);
    expect(out.text).toContain('- [ ] New thing #obsidian ^dg-def67890');
    const replay = applyBridgeIntent(out.text, appendIntent);
    expect(replay.changed).toBe(false);
    expect(replay.text).toBe(out.text);
  });

  it('a tokenless append dedupes on the exact line', () => {
    const bare = { ...appendIntent, task: { ...appendIntent.task, blockId: undefined } };
    const out = applyBridgeIntent('# Day\n\n## Tasks\n', bare);
    expect(out.changed).toBe(true);
    const replay = applyBridgeIntent(out.text, bare);
    expect(replay.changed).toBe(false);
  });

  it('AUDIT FIX H3: replay stays idempotent when the TITLE refuses the token (foreign ^ref / embedded ^dg-) — the crash-replay contract holds', () => {
    // buildObsidianTaskLine routes the token through blockIdSuffix, which
    // refuses it for these titles — so the appended line carries NO token,
    // and the old landed-check (keyed on intent.task.blockId alone) never
    // matched: every replay appended the line AGAIN, breaking the module's
    // "dying between apply and persist replays as no-ops" contract in the
    // exact scenario it exists for.
    for (const title of ['See ^quote1', 'Broken ^dg-embedded token #obsidian']) {
      const refusing = { ...appendIntent, task: { ...appendIntent.task, title, blockId: 'abc12345' } };
      const out = applyBridgeIntent('# Day\n\n## Tasks\n', refusing);
      expect(out.changed).toBe(true);
      expect(out.text).not.toContain('^dg-abc12345'); // token refused, as designed
      const replay = applyBridgeIntent(out.text, refusing);
      expect(replay.changed).toBe(false); // landed-check falls back to the exact line
      expect(replay.text).toBe(out.text);
    }
  });

  it('AUDIT FIX H3: a human adding trailing whitespace to the landed line no longer defeats the replay guard', () => {
    const out = applyBridgeIntent('# Day\n\n## Tasks\n', appendIntent);
    const withTrailing = out.text.replace(
      '- [ ] New thing #obsidian ^dg-def67890',
      '- [ ] New thing #obsidian ^dg-def67890   ');
    const replay = applyBridgeIntent(withTrailing, appendIntent);
    expect(replay.changed).toBe(false);
  });
});

describe('applyBridgeIntent — notes', () => {
  it('daily_note_write replaces wholesale; identical content is a no-op', () => {
    expect(applyBridgeIntent('old', { type: 'daily_note_write', content: 'new' }))
      .toEqual({ text: 'new', changed: true });
    expect(applyBridgeIntent('new', { type: 'daily_note_write', content: 'new' }).changed).toBe(false);
    expect(applyBridgeIntent(null, { type: 'daily_note_write', content: '' }).changed).toBe(true);
  });

  it('wiki_note_write: creation gets frontmatter and the portability gate; existing notes get neither', () => {
    const created = applyBridgeIntent(null, { type: 'wiki_note_write', noteName: 'Fresh note', content: 'hello' });
    expect(created.changed).toBe(true);
    expect(created.text.startsWith('---\n')).toBe(true);
    expect(created.text).toContain('hello');
    // Refuse-creation/permit-existing (spec §3.7): a new unportable name is
    // refused; an existing file with the same name is written as-is.
    const refused = applyBridgeIntent(null, { type: 'wiki_note_write', noteName: 'plans?', content: 'x' });
    expect(refused.error).toBe('unportable_name');
    const existing = applyBridgeIntent('old body', { type: 'wiki_note_write', noteName: 'plans?', content: 'x' });
    expect(existing).toEqual({ text: 'x', changed: true });
  });

  it('unknown intent types are unsupported, never a throw (forward compatibility)', () => {
    expect(applyBridgeIntent('x', { type: 'task_delete' })).toEqual({ unsupported: true });
    expect(applyBridgeIntent('x', null)).toEqual({ unsupported: true });
  });
});
