import { describe, it, expect, vi } from 'vitest';
import { removeDirectAccessEncryption } from './directAccessEncryption.js';

// The one sanctioned downgrade (docs/direct-access-sync.md, Phase 8).
const seal = (p) => ({ v: 1, enc: 'AES-GCM-256', data: Buffer.from(JSON.stringify(p)).toString('base64') });
const open = async (e) => JSON.parse(Buffer.from(e.data, 'base64').toString());
const isSealed = (v) => !!v && v.v === 1 && v.enc === 'AES-GCM-256' && typeof v.data === 'string';
const payload = { version: 2, lastModified: '2026-10-10T21:35:25.353Z', writtenBy: 'mac-a', data: { tasks: [{ id: 1 }], unscheduledTasks: [] } };

const transport = (text, { available = true, writeOk = true } = {}) => {
  const t = {
    text,
    isAvailable: () => available,
    read: vi.fn(async () => t.text),
    write: vi.fn(async (next) => { if (writeOk) t.text = next; return writeOk; }),
    setEncryptsWrites: vi.fn(),
  };
  return t;
};
const io = (over = {}) => ({ isEncryptedEnvelope: isSealed, decryptData: open, log: { error: vi.fn() }, ...over });

describe('removeDirectAccessEncryption', () => {
  it('rewrites an envelope as the same plaintext payload once, and turns this device\'s switch off', async () => {
    const t = transport(JSON.stringify(seal(payload)));
    expect(await removeDirectAccessEncryption({ transport: t, io: io() })).toEqual({ outcome: 'removed' });
    expect(t.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(t.text)).toEqual(payload);                      // the same stamp: no device sees a new version
    expect(t.setEncryptsWrites).toHaveBeenCalledWith(false);
  });

  it('a plaintext file is left as it is, and the switch is still turned off', async () => {
    const t = transport(JSON.stringify(payload));
    expect(await removeDirectAccessEncryption({ transport: t, io: io() })).toEqual({ outcome: 'already-plaintext' });
    expect(t.write).not.toHaveBeenCalled();
    expect(t.setEncryptsWrites).toHaveBeenCalledWith(false);
  });

  it('guard: without the key nothing is written and the switch is untouched; a failed write changes nothing', async () => {
    const noKey = transport(JSON.stringify(seal(payload)));
    const r = await removeDirectAccessEncryption({ transport: noKey, io: io({ decryptData: async () => { throw new Error('Encryption key not available'); } }) });
    expect(r).toMatchObject({ outcome: 'needs-key', detail: 'Encryption key not available' });
    expect(noKey.write).not.toHaveBeenCalled();
    expect(noKey.setEncryptsWrites).not.toHaveBeenCalled();
    const broken = transport(JSON.stringify(seal(payload)), { writeOk: false });
    expect(await removeDirectAccessEncryption({ transport: broken, io: io() })).toEqual({ outcome: 'write-failed' });
    expect(isSealed(JSON.parse(broken.text))).toBe(true);
    expect(broken.setEncryptsWrites).not.toHaveBeenCalled();
  });

  it('names the folder states it cannot act on', async () => {
    expect(await removeDirectAccessEncryption({ transport: transport(null, { available: false }), io: io() })).toEqual({ outcome: 'unavailable' });
    expect(await removeDirectAccessEncryption({ transport: transport(null), io: io() })).toEqual({ outcome: 'no-file' });
    expect(await removeDirectAccessEncryption({ transport: transport('{"error":"gone"}'), io: io() })).toEqual({ outcome: 'unavailable', detail: 'gone' });
    expect(await removeDirectAccessEncryption({ transport: transport('{"downloading":true}'), io: io() })).toEqual({ outcome: 'unavailable', detail: 'downloading' });
    const odd = transport(JSON.stringify(seal({ nothing: true })));
    expect((await removeDirectAccessEncryption({ transport: odd, io: io() })).outcome).toBe('needs-key');
    expect(odd.write).not.toHaveBeenCalled();
  });
});
