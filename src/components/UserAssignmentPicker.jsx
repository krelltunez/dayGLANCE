import React from 'react';

/**
 * Multi-select user assignment picker (broadcast-with-filter model).
 *
 * Mirrors the inline picker used in the task modals: an empty selection means
 * "everybody can see it", while explicit selections restrict visibility to
 * those users. Returns null when multi-user is disabled or there are no users,
 * so callers can drop it in unconditionally.
 */
export default function UserAssignmentPicker({
  enabled,
  users = [],
  value = [],
  onChange,
  darkMode,
  borderClass = '',
  textSecondary = '',
  label = 'Assigned to',
}) {
  const activeUsers = users.filter(u => !u.deleted);
  if (!enabled || activeUsers.length === 0) return null;

  const assigned = value ?? [];

  return (
    <div className="flex flex-col gap-1">
      <label className={`text-xs font-medium ${textSecondary}`}>
        {label} <span className="opacity-70">(empty = everybody)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {activeUsers.map(u => {
          const key = u.syncId ?? u.id;
          const isSelected = assigned.includes(key);
          const toggle = () => {
            const next = isSelected
              ? assigned.filter(id => id !== key)
              : [...assigned, key];
            onChange(next);
          };
          return (
            <button
              key={u.id}
              type="button"
              onClick={toggle}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border transition-colors ${isSelected
                ? `border-blue-500 ${darkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-50 text-blue-700'}`
                : `${borderClass} ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-white text-stone-600'}`}`}
            >
              <span
                style={{ width: 18, height: 18, fontSize: 10 }}
                className="rounded-full bg-gray-500 text-white flex items-center justify-center font-semibold leading-none flex-shrink-0"
              >
                {u.name[0].toUpperCase()}
              </span>
              {u.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
