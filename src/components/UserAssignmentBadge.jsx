import React from 'react';

export default function UserAssignmentBadge({ users = [], assignedUserSyncIds = [], size = 14 }) {
  if (!assignedUserSyncIds?.length) return null;
  const assigned = users.filter(u => !u.deleted && assignedUserSyncIds.includes(u.syncId));
  if (!assigned.length) return null;
  const dim = size;
  return (
    <span className="flex items-center gap-0.5 flex-shrink-0">
      {assigned.slice(0, 2).map(u => (
        <span
          key={u.id}
          style={{ width: dim, height: dim, fontSize: dim * 0.6 }}
          className="rounded-full bg-gray-500 text-white flex items-center justify-center font-semibold leading-none flex-shrink-0"
          title={u.name}
        >
          {u.name[0].toUpperCase()}
        </span>
      ))}
    </span>
  );
}
