import { describe, it, expect } from 'vitest';
import {
  defaultConfig,
  decideStreamDeckMigration,
  interpretConfigFile,
  recoverFromConfigFile,
  normalizeConfig,
  mcpGates,
  applyTransition,
  listenerEffects,
  type LocalIntegrationsConfig,
  type TransitionAction,
} from './localIntegrations.js';

// §6.2's blocking migration, §6.3's tiers, and the consent-state machine.
// Load-bearing: an upgrade turns Stream Deck ON exactly once; a user's OFF
// sticks forever after; no path reaches an MCP-bound state without a fresh
// consent confirmation in the action itself.

const deps = {
  nowIso: () => '2026-08-12T12:00:00.000Z',
  generateToken: () => 'tok-' + 'a'.repeat(60),
  resolvePort: (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535
      ? ({ ok: true, port: v } as const)
      : ({ ok: false, reason: `bad port ${JSON.stringify(v)}` } as const),
};

const apply = (config: LocalIntegrationsConfig, action: TransitionAction) =>
  applyTransition(config, action, deps);

const enabledConfig = (tier: 'dayglance' | 'dayglance_calendar' = 'dayglance') => {
  const r = apply(defaultConfig(), {
    type: 'set-mcp-read-tier', tier, consentConfirmed: true, calendarConsentConfirmed: true,
  });
  if (!r.ok) throw new Error(r.error);
  return r.config;
};

describe('decideStreamDeckMigration — the §6.2 blocking item', () => {
  it('upgrade (no config, prior install evidence) → migrate to ON', () => {
    expect(decideStreamDeckMigration({ configFileExists: false, priorInstallEvidence: true }))
      .toEqual({ migrate: true, enabled: true });
  });

  it('fresh install (no config, no evidence) → migrate to OFF', () => {
    expect(decideStreamDeckMigration({ configFileExists: false, priorInstallEvidence: false }))
      .toEqual({ migrate: true, enabled: false });
  });

  it('config file exists → NEVER migrate again, whatever the evidence says', () => {
    expect(decideStreamDeckMigration({ configFileExists: true, priorInstallEvidence: true }))
      .toEqual({ migrate: false });
    expect(decideStreamDeckMigration({ configFileExists: true, priorInstallEvidence: false }))
      .toEqual({ migrate: false });
  });
});

describe('interpretConfigFile — corrupt is absent, not a choice', () => {
  it('null content is absent', () => {
    expect(interpretConfigFile(null)).toEqual({ state: 'absent' });
  });

  it('a parseable object is valid, normalized tolerantly', () => {
    const config = enabledConfig();
    expect(interpretConfigFile(JSON.stringify(config))).toEqual({ state: 'valid', config });
    expect(interpretConfigFile('{}')).toEqual({ state: 'valid', config: defaultConfig() });
  });

  it('unparseable content is corrupt', () => {
    for (const raw of ['{oops', '', 'not json at all', '{"mcp": }']) {
      expect(interpretConfigFile(raw)).toEqual({ state: 'corrupt' });
    }
  });

  it('parseable non-objects are corrupt too (no user wrote 42 as their config)', () => {
    for (const raw of ['42', '"off"', '[]', 'null', 'true']) {
      expect(interpretConfigFile(raw)).toEqual({ state: 'corrupt' });
    }
  });
});

describe('recoverFromConfigFile — the split failure mode (§6.2)', () => {
  it('valid file: used as-is, never re-migrated (deliberate off stays off)', () => {
    const off = JSON.stringify(defaultConfig()); // a user who turned everything off
    const r = recoverFromConfigFile(off, true); // even with upgrade evidence present
    expect(r.action).toBe('use');
    expect(r.corrupt).toBe(false);
    expect(r.config.streamDeck.enabled).toBe(false);
  });

  it('corrupt file + upgrade evidence: Stream Deck restored to ON, MCP stays off', () => {
    const r = recoverFromConfigFile('{oops', true);
    expect(r.action).toBe('migrate');
    expect(r.corrupt).toBe(true);
    expect(r.config.streamDeck).toEqual({ enabled: true, migratedFromUnconditional: true });
    // MCP fails closed: the migration never enables it, whatever was in the file.
    expect(r.config.mcp.readTier).toBe('off');
    expect(r.config.mcp.writesEnabled).toBe(false);
    expect(r.config.mcp.token).toBeNull();
  });

  it('corrupt file + no evidence: everything stays off', () => {
    const r = recoverFromConfigFile('{oops', false);
    expect(r.action).toBe('migrate');
    expect(r.corrupt).toBe(true);
    expect(r.config).toEqual(defaultConfig());
  });

  it('absent file migrates but is not flagged corrupt (nothing to preserve)', () => {
    const withEvidence = recoverFromConfigFile(null, true);
    expect(withEvidence).toMatchObject({ action: 'migrate', corrupt: false });
    expect(withEvidence.config.streamDeck.enabled).toBe(true);
    const fresh = recoverFromConfigFile(null, false);
    expect(fresh).toMatchObject({ action: 'migrate', corrupt: false });
    expect(fresh.config).toEqual(defaultConfig());
  });
});

describe('normalizeConfig — tolerant load, fails toward off', () => {
  it('garbage collapses to the all-off defaults', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}]) {
      expect(normalizeConfig(raw)).toEqual(defaultConfig());
    }
  });

  it('round-trips a valid config', () => {
    const config = enabledConfig('dayglance_calendar');
    expect(normalizeConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  });

  it('writesEnabled cannot survive without a read tier (writes ride on reads, §6.3)', () => {
    const raw = { mcp: { readTier: 'off', writesEnabled: true, token: 't' } };
    expect(normalizeConfig(raw).mcp.writesEnabled).toBe(false);
  });

  it('unknown tiers collapse to off', () => {
    expect(normalizeConfig({ mcp: { readTier: 'everything' } }).mcp.readTier).toBe('off');
  });
});

