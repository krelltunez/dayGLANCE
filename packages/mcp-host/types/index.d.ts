// Hand-maintained declarations for @glance-apps/mcp-host. The package is plain
// ESM JavaScript; these types are what a TypeScript host (the dayGLANCE
// Electron main process) compiles against, so keep them exact.

import type { Server } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/server';

// ── auth.js ──────────────────────────────────────────────────────────────────

export const DEFAULT_AUTH_REALM: 'MCP';

/**
 * Why a rejection happened. Internal only: logs and a settings surface may
 * distinguish these, but the HTTP response must not (see unauthorizedResponse).
 */
export type BearerRejection = 'missing-header' | 'malformed-header' | 'wrong-token';

export type BearerCheckResult = { ok: true } | { ok: false; reason: BearerRejection };

/** 32 CSPRNG bytes as 64 lowercase hex chars. */
export function generateMcpToken(): string;

/**
 * Constant-time check of a raw `Authorization` header against the configured
 * token. A repeated header is malformed; an empty expected token never matches.
 */
export function checkBearerToken(header: string | string[] | undefined, expectedToken: string): BearerCheckResult;

/** The one 401 the listener sends, identical for every rejection reason. */
export function unauthorizedResponse(realm?: string): {
  status: 401;
  headers: Record<string, string>;
  body: string;
};

// ── port.js ──────────────────────────────────────────────────────────────────

export type PortResolution =
  | { ok: true; port: number }
  | { ok: false; reason: string };

/**
 * Exactly one port: the override when given (an integer 1-65535, as a number
 * or decimal string), else `defaultPort`. Never a scan; port 0 is refused.
 */
export function resolvePort(override: unknown, defaultPort: number): PortResolution;

/** The loud bind-failure message: names the port, never suggests a retry. */
export function describeBindFailure(
  port: number,
  err: { code?: string; message?: string },
  opts?: { appName?: string; host?: string },
): string;

/** `host:port`, with an IPv6 literal bracketed. */
export function hostPort(host: string, port: number): string;

// ── rateLimit.js ─────────────────────────────────────────────────────────────

export const DEFAULT_WRITE_LIMIT_PER_MINUTE: number;
export const DEFAULT_WRITE_WINDOW_MS: number;

export interface WriteRateLimiterOptions {
  /** Writes allowed per window. Non-positive means writes are never allowed. */
  limit?: number;
  windowMs?: number;
  /** Injectable clock so tests can advance time without waiting. */
  now?: () => number;
}

export interface WriteRateLimiter {
  /** Admit one write for `key` (the bearer token); refusals are not recorded. */
  tryAcquire(key: string): boolean;
  countInWindow(key: string): number;
  reset(): void;
}

export function createWriteRateLimiter(opts?: WriteRateLimiterOptions): WriteRateLimiter;

// ── writeGate.js ─────────────────────────────────────────────────────────────

export const DEFAULT_VIOLATION_LIMIT: number;
export const DEFAULT_VIOLATION_WINDOW_MS: number;

export type WriteAdmission =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'rate_limited' | 'writes_disabled';
      /** True exactly once: on the violation that flipped writes off. */
      disabledNow: boolean;
    };

export interface WriteGateOptions extends WriteRateLimiterOptions {
  /** Violations within violationWindowMs that trigger auto-disable. */
  violationLimit?: number;
  violationWindowMs?: number;
}

export interface WriteGate {
  tryWrite(key: string): WriteAdmission;
  writesDisabled(): boolean;
  /** Explicit re-enable. */
  reset(): void;
}

export function createWriteGate(opts?: WriteGateOptions): WriteGate;

// ── idempotency.js ───────────────────────────────────────────────────────────

export const DEFAULT_IDEMPOTENCY_TTL_MS: number;
export const DEFAULT_IDEMPOTENCY_MAX_ENTRIES: number;

export interface IdempotencyStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export interface IdempotencyStore<T> {
  /** The stored first-attempt result, or null when absent/expired. */
  get(storeKey: string): T | null;
  put(storeKey: string, value: T): void;
  size(): number;
  reset(): void;
}

/** A caller-supplied key must be shaped like an id, not a payload. */
export function isValidIdempotencyKey(value: unknown): value is string;

