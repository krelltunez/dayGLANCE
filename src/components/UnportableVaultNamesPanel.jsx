import { AlertTriangle } from 'lucide-react';

/**
 * Read-only Settings → Obsidian listing of vault entries whose names may not
 * sync to Windows or Android devices (issue #1358). Entries come from the
 * vault scan that already populates wikilink candidates; the rules are the
 * creation-gate union from utils/vaultPortability.js.
 *
 * Deliberately informational (amber, not red) and deliberately read-only:
 * a macOS-only user has no actual problem, and renaming a note here would
 * break every wikilink to it across the vault. Renames belong in Obsidian,
 * which updates backlinks.
 */
export default function UnportableVaultNamesPanel({ entries, darkMode, textSecondary }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div className={`mt-3 p-3 rounded-lg border ${darkMode ? 'border-amber-700/50 bg-amber-900/20' : 'border-amber-300 bg-amber-50'}`}>
      <p className={`text-xs font-medium flex items-center gap-1.5 ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>
        <AlertTriangle size={14} className="flex-shrink-0" />
        {entries.length === 1
          ? '1 vault file has a name that may not sync to Windows or Android devices'
          : `${entries.length} vault files have names that may not sync to Windows or Android devices`}
      </p>
      <p className={`text-xs mt-1 ${textSecondary}`}>
        dayGLANCE no longer creates names like these, but it never renames existing
        notes: a rename breaks the links pointing at the note from the rest of the
        vault. To fix one, rename it inside Obsidian, which updates its backlinks.
      </p>
      <ul className="mt-2 max-h-40 overflow-y-auto space-y-1.5">
        {entries.map((f) => (
          <li key={f.path} className="text-xs">
            <span className={`font-mono break-all ${darkMode ? 'text-gray-200' : 'text-stone-800'}`}>{f.path}</span>
            <span className={`block ${textSecondary}`}>{f.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
