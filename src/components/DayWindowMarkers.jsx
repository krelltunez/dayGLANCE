import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

// START/STOP day-window marker lines on the timeline grid. Render-only in
// phase A — the window is set and moved from the summary strip's day-window
// menu; making the lines themselves draggable is a later phase because it has
// to integrate with both the desktop and the phone drag systems.
//
// Dashed teal/indigo, deliberately distinct from the solid red current-time
// line and from the GTD frame bands. Labels sit centered on the line — both
// along it and straddling it — clear of the frame labels (top-left) and the
// current-time dot (left edge).

const START_COLOR = '#14b8a6'; // teal-500
const STOP_COLOR = '#6366f1'; // indigo-500

function MarkerLine({ topPx, color, label, onOpenMenu }) {
  return (
    <div className="absolute left-0 right-0 pointer-events-none z-[5]" style={{ top: `${topPx}px` }}>
      <div className="border-t-2 border-dashed" style={{ borderColor: color }} />
      {/* The chip (just the word, not the line) opens the day-window popover —
          the line itself stays click-transparent so blocks under it remain
          reachable. Dragging is deliberately not offered; the popover is the
          editor until real use proves drag is worth its integration cost. */}
      <button
        onClick={(e) => {
          // The chip sits inside a grid column whose own onClick opens the
          // new-task form at the tapped time — without stopping propagation a
          // chip tap opened BOTH the popover and that modal.
          e.stopPropagation();
          onOpenMenu();
        }}
        className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 px-1 rounded text-[9px] font-semibold uppercase tracking-wide text-white pointer-events-auto cursor-pointer"
        style={{ backgroundColor: color }}
      >
        {label}
      </button>
    </div>
  );
}

/**
 * @param dateStr      Day this column renders ('YYYY-MM-DD').
 * @param minToTop     Optional minutes→px transform for views whose columns
 *                     cover a slice of the day (DayView's 8-hour blocks).
 *                     Defaults to the shared minutesToPosition.
 * @param clipStartMin Optional visible range: a marker outside it is simply
 * @param clipEndMin   not drawn in this column.
 */
export default function DayWindowMarkers({ dateStr, minToTop, clipStartMin = 0, clipEndMin = 1440 }) {
  const { minutesToPosition, timeToMinutes } = useDayPlannerCtx();
  const { getDayWindow, setDayWindowMenuOpen } = useFeaturesCtx();

  const window = getDayWindow?.(dateStr);
  if (!window) return null;

  const toTop = minToTop ?? minutesToPosition;
  const lines = [];
  if (window.start) {
    const min = timeToMinutes(window.start);
    if (min >= clipStartMin && min < clipEndMin) {
      lines.push(<MarkerLine key="start" topPx={Math.round(toTop(min))} color={START_COLOR} label="start" onOpenMenu={() => setDayWindowMenuOpen?.(true)} />);
    }
  }
  if (window.stop) {
    const min = timeToMinutes(window.stop);
    if (min >= clipStartMin && min < clipEndMin) {
      lines.push(<MarkerLine key="stop" topPx={Math.round(toTop(min))} color={STOP_COLOR} label="end" onOpenMenu={() => setDayWindowMenuOpen?.(true)} />);
    }
  }
  return lines.length > 0 ? <>{lines}</> : null;
}
