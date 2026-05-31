import React from 'react';

/**
 * lastGLANCE source badge.
 *
 * A miniature of the lastGLANCE logo mark: a square dot grid with one
 * highlighted column rendered in the brand green. Used as a small inline
 * indicator next to task titles so tasks created via lastGLANCE intents are
 * distinguishable from regular dayGLANCE tasks.
 *
 * The faint grid dots use `currentColor` so they adapt to context (white text
 * on coloured timeline cards, dark text in modals); the highlighted column is
 * always brand green for recognisability.
 */

const BRAND_GREEN = '#3DDC84';

// 5×5 grid laid out in a 24×24 viewBox. Column index 1 (left-of-centre, as in
// the wordmark) is the highlighted brand column.
const CELL = 3;
const STEP = 4.5;
const ORIGIN = 1.5;
const HIGHLIGHT_COL = 1;

const LastGlanceBadge = ({ size = 12, className = '', title }) => {
  const cells = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const highlighted = col === HIGHLIGHT_COL;
      cells.push(
        <rect
          key={`${row}-${col}`}
          x={ORIGIN + col * STEP}
          y={ORIGIN + row * STEP}
          width={CELL}
          height={CELL}
          rx={0.9}
          fill={highlighted ? BRAND_GREEN : 'currentColor'}
          opacity={highlighted ? 1 : 0.35}
        />,
      );
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {cells}
    </svg>
  );
};

export default LastGlanceBadge;
