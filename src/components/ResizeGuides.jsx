import React from 'react';

const DAY_MINUTES = 24 * 60;

// Guide lines while a task card is resized by either edge (#2273): one at its
// start and one at its end, each with its time, so it is clear what the block
// will become. The edge under the pointer is drawn solid and the fixed edge
// faded. The start label sits above its line and the end label below its
// line, outside the card, so a 15-minute block keeps both readable.
//
// `preview` is useDragDrop's resizePreview ({ edge, startMinutes, endMinutes }).
// `minToTop` maps a minute of the day to this column's pixel offset. A DAY
// column shows only its own hours (`clipStartMin`..`clipEndMin`), so a line
// outside them belongs to another column and is not drawn here.
const ResizeGuides = ({
  preview, minToTop, formatMinutes, darkMode,
  clipStartMin = 0, clipEndMin = DAY_MINUTES,
  className = 'left-0 right-0',
}) => {
  if (!preview) return null;
  const { edge, startMinutes, endMinutes } = preview;
  const lines = [
    {
      key: 'start', minutes: startMinutes, moving: edge === 'top',
      inColumn: startMinutes >= clipStartMin && startMinutes < clipEndMin,
    },
    {
      key: 'end', minutes: endMinutes, moving: edge !== 'top',
      inColumn: endMinutes > clipStartMin && endMinutes <= clipEndMin,
    },
  ];
  const labelBg = darkMode ? 'bg-blue-500' : 'bg-blue-600';
  return lines.filter((line) => line.inColumn).map((line) => (
    <div
      key={line.key}
      data-resize-guide={line.key}
      className={`absolute ${className} pointer-events-none z-20`}
      style={{ top: `${Math.round(minToTop(line.minutes))}px` }}
    >
      <div className="relative">
        <div className={`absolute ${line.key === 'start' ? 'bottom-0.5' : 'top-0.5'} right-0 px-1.5 py-0.5 rounded text-[10px] font-bold text-white whitespace-nowrap ${labelBg} ${line.moving ? '' : 'opacity-80'}`}>
          {formatMinutes(line.minutes % DAY_MINUTES)}
        </div>
        <div className={`h-0.5 ${line.moving ? 'bg-blue-500' : 'bg-blue-500/50'}`} />
      </div>
    </div>
  ));
};

export default ResizeGuides;
