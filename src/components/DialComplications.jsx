import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, ExternalLink, Inbox, Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { stripWikilinks } from '../utils/taskUtils.js';
import { HabitRing } from './HabitRing.jsx';

// Watch-face complications for the Day Dial: up to four small readouts on
// the face itself, each one actionable.
//
// They sit at the corners of a square inscribed in the dial — the Apple
// Watch position — because every other candidate is already spoken for. The
// weather ring puts a temperature at r=250 on each diagonal and the hour
// labels put "03/09/15/21" at r=478 on the same four axes, so a complication
// has to clear both: inside the temperatures it collides with the hub's own
// typography, and between them there is no gap. Outside the labels there is
// nothing but dead corner.
//
// HTML rather than SVG, like the hub, so the habit rings can be the app's
// own HabitRing component instead of a second implementation of it that
// would drift. That means the slots are positioned in px off the dial's
// measured size, which the parent passes in.

// Slot radius as a fraction of the dial's radius, where 1.0 is the viewBox's
// half-height. The hour labels sit at 0.96, so a slot has to clear that:
// 1.2 puts it in the corner of the square the circle is inscribed in, which
// is the only part of the face nothing else uses. Mocked against the
// alternative (inside the ring, around the hub) — there the readouts crowd
// the clock and collide with the hub's own narration line.
const SLOT_R = 1.2;
const SLOT_DIAGONAL = Math.SQRT1_2;

// Where each slot sits, as a fraction of the dial's radius from centre.
export const COMPLICATION_SLOTS = [
  { key: 'tl', x: -SLOT_R * SLOT_DIAGONAL, y: -SLOT_R * SLOT_DIAGONAL },
  { key: 'tr', x: SLOT_R * SLOT_DIAGONAL, y: -SLOT_R * SLOT_DIAGONAL },
  { key: 'bl', x: -SLOT_R * SLOT_DIAGONAL, y: SLOT_R * SLOT_DIAGONAL },
  { key: 'br', x: SLOT_R * SLOT_DIAGONAL, y: SLOT_R * SLOT_DIAGONAL },
];

// Three sizes, chosen from the dial's measured diameter rather than from a
// viewport breakpoint — the dial is sized by the space the modal gives it,
// so the same window can produce very different faces (sidebar open, tray
// popup, rotated wall panel). A readout that reads well on a 13" laptop is
// a speck on a 27" display; each tier keeps the slot at roughly the same
// share of the face.
export const COMPLICATION_SIZES = [
  { key: 'sm', minDialPx: 520, dot: 46, icon: 15, count: 'text-lg', label: 'text-[10px]' },
  { key: 'md', minDialPx: 700, dot: 58, icon: 18, count: 'text-2xl', label: 'text-[11px]' },
  { key: 'lg', minDialPx: 860, dot: 74, icon: 22, count: 'text-3xl', label: 'text-xs' },
];

// Below the smallest tier the face has no room for readouts that must stay
// legible and tappable — a phone dial is ~385px across, and four corner
// slots on it would sit on top of the hub's own text.
export const COMPLICATION_MIN_DIAL_PX = COMPLICATION_SIZES[0].minDialPx;

/** The largest tier the measured face can carry, or null if it can carry none. */
export const complicationSize = (dialPx) => {
  if (!dialPx) return null;
  let found = null;
  for (const size of COMPLICATION_SIZES) if (dialPx >= size.minDialPx) found = size;
  return found;
};

// How long a press has to be held before it means "open the sheet" rather
// than "add one" — the same 500ms GLANCE's habit rings use, so the gesture
// is one habit, not two.
const HOLD_MS = 500;

const COUNT_KINDS = { inbox: Inbox, deadlines: CalendarClock };

/**
 * A habit's own ring, wired the way GLANCE wires it: a tap adds one, a hold
 * (or a right-click / context-menu key) opens the sheet. The dimming is the
 * point of the wrapper — HabitRing paints a saturated brand colour that is
 * right in a sidebar but wrong on the face, where the orange now-line has to
 * stay the brightest thing on screen. Hovering restores it.
 */
