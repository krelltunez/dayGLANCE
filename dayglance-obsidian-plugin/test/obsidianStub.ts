// A stub of the `obsidian` module for the bridge scenario harness: an
// in-memory vault with the events the plugin listens to, a metadata cache
// that parses frontmatter and tags, a workspace whose editors the tests
// open on purpose, and `requestUrl` routed to whatever fake server the test
// registers. Only what the plugin's transport, agenda store and block writer
// touch; nothing here models timing (Obsidian Sync, editor autosave), which
// stays a manual test by design.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const normalizePath = (p: string): string =>
  String(p ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');

export class TAbstractFile {
  path = '';
  name = '';
  parent: TFolder | null = null;
  vault!: Vault;
}
export class TFile extends TAbstractFile {
  basename = '';
  extension = '';
  stat = { ctime: 0, mtime: 0, size: 0 };
  constructor(path: string, vault: Vault, mtime: number) {
    super();
    this.vault = vault;
    this.setPath(path);
    this.stat = { ctime: mtime, mtime, size: 0 };
  }
  setPath(path: string): void {
    this.path = path;
    this.name = path.split('/').pop() ?? path;
    const dot = this.name.lastIndexOf('.');
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : '';
  }
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  constructor(path: string) { super(); this.path = path; this.name = path.split('/').pop() ?? path; }
  isRoot(): boolean { return this.path === ''; }
}

type Handler = (...args: any[]) => void;
class Events {
  private handlers = new Map<string, Set<Handler>>();
  on(name: string, cb: Handler): { name: string; cb: Handler } {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(cb);
    return { name, cb };
  }
  off(name: string, cb: Handler): void { this.handlers.get(name)?.delete(cb); }
  offref(ref: { name: string; cb: Handler }): void { this.off(ref.name, ref.cb); }
  trigger(name: string, ...args: any[]): void { for (const cb of [...(this.handlers.get(name) ?? [])]) cb(...args); }
}

// ── minimal YAML: scalars, inline arrays, block lists, one nested map level ──
const parseScalar = (raw: string): unknown => {
  const s = raw.trim();
  if (s === '' ) return '';
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map((x) => parseScalar(x)).filter((x) => x !== '');
  if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1);
  return s;
};
export function parseYaml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = /^([^\s:][^:]*):\s?(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const key = m[1].trim();
    const rest = m[2];
    if (rest.trim() !== '') { out[key] = parseScalar(rest); i++; continue; }
    // block list or nested map
    const items: unknown[] = [];
    const map: Record<string, unknown> = {};
    let isList = false; let isMap = false;
    i++;
    while (i < lines.length && /^\s+\S/.test(lines[i])) {
      const inner = lines[i].trim();
      if (inner.startsWith('- ')) { isList = true; items.push(parseScalar(inner.slice(2))); }
      else { const mm = /^([^:]+):\s?(.*)$/.exec(inner); if (mm) { isMap = true; map[mm[1].trim()] = parseScalar(mm[2]); } }
      i++;
    }
    out[key] = isList ? items : isMap ? map : null;
  }
  return out;
}
const quoteIfNeeded = (v: unknown): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return /[:#\[\]{}]|^\s|\s$/.test(s) ? JSON.stringify(s) : s;
};
export function stringifyYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) { lines.push(`${k}: []`); continue; }
      lines.push(`${k}:`); for (const it of v) lines.push(`  - ${quoteIfNeeded(it)}`);
    } else if (v && typeof v === 'object') {
      lines.push(`${k}:`); for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) lines.push(`  ${kk}: ${Array.isArray(vv) ? `[${vv.map(quoteIfNeeded).join(', ')}]` : quoteIfNeeded(vv)}`);
    } else lines.push(`${k}: ${quoteIfNeeded(v)}`);
  }
  return lines.join('\n') + '\n';
}
const splitFrontmatter = (text: string): { fm: string | null; body: string } => {
  if (!text.startsWith('---\n')) return { fm: null, body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { fm: null, body: text };
  const after = end + 4;
  return { fm: text.slice(4, end + 1), body: text.slice(after).replace(/^\n/, '') };
};

export interface CachedMetadata { frontmatter?: Record<string, unknown>; tags?: Array<{ tag: string }> }
export function getAllTags(cache: CachedMetadata | null): string[] | null {
  if (!cache) return null;
  const out = new Set<string>();
  const fmTags = cache.frontmatter?.tags;
  for (const t of Array.isArray(fmTags) ? fmTags : typeof fmTags === 'string' ? [fmTags] : []) out.add(String(t).startsWith('#') ? String(t) : `#${t}`);
  for (const t of cache.tags ?? []) out.add(t.tag);
  return [...out];
}

export class Vault extends Events {
  files = new Map<string, TFile>();
  contents = new Map<string, string>();
  folders = new Set<string>(['']);
  now: () => number = () => Date.now();
  writes = 0;
  adapter = {
    exists: async (p: string) => this.files.has(normalizePath(p)) || this.folders.has(normalizePath(p)),
    read: async (p: string) => { const c = this.contents.get(normalizePath(p)); if (c === undefined) throw new Error(`ENOENT ${p}`); return c; },
    stat: async (p: string) => { const f = this.files.get(normalizePath(p)); return f ? { ...f.stat, type: 'file' } : null; },
    mkdir: async (p: string) => { this.folders.add(normalizePath(p)); },
    write: async (p: string, data: string) => { await this.writeRaw(normalizePath(p), data); },
    remove: async (p: string) => { const f = this.files.get(normalizePath(p)); if (f) await this.delete(f); },
  };
  private async writeRaw(path: string, data: string): Promise<TFile> {
    const existing = this.files.get(path);
    this.contents.set(path, data);
    this.writes++;
    if (existing) {
      existing.stat = { ...existing.stat, mtime: this.now(), size: data.length };
      this.trigger('modify', existing);
      (this as any).__cache?.invalidate(existing);
      return existing;
    }
    const file = new TFile(path, this, this.now());
    this.files.set(path, file);
    this.ensureFolders(path);
    this.trigger('create', file);
    (this as any).__cache?.invalidate(file);
    return file;
  }
  private ensureFolders(path: string): void {
    const segs = path.split('/').slice(0, -1);
    let dir = '';
    for (const s of segs) { dir = dir ? `${dir}/${s}` : s; this.folders.add(dir); }
  }
  getAbstractFileByPath(p: string): TFile | TFolder | null {
    const n = normalizePath(p);
    return this.files.get(n) ?? (this.folders.has(n) ? new TFolder(n) : null);
  }
  getMarkdownFiles(): TFile[] { return [...this.files.values()].filter((f) => f.extension === 'md'); }
  getFiles(): TFile[] { return [...this.files.values()]; }
  async read(f: TFile): Promise<string> { return this.adapter.read(f.path); }
  async cachedRead(f: TFile): Promise<string> { return this.adapter.read(f.path); }
  async create(path: string, data: string): Promise<TFile> {
    const n = normalizePath(path);
    if (this.files.has(n)) throw new Error(`File already exists: ${n}`);
    return this.writeRaw(n, data);
  }
  async modify(f: TFile, data: string): Promise<void> { await this.writeRaw(f.path, data); }
  async process(f: TFile, fn: (data: string) => string): Promise<string> {
    const cur = await this.adapter.read(f.path);
    const next = fn(cur);
    if (next !== cur) await this.writeRaw(f.path, next);
    return next;
  }
  async delete(f: TFile): Promise<void> {
    this.files.delete(f.path); this.contents.delete(f.path);
    (this as any).__cache?.forget(f.path);
    this.trigger('delete', f);
  }
  /** A move or rename: the file keeps its stat (mtime untouched), like a real filesystem move. */
  async rename(f: TFile, newPath: string): Promise<void> {
    const oldPath = f.path;
    const n = normalizePath(newPath);
    this.files.delete(oldPath);
    const content = this.contents.get(oldPath) ?? '';
    this.contents.delete(oldPath);
    f.setPath(n);
    this.files.set(n, f);
    this.contents.set(n, content);
    this.ensureFolders(n);
    (this as any).__cache?.forget(oldPath);
    (this as any).__cache?.invalidate(f);
    this.trigger('rename', f, oldPath);
  }
}

export class MetadataCache extends Events {
  private cache = new Map<string, CachedMetadata>();
  constructor(private vault: Vault) { super(); (vault as any).__cache = this; }
  private compute(f: TFile): CachedMetadata {
    const text = this.vault.contents.get(f.path) ?? '';
    const { fm, body } = splitFrontmatter(text);
    const out: CachedMetadata = {};
    if (fm !== null) out.frontmatter = parseYaml(fm);
    const tags: Array<{ tag: string }> = [];
    for (const m of body.matchAll(/(^|\s)(#[A-Za-z][\w/-]*)/g)) tags.push({ tag: m[2] });
    if (tags.length) out.tags = tags;
    return out;
  }
  invalidate(f: TFile): void { this.cache.set(f.path, this.compute(f)); this.trigger('changed', f); }
  forget(path: string): void { this.cache.delete(path); }
  getFileCache(f: TFile): CachedMetadata | null {
    if (!this.vault.files.has(f.path)) return null;
    if (!this.cache.has(f.path)) this.cache.set(f.path, this.compute(f));
    return this.cache.get(f.path)!;
  }
  getFirstLinkpathDest(linkpath: string, _from: string): TFile | null {
    const n = normalizePath(linkpath);
    const direct = this.vault.files.get(n.endsWith('.md') ? n : `${n}.md`);
    if (direct) return direct;
    for (const f of this.vault.getMarkdownFiles()) if (f.basename === n) return f;
    return null;
  }
}

export class MarkdownView {
  file: TFile;
  private data: string;
  constructor(file: TFile, data: string) { this.file = file; this.data = data; }
  getViewData(): string { return this.data; }
  setViewData(d: string): void { this.data = d; }
  editor = { getCursor: () => ({ line: 0, ch: 0 }), hasFocus: () => false };
}
export class WorkspaceLeaf { constructor(public view: unknown) {} }
export class Workspace extends Events {
  private leaves: WorkspaceLeaf[] = [];
  activeFile: TFile | null = null;
  onLayoutReady(cb: () => void): void { cb(); }
  getLeavesOfType(_type: string): WorkspaceLeaf[] { return this.leaves; }
  getActiveFile(): TFile | null { return this.activeFile; }
  /** Test control: open an editor whose buffer shows `data` (dirty when it differs from disk). */
  openEditor(file: TFile, data: string): MarkdownView { const v = new MarkdownView(file, data); this.leaves.push(new WorkspaceLeaf(v)); return v; }
  closeEditors(): void { this.leaves = []; }
  getLeaf(): { openFile: (f: TFile) => Promise<void> } { return { openFile: async () => {} }; }
}

export class FileManager {
  constructor(private vault: Vault) {}
  async processFrontMatter(file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> {
    const text = await this.vault.read(file);
    const { fm, body } = splitFrontmatter(text);
    const obj = fm !== null ? parseYaml(fm) : {};
    fn(obj);
    const yaml = stringifyYaml(obj);
    const next = Object.keys(obj).length ? `---\n${yaml}---\n${body}` : body;
    if (next !== text) await this.vault.modify(file, next);
  }
}

export class App {
  vault = new Vault();
  metadataCache = new MetadataCache(this.vault);
  workspace = new Workspace();
  fileManager = new FileManager(this.vault);
  plugins = { plugins: {} as Record<string, unknown> };
}

export const Platform = { isDesktopApp: false, isMobile: false, isMobileApp: false };
export class Notice { constructor(public message: string) { notices.push(message); } }
export const notices: string[] = [];
export class Modal { constructor(public app: App) {} open(): void {} close(): void {} contentEl = { empty() {}, createEl() { return {} as any; } }; }
export class FuzzySuggestModal<T> extends Modal { getItems(): T[] { return []; } getItemText(_i: T): string { return ''; } onChooseItem(_i: T): void {} }
export class Plugin { constructor(public app: App, public manifest: unknown) {} }
export class PluginSettingTab { containerEl = {} as any; constructor(public app: App, public plugin: Plugin) {} }
export class Setting { constructor(_el: unknown) {} setName() { return this; } setDesc() { return this; } addText() { return this; } addTextArea() { return this; } addToggle() { return this; } addDropdown() { return this; } addButton() { return this; } }
export class ItemView { constructor(public leaf: WorkspaceLeaf) {} }
export const Keymap = { isModEvent: () => false };

// ── requestUrl → the test's fake server ─────────────────────────────────────
export interface StubResponse { status: number; json: unknown; text: string; headers: Record<string, string> }
type RequestHandler = (req: { url: string; method: string; headers: Record<string, string>; body?: string }) => Promise<StubResponse> | StubResponse;
let handler: RequestHandler | null = null;
export function __setRequestHandler(h: RequestHandler | null): void { handler = h; }
export async function requestUrl(req: { url: string; method?: string; headers?: Record<string, string>; body?: string; throw?: boolean }): Promise<StubResponse> {
  if (!handler) throw new Error(`requestUrl: no fake server registered (${req.method ?? 'GET'} ${req.url})`);
  const res = await handler({ url: req.url, method: req.method ?? 'GET', headers: req.headers ?? {}, body: req.body });
  if (req.throw !== false && res.status >= 400) throw Object.assign(new Error(`Request failed, status ${res.status}`), { status: res.status });
  return res;
}
