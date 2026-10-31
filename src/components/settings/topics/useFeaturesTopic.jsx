// Settings: the Features topic's sections (docs/settings-redesign.md).
// Moved verbatim from SettingsModal.jsx. Returns `{ key: { show, node, ... } }`
// for the keys this topic lists in settingsTopics.js; the dialog builds
// its topic list, search and page from them.
import React, { useState } from 'react';
import { Activity, BarChart3, Compass, Flag, FlaskConical, RefreshCw, Sparkles, Users } from 'lucide-react';
import SettingsCard from '../SettingsCard.jsx';
import DirectAccessFileRow from '../../DirectAccessFileRow.jsx';
import useDirectAccessStatus from '../../../hooks/useDirectAccessStatus.js';
import { MULTI_USER_CONFIG_KEY } from '../../../intents/useIntentPoller.js';
import { syncSharedUsers, syncSharedUsersViaDirectAccess, markRosterEdited } from '../../../intents/sharedUsers.js';
import { isAvailable as isICloudAvailable } from '../../../intents/icloudFileTransport.js';
import { multiUserToggleLocked, multiUserUnavailableReason, canSyncUserRoster } from '../../../utils/multiUserGate.js';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../../../context/SyncContext.jsx';
import { useFeaturesCtx } from '../../../context/FeaturesContext.jsx';

