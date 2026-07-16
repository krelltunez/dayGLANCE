import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initStartupLog,
  logStartup,
  startupLogPath,
  STARTUP_LOG_FILENAME,
  MAX_LOG_BYTES,
  __resetStartupLogForTests,
} from './startupLog.js';

// The logger does real fs I/O against a temp userData dir. It must be
// bounded (never grow without limit) and must never throw into startup.

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayglance-startuplog-'));
  __resetStartupLogForTests();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('initStartupLog / logStartup', () => {
  it('creates the log under userData and appends timestamped lines', () => {
    const p = initStartupLog(dir);
    expect(p).toBe(path.join(dir, STARTUP_LOG_FILENAME));
    expect(startupLogPath()).toBe(p);

    logStartup('createWindow: called');
    logStartup('main window ready-to-show');

    const contents = fs.readFileSync(p!, 'utf-8');
    expect(contents).toContain('===== session');
    expect(contents).toContain('createWindow: called');
    expect(contents).toContain('main window ready-to-show');
  });

  it('preserves prior sessions across inits (appends a new session header)', () => {
    initStartupLog(dir);
    logStartup('first launch line');
    __resetStartupLogForTests();

    initStartupLog(dir);
    const contents = fs.readFileSync(path.join(dir, STARTUP_LOG_FILENAME), 'utf-8');
    // Old content kept, and a second session header added.
    expect(contents).toContain('first launch line');
    expect(contents.match(/===== session/g)?.length).toBe(2);
  });

  it('drops an oversized log on init so it can never grow without bound', () => {
    const target = path.join(dir, STARTUP_LOG_FILENAME);
    fs.writeFileSync(target, 'x'.repeat(MAX_LOG_BYTES + 1));

    initStartupLog(dir);
    const contents = fs.readFileSync(target, 'utf-8');
    expect(contents).not.toContain('xxxx'); // stale bulk gone
    expect(contents).toContain('===== session'); // fresh header only
    expect(contents.length).toBeLessThan(MAX_LOG_BYTES);
  });

  it('logStartup is a no-op (no throw) before init', () => {
    expect(() => logStartup('should be ignored')).not.toThrow();
    expect(startupLogPath()).toBeNull();
  });
});
