import React from 'react';

/**
 * dayGLANCE text wordmark — replaces the drawn logotype SVGs.
 *
 * "day" renders in a neutral gray that adapts to the theme; "GLANCE" is
 * italic brand orange. Uses the self-hosted Lora serif (see the @font-face
 * rules in index.css). Scale is controlled by the font-size passed via
 * `className` (e.g. "text-4xl"), mirroring how the old <img> used height
 * utilities. Pass `dayClassName` to override the "day" color (e.g. make it
 * white on a dark surface).
 */
export default function Wordmark({ className = '', darkMode = false, dayClassName }) {
  const dayColor = dayClassName ?? (darkMode ? 'text-gray-200' : 'text-stone-600');
  return (
    <span className={`font-brand leading-none tracking-tight whitespace-nowrap select-none ${className}`}>
      <span className={`font-medium ${dayColor}`}>day</span>
      <span className="font-bold italic text-brand">GLANCE</span>
    </span>
  );
}
