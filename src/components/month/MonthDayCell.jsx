import React, { useId } from 'react';
import { layoutDayCell } from '../../utils/monthCellLayout.js';
import { MONTH_CELL_LAYOUT } from '../../constants/monthView.js';

// Month view day cell (step 2). A miniature vertical timeline: the layout
// engine (utils/monthCellLayout.js) decides where everything goes, this
// component only draws it. There is no text in a cell beyond the date
// number and an overflow count, no hover state on anything, and the whole
// cell is the one tap target. Desktop and phone share the encoding; only the
// gutter (present when gutterWidth > 0) and the pixels-per-hour vary.
//
// Encoding, chosen so nothing rests on colour alone:
//   task     solid band, app blue
//   event    outlined band with a diagonal hatch, app gray
//   routine  solid band drawn faint, app teal
//   point    hollow diamond at the minute, stroked in the kind's colour
//   all-day  small marks with NO vertical meaning: stacked top-down in the
//            gutter in a fixed order (deadline, event, task, routine), or
//            in a row beside the date number when there is no gutter
//   deadline a flag mark, app rose, all-day only
// Colours are the app's Tailwind tokens with dark: variants, so the cell
// follows the root `dark` class like everything else.

const ALL_DAY_ORDER = ['deadline', 'event', 'task', 'routine'];
const orderAllDay = (list) => [...list].sort((a, b) =>
  ALL_DAY_ORDER.indexOf(a.kind) - ALL_DAY_ORDER.indexOf(b.kind) || Number(a.completed) - Number(b.completed));

const STROKE = {
  task: 'stroke-blue-500 dark:stroke-blue-400',
  event: 'stroke-gray-500 dark:stroke-gray-400',
  routine: 'stroke-teal-600 dark:stroke-teal-500',
  deadline: 'stroke-rose-500 dark:stroke-rose-400',
};
const FILL = {
  task: 'fill-blue-500 dark:fill-blue-400',
  event: 'fill-gray-200 dark:fill-gray-700',
  routine: 'fill-teal-600 dark:fill-teal-500',
  deadline: 'fill-rose-500 dark:fill-rose-400',
};
const dim = (completed) => (completed ? 'opacity-50' : '');

/** One timed band. Events get the outline + hatch, routines the faint fill. */
function Band({ band, hatchId }) {
  const { kind, x, y, width, height, completed } = band;
  const common = { 'data-band': band.id, 'data-kind': kind };
  if (kind === 'event') {
    return (
      <g {...common} className={dim(completed)}>
        <rect x={x + 0.5} y={y + 0.5} width={Math.max(0, width - 1)} height={Math.max(0, height - 1)} rx={1}
          strokeWidth={1} className={`${FILL.event} ${STROKE.event}`} />
        <rect x={x + 1} y={y + 1} width={Math.max(0, width - 2)} height={Math.max(0, height - 2)} fill={`url(#${hatchId})`} />
      </g>
    );
  }
  const faint = kind === 'routine' ? 'opacity-30' : '';
  return (
    <rect {...common} x={x} y={y} width={width} height={height} rx={1}
      className={`${FILL[kind] || FILL.task} ${faint} ${dim(completed)}`} />
  );
}

/** A moment with no length: a hollow diamond, so it never reads as a short band. */
function Point({ point, x }) {
  const s = MONTH_CELL_LAYOUT.pointSize;
  const { y, kind, completed } = point;
  return (
    <path data-point={point.id} data-kind={kind}
      d={`M${x},${y - s} L${x + s},${y} L${x},${y + s} L${x - s},${y} Z`}
      strokeWidth={1.25} className={`fill-white dark:fill-gray-900 ${STROKE[kind] || STROKE.task} ${dim(completed)}`} />
  );
}

/** An all-day mark. Position is the caller's; it carries no time. */
function AllDayMark({ item, x, y, hatchId }) {
  const m = MONTH_CELL_LAYOUT.gutterMarkerSize;
  const common = { 'data-allday-marker': item.id, 'data-kind': item.kind, className: dim(item.completed) };
  if (item.kind === 'deadline') {
    // A flag: pole on the left, pennant to the right.
    return (
      <g {...common}>
        <path d={`M${x + 1},${y} v${m}`} strokeWidth={1.25} className={STROKE.deadline} />
        <path d={`M${x + 1},${y} h${m - 1} l-2,${m / 2 - 0.5} l2,${m / 2 - 0.5} h${-(m - 1)} Z`} className={FILL.deadline} />
      </g>
    );
  }
  if (item.kind === 'event') {
    return (
      <g {...common}>
        <rect x={x + 0.5} y={y + 0.5} width={m - 1} height={m - 1} strokeWidth={1} className={`${FILL.event} ${STROKE.event}`} />
        <rect x={x + 1} y={y + 1} width={m - 2} height={m - 2} fill={`url(#${hatchId})`} />
      </g>
    );
  }
  const faint = item.kind === 'routine' ? 'opacity-40' : '';
  return <rect {...common} x={x} y={y} width={m} height={m} rx={1} className={`${FILL[item.kind] || FILL.task} ${faint} ${dim(item.completed)}`} />;
}

