import { describe, it, expect, vi } from 'vitest';
import { retryTransientFs, isTransientFsError, TRANSIENT_FS_CODES } from './fsRetry.js';

const errno = (code: string) => Object.assign(new Error(`${code}: something, read`), { code });

describe('isTransientFsError', () => {
  it('recognises the interruption codes', () => {
    expect(isTransientFsError(errno('EINTR'))).toBe(true);
    expect(isTransientFsError(errno('EAGAIN'))).toBe(true);
  });

  // Narrow on purpose: retrying these would slow a correct answer down, or
  // paper over a condition that persists.
  it('does not treat persistent or meaningful errors as transient', () => {
    expect(isTransientFsError(errno('ENOENT'))).toBe(false);
    expect(isTransientFsError(errno('EBUSY'))).toBe(false);
    expect(isTransientFsError(errno('EACCES'))).toBe(false);
    expect(isTransientFsError(errno('EPERM'))).toBe(false);
  });

  it('handles junk without throwing', () => {
    expect(isTransientFsError(null)).toBe(false);
    expect(isTransientFsError(undefined)).toBe(false);
    expect(isTransientFsError('EINTR')).toBe(false);       // a bare string has no .code
    expect(isTransientFsError(new Error('EINTR'))).toBe(false); // message, not code
  });

  it('exposes exactly the two codes', () => {
    expect([...TRANSIENT_FS_CODES].sort()).toEqual(['EAGAIN', 'EINTR']);
  });
});

describe('retryTransientFs', () => {
  it('returns the value without retrying when the call succeeds', () => {
    const op = vi.fn(() => 'contents');
    expect(retryTransientFs(op)).toBe('contents');
    expect(op).toHaveBeenCalledTimes(1);
  });

  // The reported failure: EINTR on the first read, fine on the reissue.
  it('reissues after EINTR and returns the eventual result', () => {
    let calls = 0;
    const op = vi.fn(() => {
      calls++;
      if (calls === 1) throw errno('EINTR');
      return 'contents';
    });
    expect(retryTransientFs(op)).toBe('contents');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('keeps trying up to the attempt limit', () => {
    let calls = 0;
    const op = vi.fn(() => {
      calls++;
      if (calls < 3) throw errno('EINTR');
      return 'ok';
    });
    expect(retryTransientFs(op, 3)).toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  // A genuine failure must not be delayed behind pointless retries — icloud.ts
  // relies on ENOENT-shaped answers reaching it promptly.
  it('rethrows a non-transient error on the first attempt', () => {
    const op = vi.fn(() => { throw errno('EACCES'); });
    expect(() => retryTransientFs(op)).toThrow(/EACCES/);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('rethrows a transient error that never resolves, rather than looping', () => {
    const op = vi.fn(() => { throw errno('EINTR'); });
    expect(() => retryTransientFs(op, 3)).toThrow(/EINTR/);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('always makes at least one attempt, whatever the count says', () => {
    const op = vi.fn(() => 'once');
    expect(retryTransientFs(op, 0)).toBe('once');
    expect(retryTransientFs(op, -5)).toBe('once');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('preserves the thrown error object, not just its message', () => {
    const original = errno('EPERM');
    try {
      retryTransientFs(() => { throw original; });
      expect.unreachable();
    } catch (e) {
      expect(e).toBe(original);
    }
  });
});
