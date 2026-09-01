import React, { useState } from 'react';
import { Save, Cloud, FolderOpen } from 'lucide-react';
import { autoBackupProviders } from '../utils/autoBackup.js';
import { useTranslation } from 'react-i18next';
import { formatLocalizedDate } from '../utils/localeFormatting.js';

// Auto-Backup Settings Form (extracted to avoid hooks-in-conditional issues)
const AutoBackupSettingsForm = ({ config, setConfig, status, darkMode, textPrimary, textSecondary, borderClass, hoverBg, onRemoteBackupNow, folderBackup, onFolderRestore }) => {
  const { t } = useTranslation();
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  // Set when the picked folder already contains a backup with data: the user
  // chooses between restoring it and replacing it with this device's data.
  const [folderPrompt, setFolderPrompt] = useState(null); // { savedAt } | null

  const localConfig = config.local;
  const remoteConfig = config.remote;
  const folderConfig = config.folder || { enabled: false, snapshotFrequency: 'daily' };
  const providerKey = remoteConfig.provider || 'nextcloud';
  const provider = autoBackupProviders[providerKey];
  const remoteFieldsFilled = provider.configFields.every(f => remoteConfig[f.key]);

  const updateLocal = (updates) => setConfig(prev => ({ ...prev, local: { ...prev.local, ...updates } }));
  const updateRemote = (updates) => setConfig(prev => ({ ...prev, remote: { ...prev.remote, ...updates } }));
  const updateFolder = (updates) => setConfig(prev => ({ ...prev, folder: { ...prev.folder, ...updates } }));

  const handleFolderConnect = async () => {
    const res = await folderBackup.connect();
    if (!res?.ok) return;
    if (res.existing) {
      setFolderPrompt({ savedAt: res.existing.timestamp || res.existing.exportedAt || null });
    } else {
      setFolderPrompt(null);
      updateFolder({ enabled: true });
    }
  };

  const handleFolderDisconnect = async () => {
    setFolderPrompt(null);
    await folderBackup.disconnect();
    updateFolder({ enabled: false });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await provider.testConnection(remoteConfig);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    }
    setTesting(false);
  };

  return (
    <div className="space-y-6">
      {/* Local Backup Settings */}
      <div>
        <h4 className={`font-medium ${textPrimary} mb-3 flex items-center gap-2`}>
          <Save size={16} />
          {t('backup.localBackups')}
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.enabled}
              onChange={(e) => updateLocal({ enabled: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className={textPrimary}>{t('backup.enableLocalBackups')}</span>
          </label>
          {localConfig.enabled && (
                <div className="ml-7">
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('backup.frequency')}</label>
              <select
                value={localConfig.frequency}
                onChange={(e) => updateLocal({ frequency: e.target.value })}
                className={`px-3 py-1.5 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
              >
                <option value="hourly">{t('backup.hourly')}</option>
                <option value="daily">{t('backup.daily')}</option>
                <option value="weekly">{t('backup.weekly')}</option>
              </select>
                {status.local.lastBackup && (
                  <p className={`text-xs ${textSecondary} mt-1`}>
                  {t('backup.lastBackup', { time: formatLocalizedDate(new Date(status.local.lastBackup), { dateStyle: 'short', timeStyle: 'short' }) })}
                  </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Folder Backup Settings — continuous write-through to a local folder.
          Web/PWA only (File System Access API); the section is hidden where
          unsupported (Firefox/Safari, Electron, native). */}
      {folderBackup?.supported && (
        <div>
          <h4 className={`font-medium ${textPrimary} mb-3 flex items-center gap-2`}>
            <FolderOpen size={16} />
            {t('backup.folderBackup')}
          </h4>
          <div className="space-y-3 ml-1">
            <p className={`text-xs ${textSecondary}`}>
              {t('backup.folderBackupDescription')}
            </p>

            {folderPrompt ? (
              <div className={`p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'} space-y-2`}>
                <p className={`text-sm ${textPrimary}`}>
                  {t('backup.folderContainsBackup', {
                    savedAt: folderPrompt.savedAt ? ` (${formatLocalizedDate(new Date(folderPrompt.savedAt), { dateStyle: 'short', timeStyle: 'short' })})` : '',
                  })}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => onFolderRestore()}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {t('backup.restoreBackup')}
                  </button>
                  <button
                    onClick={() => { folderBackup.armOverwrite(); updateFolder({ enabled: true }); setFolderPrompt(null); }}
                    className={`px-3 py-1.5 text-sm rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} transition-colors`}
                  >
                    {t('backup.replaceWithCurrentData')}
                  </button>
                  <button
                    onClick={handleFolderDisconnect}
                    className={`px-3 py-1.5 text-sm rounded-lg ${textSecondary} ${hoverBg} transition-colors`}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : !folderConfig.enabled || !folderBackup.folderName ? (
              <div className="space-y-2">
                  {folderConfig.enabled && !folderBackup.folderName && (
                    <p className={`text-xs ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                     {t('backup.folderReconnectHint')}
                    </p>
                  )}
                <button
                  onClick={handleFolderConnect}
                  className={`px-3 py-1.5 text-sm rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} transition-colors`}
                >
                  {t('backup.chooseFolder')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className={`text-sm ${textPrimary}`}>
                  {t('backup.backingUpTo', { name: folderBackup.folderName })}
                </p>

                {folderBackup.permission === 'prompt' && (
                  <div className={`p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
                    <p className={`text-xs ${darkMode ? 'text-amber-300' : 'text-amber-800'} mb-2`}>
                      {t('backup.permissionRequired')}
                    </p>
                    <button
                      onClick={() => folderBackup.reconnect()}
                      className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                    >
                      {t('backup.reconnect')}
                    </button>
                  </div>
                )}

                {folderBackup.status === 'guarded' && (
                  <div className={`p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
                    <p className={`text-xs ${darkMode ? 'text-amber-300' : 'text-amber-800'} mb-2`}>
                      {t('backup.pausedEmpty')}
                    </p>
                    <button
                      onClick={() => onFolderRestore()}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      {t('backup.restoreBackup')}
                    </button>
                  </div>
                )}

                {folderBackup.status === 'error' && (
                  <p className="text-xs text-red-500">
                    {t('backup.lastWriteFailed')}
                  </p>
                )}

                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>{t('backup.snapshotFrequency')}</label>
                  <select
                    value={folderConfig.snapshotFrequency || 'daily'}
                    onChange={(e) => updateFolder({ snapshotFrequency: e.target.value })}
                    className={`px-3 py-1.5 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                  >
                    <option value="hourly">{t('backup.hourly')}</option>
                    <option value="daily">{t('backup.daily')}</option>
                    <option value="weekly">{t('backup.weekly')}</option>
                  </select>
                  <p className={`text-xs ${textSecondary} mt-1`}>
                    {t('backup.snapshotDescription')}
                  </p>
                </div>

                {folderBackup.lastWritten && (
                  <p className={`text-xs ${textSecondary}`}>
                    {t('backup.lastSaved', { time: formatLocalizedDate(new Date(folderBackup.lastWritten), { dateStyle: 'short', timeStyle: 'short' }) })}
                  </p>
                )}

                <button
                  onClick={handleFolderDisconnect}
                  className={`px-3 py-1.5 text-sm rounded-lg ${textSecondary} ${hoverBg} transition-colors`}
                >
                  {t('common.disconnect')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Remote Backup Settings */}
      <div>
          <h4 className={`font-medium ${textPrimary} mb-3 flex items-center gap-2`}>
            <Cloud size={16} />
            {t('backup.remoteBackups')}
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={remoteConfig.enabled}
              onChange={(e) => updateRemote({ enabled: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className={textPrimary}>{t('backup.enableRemoteBackups')}</span>
          </label>
          <p className={`text-xs ${textSecondary} ml-7`}>
            {t('backup.remoteDeviceHint')}
          </p>
          {remoteConfig.enabled && (
            <div className="ml-7 space-y-3">
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('backup.provider')}</label>
                <select
                  value={providerKey}
                  onChange={(e) => updateRemote({ provider: e.target.value })}
                  className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                >
                  {Object.entries(autoBackupProviders).map(([key, p]) => (
                    <option key={key} value={key}>{t(`backup.providerNames.${key}`, { defaultValue: p.name })}</option>
                  ))}
                </select>
              </div>

              {provider.configFields.map(field => (
                <div key={field.key}>
                  <label className={`block text-sm ${textSecondary} mb-1`}>
                    {t(`backup.fields.${field.key}`, { defaultValue: field.label })}
                  </label>
                  <input
                    type={field.type}
                    placeholder={field.placeholder}
                    value={remoteConfig[field.key] || ''}
                    onChange={(e) => updateRemote({ [field.key]: e.target.value })}
                    className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                  />
                </div>
              ))}

              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('backup.frequency')}</label>
                <select
                  value={remoteConfig.frequency}
                  onChange={(e) => updateRemote({ frequency: e.target.value })}
                  className={`px-3 py-1.5 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                >
                  <option value="hourly">{t('backup.hourly')}</option>
                  <option value="daily">{t('backup.daily')}</option>
                  <option value="weekly">{t('backup.weekly')}</option>
                </select>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleTest}
                  disabled={testing || !remoteFieldsFilled}
                  className={`px-3 py-1.5 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors disabled:opacity-50 text-sm`}
                >
                  {testing ? t('backup.testing') : t('backup.testConnection')}
                </button>
                <button
                  onClick={() => onRemoteBackupNow(remoteConfig.frequency)}
                  disabled={status.remote.status === 'backing-up' || !remoteFieldsFilled}
                  className={`px-3 py-1.5 ${darkMode ? 'bg-blue-700 hover:bg-blue-600' : 'bg-blue-500 hover:bg-blue-600'} text-white rounded-lg transition-colors disabled:opacity-50 text-sm`}
                >
                  {status.remote.status === 'backing-up' ? t('backup.backingUp') : t('backup.backupNow')}
                </button>
                {testResult && (
                  <span className={`text-sm ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
                    {testResult.success ? t('backup.connected') : testResult.error}
                  </span>
                )}
              </div>

              {status.remote.lastBackup && (
                <p className={`text-xs ${textSecondary}`}>
                  {t('backup.lastBackup', { time: formatLocalizedDate(new Date(status.remote.lastBackup), { dateStyle: 'short', timeStyle: 'short' }) })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AutoBackupSettingsForm;
