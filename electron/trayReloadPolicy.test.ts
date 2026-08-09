import { describe, it, expect } from 'vitest';
import {
  trayReloadDebounceMs,
  TRAY_RELOAD_DEBOUNCE_MS,
  TRAY_RELOAD_MCP_DEBOUNCE_MS,
  MCP_WRITE_RECENCY_MS,
} from './trayReloadPolicy.js';

// §3.6 under test: user saves keep the historical 500 ms debounce; a recent
// MCP write stretches it past the 2 s write cadence at the §4.3 rate limit,
// so an agent's write storm coalesces instead of reloading the tray per write.

describe('trayReloadDebounceMs', () => {
  const NOW = 1_000_000;

  it('uses the historical 500 ms when no MCP write has ever happened', () => {
    expect(TRAY_RELOAD_DEBOUNCE_MS).toBe(500);
    expect(trayReloadDebounceMs(NOW, null)).toBe(500);
  });

  it('stretches while MCP writes are recent — and longer than the 2 s rate-limit cadence', () => {
    expect(TRAY_RELOAD_MCP_DEBOUNCE_MS).toBeGreaterThan(2_000);
    expect(trayReloadDebounceMs(NOW, NOW)).toBe(TRAY_RELOAD_MCP_DEBOUNCE_MS);
    expect(trayReloadDebounceMs(NOW, NOW - MCP_WRITE_RECENCY_MS + 1)).toBe(TRAY_RELOAD_MCP_DEBOUNCE_MS);
  });

  it('reverts to 500 ms once the last MCP write is old enough', () => {
    expect(trayReloadDebounceMs(NOW, NOW - MCP_WRITE_RECENCY_MS)).toBe(TRAY_RELOAD_DEBOUNCE_MS);
    expect(trayReloadDebounceMs(NOW, NOW - 60 * 60_000)).toBe(TRAY_RELOAD_DEBOUNCE_MS);
  });

  it('fails toward coalescing on a backwards clock jump (future lastMcpWriteAt)', () => {
    expect(trayReloadDebounceMs(NOW, NOW + 5_000)).toBe(TRAY_RELOAD_MCP_DEBOUNCE_MS);
  });
});
