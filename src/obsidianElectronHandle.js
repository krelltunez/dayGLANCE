/**
 * Electron vault handle shim.
 *
 * Presents the subset of the File System Access API that src/obsidian.js uses
 * (getDirectoryHandle, getFileHandle, entries, getFile().text()/.lastModified,
 * createWritable().write()/.close(), and NotFoundError semantics), backed by the
 * Electron main process via window.electronAPI.obsidian.*.
 *
 * This lets all of obsidian.js's proven markdown/sync logic run unchanged on the
 * Mac App Store build, where the vault folder is accessed in the main process
 * through a security-scoped bookmark (the renderer's own FS Access handle can't
 * persist across relaunch under the sandbox).
 */

function notFoundError() {
  const e = new Error('A requested file or directory could not be found.');
  e.name = 'NotFoundError';
  return e;
}

function joinRel(base, name) {
  return base ? `${base}/${name}` : name;
}

function makeFileHandle(api, relPath, name) {
  return {
    kind: 'file',
    name,
    async getFile() {
      const res = await api.readFile(relPath);
      if (!res || res.notFound) throw notFoundError();
      if (res.error) throw new Error(res.error);
      return {
        lastModified: res.lastModified,
        async text() { return res.text; },
      };
    },
    async createWritable() {
      // FS Access createWritable() truncates/overwrites; obsidian.js always writes
      // the full file contents in a single write() then close(). Buffer and flush
      // on close() via one IPC write.
      let buffer = '';
      return {
        async write(chunk) { buffer += typeof chunk === 'string' ? chunk : String(chunk ?? ''); },
        async close() {
          const ok = await api.writeFile(relPath, buffer);
          if (!ok) throw new Error(`Obsidian: failed to write ${relPath || name}`);
        },
      };
    },
  };
}

function makeDirHandle(api, relPath, name) {
  return {
    kind: 'directory',
    name,
    // Access is managed by the main process's security-scoped bookmark, so from
    // the renderer's perspective permission is always granted.
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },

    async getDirectoryHandle(childName, opts = {}) {
      const childRel = joinRel(relPath, childName);
      if (!opts.create) {
        const st = await api.stat(childRel);
        if (!st || st.kind !== 'directory') throw notFoundError();
      }
      // With { create: true } the directory is materialized lazily — the main
      // process's write-file mkdirs the full parent path on first write.
      return makeDirHandle(api, childRel, childName);
    },

    async getFileHandle(childName, opts = {}) {
      const childRel = joinRel(relPath, childName);
      if (!opts.create) {
        const st = await api.stat(childRel);
        if (!st || st.kind !== 'file') throw notFoundError();
      }
      return makeFileHandle(api, childRel, childName);
    },

    async *entries() {
      const items = await api.listDir(relPath);
      for (const it of items) {
        const childRel = joinRel(relPath, it.name);
        const handle = it.kind === 'directory'
          ? makeDirHandle(api, childRel, it.name)
          : makeFileHandle(api, childRel, it.name);
        yield [it.name, handle];
      }
    },

    async *keys() {
      const items = await api.listDir(relPath);
      for (const it of items) yield it.name;
    },

    async *values() {
      for await (const [, handle] of this.entries()) yield handle;
    },

    // FS Access directory handles are themselves async-iterable (equivalent to
    // entries()); obsidian.js's sync path iterates the handle directly, so the
    // shim must support it too — this was the missing piece.
    [Symbol.asyncIterator]() {
      return this.entries();
    },
  };
}

/**
 * Build a vault directory handle rooted at the vault folder, backed by the
 * Electron main process. Returns null if the Electron Obsidian API is unavailable.
 */
export function makeElectronVaultHandle() {
  const api = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.obsidian;
  if (!api) return null;
  return makeDirHandle(api, '', 'vault');
}
