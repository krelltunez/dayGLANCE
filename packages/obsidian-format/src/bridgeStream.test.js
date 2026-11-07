import { describe, it, expect, vi } from 'vitest';
import { noteTextHash, extractNoteDescription } from './noteDescription.js';
import {
  sealBridgeEnvelope, readBridgeEnvelopeGeneration,
  openBridgeEnvelope,
  encodePlainBridgeRow,
  decodePlainBridgeRow,
  applyBridgeIntent,
  noteContainsBlock,
  mintIntentId,
  observationEntityId,
  BRIDGE_INTENT_PREFIX,
  BRIDGE_OBSERVATION_PREFIX,
  BRIDGE_ACTION_PREFIX,
  BRIDGE_CREATE_ACTION_PREFIX,
  BRIDGE_PROJECTION_PREFIX,
  BRIDGE_COPY_PREFIX,
  BRIDGE_PAIRING_META_ID,
  BRIDGE_CONFIG_META_ID,
  BRIDGE_APPLIER_META_ID,
  BRIDGE_CAPABILITY_PREFIX,
  BRIDGE_CAPABILITY_TASK_CREATE,
  bridgeCapabilityId,
  bridgeCapabilityPayload,
  isBridgeCapability,
  dailyNoteCreationBody,
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

  it('THE GENERATION TAG (2026-09-29): sealed in the clear beside the ciphertext, readable without the key, absent when not supplied', async () => {
    const key = await subkey();
    const tagged = await sealBridgeEnvelope(key, { kind: 'intent', type: 'task_state' }, 'gen-A');
    expect(readBridgeEnvelopeGeneration(tagged)).toBe('gen-A');
    // The tag changes nothing about opening: right key opens, wrong key does not.
    expect(await openBridgeEnvelope(key, tagged)).toEqual({ kind: 'intent', type: 'task_state' });
    expect(await openBridgeEnvelope(await otherKey(), tagged)).toBe(null);
    // A writer that predates the tag, an empty tag, and junk all read as "unknown".
    expect(readBridgeEnvelopeGeneration(await sealBridgeEnvelope(key, { kind: 'intent' }))).toBe(null);
    expect(readBridgeEnvelopeGeneration(await sealBridgeEnvelope(key, { kind: 'intent' }, ''))).toBe(null);
    expect(readBridgeEnvelopeGeneration('junk')).toBe(null);
    expect(serverRoundTrip(tagged)).toBe(tagged);
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

  it('a task-create row is invisible to every older reader: no other prefix is a prefix of it', () => {
    // An app built before task_create deletes every `act:` row whose type it
    // does not know; the create rows must not start with any prefix an older
    // reader filters on.
    for (const other of [BRIDGE_ACTION_PREFIX, BRIDGE_OBSERVATION_PREFIX, BRIDGE_INTENT_PREFIX, BRIDGE_PROJECTION_PREFIX, BRIDGE_COPY_PREFIX, 'meta:']) {
      expect(`${BRIDGE_CREATE_ACTION_PREFIX}x`.startsWith(other)).toBe(false);
    }
  });

  it('a capability row is one no reader old or new mistakes for its own: no other id or prefix matches it, and it matches none of theirs', () => {
    // Every listing on both sides matches an exact meta id or a longer
    // prefix (`meta:copy:`); none filters on the bare `meta:`. A `meta:cap:`
    // row must therefore neither start with any of those nor be one.
    const id = bridgeCapabilityId(BRIDGE_CAPABILITY_TASK_CREATE);
    expect(id).toBe('meta:cap:task_create');
    expect(id.startsWith(BRIDGE_CAPABILITY_PREFIX)).toBe(true);
    for (const exact of [BRIDGE_PAIRING_META_ID, BRIDGE_CONFIG_META_ID, BRIDGE_APPLIER_META_ID]) {
      expect(id).not.toBe(exact);
      expect(exact.startsWith(BRIDGE_CAPABILITY_PREFIX)).toBe(false);
    }
    for (const other of [BRIDGE_ACTION_PREFIX, BRIDGE_CREATE_ACTION_PREFIX, BRIDGE_OBSERVATION_PREFIX, BRIDGE_INTENT_PREFIX, BRIDGE_PROJECTION_PREFIX, BRIDGE_COPY_PREFIX]) {
      expect(id.startsWith(other)).toBe(false);
      expect(`${other}x`.startsWith(BRIDGE_CAPABILITY_PREFIX)).toBe(false);
    }
  });

  it('a capability payload names one capability, and is recognised only for that name', async () => {
    const p = bridgeCapabilityPayload('task_create', '2026-11-06T12:00:00.000Z');
    expect(p).toEqual({ v: 1, kind: 'capability', name: 'task_create', since: '2026-11-06T12:00:00.000Z' });
    const key = await subkey();
    const opened = await openBridgeEnvelope(key, await sealBridgeEnvelope(key, p, 'gen-A'));
    expect(isBridgeCapability(opened, 'task_create')).toBe(true);
    expect(isBridgeCapability(opened, 'task_other')).toBe(false);
    expect(isBridgeCapability({ kind: 'config', name: 'task_create' }, 'task_create')).toBe(false);
    expect(isBridgeCapability(null, 'task_create')).toBe(false);
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

  it('completion_log_append: inserts at SECTION END, dedupes by exact line, creates the note when absent', () => {
    const entry = '- ✅ 14:32 Review Q2 contract draft [completion:: 2026-04-06T14:32:00] #legal';
    const intent = { type: 'completion_log_append', path: '2026-04-06.md', date: '2026-04-06', heading: '## Completed', template: '# My day\n', entry };
    // Creation: frontmatter + template + heading + entry.
    const created = applyBridgeIntent(null, intent);
    expect(created.changed).toBe(true);
    expect(created.text.startsWith('---\n')).toBe(true);
    expect(created.text).toContain('# My day');
    expect(created.text).toContain(`## Completed\n${entry}`);
    // Section-end insertion: a second entry lands BELOW the first (the log
    // is chronological, newest last), and the next section is untouched.
    const second = '- ✅ 15:01 Call accountant [completion:: 2026-04-06T15:01:00]';
    const two = applyBridgeIntent(created.text, { ...intent, entry: second });
    expect(two.text).toContain(`${entry}\n${second}`);
    // Replay is a no-op — including against a hand-added trailing space.
    expect(applyBridgeIntent(two.text, { ...intent, entry: second }).changed).toBe(false);
    const padded = two.text.replace(second, `${second}  `);
    expect(applyBridgeIntent(padded, { ...intent, entry: second }).changed).toBe(false);
  });

  it('completion_log_append: entries under the heading never disturb other sections; a missing heading is created at note end', () => {
    const note = '# Day\n\n## Tasks\n- [ ] Open thing\n\n## Notes\nfree text\n';
    const entry = '- ✅ 09:45 Update roadmap [completion:: 2026-04-06T09:45:00]';
    const out = applyBridgeIntent(note, { type: 'completion_log_append', path: 'x.md', date: '2026-04-06', heading: '## Completed', template: '', entry });
    expect(out.changed).toBe(true);
    // Appended at the end with its heading; Tasks and Notes untouched.
    expect(out.text).toContain('## Tasks\n- [ ] Open thing');
    expect(out.text).toContain('## Notes\nfree text');
    expect(out.text).toContain(`## Completed\n${entry}`);
    // Now with the heading present mid-note: the entry stays INSIDE that
    // section, before the next heading.
    const mid = '# Day\n\n## Completed\n- ✅ 08:00 Early thing [completion:: 2026-04-06T08:00:00]\n\n## Notes\ntext\n';
    const out2 = applyBridgeIntent(mid, { type: 'completion_log_append', path: 'x.md', date: '2026-04-06', heading: '## Completed', template: '', entry });
    expect(out2.text).toContain(`Early thing [completion:: 2026-04-06T08:00:00]\n${entry}\n\n## Notes`);
  });

  it('completion_log_append: THE SCAN-COLLISION GUARD — a multi-line or headingless entry is refused, never written', () => {
    // A multi-line entry could smuggle a task-shaped line past the
    // formatter's non-task guarantee; the applier refuses it outright.
    const smuggle = '- ✅ ok\n- [ ] smuggled task';
    const base = '# Day\n';
    expect(applyBridgeIntent(base, { type: 'completion_log_append', path: 'x.md', date: 'd', heading: '## Completed', template: '', entry: smuggle }))
      .toEqual({ text: base, changed: false });
    expect(applyBridgeIntent(base, { type: 'completion_log_append', path: 'x.md', date: 'd', heading: '', template: '', entry: '- ✅ ok' }))
      .toEqual({ text: base, changed: false });
    expect(applyBridgeIntent(base, { type: 'completion_log_append', path: 'x.md', date: 'd', heading: '## Completed', template: '', entry: '' }))
      .toEqual({ text: base, changed: false });
  });

  it('unknown intent types are unsupported, never a throw (forward compatibility)', () => {
    expect(applyBridgeIntent('x', { type: 'task_delete' })).toEqual({ unsupported: true });
    expect(applyBridgeIntent('x', null)).toEqual({ unsupported: true });
  });
});

describe('applyBridgeIntent — note tasks (companion §4.3, project routing)', () => {
  const note = '---\ndayglance-id: p1\n---\n# House\n\n## Tasks\n- [ ] Fix the gate ^dg-aaaaaaaa\n- [ ] Paint the fence ^dg-bbbbbbbb\n\n## Done\nquery here\n';
  const append = {
    type: 'task_append', path: 'Projects/House.md', date: null, noteTask: true,
    task: { title: 'Call the plumber [scheduled:: 2026-09-10]', startTime: '10:00', duration: 30, isAllDay: false, blockId: 'cccccccc' },
    heading: '## Tasks',
  };

  it('appends at the END of the Tasks section, before the next heading, without sorting', () => {
    const out = applyBridgeIntent(note, append);
    expect(out.changed).toBe(true);
    expect(out.text).toBe('---\ndayglance-id: p1\n---\n# House\n\n## Tasks\n- [ ] Fix the gate ^dg-aaaaaaaa\n- [ ] Paint the fence ^dg-bbbbbbbb\n- [ ] 10:00-10:30 Call the plumber [scheduled:: 2026-09-10] ^dg-cccccccc\n\n## Done\nquery here\n');
    expect(applyBridgeIntent(out.text, append).changed).toBe(false); // replay
  });

  it('never creates a missing note (a deleted project note stays deleted)', () => {
    expect(applyBridgeIntent(null, append)).toEqual({ text: null, changed: false });
  });

  it('adds the heading at the end when the note has none', () => {
    const out = applyBridgeIntent('# House\nsome text\n', append);
    expect(out.text).toBe('# House\nsome text\n\n## Tasks\n- [ ] 10:00-10:30 Call the plumber [scheduled:: 2026-09-10] ^dg-cccccccc\n');
  });

  it('task_remove drops exactly the line carrying the block id; replay is a no-op; other lines untouched', () => {
    const out = applyBridgeIntent(note, { type: 'task_remove', path: 'Projects/House.md', blockId: 'aaaaaaaa' });
    expect(out.changed).toBe(true);
    expect(out.text).toBe('---\ndayglance-id: p1\n---\n# House\n\n## Tasks\n- [ ] Paint the fence ^dg-bbbbbbbb\n\n## Done\nquery here\n');
    expect(applyBridgeIntent(out.text, { type: 'task_remove', path: 'Projects/House.md', blockId: 'aaaaaaaa' }).changed).toBe(false);
    expect(applyBridgeIntent(null, { type: 'task_remove', path: 'x.md', blockId: 'aaaaaaaa' })).toEqual({ text: null, changed: false });
  });

  it('task_remove without a block id matches a tokenless line by its exact raw title only', () => {
    const plain = '## Tasks\n- [ ] Alpha\n- [x] Alpha ^dg-dddddddd\n- [ ] Beta\n';
    const out = applyBridgeIntent(plain, { type: 'task_remove', path: 'n.md', blockId: null, obsidianRawTitle: 'Alpha' });
    expect(out.text).toBe('## Tasks\n- [x] Alpha ^dg-dddddddd\n- [ ] Beta\n');
  });
});


// ── Companion §4.4 build record (2026-09-06): the daily-note creation body ──
// Every point that CREATES a daily note renders the app's text template
// through the same subset — `{{date}}`, and `{{title}}` as the note's name
// — so a template reads the same wherever the note is born.
describe('applyBridgeIntent — CRLF notes (format-package audit low, 2026-09-06, follow-up)', () => {
  // The four line-editing branches used to split on a bare LF and join with
  // LF: on a Windows-ended note every line kept a dangling '\r' for the
  // comparisons, and the rewritten note came back with mixed endings.
  const crlf = (lf) => lf.replace(/\n/g, '\r\n');
  const bareLf = (text) => /[^\r]\n/.test(text) || text.startsWith('\n');
  const NOTE = crlf('# Day\n\n## Tasks\n- [ ] 09:00 Write report ^dg-abc12345\n- [ ] Other\n');
  const stateIntent = {
    type: 'task_state', path: '2026-08-29.md', date: '2026-08-29',
    obsidianRawTitle: 'Write report', completed: true, startTime: '09:00',
    duration: null, taskHeading: '## Tasks', blockId: 'abc12345',
    completedAt: null, completionFormat: null,
  };
  const appendIntent = {
    type: 'task_append', path: '2026-08-29.md', date: '2026-08-29',
    task: { title: 'New thing #obsidian', startTime: null, duration: null, isAllDay: true, date: '2026-08-29', blockId: 'def67890' },
    heading: '## Tasks', template: '# My day\n',
  };

  it('task_state finds the line behind the CR, marks it, and re-joins with CRLF; replay is a no-op', () => {
    const out = applyBridgeIntent(NOTE, stateIntent);
    expect(out.changed).toBe(true);
    expect(out.text).toContain('- [x] 09:00 Write report ^dg-abc12345\r\n');
    expect(bareLf(out.text)).toBe(false);
    expect(applyBridgeIntent(out.text, stateIntent).changed).toBe(false);
  });

  it('task_append inserts a CRLF line under the heading, sorts within the section, and dedupes on replay', () => {
    const out = applyBridgeIntent(NOTE, appendIntent);
    expect(out.changed).toBe(true);
    expect(out.text).toContain('- [ ] New thing #obsidian ^dg-def67890\r\n');
    expect(bareLf(out.text)).toBe(false);
    expect(applyBridgeIntent(out.text, appendIntent).changed).toBe(false);
  });

  it('task_remove matches the block id behind the CR and leaves the rest CRLF', () => {
    const out = applyBridgeIntent(NOTE, { type: 'task_remove', path: '2026-08-29.md', blockId: 'abc12345', obsidianRawTitle: 'Write report' });
    expect(out.changed).toBe(true);
    expect(out.text).not.toContain('Write report');
    expect(out.text).toContain('- [ ] Other\r\n');
    expect(bareLf(out.text)).toBe(false);
    expect(applyBridgeIntent(out.text, { type: 'task_remove', path: '2026-08-29.md', blockId: 'abc12345' }).changed).toBe(false);
  });

  it('completion_log_append lands under its heading in CRLF and dedupes on replay', () => {
    const intent = { type: 'completion_log_append', path: '2026-08-29.md', date: '2026-08-29', heading: '## Completed', entry: '- ✅ 12:30 Write report', template: '' };
    const out = applyBridgeIntent(NOTE, intent);
    expect(out.changed).toBe(true);
    expect(out.text).toContain('## Completed\r\n- ✅ 12:30 Write report\r\n');
    expect(bareLf(out.text)).toBe(false);
    expect(applyBridgeIntent(out.text, intent).changed).toBe(false);
  });

  it('an LF note is untouched by the change: same output as before, LF throughout', () => {
    const lf = '# Day\n\n## Tasks\n- [ ] 09:00 Write report ^dg-abc12345\n- [ ] Other\n';
    const out = applyBridgeIntent(lf, appendIntent);
    expect(out.text).not.toContain('\r');
    expect(out.text).toContain('- [ ] New thing #obsidian ^dg-def67890\n');
  });
});

describe('dailyNoteCreationBody / creation through the two daily-note intents', () => {
  it('fills {{date}} and {{title}} (the note name from the path, else the date) and adds the creation frontmatter', () => {
    const body = dailyNoteCreationBody('# {{title}}\n\nToday is {{date}}.\n', '2026-09-10', 'Daily/2026-09-10.md');
    expect(body.startsWith('---\n')).toBe(true);
    expect(body).toContain('# 2026-09-10');
    expect(body).toContain('Today is 2026-09-10.');
    expect(dailyNoteCreationBody('{{title}}', '2026-09-10')).toContain('2026-09-10');
    expect(dailyNoteCreationBody('', '2026-09-10').startsWith('---\n')).toBe(true);
  });

  it('task_append on an absent note renders the template subset', () => {
    const out = applyBridgeIntent(null, {
      type: 'task_append', path: 'Daily/2026-09-10.md', date: '2026-09-10',
      task: { title: 'Water #obsidian', startTime: null, duration: null, isAllDay: true, date: '2026-09-10', blockId: 'abc12345' },
      heading: '## Tasks', template: '# {{title}}\n\n## Tasks\n',
    });
    expect(out.changed).toBe(true);
    expect(out.text).toContain('# 2026-09-10');
    expect(out.text).not.toContain('{{title}}');
    expect(out.text).toMatch(/## Tasks\n- \[ \] Water #obsidian \^dg-abc12345/);
  });

  it('completion_log_append on an absent note renders the same subset', () => {
    const out = applyBridgeIntent(null, {
      type: 'completion_log_append', path: 'Daily/2026-09-10.md', date: '2026-09-10',
      heading: '## Done', entry: '- 10:00 Did the thing', template: '# {{date}}\n',
    });
    expect(out.changed).toBe(true);
    expect(out.text).toContain('# 2026-09-10');
    expect(out.text).toContain('## Done\n- 10:00 Did the thing');
  });
});

describe('wiki_note_write create_or_append (task notes into the vault, companion §4.3)', () => {
  const intent = { type: 'wiki_note_write', noteName: 'Projects/Fix the gutter', content: 'Call the roofer first', mode: 'create_or_append' };
  it('creates like any wiki note write when the note is absent', () => {
    const r = applyBridgeIntent(null, intent);
    expect(r.changed).toBe(true);
    expect(r.text).toMatch(/^---\n/);
    expect(r.text).toContain('Call the roofer first');
  });
  it('appends to an existing note instead of replacing it, once', () => {
    const first = applyBridgeIntent('# Gutter\n\nOwner notes.\n', intent);
    expect(first).toEqual({ text: '# Gutter\n\nOwner notes.\n\nCall the roofer first\n', changed: true });
    // A second copy of the same migration (another device, a retried enqueue) changes nothing.
    expect(applyBridgeIntent(first.text, intent)).toEqual({ text: first.text, changed: false });
  });
  it('without the mode an existing note is still replaced (the linked-note editor)', () => {
    const { mode, ...plain } = intent;
    void mode;
    expect(applyBridgeIntent('old', plain)).toEqual({ text: 'Call the roofer first', changed: true });
  });
});

describe('create_or_append block guard (report F1)', () => {
  const intent = (content) => ({ type: 'wiki_note_write', noteName: 'Projects/Fix the gutter', content, mode: 'create_or_append' });
  it('a short body that only occurs inside a longer line is still appended', () => {
    const r = applyBridgeIntent('# Gutter\n\nDone and dusted.\n', intent('Done'));
    expect(r).toEqual({ text: '# Gutter\n\nDone and dusted.\n\nDone\n', changed: true });
  });
  it('an exact block already present is not appended again, and the skip is logged', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const r = applyBridgeIntent('# Gutter\n\nDone\n\nMore.\n', intent('Done'));
      expect(r).toEqual({ text: '# Gutter\n\nDone\n\nMore.\n', changed: false });
      expect(info).toHaveBeenCalledWith(expect.stringContaining('already present in Projects/Fix the gutter'));
    } finally { info.mockRestore(); }
  });
  it('a multi-paragraph body matches only as a consecutive run of whole blocks', () => {
    expect(noteContainsBlock('a\n\nb\n\nc\n', 'a\n\nb')).toBe(true);
    expect(noteContainsBlock('a\n\nx\n\nb\n', 'a\n\nb')).toBe(false);
    expect(noteContainsBlock('a\r\n\r\nb\r\n', 'a\n\nb')).toBe(true);
  });
});

describe('REFUSE ON CHANGE at the applier (owner ruling 2026-10-03)', () => {
  const NOTE = '# House\nDry roof by spring.\n\n## Tasks\n- [ ] Fix the gutter ^dg-abc12345\n';
  it('wiki_note_write with a base the note no longer matches is left alone; a matching base writes; no base writes as before', () => {
    const stale = noteTextHash('something else');
    expect(applyBridgeIntent(NOTE, { type: 'wiki_note_write', noteName: 'House', content: 'mine', base: stale })).toEqual({ text: NOTE, changed: false });
    expect(applyBridgeIntent(NOTE, { type: 'wiki_note_write', noteName: 'House', content: 'mine', base: noteTextHash(NOTE) })).toEqual({ text: 'mine', changed: true });
    expect(applyBridgeIntent(NOTE, { type: 'wiki_note_write', noteName: 'House', content: 'mine' })).toEqual({ text: 'mine', changed: true });
  });
  it('project_note_description: replace with a matching base rewrites only the section; a stale base keeps the section and adds a dated callout; merge keeps existing text', () => {
    const base = noteTextHash('Dry roof by spring.');
    const replaced = applyBridgeIntent(NOTE, { type: 'project_note_description', path: 'Projects/House.md', content: 'Dry roof, and gutters.', mode: 'replace', base });
    expect(replaced.changed).toBe(true);
    expect(replaced.text).toBe('# House\nDry roof, and gutters.\n\n## Tasks\n- [ ] Fix the gutter ^dg-abc12345\n');
    const conflicted = applyBridgeIntent(NOTE, { type: 'project_note_description', path: 'Projects/House.md', content: 'Typed in dayGLANCE.', mode: 'replace', base: noteTextHash('older'), at: '2026-10-03 09:00' });
    expect(conflicted.changed).toBe(true);
    expect(extractNoteDescription(conflicted.text)).toBe('Dry roof by spring.\n\n> [!note] Edited in dayGLANCE 2026-10-03 09:00\n> Typed in dayGLANCE.');
    expect(conflicted.text).toContain('## Tasks\n- [ ] Fix the gutter ^dg-abc12345\n');
    const merged = applyBridgeIntent(NOTE, { type: 'project_note_description', path: 'Projects/House.md', content: 'Purpose: ship.', mode: 'merge' });
    expect(extractNoteDescription(merged.text)).toBe('Dry roof by spring.\n\nPurpose: ship.');
    expect(applyBridgeIntent(null, { type: 'project_note_description', path: 'x.md', content: 'x', mode: 'replace' })).toEqual({ text: null, changed: false });
  });
});