function HabitSlot({ item, size, onOpen, onIncrement, t }) {
  const timer = useRef(null);
  const held = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  // A health-synced habit's count is not ours to add to (GLANCE disables the
  // tap for exactly this reason), so there a tap opens the sheet instead.
  const canIncrement = !item.habit.source;

  const startHold = () => {
    held.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { held.current = true; onOpen(); }, HOLD_MS);
  };
  const cancelHold = () => clearTimeout(timer.current);

  return (
    <div className="opacity-65 saturate-[.45] transition-[opacity,filter] duration-200 hover:opacity-100 hover:saturate-100">
      <HabitRing
        size={size.dot}
        habit={item.habit}
        count={item.count}
        darkMode
        // Match the count subdials' caption, so "5/8" and "INBOX" sit at the
        // same weight on the same baseline instead of one tier apart.
        countClassName={size.label}
        ariaLabel={t('dial.habitLabel', '{{name}}: {{count}} of {{target}}', {
          name: item.habit.name, count: item.count, target: item.habit.target,
        })}
        onClick={() => {
          // The hold already did something; don't also count the click it
          // leaves behind.
          if (held.current) { held.current = false; return; }
          if (canIncrement) onIncrement(); else onOpen();
        }}
        onContextMenu={(e) => { e.preventDefault(); cancelHold(); onOpen(); }}
        onMouseDown={startHold}
        onMouseUp={cancelHold}
        onMouseLeave={cancelHold}
        onTouchStart={startHold}
        onTouchEnd={cancelHold}
      />
    </div>
  );
}

/**
 * A count readout, dressed as a chronograph subdial: a recessed disc with a
 * hairline rim, the icon and figure inside it, the name printed underneath —
 * which is also where HabitRing prints its own "5/8", so the two kinds of
 * complication sit on the same baseline.
 */
function CountSlot({ item, size, onOpen, t }) {
  const Icon = COUNT_KINDS[item.kind] || Inbox;
  const label = item.kind === 'inbox'
    ? t('dial.inbox', 'Inbox')
    : t('dial.deadlines', 'Deadlines');
  return (
    <button
      onClick={onOpen}
      aria-label={`${label}: ${item.count}`}
      className="flex flex-col items-center gap-0.5 transition-transform active:scale-95"
    >
      <span
        className="flex flex-col items-center justify-center rounded-full border border-white/10 hover:border-white/20 transition-colors"
        style={{
          width: size.dot,
          height: size.dot,
          // Lit from above, like the face's other recessed elements.
          background: 'radial-gradient(circle at 50% 28%, rgba(255,255,255,0.06), rgba(255,255,255,0.015) 72%)',
          boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.35)',
        }}
      >
        <Icon size={size.icon} strokeWidth={1.75} className="text-white/45" aria-hidden="true" />
        <span className={`text-white/85 ${size.count} font-medium leading-none tabular-nums mt-0.5`}>
          {item.count}
        </span>
      </span>
      <span className={`text-white/35 ${size.label} uppercase tracking-[0.14em] leading-none`}>{label}</span>
    </button>
  );
}

