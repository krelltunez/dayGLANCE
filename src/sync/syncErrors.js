// Localize cloud-sync errors.
//
// @glance-apps/sync already delivers BOTH a human-readable English `message`
// AND a structured `code` (SyncErrorCode) to onError(message, code, isHardStop)
// on both the file (WebDAV/iCloud) and DB (GLANCEvault) tiers. So localization is
// a client concern: key the display string off the typed `code`, and fall back
// to the engine's English `message` for any code we don't (yet) have a key for.
//
// Pass the caller's own `t` (from useTranslation) so the string honours the
// active language at the moment the error is rendered.
//
// NOTE: testConnection()/test() return only `{ success, error }` with NO code, so
// the "Test Connection" result is the one sync surface that stays English until
// the package grows a code there — handled at that call site, not here.

/**
 * @param {(key: string, opts?: object) => string} t  i18next translator
 * @param {string|null} message  engine-provided English message (fallback)
 * @param {string|null} [code]   SyncErrorCode, if any
 * @returns {string|null}  localized message, or null when there is no error
 *                          (a null message is the engine's "clear error" signal)
 */
export function syncErrorText(t, message, code) {
  if (!message) return null;
  if (code) return t(`sync.errors.${code}`, { defaultValue: message });
  return message;
}
