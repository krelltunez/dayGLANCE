// ┌──────────────────────────────────────────────────────────────────────────┐
// │ TEMPORARY. Month view step 2 dev harness for MonthDayCell.               │
// │ Not linked from the app. Reach it with `?month-cells` on the web or the  │
// │ Electron dev server, or on a device by setting localStorage             │
// │ 'day-planner-dev-month-cells' to '1' (chrome://inspect on a debug       │
// │ Android build) and reloading. Delete this file and the gate in           │
// │ src/main.jsx once the month grid (step 3) renders real cells.            │
// └──────────────────────────────────────────────────────────────────────────┘
import React, { useEffect, useState } from 'react';
import MonthDayCell from './MonthDayCell.jsx';
import { tagKind } from '../../utils/monthCellLayout.js';
import { FIXTURE_DATE, busyDayItems } from '../../utils/monthCellLayout.fixture.js';

const D = FIXTURE_DATE;
const task = (id, startTime, duration, extra = {}) => ({ id, title: id, date: D, startTime, duration, isAllDay: false, completed: false, ...extra });
const event = (id, startTime, duration, extra = {}) => task(id, startTime, duration, { imported: true, ...extra });
const busy = busyDayItems();

const SCENARIOS = [
  { label: 'empty', items: [] },
  { label: 'single', items: [task('a', '09:00', 60)] },
  { label: '3-way', items: [event('team', '13:00', 60), task('review', '13:30', 60), event('interview', '13:45', 30)] },
  { label: 'past cap', items: [task('a', '09:00', 60), task('b', '09:10', 50), event('c', '09:20', 40), task('d', '09:30', 30)] },
  { label: 'all-day + timed', items: [
    task('bday', null, null, { isAllDay: true, imported: true }),
    task('expense', null, null, { isAllDay: true }),
    { id: 'dl-1', kind: 'deadline', isAllDay: true, completed: false, date: D },
    ...tagKind([{ id: 'r-ad', name: 'Stretch', startTime: null, duration: null, isAllDay: true, completed: false }], 'routine'),
    task('a', '10:00', 60), event('e', '14:00', 30, { completed: true }),
  ] },
  { label: 'point', items: [task('dentist', '11:00', 0), event('call', '15:30', 0), task('a', '09:00', 90)] },
  { label: 'busy', items: [...busy.agenda, ...tagKind(busy.routines, 'routine'), { id: 'dl-2', kind: 'deadline', isAllDay: true, completed: false, date: D }] },
];

const SIZES = [
  { label: 'phone 52×88, no gutter', width: 52, height: 88, gutterWidth: 0 },
  { label: 'phone 56×110, no gutter', width: 56, height: 110, gutterWidth: 0 },
  { label: 'tablet 96×120, gutter 12', width: 96, height: 120, gutterWidth: 12 },
  { label: 'desktop 160×140, gutter 16', width: 160, height: 140, gutterWidth: 16 },
  { label: 'wide 220×200, gutter 20', width: 220, height: 200, gutterWidth: 20 },
];

const Row = ({ size, dark }) => (
  <section className="mb-6">
    <h2 className="text-xs font-semibold text-stone-500 dark:text-gray-400 mb-1">{size.label}</h2>
    <div className="flex flex-wrap gap-3 items-start">
      {SCENARIOS.map((sc, i) => (
        <figure key={sc.label} className="m-0">
          <div className={`border ${dark ? 'border-gray-700 bg-gray-900' : 'border-stone-300 bg-white'}`} style={{ width: size.width, height: size.height }}>
            <MonthDayCell date={D} items={sc.items} width={size.width} height={size.height} gutterWidth={size.gutterWidth}
              isToday={i === 1} inMonth={i !== 0} onSelect={(d) => console.log('[month-cells] select', d, sc.label)} />
          </div>
          <figcaption className="text-[10px] text-stone-500 dark:text-gray-500 mt-0.5">{sc.label}</figcaption>
        </figure>
      ))}
    </div>
  </section>
);

// Seven columns across the real viewport, the shape the step 3 grid will have:
// gutter on wide screens (the app's tablet breakpoint), none on phones.
const FitRow = ({ dark }) => {
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const width = Math.floor((vw - 16) / 7);
  const gutterWidth = vw >= 721 ? 14 : 0;
  const height = vw >= 721 ? 140 : 96;
  return (
    <section className="mb-6">
      <h2 className="text-xs font-semibold text-stone-500 dark:text-gray-400 mb-1">fit to screen: 7 × {width}×{height}, gutter {gutterWidth}</h2>
      <div className={`grid border-t border-l ${dark ? 'border-gray-700' : 'border-stone-300'}`} style={{ gridTemplateColumns: `repeat(7, ${width}px)` }}>
        {SCENARIOS.map((sc, i) => (
          <div key={sc.label} className={`border-r border-b ${dark ? 'border-gray-700' : 'border-stone-300'}`}>
            <MonthDayCell date={D} items={sc.items} width={width} height={height} gutterWidth={gutterWidth} isToday={i === 6} />
          </div>
        ))}
      </div>
    </section>
  );
};

export default function MonthCellDevHarness() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);
  return (
    <main className={`min-h-screen p-2 ${dark ? 'bg-gray-950 text-gray-100' : 'bg-stone-50 text-stone-900'}`}>
      <header className="flex items-center gap-3 mb-4">
        <h1 className="text-sm font-bold">Month day cells (TEMPORARY dev harness)</h1>
        <button type="button" onClick={() => setDark((v) => !v)} className="text-xs px-2 py-1 rounded border border-current">
          {dark ? 'light' : 'dark'}
        </button>
        <span className="text-[10px] text-stone-500 dark:text-gray-500">cells: 1st is outside the month, 2nd is today; last row is today</span>
      </header>
      <FitRow dark={dark} />
      {SIZES.map((size) => <Row key={size.label} size={size} dark={dark} />)}
    </main>
  );
}