/** Length-prefixed (token, tool, key), so no crafted key collides across fields. */
export function makeStoreKey(token: string, tool: string, idempotencyKey: string): string;

export function createIdempotencyStore<T>(opts?: IdempotencyStoreOptions): IdempotencyStore<T>;

// ── pagination.js ────────────────────────────────────────────────────────────

export const DEFAULT_LIST_LIMIT: number;
export const MAX_LIST_LIMIT: number;
export const DEFAULT_CURSOR_PREFIX: string;

export function encodeCursor(offset: number, filterKey: string, prefix?: string): string;

/** {offset, filterKey}, or null for anything not produced by encodeCursor under `prefix`. */
export function decodeCursor(cursor: string, prefix?: string): { offset: number; filterKey: string } | null;

export type PageResult<T> =
  | {
      ok: true;
      items: T[];
      /** True when items remain past this page: the §5.1 truncation flag. */
      truncated: boolean;
      /** Present exactly when truncated. */
      nextCursor: string | null;
      /** Total items in the full list, so the model can report "50 of 312". */
      total: number;
    }
  | { ok: false; reason: string };

export function paginate<T>(
  items: T[],
  opts: { limit?: unknown; cursor?: unknown; filterKey: string; cursorPrefix?: string },
): PageResult<T>;

// ── journal.js ───────────────────────────────────────────────────────────────

export interface JournalEntry<Op = unknown> {
  seq: number;
  /** ISO timestamp of the write (host clock). */
  at: string;
  /** MCP tool that performed the write. */
  tool: string;
  /** Display-ready description of what changed; the entity title quoted “ ”. */
  summary: string;
  /** The caller's idempotency key, when it sent one. */
  idempotencyKey?: string;
  op: Op;
}

export interface JournalRecord<Op = unknown> {
  tool: string;
  summary: string;
  idempotencyKey?: string;
  op: Op;
}

export interface JournalGroup {
  key: string;
  label: string;
  count: number;
  /** seq of the group's newest entry, for newest-activity-first ordering. */
  latestSeq: number;
}

export interface JournalGrouping<Op = unknown> {
  /** The single entity an op reverses. Should throw on an op kind it does not know. */
  groupKey(op: Op): string;
  /** The group's label, taken from its latest entry. Default: defaultGroupLabel. */
  groupLabel?(entry: JournalEntry<Op>): string;
}

export interface JournalSnapshot {
  total: number;
  entries: Array<Omit<JournalEntry, 'op'> & { groupKey: string }>;
  groups: JournalGroup[];
}

export function appendEntry<Op>(entries: JournalEntry<Op>[], record: JournalRecord<Op>, nowIso: string): JournalEntry<Op>[];

/** First “ to last ” of a summary, or null when it quotes nothing. */
export function summaryTitle(summary: string): string | null;

/** The quoted title, or the raw summary when it quotes none. */
export function defaultGroupLabel(entry: { summary: string }): string;

export function journalGroups<Op>(entries: JournalEntry<Op>[], grouping: JournalGrouping<Op>): JournalGroup[];

export function journalSnapshot<Op>(
  entries: JournalEntry<Op>[],
  grouping: JournalGrouping<Op>,
  displayLimit?: number,
): JournalSnapshot;

/** Every op, newest first, so compound histories unwind. */
export function buildUndoPlan<Op>(entries: JournalEntry<Op>[]): { count: number; ops: Op[] };

// ── dates.js ─────────────────────────────────────────────────────────────────

/** Strict YYYY-MM-DD of a date that exists. */
export function isValidLocalDate(value: unknown): value is string;

/** The local calendar date of `epochMs` in `timeZone`, as YYYY-MM-DD. */
export function localDateOf(epochMs: number, timeZone: string): string;

/** The `{date, timezone}` echo every dated tool response carries (§5.3). */
export interface DateEnvelope {
  /** The resolved local calendar date the response is about. */
  date: string;
  /** The IANA timezone the server resolved (e.g. "America/Chicago"). */
  timezone: string;
}

export function dateEnvelope(date: string, timeZone: string): DateEnvelope;

// ── localTime.js ─────────────────────────────────────────────────────────────

