import React from 'react';
import { Cloud, Clock, Save, Trash2, Undo2, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';

const AutoBackupManagerModal = () => {
  const {
    showAutoBackupManager, setShowAutoBackupManager,
    autoBackupRestoreConfirm, setAutoBackupRestoreConfirm,
    autoBackupManagerTab, setAutoBackupManagerTab,
    autoBackupConfig, setAutoBackupConfig,
    autoBackupStatus, autoBackupHistory,
    cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg,
    loadAutoBackupHistory, performRemoteBackup,
    restoreFromAutoBackup, restoreFromRemoteBackup,
    deleteLocalAutoBackup, deleteRemoteAutoBackup,
  } = useDayPlannerCtx();

  if (!showAutoBackupManager) return null;

  return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowAutoBackupManager(false); setAutoBackupRestoreConfirm(null); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl ${borderClass} border max-w-lg w-full mx-4 max-h-[80vh] flex flex-col`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 pb-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <Clock size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className={`text-lg font-semibold ${textPrimary}`}>Auto-Backup</h3>
                <button onClick={() => { setShowAutoBackupManager(false); setAutoBackupRestoreConfirm(null); }} className={`ml-auto p-1 rounded ${hoverBg}`}>
                  <X size={18} className={textSecondary} />
                </button>
              </div>

              {/* Tabs */}
              <div className={`flex border-b ${borderClass}`}>
                <button
                  onClick={() => setAutoBackupManagerTab('settings')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    autoBackupManagerTab === 'settings'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : `border-transparent ${textSecondary} ${hoverBg}`
                  }`}
                >
                  Settings
                </button>
                <button
                  onClick={() => { setAutoBackupManagerTab('history'); loadAutoBackupHistory(); }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    autoBackupManagerTab === 'history'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : `border-transparent ${textSecondary} ${hoverBg}`
                  }`}
                >
                  History
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 pb-6 overflow-y-auto flex-1">
              {autoBackupManagerTab === 'settings' ? (
                <AutoBackupSettingsForm
                  config={autoBackupConfig}
                  setConfig={setAutoBackupConfig}
                  status={autoBackupStatus}
                  darkMode={darkMode}
                  textPrimary={textPrimary}
                  textSecondary={textSecondary}
                  borderClass={borderClass}
                  hoverBg={hoverBg}
                  onRemoteBackupNow={performRemoteBackup}
                />
              ) : (
                <div className="space-y-6">
                  {/* Restore confirmation */}
                  {autoBackupRestoreConfirm && (
                    <div className={`p-4 rounded-lg border ${borderClass} ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
                      <p className={`text-sm ${textPrimary} mb-3`}>
                        Restore from this backup? All current data will be replaced and the page will reload.
                      </p>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setAutoBackupRestoreConfirm(null)}
                          className={`px-3 py-1.5 text-sm rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary} ${hoverBg}`}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (autoBackupRestoreConfirm.type === 'local') {
                              restoreFromAutoBackup(autoBackupRestoreConfirm.id);
                            } else {
                              restoreFromRemoteBackup(autoBackupRestoreConfirm.filename);
                            }
                          }}
                          className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Local Backups */}
                  <div>
                    <h4 className={`font-medium ${textPrimary} mb-2 flex items-center gap-2`}>
                      <Save size={14} />
                      Local Backups ({autoBackupHistory.local.length})
                    </h4>
                    {autoBackupHistory.local.length === 0 ? (
                      <p className={`text-sm ${textSecondary}`}>No local backups yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {autoBackupHistory.local.map(b => (
                          <div key={b.id} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm ${textPrimary} truncate`}>
                                {new Date(b.timestamp).toLocaleString()}
                              </p>
                              <p className={`text-xs ${textSecondary}`}>{b.frequency}</p>
                            </div>
                            <div className="flex items-center gap-1 ml-2 shrink-0">
                              <button
                                onClick={() => setAutoBackupRestoreConfirm({ type: 'local', id: b.id, timestamp: b.timestamp })}
                                className={`p-1.5 rounded ${hoverBg}`}
                                title="Restore"
                              >
                                <Undo2 size={14} className={textSecondary} />
                              </button>
                              <button
                                onClick={() => deleteLocalAutoBackup(b.id)}
                                className={`p-1.5 rounded ${hoverBg}`}
                                title="Delete"
                              >
                                <Trash2 size={14} className={textSecondary} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Remote Backups */}
                  {autoBackupConfig.remote.enabled && (
                    <div>
                      <h4 className={`font-medium ${textPrimary} mb-2 flex items-center gap-2`}>
                        <Cloud size={14} />
                        Remote Backups ({autoBackupHistory.remote.length})
                      </h4>
                      {autoBackupHistory.remote.length === 0 ? (
                        <p className={`text-sm ${textSecondary}`}>No remote backups yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {autoBackupHistory.remote.map(b => (
                            <div key={b.filename} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                              <div className="min-w-0 flex-1">
                                <p className={`text-sm ${textPrimary} truncate`}>
                                  {b.lastModified ? new Date(b.lastModified).toLocaleString() : b.filename}
                                </p>
                                <p className={`text-xs ${textSecondary} truncate`}>{b.filename}</p>
                              </div>
                              <div className="flex items-center gap-1 ml-2 shrink-0">
                                <button
                                  onClick={() => setAutoBackupRestoreConfirm({ type: 'remote', filename: b.filename, timestamp: b.lastModified })}
                                  className={`p-1.5 rounded ${hoverBg}`}
                                  title="Restore"
                                >
                                  <Undo2 size={14} className={textSecondary} />
                                </button>
                                <button
                                  onClick={() => deleteRemoteAutoBackup(b.filename)}
                                  className={`p-1.5 rounded ${hoverBg}`}
                                  title="Delete"
                                >
                                  <Trash2 size={14} className={textSecondary} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
  );
};

export default AutoBackupManagerModal;
