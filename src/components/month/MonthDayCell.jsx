import React from 'react';
import { layoutDayCell } from '../../utils/monthCellLayout.js';
import { monthCellMetrics } from '../../utils/monthCellMetrics.js';
import { taskColorToHex } from '../../utils/colorUtils.js';

// Month view day cell (step 2, visual pass). A miniature vertical timeline:
// the layout engine (utils/monthCellLayout.js) decides where everything
// goes, this component only draws it. There is no text in a cell beyond the
// date number and an overflow count, no hover state on anything, and the
// whole cell is the one tap target. Desktop and phone share the encoding;
// every size below is a proportion of the cell (utils/monthCellMetrics.js),
// so a phone cell and a desktop cell are the same drawing at two scales.
//
// Encoding, chosen so nothing rests on colour alone:
//   task     rounded band in a pale tint of the task's OWN colour, as in
//            every other view
//   event    rounded band in a pale gray tint with a darker cap on its left
//            edge (the app's left-edge convention, as on frames and
//            hyperGLANCE bars); the cap is what says "event", so a gray
//            task still reads apart from an event
//   routine  the same band, teal, fainter still
//   point    hollow rounded diamond at the minute, stroked in the item's
//            colour, so it never reads as a short band
//   all-day  small rounded marks with NO vertical meaning: stacked top-down
//            in the gutter in a fixed order (deadline, event, task, routine),
//            or in a row beside the date number when there is no gutter;
//            the gutter itself is only a hairline
//   deadline a flag mark, app rose, all-day only
// Bands always span the full lane width with one uniform inset from the
// cell edges and from the gutter: horizontal position carries no meaning
// and widths stay comparable across days. Theme handling is the app's root
// `dark` class via Tailwind variants; tints use the item colour at a
// theme-specific opacity.

const ALL_DAY_ORDER = ['deadline', 'event', 'task', 'routine'];
const orderAllDay = (list) => [...list].sort((a, b) =>
  ALL_DAY_ORDER.indexOf(a.kind) - ALL_DAY_ORDER.indexOf(b.kind) || Number(a.completed) - Number(b.completed));

const TINT = '[fill-opacity:0.42] dark:[fill-opacity:0.55]';
const TINT_FAINT = '[fill-opacity:0.22] dark:[fill-opacity:0.3]';
const EVENT_FILL = `fill-gray-400 dark:fill-gray-500 ${TINT}`;
const EVENT_EDGE = 'fill-gray-600 dark:fill-gray-300';
const EVENT_STROKE = 'stroke-gray-500 dark:stroke-gray-400';
const ROUTINE_FILL = `fill-teal-500 ${TINT_FAINT}`;
const ROUTINE_STROKE = 'stroke-teal-600 dark:stroke-teal-400';
const DEADLINE_FILL = 'fill-rose-500 dark:fill-rose-400';
const DEADLINE_STROKE = 'stroke-rose-500 dark:stroke-rose-400';
const dim = (completed) => (completed ? 'opacity-50' : '');

