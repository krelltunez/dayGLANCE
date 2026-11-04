import React from 'react';

// The block a dragged task becomes if it is dropped now (#2277): a
// translucent fill over its whole duration, the start edge as the solid line
// the drag preview always drew, and the time label above it. Each view places
// it with its own time-to-pixel conversion (see dragBlockRange in
// utils/dragUtils.js for the range); this only draws it, and never takes a
// pointer event, so the drop still lands on the column underneath.
//
// `showStart` is false for the continuation of a block that began in an
// earlier column (DAY's 8-hour columns): no start edge and no label there.
const DragBlockPreview = ({ top, height, label, darkMode, className = 'left-0 right-0 z-20', showStart = true }) => (
  <div
    data-drag-block-preview=""
    className={`absolute pointer-events-none ${className}`}
    style={{ top: `${top}px`, height: `${Math.max(0, height)}px` }}
  >
    <div className={`absolute inset-0 border border-blue-500/70 ${showStart ? 'rounded-t-sm' : 'border-t-0'} rounded-b-sm ${darkMode ? 'bg-blue-400/20' : 'bg-blue-500/15'}`} />
    {showStart && (
      <div className="absolute left-0 right-0 top-0">
        <div className="relative">
          <div className={`absolute bottom-0.5 right-0 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${darkMode ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white'}`}>
            {label}
          </div>
          <div className="h-0.5 bg-blue-500" />
        </div>
      </div>
    )}
  </div>
);

export default DragBlockPreview;