describe('mcpGates — §6.3 tier resolution', () => {
  it('off: not bound, nothing included', () => {
    expect(mcpGates(defaultConfig())).toEqual({ bound: false, includeNative: false, includeWrites: false });
  });

  it('dayglance tier: bound, _native excluded, writes off by default', () => {
    expect(mcpGates(enabledConfig('dayglance'))).toEqual({ bound: true, includeNative: false, includeWrites: false });
  });

  it('calendar tier: bound with _native included', () => {
    expect(mcpGates(enabledConfig('dayglance_calendar'))).toEqual({ bound: true, includeNative: true, includeWrites: false });
  });

  it('writes gate only opens on top of a bound read tier', () => {
    const withWrites = apply(enabledConfig(), { type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true });
    if (!withWrites.ok) throw new Error(withWrites.error);
    expect(mcpGates(withWrites.config).includeWrites).toBe(true);
  });

  it('a tier without a token is NOT bound (fail closed)', () => {
    const config = enabledConfig();
    config.mcp.token = null;
    expect(mcpGates(config).bound).toBe(false);
    expect(mcpGates(config).includeNative).toBe(false);
  });

  it('writes never leak through an unbound config', () => {
    const withWrites = apply(enabledConfig(), { type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true });
    if (!withWrites.ok) throw new Error(withWrites.error);
    withWrites.config.mcp.token = null; // unbound (fail-closed) but writesEnabled still true
    expect(mcpGates(withWrites.config).includeWrites).toBe(false);
  });
});

