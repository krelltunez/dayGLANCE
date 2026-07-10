import { describe, it, expect } from 'vitest';
import { classifyVaultUrl, isLocalOrLanHost } from './vaultUrlPolicy.js';

// The vault Bearer token must never travel over cleartext on the public internet.
// classifyVaultUrl gates the settings form's Save + Test Connection; the native
// shells enforce the same rule before opening a stream.

describe('classifyVaultUrl', () => {
  it('accepts https:// without a warning', () => {
    expect(classifyVaultUrl('https://vault.example.com')).toEqual({ ok: true });
    expect(classifyVaultUrl('https://vault.example.com:8443/path')).toEqual({ ok: true });
  });

  it('rejects a plain-internet http:// URL', () => {
    const r = classifyVaultUrl('http://vault.example.com');
    expect(r.ok).toBe(false);
    expect(r.messageKey).toBe('sync.vaultUrl.httpRejected');
  });

  it('allows http:// on localhost with a warning', () => {
    const r = classifyVaultUrl('http://localhost:8080');
    expect(r.ok).toBe(true);
    expect(r.warning).toBe(true);
    expect(r.messageKey).toBe('sync.vaultUrl.insecureLanWarning');
  });

  it('allows http:// on loopback / LAN / .local hosts with a warning', () => {
    for (const u of [
      'http://127.0.0.1',
      'http://127.5.6.7:9000',
      'http://[::1]:3000',
      'http://10.1.2.3',
      'http://192.168.1.50/events',
      'http://172.16.0.1',
      'http://172.31.255.254',
      'http://vault.local',
      'http://my-nas.localhost',
    ]) {
      const r = classifyVaultUrl(u);
      expect(r.ok, u).toBe(true);
      expect(r.warning, u).toBe(true);
    }
  });

  it('rejects http:// on a public IP even inside 172.x that is not 172.16-31', () => {
    expect(classifyVaultUrl('http://172.15.0.1').ok).toBe(false);
    expect(classifyVaultUrl('http://172.32.0.1').ok).toBe(false);
    expect(classifyVaultUrl('http://8.8.8.8').ok).toBe(false);
  });

  it('rejects empty / malformed / non-http(s) URLs as invalid', () => {
    expect(classifyVaultUrl('').messageKey).toBe('sync.vaultUrl.invalid');
    expect(classifyVaultUrl('   ').messageKey).toBe('sync.vaultUrl.invalid');
    expect(classifyVaultUrl('not a url').messageKey).toBe('sync.vaultUrl.invalid');
    expect(classifyVaultUrl('ftp://vault.example.com').messageKey).toBe('sync.vaultUrl.invalid');
  });
});

describe('isLocalOrLanHost', () => {
  it('recognizes loopback and private ranges', () => {
    expect(isLocalOrLanHost('localhost')).toBe(true);
    expect(isLocalOrLanHost('127.0.0.1')).toBe(true);
    expect(isLocalOrLanHost('::1')).toBe(true);
    expect(isLocalOrLanHost('[::1]')).toBe(true);
    expect(isLocalOrLanHost('10.0.0.1')).toBe(true);
    expect(isLocalOrLanHost('192.168.0.1')).toBe(true);
    expect(isLocalOrLanHost('172.20.5.5')).toBe(true);
    expect(isLocalOrLanHost('printer.local')).toBe(true);
  });

  it('rejects public hosts and out-of-range octets', () => {
    expect(isLocalOrLanHost('vault.example.com')).toBe(false);
    expect(isLocalOrLanHost('8.8.8.8')).toBe(false);
    expect(isLocalOrLanHost('172.15.0.1')).toBe(false);
    expect(isLocalOrLanHost('172.32.0.1')).toBe(false);
    expect(isLocalOrLanHost('999.1.1.1')).toBe(false);
    expect(isLocalOrLanHost('')).toBe(false);
  });
});