/** A rect with only its left corners rounded: the event cap, flush with the band's edge. */
const leftCapPath = (x, y, w, h, radius) => {
  const r = Math.min(radius, h / 2, w);
  return `M${x + r},${y} H${x + w} V${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
};

/** The item's own colour, as the other views draw it. */
const itemHex = (item) => taskColorToHex(item?.color, item?.nativeCalendarColor);

/** One timed band. Tasks in their own tint, events gray with the cap, routines faint teal. */
function Band({ band, item, m }) {
  const { kind, x, y, width, height, completed } = band;
  const r = Math.min(m.radius, height / 2, width / 2);
  const common = { 'data-band': band.id, 'data-kind': kind };
  if (kind === 'event') {
    return (
      <g {...common} className={dim(completed)}>
        <rect x={x} y={y} width={width} height={height} rx={r} className={EVENT_FILL} />
        <path data-event-edge="" d={leftCapPath(x, y, Math.min(m.capWidth, width), height, r)} className={EVENT_EDGE} />
      </g>
    );
  }
  if (kind === 'routine') {
    return <rect {...common} x={x} y={y} width={width} height={height} rx={r} className={`${ROUTINE_FILL} ${dim(completed)}`} />;
  }
  return <rect {...common} x={x} y={y} width={width} height={height} rx={r} fill={itemHex(item)} className={`${TINT} ${dim(completed)}`} />;
}

/** A moment with no length: a hollow rounded diamond, so it never reads as a short band. */
function Point({ point, item, x, m }) {
  const side = m.pointSize * 1.6;
  const { y, kind, completed } = point;
  const strokeClass = kind === 'event' ? EVENT_STROKE : kind === 'routine' ? ROUTINE_STROKE : '';
  return (
    <rect data-point={point.id} data-kind={kind}
      x={x - side / 2} y={y - side / 2} width={side} height={side} rx={side * 0.3}
      transform={`rotate(45 ${x} ${y})`} strokeWidth={1.25}
      stroke={strokeClass ? undefined : itemHex(item)}
      className={`fill-white dark:fill-gray-900 ${strokeClass} ${dim(completed)}`} />
  );
}

/** An all-day mark. Position is the caller's; it carries no time. */
function AllDayMark({ entry, item, x, y, size, m }) {
  const s = size;
  const r = Math.max(1.5, s * 0.25);
  const common = { 'data-allday-marker': entry.id, 'data-kind': entry.kind, className: dim(entry.completed) };
  if (entry.kind === 'deadline') {
    // A flag: pole on the left, pennant to the right.
    return (
      <g {...common}>
        <path d={`M${x + 1},${y} v${s}`} strokeWidth={1.25} strokeLinecap="round" className={DEADLINE_STROKE} />
        <path d={`M${x + 1},${y} h${s - 1} l-2,${s / 2 - 0.5} l2,${s / 2 - 0.5} h${-(s - 1)} Z`}
          strokeWidth={1} strokeLinejoin="round" className={`${DEADLINE_FILL} ${DEADLINE_STROKE}`} />
      </g>
    );
  }
  if (entry.kind === 'event') {
    return (
      <g {...common}>
        <rect x={x} y={y} width={s} height={s} rx={r} className={EVENT_FILL} />
        <path data-event-edge="" d={leftCapPath(x, y, Math.min(m.capWidth, s), s, r)} className={EVENT_EDGE} />
      </g>
    );
  }
  if (entry.kind === 'routine') {
    return <rect {...common} x={x} y={y} width={s} height={s} rx={r} className={`fill-teal-500 [fill-opacity:0.5] ${dim(entry.completed)}`} />;
  }
  return <rect {...common} x={x} y={y} width={s} height={s} rx={r} fill={itemHex(item)} className={`[fill-opacity:0.85] ${dim(entry.completed)}`} />;
}

/**
 * @param {object} props
 * @param {string} props.date          YYYY-MM-DD
 * @param {Array<object>} props.items  AgendaItem / RoutineItem shapes for the day,
 *   routines tagged kind 'routine' and deadlines tagged kind 'deadline' (see tagKind)
 * @param {number} props.width         measured cell width, px
 * @param {number} props.height        measured cell height, px
 * @param {number} [props.gutterWidth] all-day track width; omit to follow the
 *   width rule in constants (present on wide cells, absent on narrow), 0 for none
 * @param {boolean} [props.isToday=false]
 * @param {boolean} [props.inMonth=true]  false dims the cell (adjacent month)
 * @param {string} [props.label]       accessible name; defaults to the date
 * @param {(date: string) => void} [props.onSelect]  the whole-cell tap; the
 *   day sheet it opens is step 4, so callers leave it unwired for now
 */
export default function MonthDayCell({
  date, items, width, height, gutterWidth, isToday = false, inMonth = true, label, onSelect,
}) {
  const m = monthCellMetrics(width, height, { gutter: gutterWidth === undefined ? 'auto' : gutterWidth });
  const layout = layoutDayCell(items, date, m.timelineWidth, m.timelineHeight);
  const { bands, points, overflow } = layout;
  const byId = new Map((items || []).map((item) => [String(item?.id), item]));
  const allDay = orderAllDay(layout.allDay);
  const dayNumber = Number(String(date).slice(8, 10)) || '';
  const { markerSize: ms, markerGap: mg } = m;

  // All-day marks: stacked in the gutter, or a row in the header. Whatever
  // does not fit joins the overflow count instead of being drawn smaller.
  const gutterCapacity = m.hasGutter ? Math.max(0, Math.floor((m.timelineHeight + mg) / (ms + mg))) : 0;
  const headerCapacity = m.hasGutter ? 0 : Math.max(0, Math.floor((width - m.dateSize - 2 * m.inset - 4 + mg) / (ms + mg)));
  const shownAllDay = allDay.slice(0, m.hasGutter ? gutterCapacity : headerCapacity);
  const overflowCount = overflow.hidden.length + (allDay.length - shownAllDay.length);
  const showOverflow = overflowCount > 0 || overflow.crowded;
  const overflowText = overflowCount > 0 ? `+${overflowCount}` : '+';
  const badgeH = Math.max(11, Math.round(m.headerHeight * 0.6));
  const badgeFont = Math.round(badgeH * 0.72);
  const badgeW = Math.round(badgeH * 0.5 + badgeFont * 0.62 * overflowText.length);
  const gutterX = width - m.gutterWidth;

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
        ${isToday ? 'bg-blue-50/70 dark:bg-blue-900/15' : ''} ${inMonth ? '' : 'opacity-40'}`}
      style={{ width, height }}
    >
      <svg
        data-month-cell-timeline
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="absolute inset-0 block"
      >
        {m.hasGutter && (
          <g data-month-cell-gutter>
            {/* A hairline only: the track is a quiet edge, never a block of fill. */}
            <line x1={gutterX + 0.5} y1={m.timelineTop} x2={gutterX + 0.5} y2={m.timelineTop + m.timelineHeight}
              strokeWidth={1} strokeLinecap="round" className="stroke-stone-300 dark:stroke-white/15" />
            {shownAllDay.map((item, i) => (
              <AllDayMark key={item.id} entry={item} item={byId.get(item.id)} x={gutterX + (m.gutterWidth - ms) / 2} y={m.timelineTop + i * (ms + mg)} size={ms} m={m} />
            ))}
          </g>
        )}

        <g data-month-cell-lanes transform={`translate(${m.timelineLeft}, ${m.timelineTop})`}>
          {bands.map((band) => <Band key={band.id} band={band} item={byId.get(band.id)} m={m} />)}
          {points.map((point) => <Point key={point.id} point={point} item={byId.get(point.id)} x={m.timelineWidth - m.pointSize - 1} m={m} />)}
          {showOverflow && (
            <g data-month-cell-overflow={overflowText} transform={`translate(${Math.max(0, m.timelineWidth - badgeW)}, ${Math.max(0, m.timelineHeight - badgeH)})`}>
              <rect width={badgeW} height={badgeH} rx={badgeH / 3} className="fill-stone-600 dark:fill-gray-300" />
              <text x={badgeW / 2} y={badgeH * 0.74} textAnchor="middle" fontSize={badgeFont} fontWeight="600" className="fill-white dark:fill-gray-900">{overflowText}</text>
            </g>
          )}
        </g>
      </svg>

      <div className="absolute top-0 left-0 right-0 flex items-center gap-1" style={{ height: m.headerHeight, paddingLeft: m.inset, paddingRight: m.inset }}>
        <span
          data-month-cell-date
          className={`inline-flex items-center justify-center font-semibold leading-none tabular-nums shrink-0 rounded-md
            ${isToday ? 'bg-blue-100 text-blue-800 dark:bg-blue-400/25 dark:text-blue-100' : 'text-stone-700 dark:text-gray-200'}`}
          style={{ width: m.dateSize, height: m.dateSize, fontSize: m.dateFont }}
        >
          {dayNumber}
        </span>
        {!m.hasGutter && shownAllDay.length > 0 && (
          <svg data-month-cell-allday-row width={shownAllDay.length * (ms + mg) - mg} height={ms} aria-hidden="true" className="shrink-0">
            {shownAllDay.map((item, i) => <AllDayMark key={item.id} entry={item} item={byId.get(item.id)} x={i * (ms + mg)} y={0} size={ms} m={m} />)}
          </svg>
        )}
      </div>
    </button>
  );
}
