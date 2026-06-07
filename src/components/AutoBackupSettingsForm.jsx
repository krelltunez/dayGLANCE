import React, { useState } from 'react';
import { Save, Cloud } from 'lucide-react';
import { autoBackupProviders } from '../utils/autoBackup.js';
import { useTranslation } from 'react-i18next';

// Auto-Backup Settings Form (extracted to avoid hooks-in-conditional issues)
const AutoBackupSettingsForm = ({ config, setConfig, status, darkMode, textPrimary, textSecondary, borderClass, hoverBg, onRemoteBackupNow }) => {
  const { t } = useTranslation();
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const localConfig = config.local;
  const remoteConfig = config.remote;
  const providerKey = remoteConfig.provider || 'nextcloud';
  const provider = autoBackupProviders[providerKey];
  const remoteFieldsFilled = provider.configFields.every(f => remoteConfig[f.key]);

  const updateLocal = (updates) => setConfig(prev => ({ ...prev, local: { ...prev.local, ...updates } }));
  const updateRemote = (updates) => setConfig(prev => ({ ...prev, remote: { ...prev.remote, ...updates } }));

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
          Local Backups
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
              <label className={`block text-sm ${textSecondary} mb-1`}>Frequency</label>
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
                  Last backup: {new Date(status.local.lastBackup).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Remote Backup Settings */}
      <div>
        <h4 className={`font-medium ${textPrimary} mb-3 flex items-center gap-2`}>
          <Cloud size={16} />
          Remote Backups
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
            Only enable on one device. If you use multiple devices, use Cloud Sync to keep them in sync and set up remote backups on your primary device only.
          </p>
          {remoteConfig.enabled && (
            <div className="ml-7 space-y-3">
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>Provider</label>
                <select
                  value={providerKey}
                  onChange={(e) => updateRemote({ provider: e.target.value })}
                  className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                >
                  {Object.entries(autoBackupProviders).map(([key, p]) => (
                    <option key={key} value={key}>{p.name}</option>
                  ))}
                </select>
              </div>

              {provider.configFields.map(field => (
                <div key={field.key}>
                  <label className={`block text-sm ${textSecondary} mb-1`}>{field.label}</label>
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
                <label className={`block text-sm ${textSecondary} mb-1`}>Frequency</label>
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
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={() => onRemoteBackupNow(remoteConfig.frequency)}
                  disabled={status.remote.status === 'backing-up' || !remoteFieldsFilled}
                  className={`px-3 py-1.5 ${darkMode ? 'bg-blue-700 hover:bg-blue-600' : 'bg-blue-500 hover:bg-blue-600'} text-white rounded-lg transition-colors disabled:opacity-50 text-sm`}
                >
                  {status.remote.status === 'backing-up' ? 'Backing up...' : 'Backup Now'}
                </button>
                {testResult && (
                  <span className={`text-sm ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
                    {testResult.success ? 'Connected!' : testResult.error}
                  </span>
                )}
              </div>

              {status.remote.lastBackup && (
                <p className={`text-xs ${textSecondary}`}>
                  Last backup: {new Date(status.remote.lastBackup).toLocaleString()}
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
