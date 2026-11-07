import React, { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { planHistory } from '../utils/originalPlan.js';
import { intermediatePlans, hiddenStops } from '../utils/planTrail.js';
import { formatShortDate } from '../utils/taskUtils.js';
import { formatDuration } from '../utils/formatDuration.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// Reveals what a task was ORIGINALLY planned for, next to where it sits now.
//
// This is the first thing in the app to read `originalPlan` (utils/originalPlan.js),
// and it exists for two reasons. The obvious one is that a rescheduled task
// losing its original intention was the gap #1623 opened with. The less obvious
// one is that a field nothing reads can be silently wrong for months: the
// baseline shipped once already in a state where it never survived a sync cycle,
// and the only way to notice was a console query. This makes that check part of
// using the app.
//
// It renders NOTHING when there is no story to tell — no baseline recorded, or
// the task is still exactly where it was first put. An affordance on every task
// that opens to say "nothing happened" is worse than no affordance, and most
// tasks are in that state.
//
// The icon is lucide's `History` (a clock with a turn-back arrow) rather than
// `Clock`, which the card already uses for the task's CURRENT start time. Two
// clocks side by side meaning different things would be worse than precise.
// The panel body, exported so a test can render it directly. Everything inside
// only ever runs while the popover is open, which is precisely the code a static
// render of the closed badge cannot reach.
const isDateString = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function PlanHistoryPanel({ history, task, formatTime }) {
  const { t } = useTranslation();
  const { plan, changed } = history ?? { plan: null, changed: {} };
  const deferrals = Number(task?.deferrals) || 0;
  // Reversed HERE rather than in the util: the data's order is chronological,
  // and which way the panel reads is a layout decision.
  const stops = [...intermediatePlans(task)].reverse();
  const earlier = hiddenStops(task);

  // A changed value is stated plainly; an unchanged one is dimmed, so the eye
  // lands on what actually moved rather than on three values of equal weight.
  const part = (value, didChange) => (
    <span className={didChange ? 'font-semibold' : 'opacity-60'}>{value}</span>
  );

  // `emphasis` marks what moved between the FIRST plan and the current one. An
  // intermediate stop is not either of those, so it passes false and reads flat:
  // bolding it against a diff it took no part in would point at nothing.
  // A row reads only what it has. An Inbox task (SCHED shows Inbox cards with
  // a deadline, and a task moved back to the Inbox keeps its history) has no
  // date or time now: that row says so rather than formatting a missing date,
  // which threw "Invalid time value" the moment the panel opened.
  const row = (date, startTime, duration, emphasis = changed) => (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {isDateString(date)
        ? part(formatShortDate(new Date(`${date}T12:00:00`)), emphasis.date)
        : part(t('task.planHistoryInInbox'), emphasis.date)}
      {isDateString(date) && startTime && (<>
        <span className="opacity-40">·</span>
        {part(formatTime(startTime), emphasis.startTime)}
      </>)}
      {typeof duration === 'number' && (<>
        <span className="opacity-40">·</span>
        {part(formatDuration(duration, t), emphasis.duration)}
      </>)}
    </div>
  );
  const NO_EMPHASIS = {};

  return (
    <>
      {/* NEWEST FIRST, top to bottom, which is what lets the panel hold three
          things at once: dates that descend without a break, stops labelled
          "recent" that really are the recent ones, and the count of what the cap
          dropped sitting in its true chronological slot — after the oldest stop
          still kept and before the baseline it followed. Read the other way
          round, that count has nowhere to go: at the head of the list it reads
          as a fragment with something missing above it, and reversing only the
          middle section leaves the dates running 15, 18, 15, 19 down the page.
          It is also how every other history reads: newest at the top. */}
      {history && (<>
        <div className="opacity-60 mb-0.5">{t('task.nowScheduled')}</div>
        {row(task.date, task.startTime, task.duration)}
        {/* The stops in between, which is what makes this a history rather than
            a before-and-after. Flat rather than emphasised: the eye should land
            on where it is now and where it began, with the middle read only if
            the shape of the slide is the question. Duration is left off — a
            stop records a schedule move, and a resize is not one. */}
        {stops.length > 0 && (<>
          <div className="opacity-60 mt-1.5 mb-0.5">{t('task.movedVia')}</div>
          <div className="space-y-0.5">
            {stops.map((stop) => (
              <div key={`${stop.at}-${stop.date}-${stop.startTime}`}>
                {row(stop.date, stop.startTime, undefined, NO_EMPHASIS)}
              </div>
            ))}
            {/* Everything the cap dropped, in one line, where those moves
                actually happened: older than the last stop shown, newer than
                the baseline below. */}
            {earlier > 0 && (
              <div className="opacity-50">{t('task.earlierMoves', { count: earlier })}</div>
            )}
          </div>
        </>)}
        <div className="opacity-60 mt-1.5 mb-0.5">{t('task.originallyPlanned')}</div>
        {row(plan.date, plan.startTime, plan.duration)}
      </>)}
      {/* The count is the other half of the story: two points say WHERE it moved,
          this says how often it slipped. Counted only for moves made after the
          task came due, so planning does not inflate it (utils/deferrals.js). */}
      {deferrals > 0 && (
        <div className={`opacity-60 ${history ? 'mt-1.5' : ''}`}>
          {t('task.deferredTimes', { count: deferrals })}
        </div>
      )}
    </>
  );
}

// `size` matches the icon scale of whichever card row this sits in: 12 on the
// timeline card, 10 on the denser SCHED row.
// `pad` is the button's padding: a row with room for larger tap targets
// (SCHED) passes more, with a matching negative margin so the row keeps its
// height.
export default function TaskPlanHistory({ task, size = 12, pad = 'p-0.5' }) {
  const { t } = useTranslation();
  // SCHED cards also render inside the project planner, which is not guaranteed
  // to sit under the day-planner provider. Falling back to the raw value keeps
  // the history readable there instead of throwing.
  const formatTime = useDayPlannerCtx()?.formatTime ?? ((value) => value);
  const [open, setOpen] = useState(false);
  // Fixed coordinates, measured from the button when it opens. An absolutely
  // positioned panel is clipped by the timeline column and by the card itself —
  // a WEEK column is narrower than this panel — so it has to escape both.
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const buttonRef = useRef(null);

  const PANEL_WIDTH = 230;
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) {
      setPos({
        top: r.bottom + 4,
        // Clamped to the viewport so a task at either edge still reads.
        left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8)),
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (e) => { if (!ref.current?.contains(e.target)) close(); };
    const onKeyDown = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // A fixed panel does not follow its anchor, so a resize retires it rather
    // than leaving it over an unrelated part of the timeline. Deliberately NOT
    // listening for scroll in the capture phase: the click that opens the panel
    // can itself scroll the card into view, and that closed the panel instantly.
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const history = planHistory(task);
  // A task that slipped before the baseline shipped has a count but no plan to
  // compare against. That is still something to tell, so the badge appears for
  // either half.
  const hasCount = (Number(task?.deferrals) || 0) > 0;
  if (!history && !hasCount) return null;

  return (
    <span ref={ref} className="relative flex-shrink-0 inline-flex">
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={`hover:bg-white/20 rounded ${pad} transition-colors opacity-75 hover:opacity-100`}
        title={t('task.planHistory')}
        aria-expanded={open}
      >
        <History size={size} />
      </button>
      {open && pos && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_WIDTH }}
          className="z-50 rounded-lg shadow-xl border p-2 text-xs
                     bg-white dark:bg-gray-800 text-gray-800 dark:text-white
                     border-stone-300 dark:border-gray-700"
        >
          <PlanHistoryPanel history={history} task={task} formatTime={formatTime} />
        </div>
      )}
    </span>
  );
}
