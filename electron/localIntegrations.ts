// Local-integrations configuration decisions (spec §6.2/§6.3), extracted as
// pure functions in the startupQuit.ts style: migration, tier resolution, and
// consent-state transitions all live here, tested; file I/O and listener
// lifecycle live in main.ts.
//
// THE BLOCKING ITEM (§6.2): the Stream Deck listener has shipped
// unconditionally enabled since it existed. Introducing an off-by-default
// toggle would silently kill every existing user's buttons on auto-update —
// no error, dead keys. So existing installs MIGRATE TO ON exactly once, and
// a READABLE config file is the one-time flag: while one exists and parses,
// migration never runs again, so a user's later "off" can never be
// re-enabled by an update. A corrupt/unparseable file is NOT a choice the
// user made — it is treated as absent and the migration re-runs against the
// on-disk evidence (see interpretConfigFile). Fresh installs start with
// everything off.

export type McpReadTier = 'off' | 'dayglance' | 'dayglance_calendar';

export interface LocalIntegrationsConfig {
  version: 1;
  streamDeck: {
    enabled: boolean;
    /** True when `enabled` came from the §6.2 upgrade migration, not a user choice. */
    migratedFromUnconditional: boolean;
  };
  mcp: {
    readTier: McpReadTier;
    /** Writes are a separate opt-in ON TOP of a read tier (§6.3). */
    writesEnabled: boolean;
    /** Pre-shared bearer token; null until first enable. */
    token: string | null;
    /** User port override; null = DEFAULT_MCP_PORT. */
    portOverride: number | null;
    /** When the §6.4 base consent copy was accepted. */
    consentAcceptedAt: string | null;
    /** When the device-calendar tier's own copy (§6.4) was accepted. */
    calendarConsentAcceptedAt: string | null;
    /** When the writes opt-in was confirmed. */
    writesConsentAcceptedAt: string | null;
  };
}

export function defaultConfig(): LocalIntegrationsConfig {
  return {
    version: 1,
    streamDeck: { enabled: false, migratedFromUnconditional: false },
    mcp: {
      readTier: 'off',
      writesEnabled: false,
      token: null,
      portOverride: null,
      consentAcceptedAt: null,
      calendarConsentAcceptedAt: null,
      writesConsentAcceptedAt: null,
    },
  };
}

/**
 * The §6.2 migration decision, made once at startup BEFORE any listener binds.
 *
 * - Config file exists → it is the authority; never migrate again. This is
 *   what makes a user's deliberate "off" stick across every later update.
 * - No config file + evidence of a prior install → upgrade: Stream Deck ON.
 * - No config file + no evidence → fresh install: everything off.
 *
 * `priorInstallEvidence` is "any pre-existing userData artifact that only a
 * previous RUN could have created" — window-state.json (written on window
 * close/move), window-theme.json (written on first theme report), or the
 * .origin-migrated-file-to-app-v1 flag (written on first run of any modern
 * version). The startup log is NOT usable evidence: it is created at module
 * load of the current run, before this decision executes.
 */
export function decideStreamDeckMigration(input: {
  configFileExists: boolean;
  priorInstallEvidence: boolean;
}): { migrate: false } | { migrate: true; enabled: boolean } {
  if (input.configFileExists) return { migrate: false };
  return { migrate: true, enabled: input.priorInstallEvidence };
}

/**
 * Classify the on-disk config file's CONTENT (main.ts owns the reading).
 *
 * - null (file absent, or unreadable with the read error swallowed upstream
 *   mapped to '') → 'absent'
 * - JSON that parses to a plain object → 'valid', normalized tolerantly
 * - anything else (parse failure, or JSON that is not an object — no user
 *   ever wrote `42` as their integrations config) → 'corrupt'
 *
 * 'corrupt' exists because the two integrations must fail DIFFERENTLY (§6.2):
 * MCP fails closed — nobody consented to a listener, so off is right. Stream
 * Deck fails OPEN to the migration: it ran unconditionally before the toggle
 * existed, so a user with a mangled config would otherwise lose their buttons
 * silently, blamed on a file they have never heard of. A corrupt file is
 * therefore treated as ABSENT (re-run the migration against the on-disk
 * evidence), not as an all-off choice the user never made.
 */
export function interpretConfigFile(fileContent: string | null):
  | { state: 'absent' }
  | { state: 'corrupt' }
  | { state: 'valid'; config: LocalIntegrationsConfig } {
  if (fileContent === null) return { state: 'absent' };
  try {
    const parsed: unknown = JSON.parse(fileContent);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { state: 'valid', config: normalizeConfig(parsed) };
    }
  } catch {
    // fall through: unparseable is corrupt
  }
  return { state: 'corrupt' };
}

