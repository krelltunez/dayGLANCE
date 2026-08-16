import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mod = require('./codesign-ad-hoc.cjs');
const codesignAdHoc = mod.default;
const { runOrThrow } = mod;

const mockSpawnSync = vi.fn();

beforeEach(() => {
  mockSpawnSync.mockReset();
  mockSpawnSync.mockReturnValue({ status: 0, error: null });
  mod._spawnSync = mockSpawnSync;
  delete process.env.CSC_LINK;
});

describe('runOrThrow', () => {
  it('does not throw when command succeeds', () => {
    mockSpawnSync.mockReturnValue({ status: 0, error: null });
    expect(() => runOrThrow('codesign', ['--sign', '-'])).not.toThrow();
  });

  it('throws when command exits with non-zero status', () => {
    mockSpawnSync.mockReturnValue({ status: 1, error: null });
    expect(() => runOrThrow('codesign', ['--sign', '-']))
      .toThrow('[codesign-ad-hoc] codesign exited with status 1');
  });

  it('throws the spawn error when the executable cannot be started', () => {
    const err = new Error('spawn codesign ENOENT');
    err.code = 'ENOENT';
    mockSpawnSync.mockReturnValue({ status: null, error: err });
    expect(() => runOrThrow('codesign', ['--sign', '-']))
      .toThrow('ENOENT');
  });

  it('passes arguments as an array without shell splitting', () => {
    mockSpawnSync.mockReturnValue({ status: 0, error: null });
    runOrThrow('codesign', ['--sign', '-', '/path/with spaces/App.app']);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'codesign',
      ['--sign', '-', '/path/with spaces/App.app'],
      { stdio: 'inherit' },
    );
  });
});

describe('codesignAdHoc', () => {
  it('skips entirely on non-mac platforms', async () => {
    const ctx = {
      appOutDir: '/build/mac-arm64',
      packager: { platform: { name: 'linux' }, appInfo: { productName: 'dayGLANCE' } },
      electronPlatformName: 'darwin',
    };
    await codesignAdHoc(ctx);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('preserves appOutDir containing .. without rewriting', async () => {
    const ctx = {
      appOutDir: '/build/../output/mac-arm64',
      packager: { platform: { name: 'mac' }, appInfo: { productName: 'dayGLANCE' } },
      electronPlatformName: 'darwin',
    };
    await codesignAdHoc(ctx);
    const expectedPath = path.join('/build/../output/mac-arm64', 'dayGLANCE.app');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'find',
      [expectedPath, '-name', '._*', '-delete'],
      { stdio: 'inherit' },
    );
  });

  it('runs find, xattr, and codesign in order', async () => {
    const ctx = {
      appOutDir: '/build/mac-arm64',
      packager: { platform: { name: 'mac' }, appInfo: { productName: 'dayGLANCE' } },
      electronPlatformName: 'darwin',
    };
    await codesignAdHoc(ctx);
    const calls = mockSpawnSync.mock.calls.map(c => c[0]);
    expect(calls).toEqual(['find', 'xattr', 'codesign']);
  });

  it('skips codesign for MAS builds but still cleans detritus', async () => {
    const ctx = {
      appOutDir: '/build/mac-arm64',
      packager: { platform: { name: 'mac' }, appInfo: { productName: 'dayGLANCE' } },
      electronPlatformName: 'mas',
    };
    await codesignAdHoc(ctx);
    const calls = mockSpawnSync.mock.calls.map(c => c[0]);
    expect(calls).toEqual(['find', 'xattr']);
  });

  it('skips codesign when CSC_LINK is set', async () => {
    process.env.CSC_LINK = '/path/to/cert.p12';
    const ctx = {
      appOutDir: '/build/mac-arm64',
      packager: { platform: { name: 'mac' }, appInfo: { productName: 'dayGLANCE' } },
      electronPlatformName: 'darwin',
    };
    await codesignAdHoc(ctx);
    const calls = mockSpawnSync.mock.calls.map(c => c[0]);
    expect(calls).toEqual(['find', 'xattr']);
  });

  it('throws when a command fails, halting the build', async () => {
    mockSpawnSync.mockReturnValueOnce({ status: 0, error: null });
    mockSpawnSync.mockReturnValueOnce({ status: 1, error: null });
    const ctx = {
      appOutDir: '/build/mac-arm64',
      packager: { platform: { name: 'mac' }, appInfo: { productName: 'dayGLANCE' } },
      electronPlatformName: 'darwin',
    };
    await expect(codesignAdHoc(ctx))
      .rejects.toThrow('[codesign-ad-hoc] xattr exited with status 1');
  });
});
