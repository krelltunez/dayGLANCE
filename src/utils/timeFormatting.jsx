import React from 'react';

export function formatHourLabel(hour, use24h) {
  const norm = hour % 24;
  if (use24h) return `${norm.toString().padStart(2, '0')}:00`;
  const n = norm === 0 ? 12 : norm > 12 ? norm - 12 : norm;
  return <>{n}<span className="text-[10px] ml-0.5">{norm >= 12 ? 'PM' : 'AM'}</span></>;
}