/** Strict local wall-clock time: HH:MM, 24h, zero-padded. */
export function isValidWallTime(value: unknown): value is string;

export type LocalTimeResolution =
  | { kind: 'unique' }
  | { kind: 'nonexistent' }
  | { kind: 'ambiguous' };

export function resolveLocalTime(date: string, time: string, timeZone: string): LocalTimeResolution;

/** null when acceptable, else the validation message the tool returns verbatim. */
export function validateStartTime(date: string, time: string, timeZone: string): string | null;

// ── the bridge (types only) ──────────────────────────────────────────────────

/** A typed failure from the app's data side. */
export interface BridgeError {
  code: string;
  message: string;
}

/**
 * One answer from the bridge. `undo` is the write-journal descriptor a write
 * returns beside its data, host-side metadata that never reaches tool output.
 */
export type BridgeResult =
  | { ok: true; data: unknown; undo?: unknown }
  | { ok: false; error: BridgeError };

/**
 * The seam between the MCP tools and the app's data: the tools send a method
 * and params, the app answers from its state. An implementation must never
 * reject and never hang: when the data side cannot answer (a crashed window, a
 * store not loaded), `request` resolves to `{ ok: false }` with the
 * implementation's typed unavailable code (dayGLANCE: `renderer_unavailable`),
 * so a tool can say "unavailable" and never return an empty result.
 */
export interface HostBridge {
  /** Send one request; resolves with the answer or a typed error. Never rejects, never hangs. */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<BridgeResult>;
  /** Health check: a cheap, short-timeout round trip. */
  ping(): Promise<boolean>;
  dispose(): void;
}

// ── listener.js ──────────────────────────────────────────────────────────────

export const DEFAULT_MCP_PATH: '/mcp';
export const DEFAULT_BIND_ADDRESS: '127.0.0.1';
/** The hostnames the SDK's localhost guards allow. */
export const LOCALHOST_NAMES: readonly string[];

/** A loopback literal (127.0.0.0/8, ::1, IPv4-mapped loopback). Names and wildcards are not. */
export function isLoopbackAddress(address: unknown): boolean;

export function normalizeAllowlist(
  kind: string,
  list: unknown,
  opts?: { allowSchemeWildcards?: boolean },
): { ok: true; list: string[] } | { ok: false; reason: string };

export interface McpListenerOptions {
  /** The app's name, for log lines (`[name] ...`), bind-failure text and the default realm. */
  name: string;
  /**
   * Builds a fresh McpServer for each request (spec §3.7): register the tools
   * and resources here, closing over host state. Never return a shared instance.
   */
  createServer: () => McpServer;
  /**
   * The pre-shared bearer token, as a value or a getter. A getter is read on
   * EVERY request, so rotation invalidates the old token on the very next
   * request without a restart. Empty is refused at start, on every bind address.
   */
  token: string | (() => string);
  /** Raw user/env port override, resolved by resolvePort. */
  portOverride?: unknown;
  /** The port when there is no override. */
  defaultPort: number;
  /**
   * Bind address. Default 127.0.0.1 (loopback only). A non-loopback address is
   * for a host on a LAN box or behind a reverse proxy; pair it with allowedHosts.
   */
  host?: string;
  /** Endpoint path. Default '/mcp'; every other path is 404 before any other guard. */
  path?: string;
  /**
   * Host header allowlist: bare hostnames, port-agnostic, IPv6 bracketed.
   * Default (undefined): the SDK's localhost guard, exactly. Empty is refused.
   */
  allowedHosts?: string[];
  /**
   * Origin allowlist: hostnames, or `<scheme>://*` for a non-http scheme.
   * Default (undefined): the SDK's localhost guard. Requests with no Origin pass
   * either way; an empty list refuses every browser origin.
   */
  allowedOrigins?: string[];
  /** WWW-Authenticate realm. Default `${name} MCP`. */
  realm?: string;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
}

/**
 * Start the listener. Returns the http.Server (the caller owns shutdown and may
 * listen for 'listening' and 'error'), or null when it refuses to start; every
 * refusal is logged. Guard order per request: path → Host → Origin → token.
 */
export function startMcpListener(opts: McpListenerOptions): Server | null;