/**
 * @param {object} props
 * @param {string} props.date          YYYY-MM-DD
 * @param {Array<object>} props.items  AgendaItem / RoutineItem shapes for the day,
 *   routines tagged kind 'routine' and deadlines tagged kind 'deadline' (see tagKind)
 * @param {number} props.width         measured cell width, px
 * @param {number} props.height        measured cell height, px
 * @param {number} [props.gutterWidth=0]  right-hand all-day track; 0 on narrow cells
 * @param {boolean} [props.isToday=false]
 * @param {boolean} [props.inMonth=true]  false dims the cell (adjacent month)
 * @param {string} [props.label]       accessible name; defaults to the date
 * @param {(date: string) => void} [props.onSelect]  the whole-cell tap; the
 *   day sheet it opens is step 4, so callers leave it unwired for now
 */
export default function MonthDayCell({
  date, items, width, height, gutterWidth = 0, isToday = false, inMonth = true, label, onSelect,
}) {
  const hatchId = `mdc-hatch-${useId().replace(/:/g, '')}`;
  const { headerHeight, gutterMarkerSize: m, gutterMarkerGap: g } = MONTH_CELL_LAYOUT;
  const timelineHeight = Math.max(0, height - headerHeight);
  const layout = layoutDayCell(items, date, width, timelineHeight, { gutterWidth });
  const { usableWidth, bands, points, overflow } = layout;
  const hasGutter = layout.gutterWidth > 0;
  const allDay = orderAllDay(layout.allDay);
  const dayNumber = Number(String(date).slice(8, 10)) || '';

  // All-day marks: stacked in the gutter, or a row in the header. Whatever
  // does not fit joins the overflow count instead of being drawn smaller.
  const gutterCapacity = hasGutter ? Math.max(0, Math.floor((timelineHeight - 2 + g) / (m + g))) : 0;
  const headerCapacity = hasGutter ? 0 : Math.max(0, Math.floor((width - headerHeight - 6 + g) / (m + g)));
  const capacity = hasGutter ? gutterCapacity : headerCapacity;
  const shownAllDay = allDay.slice(0, capacity);
  const overflowCount = overflow.hidden.length + (allDay.length - shownAllDay.length);
  const showOverflow = overflowCount > 0 || overflow.crowded;
  const overflowText = overflowCount > 0 ? `+${overflowCount}` : '+';
  const badgeW = 6 + 5 * overflowText.length;

  return (
    <button
      type="button"
      data-month-cell={date}
      data-today={isToday ? 'true' : undefined}
      data-in-month={inMonth ? 'true' : 'false'}
      aria-label={label || date}
      onClick={onSelect ? () => onSelect(date) : undefined}
      className={`relative block p-0 m-0 border-0 bg-transparent text-left select-none appearance-none cursor-pointer overflow-hidden
        focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500
        ${isToday ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${inMonth ? '' : 'opacity-40'}`}
      style={{ width, height }}
    >
      <div className="absolute top-0 left-0 right-0 flex items-center gap-1 px-[3px]" style={{ height: headerHeight }}>
        <span
          data-month-cell-date
          className={`inline-flex items-center justify-center text-[11px] font-semibold leading-none tabular-nums shrink-0
            ${isToday ? 'bg-blue-600 text-white rounded-full' : 'text-stone-700 dark:text-gray-200'}`}
          style={{ width: headerHeight - 4, height: headerHeight - 4 }}
        >
          {dayNumber}
        </span>
        {!hasGutter && shownAllDay.length > 0 && (
          <svg data-month-cell-allday-row width={shownAllDay.length * (m + g) - g} height={m} aria-hidden="true" className="shrink-0">
            {shownAllDay.map((item, i) => <AllDayMark key={item.id} item={item} x={i * (m + g)} y={0} hatchId={hatchId} />)}
          </svg>
        )}
      </div>

      <svg
        data-month-cell-timeline
        width={width}
        height={timelineHeight}
        viewBox={`0 0 ${width} ${timelineHeight}`}
        aria-hidden="true"
        className="absolute left-0 block"
        style={{ top: headerHeight }}
      >
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"
            className="text-gray-500 dark:text-gray-400">
            <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>

        {hasGutter && (
          <g data-month-cell-gutter>
            <rect x={usableWidth} y={0} width={layout.gutterWidth} height={timelineHeight} className="fill-stone-100 dark:fill-white/5" />
            <line x1={usableWidth + 0.5} y1={0} x2={usableWidth + 0.5} y2={timelineHeight} strokeWidth={1} className="stroke-stone-300 dark:stroke-white/15" />
            {shownAllDay.map((item, i) => (
              <AllDayMark key={item.id} item={item} x={usableWidth + (layout.gutterWidth - m) / 2} y={2 + i * (m + g)} hatchId={hatchId} />
            ))}
          </g>
        )}

        {bands.map((band) => <Band key={band.id} band={band} hatchId={hatchId} />)}
        {points.map((point) => <Point key={point.id} point={point} x={usableWidth - MONTH_CELL_LAYOUT.pointSize - 2} />)}

        {showOverflow && (
          <g data-month-cell-overflow={overflowText} transform={`translate(${Math.max(0, usableWidth - badgeW - 1)}, ${Math.max(0, timelineHeight - 12)})`}>
            <rect width={badgeW} height={11} rx={3} className="fill-stone-700 dark:fill-gray-200" />
            <text x={badgeW / 2} y={8.5} textAnchor="middle" fontSize="8" fontWeight="600" className="fill-white dark:fill-gray-900">{overflowText}</text>
          </g>
        )}
      </svg>
    </button>
  );
}
