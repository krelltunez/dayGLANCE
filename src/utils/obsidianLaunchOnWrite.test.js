import { describe, it, expect } from 'vitest';
import { defaultLaunchOnWrite, effectiveLaunchOnWrite } from './obsidianLaunchOnWrite.js';

// Per-platform defaults from the Phase 1 table: macOS on (activate:false makes
// the launch background-only), everything else off. An explicit user choice
// always beats the default.

describe('defaultLaunchOnWrite', () => {
  it('defaults on only on macOS', () => {
    expect(defaultLaunchOnWrite('darwin')).toBe(true);
    expect(defaultLaunchOnWrite('win32')).toBe(false);
    expect(defaultLaunchOnWrite('linux')).toBe(false);
    expect(defaultLaunchOnWrite('android')).toBe(false);
    expect(defaultLaunchOnWrite(undefined)).toBe(false);
  });
});

describe('effectiveLaunchOnWrite', () => {
  it('an explicit choice wins on every platform', () => {
    expect(effectiveLaunchOnWrite('off', 'darwin')).toBe(false);
    expect(effectiveLaunchOnWrite('on', 'win32')).toBe(true);
    expect(effectiveLaunchOnWrite('on', 'linux')).toBe(true);
    expect(effectiveLaunchOnWrite('off', 'android')).toBe(false);
  });

  it('unset falls back to the platform default', () => {
    expect(effectiveLaunchOnWrite(null, 'darwin')).toBe(true);
    expect(effectiveLaunchOnWrite(null, 'win32')).toBe(false);
    expect(effectiveLaunchOnWrite(undefined, 'linux')).toBe(false);
    expect(effectiveLaunchOnWrite(null, 'android')).toBe(false);
  });

  it('treats an unrecognized stored value as unset rather than guessing', () => {
    expect(effectiveLaunchOnWrite('true', 'darwin')).toBe(true); // default, not the string
    expect(effectiveLaunchOnWrite('yes', 'win32')).toBe(false);
  });
});
