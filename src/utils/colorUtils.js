// Task color palette — used in the task editor color picker and as defaults.
export const TASK_COLORS = [
  { name: 'Blue',   class: 'bg-blue-500' },
  { name: 'Purple', class: 'bg-purple-500' },
  { name: 'Green',  class: 'bg-green-500' },
  { name: 'Orange', class: 'bg-orange-500' },
  { name: 'Pink',   class: 'bg-pink-500' },
  { name: 'Indigo', class: 'bg-indigo-500' },
  { name: 'Red',    class: 'bg-red-500' },
  { name: 'Teal',   class: 'bg-teal-500' },
  { name: 'Yellow', class: 'bg-yellow-500' },
];

// Maps Tailwind CSS background-color classes to hex values for the native Android widget.
// The widget renders in a separate process and cannot resolve Tailwind classes.
export const TAILWIND_TO_HEX = {
  'bg-blue-500': '#3b82f6', 'bg-blue-400': '#60a5fa', 'bg-blue-600': '#2563eb',
  'bg-red-500': '#ef4444',  'bg-red-400': '#f87171',  'bg-red-600': '#dc2626',
  'bg-green-500': '#22c55e','bg-green-400': '#4ade80', 'bg-green-600': '#16a34a',
  'bg-purple-500': '#a855f7','bg-purple-400': '#c084fc','bg-purple-600': '#9333ea',
  'bg-orange-500': '#f97316','bg-orange-400': '#fb923c','bg-orange-600': '#ea580c',
  'bg-pink-500': '#ec4899', 'bg-pink-400': '#f472b6', 'bg-pink-600': '#db2777',
  'bg-indigo-500': '#6366f1','bg-indigo-400': '#818cf8','bg-indigo-600': '#4f46e5',
  'bg-teal-500': '#14b8a6', 'bg-teal-400': '#2dd4bf', 'bg-teal-600': '#0d9488',
  'bg-yellow-500': '#eab308','bg-yellow-400': '#facc15','bg-yellow-600': '#ca8a04',
  'bg-amber-500': '#f59e0b', 'bg-amber-400': '#fbbf24','bg-amber-600': '#d97706',
  'bg-cyan-500': '#06b6d4', 'bg-cyan-400': '#22d3ee', 'bg-cyan-600': '#0891b2',
  'bg-emerald-500': '#10b981','bg-emerald-400': '#34d399',
  'bg-violet-500': '#8b5cf6','bg-violet-400': '#a78bfa',
  'bg-rose-500': '#f43f5e', 'bg-rose-400': '#fb7185',
  'bg-sky-500': '#0ea5e9',  'bg-sky-400': '#38bdf8',
  'bg-lime-500': '#84cc16', 'bg-fuchsia-500': '#d946ef',
};

/** Converts a task's .color field (Tailwind class or native hex) to a hex string. */
export const taskColorToHex = (color, nativeCalendarColor) => {
  if (nativeCalendarColor) return nativeCalendarColor;
  if (!color || color === 'task-calendar') return '#3b82f6';
  if (color.startsWith('#')) return color;
  return TAILWIND_TO_HEX[color] || '#3b82f6';
};