/**
 * The whole startup decision, pure: file content in, config out.
 *
 * - 'use': a valid config file is the sole authority (the one-time §6.2 flag
 *   working as designed — a deliberate "off" survives every update).
 * - 'migrate': absent OR corrupt content re-runs the §6.2 migration against
 *   the prior-install evidence. Upgrade evidence restores Stream Deck to ON;
 *   MCP stays off either way, because the migration never enables it — a
 *   fresh consent is the only path to a bound listener.
 *
 * `corrupt` tells main.ts to preserve the unreadable file (moved aside, never
 * overwritten in place) and to log the recovery.
 */
export function recoverFromConfigFile(
  fileContent: string | null,
  priorInstallEvidence: boolean,
): { action: 'use' | 'migrate'; config: LocalIntegrationsConfig; corrupt: boolean } {
  const interpreted = interpretConfigFile(fileContent);
  if (interpreted.state === 'valid') {
    return { action: 'use', config: interpreted.config, corrupt: false };
  }
  const decision = decideStreamDeckMigration({ configFileExists: false, priorInstallEvidence });
  const config = defaultConfig();
  if (decision.migrate && decision.enabled) {
    config.streamDeck.enabled = true;
    config.streamDeck.migratedFromUnconditional = true;
  }
  return { action: 'migrate', config, corrupt: interpreted.state === 'corrupt' };
}

/** Tolerant load: anything malformed collapses to safe defaults (everything off). */
export function normalizeConfig(raw: unknown): LocalIntegrationsConfig {
  const base = defaultConfig();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, any>;
  const sd = typeof r['streamDeck'] === 'object' && r['streamDeck'] !== null ? r['streamDeck'] : {};
  const mcp = typeof r['mcp'] === 'object' && r['mcp'] !== null ? r['mcp'] : {};
  const tier: McpReadTier = mcp.readTier === 'dayglance' || mcp.readTier === 'dayglance_calendar' ? mcp.readTier : 'off';
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    version: 1,
    streamDeck: {
      enabled: sd.enabled === true,
      migratedFromUnconditional: sd.migratedFromUnconditional === true,
    },
    mcp: {
      readTier: tier,
      writesEnabled: mcp.writesEnabled === true && tier !== 'off',
      token: str(mcp.token),
      portOverride: Number.isInteger(mcp.portOverride) ? mcp.portOverride : null,
      consentAcceptedAt: str(mcp.consentAcceptedAt),
      calendarConsentAcceptedAt: str(mcp.calendarConsentAcceptedAt),
      writesConsentAcceptedAt: str(mcp.writesConsentAcceptedAt),
    },
  };
}

/**
 * Tier resolution (§6.3): the three gates the listeners consume. These are
 * the values behind the closures main.ts hands to the tool modules — the
 * closures Phase 2/3 built precisely so this swap touches no tool code.
 */
export function mcpGates(config: LocalIntegrationsConfig): {
  bound: boolean;
  includeNative: boolean;
  includeWrites: boolean;
} {
  const bound = config.mcp.readTier !== 'off' && config.mcp.token !== null;
  return {
    bound,
    includeNative: bound && config.mcp.readTier === 'dayglance_calendar',
    includeWrites: bound && config.mcp.writesEnabled,
  };
}

export type TransitionAction =
  | { type: 'set-stream-deck'; enabled: boolean }
  | { type: 'set-mcp-read-tier'; tier: McpReadTier; consentConfirmed?: boolean; calendarConsentConfirmed?: boolean }
  | { type: 'set-mcp-writes'; enabled: boolean; writesConsentConfirmed?: boolean }
  | { type: 'rotate-token' }
  | { type: 'set-mcp-port'; portOverride: unknown };

export type TransitionResult =
  | { ok: true; config: LocalIntegrationsConfig }
  | { ok: false; error: string };

export interface TransitionDeps {
  nowIso: () => string;
  /** Injectable so tests need no CSPRNG; main.ts passes generateMcpToken. */
  generateToken: () => string;
  /** Injectable port validation; main.ts passes resolveMcpPort. */
  resolvePort: (override: unknown) => { ok: true; port: number } | { ok: false; reason: string };
}

/**
 * The consent-state machine (§6.3/§6.4). Every enabling transition demands a
 * FRESH confirmation in the action — stored stamps record history, they never
 * substitute for the dialog. MCP cannot reach a bound state through any path
 * that skips the consent copy.
 */
