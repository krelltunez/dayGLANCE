// An in-memory GLANCEvault: the row endpoints the bridge uses (batch, list,
// getRow, deleteRow), with a monotonic per-server seq and soft deletes,
// mirroring glance-vault's routes/sync.ts as the client contracts them.
// Serves both sides of the harness: the plugin through the `obsidian` stub's
// requestUrl and dayGLANCE through a global fetch shim.
import type { StubResponse } from './obsidianStub';

export interface VaultRow { entityId: string; envelope: string | null; seq: number; deleted: boolean; createdAt: number }

export class FakeGlanceVault {
  private seq = 0;
  private rows = new Map<string, Map<string, VaultRow>>(); // app → entityId → row
  requests: Array<{ method: string; path: string; who: string; at: number }> = [];

  private table(app: string): Map<string, VaultRow> {
    if (!this.rows.has(app)) this.rows.set(app, new Map());
    return this.rows.get(app)!;
  }

  /** Every live (non-deleted) row of an app, seq order. */
  live(app: string): VaultRow[] { return [...this.table(app).values()].filter((r) => !r.deleted).sort((a, b) => a.seq - b.seq); }
  all(app: string): VaultRow[] { return [...this.table(app).values()].sort((a, b) => a.seq - b.seq); }
  get maxSeq(): number { return this.seq; }

  handle(method: string, rawUrl: string, body?: string, auth = ''): StubResponse {
    const url = new URL(rawUrl);
    const path = url.pathname;
    this.requests.push({ method, path, who: auth.replace(/^Bearer /, ''), at: Date.now() });
    const json = (status: number, payload: unknown): StubResponse => ({ status, json: payload, text: JSON.stringify(payload), headers: {} });
    const m = /^\/sync\/([^/]+)(?:\/([^/]+))?$/.exec(path);
    if (!m) return json(404, { error: 'not found' });
    const app = decodeURIComponent(m[1]);
    const tail = m[2] ? decodeURIComponent(m[2]) : null;
    if (method === 'POST' && tail === 'batch') {
      const parsed = JSON.parse(body ?? '{}') as { rows?: Array<{ entityId: string; envelope: string; createdAt?: number }> };
      let maxSeq = this.seq;
      const t = this.table(app);
      for (const r of parsed.rows ?? []) {
        const seq = ++this.seq; maxSeq = seq;
        t.set(r.entityId, { entityId: r.entityId, envelope: r.envelope, seq, deleted: false, createdAt: r.createdAt ?? Date.now() });
      }
      return json(200, { written: (parsed.rows ?? []).length, maxSeq });
    }
    if (method === 'GET' && tail === 'list') {
      const since = Number(url.searchParams.get('since') ?? 0) || 0;
      const rows = this.all(app).filter((r) => r.seq > since);
      return json(200, { rows, hasMore: false });
    }
    if (method === 'GET' && tail) {
      const row = this.table(app).get(tail);
      return row ? json(200, row) : json(404, { error: 'not found' });
    }
    if (method === 'DELETE' && tail) {
      const t = this.table(app);
      const row = t.get(tail);
      const seq = ++this.seq;
      t.set(tail, { entityId: tail, envelope: null, seq, deleted: true, createdAt: row?.createdAt ?? Date.now() });
      return json(200, { seq });
    }
    return json(404, { error: 'not found' });
  }

  /** A fetch-shaped adaptor for dayGLANCE's vault client. */
  fetch = async (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }> => {
    const res = this.handle(init.method ?? 'GET', url, init.body, init.headers?.Authorization ?? '');
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.json, text: async () => res.text };
  };
}
