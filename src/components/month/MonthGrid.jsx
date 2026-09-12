import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import MonthDayCell from './MonthDayCell.jsx';
import { monthGridDates, monthCellSize, shiftMonth } from '../../utils/monthGrid.js';
import { dayCellItemKind } from '../../utils/monthCellLayout.js';
import { MONTH_CELL_LAYOUT } from '../../constants/monthView.js';
import { formatLocalizedDate, localizedWeekdays } from '../../utils/localeFormatting.js';

// Month view grid (step 3). Renders one month of MonthDayCells: leading and
// trailing days from the adjacent months dimmed, four to six rows, columns
// starting on the app's week-start day. Measures its own area and hands
// every cell its actual pixel size plus the gutter when the cell is wide
// enough for one (rules in constants/monthView.js). Data comes in through
// itemsForDate, so the grid has no opinion about where items live; the
// caller wires it to the same source the other views read.
//
// Cell selection is a prop the caller leaves unwired until the day sheet
// (step 4). Nothing here routes into the app yet.

const localDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The cell's accessible name: the date, "today" when it is, and a count per
 * kind of item, in the user's language. The only text a cell ever has.
 */
export function monthCellLabel(dateStr, items, isToday, t, language) {
  const counts = { event: 0, task: 0, routine: 0, deadline: 0 };
  for (const item of items || []) counts[dayCellItemKind(item)] += 1;
  const parts = [];
  if (counts.event) parts.push(t('month.events', { count: counts.event }));
  if (counts.task) parts.push(t('month.tasks', { count: counts.task }));
  if (counts.routine) parts.push(t('month.routines', { count: counts.routine }));
  if (counts.deadline) parts.push(t('month.deadlines', { count: counts.deadline }));
  const date = formatLocalizedDate(new Date(`${dateStr}T12:00:00`), { weekday: 'long', month: 'long', day: 'numeric' }, language);
  const head = isToday ? `${date}, ${t('month.today')}` : date;
  return `${head}: ${parts.length ? parts.join(', ') : t('month.nothingScheduled')}`;
}

/**
 * @param {object} props
 * @param {number} props.year
 * @param {number} props.month  1..12
 * @param {(dateStr: string) => Array<object>} props.itemsForDate  the day's
 *   items in the shapes layoutDayCell takes (routines tagged 'routine',
 *   deadlines tagged 'deadline')
 * @param {number} [props.weekStartDay=0]
 * @param {string} [props.today]  YYYY-MM-DD; defaults to the local date
 * @param {(year: number, month: number) => void} [props.onNavigate]
 * @param {(dateStr: string) => void} [props.onSelectDate]  cell tap (step 4)
 * @param {number} [props.width]   fixed grid-area size, else measured
 * @param {number} [props.height]
 */
export default function MonthGrid({
  year, month, itemsForDate, weekStartDay = 0, today, onNavigate, onSelectDate, width, height,
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const todayStr = today || localDateStr(new Date());
  const grid = useMemo(() => monthGridDates(year, month, weekStartDay), [year, month, weekStartDay]);

  const areaRef = useRef(null);
  const [measured, setMeasured] = useState({ width: width || 0, height: height || 0 });
  useLayoutEffect(() => {
    if (width && height) return undefined;
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const read = () => setMeasured({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);
  const area = { width: width || measured.width, height: height || measured.height };
  const cell = monthCellSize(area.width, area.height, grid.rows, MONTH_CELL_LAYOUT);
  const ready = area.width > 0 && area.height > 0;

  const weekdayNames = useMemo(() => localizedWeekdays('short', language), [language]);
  const title = formatLocalizedDate(new Date(year, month - 1, 1), { month: 'long', year: 'numeric' }, language);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  return (
    <div data-month-grid={`${year}-${String(month).padStart(2, '0')}`} className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-2 py-1 shrink-0 mx-auto w-full" style={ready ? { maxWidth: cell.width * 7 } : undefined}>
        <button type="button" onClick={onNavigate ? () => onNavigate(prev.year, prev.month) : undefined}
          aria-label={t('month.previousMonth')} className="p-1 rounded text-stone-600 dark:text-gray-300">
          <ChevronLeft size={18} />
        </button>
        <h2 data-month-grid-title className="text-sm font-semibold text-stone-800 dark:text-gray-100">{title}</h2>
        <button type="button" onClick={onNavigate ? () => onNavigate(next.year, next.month) : undefined}
          aria-label={t('month.nextMonth')} className="p-1 rounded text-stone-600 dark:text-gray-300">
          <ChevronRight size={18} />
        </button>
      </div>

      <div data-month-grid-weekdays className="grid grid-cols-7 shrink-0 mx-auto" style={ready ? { width: cell.width * 7 } : undefined}>
        {grid.weekdays.map((weekday) => (
          <div key={weekday} className="text-[10px] font-semibold uppercase tracking-wide text-center text-stone-500 dark:text-gray-400 py-0.5">
            {weekdayNames[weekday]}
          </div>
        ))}
      </div>

      <div ref={areaRef} data-month-grid-area className={`flex-1 min-h-0 ${cell.scrolls ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        {ready && (
          <div
            data-month-grid-cells
            className="grid mx-auto border-t border-l border-stone-200 dark:border-white/10"
            style={{ gridTemplateColumns: `repeat(7, ${cell.width}px)`, width: cell.width * 7 }}
          >
            {grid.cells.map(({ dateStr, inMonth }) => {
              const items = itemsForDate ? itemsForDate(dateStr) : [];
              const isToday = dateStr === todayStr;
              return (
                <div key={dateStr} className="border-r border-b border-stone-200 dark:border-white/10">
                  <MonthDayCell
                    date={dateStr}
                    items={items}
                    width={cell.width}
                    height={cell.height}
                    gutterWidth={cell.gutterWidth}
                    isToday={isToday}
                    inMonth={inMonth}
                    label={monthCellLabel(dateStr, items, isToday, t, language)}
                    onSelect={onSelectDate}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
