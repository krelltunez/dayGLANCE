import type { StorageLike } from './types.js';

/**
 * Wraps a StorageLike so that quota errors, privacy-mode failures, and a
 * missing backend can never throw into engine code paths. Falls back to an
 * in-memory map when no backend is available (SSR, tests, headless).
 */
export class SafeStorage implements StorageLike {
  private readonly backend: StorageLike | null;
  private readonly memory = new Map<string, string>();

  constructor(backend?: StorageLike | null) {
    let resolved: StorageLike | null = backend ?? null;
    if (resolved === null) {
      try {
        const g = globalThis as { localStorage?: StorageLike };
        resolved = g.localStorage ?? null;
      } catch {
        resolved = null;
      }
    }
    this.backend = resolved;
  }

  getItem(key: string): string | null {
    try {
      if (this.backend) return this.backend.getItem(key);
    } catch {
      /* fall through to memory */
    }
    return this.memory.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    try {
      if (this.backend) {
        this.backend.setItem(key, value);
        return;
      }
    } catch {
      /* fall through to memory */
    }
    this.memory.set(key, value);
  }

  removeItem(key: string): void {
    try {
      if (this.backend) {
        this.backend.removeItem(key);
        return;
      }
    } catch {
      /* fall through to memory */
    }
    this.memory.delete(key);
  }
}