const DialComplications = ({ items, dialPx, onOpenTask, onSetHabitCount, onIncrementHabit }) => {
  const { t } = useTranslation();
  const [openKey, setOpenKey] = useState(null);
  const sheetRef = useRef(null);
  const open = items.find((i) => i.key === openKey) || null;

  // Esc closes this sheet before anything above it — the same capture-phase
  // rung the block sheet and the layers panel already use.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpenKey(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    // A habit sheet exists to add one, so the keyboard lands on "+", not on
    // the minus that happens to come first in the row.
    const buttons = sheetRef.current?.querySelectorAll('button');
    const first = open.kind === 'habit' ? buttons?.[buttons.length - 1] : buttons?.[0];
    first?.focus();
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  const size = complicationSize(dialPx);
  if (!items.length || !size) return null;
  const r = dialPx / 2;

  return (
    <>
      {items.map((item, i) => {
        const slot = COMPLICATION_SLOTS[i];
        if (!slot) return null;
        return (
          <div
            key={item.key}
            className="absolute z-10 flex items-center justify-center"
            style={{
              left: `calc(50% + ${slot.x * r}px)`,
              top: `calc(50% + ${slot.y * r}px)`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {item.kind === 'habit' ? (
              <HabitSlot
                item={item}
                size={size}
                t={t}
                onOpen={() => setOpenKey(item.key)}
                onIncrement={() => onIncrementHabit?.(item.habit)}
              />
            ) : (
              <CountSlot item={item} size={size} t={t} onOpen={() => setOpenKey(item.key)} />
            )}
          </div>
        );
      })}

      {open && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          onClick={() => setOpenKey(null)}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={open.kind === 'habit'
              ? open.habit.name
              : (open.kind === 'inbox' ? t('dial.inbox', 'Inbox') : t('dial.deadlines', 'Deadlines'))}
            className="w-[min(86%,360px)] rounded-2xl border border-white/10 bg-[#12151c] px-5 py-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {open.kind === 'habit' ? (
              <>
                <div className="text-white/90 text-base font-medium text-center">{open.habit.name}</div>
                {/* The whole point of a habit on the face: put one more in
                    without going anywhere. */}
                <div className="mt-3.5 flex items-center justify-center gap-5">
                  <button
                    onClick={() => onSetHabitCount(open.habit, Math.max(0, open.count - 1))}
                    aria-label={t('dial.habitRemove', 'Remove one')}
                    className="w-11 h-11 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 flex items-center justify-center text-white/70 transition-colors"
                  >
                    <Minus size={18} />
                  </button>
                  <span className="text-white text-3xl font-semibold tabular-nums min-w-[2ch] text-center">
                    {open.count}
                  </span>
                  <button
                    onClick={() => onSetHabitCount(open.habit, open.count + 1)}
                    aria-label={t('dial.habitAdd', 'Add one')}
                    className="w-11 h-11 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 flex items-center justify-center text-white/70 transition-colors"
                  >
                    <Plus size={18} />
                  </button>
                </div>
                <div className="mt-2 text-center text-white/35 text-xs">
                  {t('dial.habitTarget', 'of {{target}}', { target: open.habit.target })}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {React.createElement(COUNT_KINDS[open.kind] || Inbox, {
                    size: 15, strokeWidth: 1.75, className: 'text-white/45', 'aria-hidden': 'true',
                  })}
                  <span className="text-white/90 text-base font-medium">
                    {open.kind === 'inbox' ? t('dial.inbox', 'Inbox') : t('dial.deadlines', 'Deadlines')}
                  </span>
                  <span className="text-white/35 text-sm tabular-nums ml-auto">{open.count}</span>
                </div>
                {open.items.length === 0 ? (
                  <div className="mt-3 text-white/35 text-sm">{t('dial.nothingHere', 'Nothing here')}</div>
                ) : (
                  <div className="mt-3 space-y-1 max-h-[46vh] overflow-y-auto">
                    {open.items.slice(0, 12).map((task) => (
                      <button
                        key={task.id}
                        onClick={() => { setOpenKey(null); onOpenTask(task); }}
                        className="w-full flex items-center gap-2.5 rounded-lg bg-white/5 hover:bg-white/10 active:bg-white/15 px-3 py-2 text-left transition-colors"
                      >
                        <span className="flex-1 min-w-0 truncate text-white/85 text-sm">
                          {stripWikilinks(task.title)}
                        </span>
                        <ExternalLink size={14} className="text-white/30 flex-shrink-0" aria-hidden="true" />
                      </button>
                    ))}
                    {open.items.length > 12 && (
                      <div className="pt-1 text-center text-white/35 text-xs">
                        {t('dial.allDayMore', '{{count}} more', { count: open.items.length - 12 })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default DialComplications;
