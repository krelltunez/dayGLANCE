import React from 'react';

// Miniature of the Day Dial itself (ring, wedge, now needle) — a truer signal
// than any stock glyph, same idiom as the ViewCycler's bespoke icons. Colors
// via currentColor so callers style it like a lucide icon. Shared by the
// desktop header and the mobile GLANCE header.
const DayDialIcon = ({ size = 18, className }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true" className={className}>
    <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45" />
    <path d="M 9 1.75 A 7.25 7.25 0 0 1 16.25 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="9" y1="9" x2="4.5" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="4.5" cy="13.5" r="1.4" fill="currentColor" />
  </svg>
);

export default DayDialIcon;