export function applyTransition(
  config: LocalIntegrationsConfig,
  action: TransitionAction,
  deps: TransitionDeps,
): TransitionResult {
  const next: LocalIntegrationsConfig = JSON.parse(JSON.stringify(config));

  switch (action.type) {
    case 'set-stream-deck': {
      next.streamDeck.enabled = action.enabled === true;
      // Any explicit user choice supersedes the migration provenance.
      next.streamDeck.migratedFromUnconditional = false;
      return { ok: true, config: next };
    }

    case 'set-mcp-read-tier': {
      const { tier } = action;
      if (tier !== 'off' && tier !== 'dayglance' && tier !== 'dayglance_calendar') {
        return { ok: false, error: `Unknown read tier ${JSON.stringify(tier)}` };
      }
      if (tier === 'off') {
        next.mcp.readTier = 'off';
        // Writes ride on top of a read tier (§6.3): no reads, no writes.
        next.mcp.writesEnabled = false;
        return { ok: true, config: next };
      }
      const enablingFromOff = config.mcp.readTier === 'off';
      if (enablingFromOff && action.consentConfirmed !== true) {
        return { ok: false, error: 'Enabling MCP reads requires accepting the consent notice' };
      }
      if (tier === 'dayglance_calendar' && config.mcp.readTier !== 'dayglance_calendar' && action.calendarConsentConfirmed !== true) {
        return { ok: false, error: 'Including device calendar events requires accepting the device-calendar consent notice' };
      }
      if (enablingFromOff) next.mcp.consentAcceptedAt = deps.nowIso();
      if (tier === 'dayglance_calendar' && config.mcp.readTier !== 'dayglance_calendar') {
        next.mcp.calendarConsentAcceptedAt = deps.nowIso();
      }
      if (next.mcp.token === null) next.mcp.token = deps.generateToken();
      next.mcp.readTier = tier;
      return { ok: true, config: next };
    }

    case 'set-mcp-writes': {
      if (action.enabled !== true) {
        next.mcp.writesEnabled = false;
        return { ok: true, config: next };
      }
      if (config.mcp.readTier === 'off') {
        return { ok: false, error: 'Writes require a read tier to be enabled first (§6.3)' };
      }
      if (action.writesConsentConfirmed !== true) {
        return { ok: false, error: 'Enabling MCP writes requires accepting the writes notice' };
      }
      next.mcp.writesEnabled = true;
      next.mcp.writesConsentAcceptedAt = deps.nowIso();
      return { ok: true, config: next };
    }

    case 'rotate-token': {
      if (config.mcp.token === null) {
        return { ok: false, error: 'No token to rotate; enable MCP first' };
      }
      next.mcp.token = deps.generateToken();
      return { ok: true, config: next };
    }

    case 'set-mcp-port': {
      const raw = action.portOverride;
      if (raw === null || raw === undefined || raw === '') {
        next.mcp.portOverride = null; // back to the default port
        return { ok: true, config: next };
      }
      const resolved = deps.resolvePort(raw);
      if (!resolved.ok) return { ok: false, error: resolved.reason };
      next.mcp.portOverride = resolved.port;
      return { ok: true, config: next };
    }

    default:
      return { ok: false, error: `Unknown action ${JSON.stringify((action as { type?: string }).type)}` };
  }
}

/**
 * What the listener lifecycle must do after a config change. Pure diff, so
 * the reconciler in main.ts stays a dumb executor.
 *
 * MCP 'restart' covers a port change while bound. A TOKEN change is
 * deliberately NOT a restart: the listener reads the token through a getter
 * on every request, so rotation invalidates the old token on the very next
 * request with zero downtime.
 */
export function listenerEffects(
  before: LocalIntegrationsConfig,
  after: LocalIntegrationsConfig,
): { streamDeck: 'start' | 'stop' | 'none'; mcp: 'start' | 'stop' | 'restart' | 'none' } {
  const sdBefore = before.streamDeck.enabled;
  const sdAfter = after.streamDeck.enabled;
  const streamDeck = sdBefore === sdAfter ? 'none' : sdAfter ? 'start' : 'stop';

  const boundBefore = mcpGates(before).bound;
  const boundAfter = mcpGates(after).bound;
  let mcp: 'start' | 'stop' | 'restart' | 'none';
  if (!boundBefore && boundAfter) mcp = 'start';
  else if (boundBefore && !boundAfter) mcp = 'stop';
  else if (boundBefore && boundAfter && before.mcp.portOverride !== after.mcp.portOverride) mcp = 'restart';
  else mcp = 'none';

  return { streamDeck, mcp };
}
