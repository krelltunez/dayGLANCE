// Builds the obsidian:// deep link used by "Open in Obsidian", extracted as a
// pure function so it can be unit-tested without Electron (same pattern as
// startupQuit.ts and calendarCache.ts).
//
// WHY THIS LIVES IN THE MAIN PROCESS: the renderer cannot open this URL itself.
// window.open() in a BrowserWindow is intercepted by setWindowOpenHandler, which
// hands the URL to openExternalSafe() — deliberately restricted to http/https so
// a renderer compromise can't launch arbitrary schemes. Rather than widen that
// allowlist, the renderer sends a NOTE NAME over IPC and the main process builds
// the URL from the vault path it already holds. The renderer never controls the
// URL, so the allowlist keeps its original security property.
//
// It also has to live here for correctness: on Electron the renderer's vault
// "handle" is a shim (src/obsidianElectronHandle.js) whose name is the constant
// 'vault', not the real folder name. Only the main process knows the actual
// vault path, and therefore the vault name Obsidian expects.

/**
 * @param vaultName Folder name of the vault (i.e. path.basename of its path).
 * @param noteName  Wikilink target, possibly with a `#Heading` fragment.
 * @returns The obsidian://open URI, or null when either input is unusable.
 */
export function buildObsidianOpenUri(vaultName: string, noteName: string): string | null {
  if (typeof vaultName !== 'string' || typeof noteName !== 'string') return null;

  const vault = vaultName.trim();
  // Strip the [[Note#Heading]] fragment, matching loadWikiNote/saveWikiNote:
  // the whole note file is opened, not a section. Left in place it would be
  // percent-encoded into the filename (`Note%23Heading`) and match nothing.
  const note = noteName.split('#')[0].trim();

  if (!vault || !note) return null;

  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(note)}`;
}

/**
 * Builds the launch-on-write deep link for the vault file at an ABSOLUTE path.
 * Obsidian's `path` parameter overrides both `vault` and `file`, so no vault
 * name is needed — which is exactly right here, since only the main process
 * holds the real path (resolveInVault in obsidian.ts) and the renderer is
 * never involved.
 *
 * Unlike buildObsidianOpenUri there is no `#Heading` stripping or trimming:
 * the input is a filesystem path the main process itself resolved, not a
 * user-typed wikilink, and it must be passed through exactly.
 *
 * @param absPath Absolute path of the file just written.
 * @returns The obsidian://open URI, or null when the input is unusable.
 */
export function buildObsidianOpenPathUri(absPath: string): string | null {
  if (typeof absPath !== 'string' || absPath.trim() === '') return null;
  return `obsidian://open?path=${encodeURIComponent(absPath)}`;
}