describe('applyTransition — consent-state machine', () => {
  it('enabling reads from off REQUIRES a fresh consentConfirmed', () => {
    const refused = apply(defaultConfig(), { type: 'set-mcp-read-tier', tier: 'dayglance' });
    expect(refused.ok).toBe(false);
    const alsoRefused = apply(defaultConfig(), { type: 'set-mcp-read-tier', tier: 'dayglance', consentConfirmed: false });
    expect(alsoRefused.ok).toBe(false);
  });

  it('a stored consent stamp never substitutes for the dialog on re-enable', () => {
    const off = apply(enabledConfig(), { type: 'set-mcp-read-tier', tier: 'off' });
    if (!off.ok) throw new Error(off.error);
    expect(off.config.mcp.consentAcceptedAt).not.toBeNull(); // history kept…
    const reEnable = apply(off.config, { type: 'set-mcp-read-tier', tier: 'dayglance' });
    expect(reEnable.ok).toBe(false); // …but the dialog is required again
  });

  it('the calendar tier needs its own consent, both from off and as an upgrade from dayglance', () => {
    const fromOff = apply(defaultConfig(), { type: 'set-mcp-read-tier', tier: 'dayglance_calendar', consentConfirmed: true });
    expect(fromOff.ok).toBe(false);
    const upgrade = apply(enabledConfig('dayglance'), { type: 'set-mcp-read-tier', tier: 'dayglance_calendar' });
    expect(upgrade.ok).toBe(false);
    const upgradeOk = apply(enabledConfig('dayglance'), {
      type: 'set-mcp-read-tier', tier: 'dayglance_calendar', calendarConsentConfirmed: true,
    });
    expect(upgradeOk.ok).toBe(true);
  });

  it('downgrading calendar → dayglance and any tier → off need no consent', () => {
    const down = apply(enabledConfig('dayglance_calendar'), { type: 'set-mcp-read-tier', tier: 'dayglance' });
    expect(down.ok).toBe(true);
    const off = apply(enabledConfig(), { type: 'set-mcp-read-tier', tier: 'off' });
    expect(off.ok).toBe(true);
  });

  it('first enable mints the token; re-enable keeps the existing one', () => {
    const first = apply(defaultConfig(), { type: 'set-mcp-read-tier', tier: 'dayglance', consentConfirmed: true });
    if (!first.ok) throw new Error(first.error);
    expect(first.config.mcp.token).toBe(deps.generateToken());
    const config = enabledConfig();
    config.mcp.token = 'existing-token';
    const off = apply(config, { type: 'set-mcp-read-tier', tier: 'off' });
    if (!off.ok) throw new Error(off.error);
    const back = apply(off.config, { type: 'set-mcp-read-tier', tier: 'dayglance', consentConfirmed: true });
    if (!back.ok) throw new Error(back.error);
    expect(back.config.mcp.token).toBe('existing-token');
  });

  it('turning reads off also turns writes off', () => {
    const w = apply(enabledConfig(), { type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true });
    if (!w.ok) throw new Error(w.error);
    const off = apply(w.config, { type: 'set-mcp-read-tier', tier: 'off' });
    if (!off.ok) throw new Error(off.error);
    expect(off.config.mcp.writesEnabled).toBe(false);
  });

  it('writes: refused with reads off, refused without confirmation, disable always allowed', () => {
    expect(apply(defaultConfig(), { type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true }).ok).toBe(false);
    expect(apply(enabledConfig(), { type: 'set-mcp-writes', enabled: true }).ok).toBe(false);
    expect(apply(enabledConfig(), { type: 'set-mcp-writes', enabled: false }).ok).toBe(true);
  });

  it('rotate-token replaces the token and refuses when none exists', () => {
    const config = enabledConfig();
    config.mcp.token = 'old-token';
    const rotated = apply(config, { type: 'rotate-token' });
    if (!rotated.ok) throw new Error(rotated.error);
    expect(rotated.config.mcp.token).toBe(deps.generateToken());
    expect(rotated.config.mcp.token).not.toBe('old-token');
    expect(apply(defaultConfig(), { type: 'rotate-token' }).ok).toBe(false);
  });

  it('set-mcp-port validates via the injected resolver and never scans', () => {
    const okPort = apply(defaultConfig(), { type: 'set-mcp-port', portOverride: 7900 });
    if (!okPort.ok) throw new Error(okPort.error);
    expect(okPort.config.mcp.portOverride).toBe(7900);
    expect(apply(defaultConfig(), { type: 'set-mcp-port', portOverride: 'seven' }).ok).toBe(false);
    const cleared = apply(okPort.config, { type: 'set-mcp-port', portOverride: null });
    if (!cleared.ok) throw new Error(cleared.error);
    expect(cleared.config.mcp.portOverride).toBeNull();
  });

  it('user toggling Stream Deck clears the migration provenance', () => {
    const migrated = defaultConfig();
    migrated.streamDeck.enabled = true;
    migrated.streamDeck.migratedFromUnconditional = true;
    const off = apply(migrated, { type: 'set-stream-deck', enabled: false });
    if (!off.ok) throw new Error(off.error);
    expect(off.config.streamDeck).toEqual({ enabled: false, migratedFromUnconditional: false });
  });

  it('never mutates its input', () => {
    const config = defaultConfig();
    const frozen = JSON.stringify(config);
    apply(config, { type: 'set-mcp-read-tier', tier: 'dayglance', consentConfirmed: true });
    apply(config, { type: 'set-stream-deck', enabled: true });
    expect(JSON.stringify(config)).toBe(frozen);
  });
});

describe('listenerEffects — reconciliation diff', () => {
  it('stream deck start/stop/none', () => {
    const off = defaultConfig();
    const on = apply(off, { type: 'set-stream-deck', enabled: true });
    if (!on.ok) throw new Error(on.error);
    expect(listenerEffects(off, on.config).streamDeck).toBe('start');
    expect(listenerEffects(on.config, off).streamDeck).toBe('stop');
    expect(listenerEffects(off, off).streamDeck).toBe('none');
  });

  it('mcp start on bind, stop on unbind, restart on port change while bound', () => {
    const off = defaultConfig();
    const on = enabledConfig();
    expect(listenerEffects(off, on).mcp).toBe('start');
    expect(listenerEffects(on, off).mcp).toBe('stop');
    const moved = apply(on, { type: 'set-mcp-port', portOverride: 7900 });
    if (!moved.ok) throw new Error(moved.error);
    expect(listenerEffects(on, moved.config).mcp).toBe('restart');
  });

  it('token rotation is NOT a restart — the getter makes it instant', () => {
    const on = enabledConfig();
    const rotated = apply(on, { type: 'rotate-token' });
    if (!rotated.ok) throw new Error(rotated.error);
    expect(listenerEffects(on, rotated.config).mcp).toBe('none');
  });

  it('tier changes while bound are none (gates re-read live)', () => {
    const day = enabledConfig('dayglance');
    const cal = apply(day, { type: 'set-mcp-read-tier', tier: 'dayglance_calendar', calendarConsentConfirmed: true });
    if (!cal.ok) throw new Error(cal.error);
    expect(listenerEffects(day, cal.config).mcp).toBe('none');
  });
});