export default function useFeaturesTopic({ intentForm }) {
  const { t } = useTranslation();
  const {
    darkMode, borderClass, textPrimary, textSecondary, setOnboardingProgress,
    tasks, isMobile,
  } = useDayPlannerCtx();
  const {
    cloudSyncConfig, vaultEnabled, vaultSyncNow,
  } = useSyncCtx();
  const {
    habitsEnabled, setHabitsEnabled, joboEnabled, setJoboEnabled, aspireEnabled,
    setAspireEnabled, routinesEnabled, setRoutinesEnabled, goalsProjectsEnabled,
    setGoalsProjectsEnabled, multiUserEnabled, setMultiUserEnabled,
    cloudSyncConfigured, users, setUsers, meUserSyncId, setMeUserSyncId,
  } = useFeaturesCtx();
  // Multi-user only matters across synced devices; gate the toggle when sync is
  // unconfigured. Never trap: an already-on toggle stays enabled so it can be
  // turned off.
  // "Requires cloud sync" is wrong on an iCloud-only device — that user IS
  // syncing, just to a destination only they can reach. Pick the sentence that
  // matches their situation instead of the generic one.
  // A connected Direct Access folder is a shared destination and carries the
  // household roster (docs/direct-access-sync.md, Phase 5).
  const directAccessStatus = useDirectAccessStatus();
  const directAccessRoster = directAccessStatus.connected && directAccessStatus.enabled;
  const multiUserLocked = multiUserToggleLocked({ cloudSyncConfigured, directAccessConnected: directAccessRoster, multiUserEnabled });
  const multiUserReason = multiUserUnavailableReason({
    cloudSyncConfigured,
    icloudAvailable: isICloudAvailable(),
    directAccessConnected: directAccessRoster,
  });
  const multiUserRosterSyncable = canSyncUserRoster({
    multiUserEnabled,
    cloudSyncEnabled: cloudSyncConfig?.enabled,
    vaultEnabled,
    directAccessConnected: directAccessRoster,
  });
  const [addingUser, setAddingUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUserName, setEditingUserName] = useState('');

  const [usersPath, setUsersPath] = useState(() => {
    const raw = localStorage.getItem(MULTI_USER_CONFIG_KEY);
    return raw ? (JSON.parse(raw).usersPath ?? '/GLANCE/users/') : '/GLANCE/users/';
  });
  const [userSyncStatus, setUserSyncStatus] = useState(null); // null | 'syncing' | 'ok' | 'error'

  return {
    goals: {
      show: true,
      card: true,
      node: (
        <SettingsCard
          cardId="goals"
          icon={Flag}
          title={t('settings.goalsProjects')}
          switchLabel={t('settings.enableGoalsProjects')}
          checked={goalsProjectsEnabled}
          onToggle={(next) => { if (next) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setGoalsProjectsEnabled(next); }}
          darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
        />
      ),
    },
    routines: {
      show: true,
      card: true,
      node: (
        <SettingsCard
          cardId="routines"
          icon={Sparkles}
          title={t('settings.routines')}
          switchLabel={t('settings.enableRoutines')}
          checked={routinesEnabled}
          onToggle={(next) => { if (next) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setRoutinesEnabled(next); }}
          darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
        />
      ),
    },
    habits: {
      show: true,
      card: true,
      node: (
        <SettingsCard
          cardId="habits"
          icon={Activity}
          title={t('settings.habitTracking')}
          switchLabel={t('settings.enableHabitTracking')}
          checked={habitsEnabled}
          onToggle={(next) => { if (next) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setHabitsEnabled(next); }}
          darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
        />
      ),
    },
    experimental: {
      show: true,
      node: (
        <>
            {/* Experimental: features landing in slices, off by default.
                The switch is the only thing a regular user ever sees of
                them; everything behind it stays absent until it is on. */}
            <div className="space-y-3" data-settings-group="experimental">
              <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                <FlaskConical size={16} className={textSecondary} />
                {t('settings.experimental')}
              </h4>
              <p className={`text-xs ${textSecondary} opacity-70`}>{t('settings.experimentalHint')}</p>
              <SettingsCard
                cardId="jobo"
                icon={BarChart3}
                title={t('settings.enableJobo')}
                hint={isMobile ? t('settings.enableJoboHintPhone') : t('settings.enableJoboHint')}
                checked={joboEnabled}
                onToggle={setJoboEnabled}
                darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
              />
              <SettingsCard
                cardId="aspire"
                icon={Compass}
                title={t('settings.enableAspire')}
                hint={t('settings.enableAspireHint')}
                checked={aspireEnabled}
                onToggle={setAspireEnabled}
                darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
              />
            </div>
        </>
      ),
    },
    multiUser: {
      show: true,
      card: true,
      node: (
        <>
            {/* Multi-user / Household Section */}
            {/* Multi-user / Household: the roster only matters while it is on. */}
            <SettingsCard
              cardId="multiUser"
              icon={Users}
              title={t('settings.multiUser')}
              hint={t('settings.multiUserModeHint')}
              switchLabel={t('settings.multiUserMode')}
              checked={multiUserEnabled}
              disabled={multiUserLocked}
              onToggle={(next) => {
                setMultiUserEnabled(next);
                localStorage.setItem('dayglance-multi-user-enabled', JSON.stringify(next));
              }}
              badge={multiUserEnabled && users.filter(u => !u.deleted).length > 0 ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null}
              summary={multiUserReason !== 'none' ? t(multiUserReason === 'icloud-only' ? 'settings.multiUserICloudOnly' : 'settings.multiUserRequiresSync') : null}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className={`${textSecondary} text-xs`}>
                      {t('settings.multiUserDescription', { defaultValue: 'Share dayGLANCE with your household. Tasks can be assigned to specific people; unassigned tasks are visible to everyone.' })}
                    </p>
                    {multiUserRosterSyncable && (
                      <button
                        type="button"
                        disabled={userSyncStatus === 'syncing'}
                        onClick={async () => {
                          setUserSyncStatus('syncing');
                          try {
                            const raw = localStorage.getItem(MULTI_USER_CONFIG_KEY);
                            const uPath = raw ? (JSON.parse(raw).usersPath ?? undefined) : undefined;
                            // The roster file: prefer WebDAV when configured, then a
                            // connected Direct Access folder. Never iCloud: it is per
                            // Apple ID, so it cannot reach other household members.
                            const merged = cloudSyncConfig?.enabled
                              ? await syncSharedUsers(cloudSyncConfig, uPath, users)
                              : directAccessRoster
                                ? await syncSharedUsersViaDirectAccess(uPath, users)
                                : null;
                            if (merged) {
                              localStorage.setItem('dayglance-users', JSON.stringify(merged));
                              setUsers(merged);
                            }
                            // GLANCEvault carries the roster inside the synced data
                            // (`users`), so a vault cycle is its roster sync.
                            if (vaultEnabled) await vaultSyncNow?.();
                            setUserSyncStatus('ok');
                            setTimeout(() => setUserSyncStatus(null), 2000);
                          } catch {
                            setUserSyncStatus('error');
                            setTimeout(() => setUserSyncStatus(null), 3000);
                          }
                        }}
                        className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                          userSyncStatus === 'ok' ? 'bg-green-500/20 text-green-500' :
                          userSyncStatus === 'error' ? 'bg-red-500/20 text-red-500' :
                          darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                      >
                        <RefreshCw size={12} className={userSyncStatus === 'syncing' ? 'animate-spin' : ''} />
                        {userSyncStatus === 'ok' ? t('common.saved') : userSyncStatus === 'error' ? t('settings.syncFailed') : t('common.syncNow')}
                      </button>
                    )}
                  </div>
                  {/* User list */}
                  <DirectAccessFileRow slot="users" darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass} />
                  <div>
                    <p className={`text-xs font-medium ${textSecondary} mb-2`}>{t('settings.multiUserPeople')}</p>
                    <div className="space-y-2">
                      {users.filter(u => !u.deleted).map(u => (
                        <div key={u.id} className="flex items-center gap-2">
                          <span
                            style={{ width: 24, height: 24, fontSize: 13 }}
                            className="rounded-full bg-gray-500 text-white flex items-center justify-center font-semibold leading-none flex-shrink-0"
                          >
                            {u.name[0].toUpperCase()}
                          </span>
                          {editingUserId === u.id ? (
                            <>
                              <input
                                type="text"
                                value={editingUserName}
                                onChange={e => setEditingUserName(e.target.value)}
                                className={`flex-1 px-2 py-1 border ${borderClass} rounded text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const trimmed = editingUserName.trim();
                                  if (!trimmed) return;
                                  const updated = users.map(usr => usr.id === u.id ? { ...usr, name: trimmed, updatedAt: new Date().toISOString() } : usr);
                                  setUsers(updated);
                                  localStorage.setItem('dayglance-users', JSON.stringify(updated));
                                  markRosterEdited();
                                  setEditingUserId(null);
                                }}
                                className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                              >{t('common.save')}</button>
                              <button type="button" onClick={() => setEditingUserId(null)} className={`px-2 py-1 rounded text-xs ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-stone-200 text-stone-700'}`}>{t('common.cancel')}</button>
                            </>
                          ) : (
                            <>
                              <span className={`flex-1 text-sm ${textPrimary}`}>{u.name}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const key = u.syncId ?? u.id;
                                  const next = meUserSyncId === key ? null : key;
                                  setMeUserSyncId(next);
                                  localStorage.setItem(MULTI_USER_CONFIG_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(MULTI_USER_CONFIG_KEY) || '{}'), meUserSyncId: next }));
                                }}
                                className={`px-2 py-1 rounded text-xs border transition-colors ${meUserSyncId === (u.syncId ?? u.id)
                                  ? 'border-green-500 bg-green-500/20 text-green-400'
                                  : `${borderClass} ${darkMode ? 'bg-transparent text-gray-400 hover:text-gray-200' : 'bg-transparent text-stone-500 hover:text-stone-700'}`}`}
                              >{meUserSyncId === (u.syncId ?? u.id) ? `✓ ${t('settings.multiUserMe', { defaultValue: 'Me' })}` : t('settings.multiUserMe', { defaultValue: 'Me' })}</button>
                              <button
                                type="button"
                                onClick={() => { setEditingUserId(u.id); setEditingUserName(u.name); }}
                                className={`px-1.5 py-1 rounded text-xs ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-stone-400 hover:text-stone-600'}`}
                                aria-label={t('common.edit')}
                              >✎</button>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = users.map(usr => usr.id === u.id ? { ...usr, deleted: true, updatedAt: new Date().toISOString() } : usr);
                                  setUsers(updated);
                                  localStorage.setItem('dayglance-users', JSON.stringify(updated));
                                  markRosterEdited();
                                  if (meUserSyncId === (u.syncId ?? u.id)) {
                                    setMeUserSyncId(null);
                                    localStorage.setItem(MULTI_USER_CONFIG_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(MULTI_USER_CONFIG_KEY) || '{}'), meUserSyncId: null }));
                                  }
                                }}
                                className={`px-1.5 py-1 rounded text-xs ${darkMode ? 'text-gray-500 hover:text-red-400' : 'text-stone-400 hover:text-red-500'}`}
                                aria-label={t('common.delete')}
                              >🗑</button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                    {addingUser ? (
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="text"
                          placeholder={t('common.name')}
                          value={newUserName}
                          onChange={e => setNewUserName(e.target.value)}
                          className={`flex-1 px-2 py-1 border ${borderClass} rounded text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const trimmed = newUserName.trim();
                              if (!trimmed) return;
                              const newUser = { id: crypto.randomUUID(), name: trimmed, syncId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
                              const updated = [...users, newUser];
                              setUsers(updated);
                              localStorage.setItem('dayglance-users', JSON.stringify(updated));
                              markRosterEdited();
                              setNewUserName('');
                              setAddingUser(false);
                            } else if (e.key === 'Escape') {
                              setAddingUser(false);
                              setNewUserName('');
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const trimmed = newUserName.trim();
                            if (!trimmed) return;
                            const newUser = { id: crypto.randomUUID(), name: trimmed, syncId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
                            const updated = [...users, newUser];
                            setUsers(updated);
                            localStorage.setItem('dayglance-users', JSON.stringify(updated));
                            markRosterEdited();
                            setNewUserName('');
                            setAddingUser(false);
                          }}
                          className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                        >{t('common.add')}</button>
                        <button type="button" onClick={() => { setAddingUser(false); setNewUserName(''); }} className={`px-2 py-1 rounded text-xs ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-stone-200 text-stone-700'}`}>{t('common.cancel')}</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingUser(true)}
                        className={`mt-2 text-sm ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
                      >{t('common.addPerson')}</button>
                    )}
                  </div>
                  {/* Users path — only shown when GLANCE Integrations WebDAV is configured */}
                  {intentForm.webdavUrl && (
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.usersSyncPath')}</label>
                      <input
                        type="text"
                        placeholder="/GLANCE/users/"
                        value={usersPath}
                        onChange={e => {
                          const val = e.target.value;
                          setUsersPath(val);
                          const existing = localStorage.getItem(MULTI_USER_CONFIG_KEY);
                          const prev = existing ? JSON.parse(existing) : {};
                          localStorage.setItem(MULTI_USER_CONFIG_KEY, JSON.stringify({ ...prev, usersPath: val }));
                        }}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      />
                      <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.usersSyncPathHint', { defaultValue: 'WebDAV path where the shared user list is stored. Must match across all GLANCE apps.' })}</p>
                    </div>
                  )}
                </div>
            </SettingsCard>
        </>
      ),
    },
  };
}
