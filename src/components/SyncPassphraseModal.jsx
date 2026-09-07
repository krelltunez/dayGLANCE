import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { setSyncPassphrase } from '../utils/crypto.js';
import { useTranslation } from 'react-i18next';

/**
 * Shown on app load when cloud sync encryption is enabled but no cached key
 * was found in device storage (e.g. new device, cleared browser data).
 *
 * The user enters their sync passphrase — we store it in session memory and
 * the derived key is cached to IndexedDB/Android Keystore on the first
 * successful decryption (inside decryptData in crypto.js).
 */
const SyncPassphraseModal = ({ darkMode, textPrimary, textSecondary, borderClass, onUnlocked }) => {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState(null);

  const bgModal  = darkMode ? 'bg-gray-800' : 'bg-white';
  const bgOverlay = 'bg-black/60';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!passphrase.trim()) return;
    setError(null);
    // Store in session — the key will be derived and cached on first sync.
    setSyncPassphrase(passphrase.trim());
    onUnlocked();
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${bgOverlay}`}>
      <div className={`${bgModal} rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-blue-50'}`}>
            <Lock size={20} className="text-blue-500" />
          </div>
          <h2 className={`text-lg font-semibold ${textPrimary}`}>{t('sync.unlockTitle', { defaultValue: 'Unlock sync' })}</h2>
        </div>

        <p className={`text-sm ${textSecondary} mb-4`}>
          {t('sync.passphrasePrompt', { defaultValue: 'Cloud sync is encrypted. Enter your sync passphrase to continue.' })}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>{t('sync.passphraseLabel', { defaultValue: 'Sync passphrase' })}</label>
            <input
              type="password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t('sync.passphrasePlaceholder', { defaultValue: 'Your sync passphrase' })}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <p className={`text-xs ${textSecondary}`}>
            {t('sync.passphraseHint', { defaultValue: 'This is the passphrase you set when you first enabled encryption. It is never stored — only you know it.' })}
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={!passphrase.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {t('sync.unlock', { defaultValue: 'Unlock' })}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SyncPassphraseModal;
