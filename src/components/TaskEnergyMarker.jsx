import React from 'react';
import { Leaf } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { blockEnergySource, flipEnergyOverride, ENERGY_EFFORT, ENERGY_RESTORE } from '../utils/energyAxis.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// A timeline card's energy (#2331): Restore blocks carry a leaf, Effort blocks
// carry nothing, since Effort is what a block is unless argued otherwise and a
// mark on every card would be noise. The leaf is the summary strip's and the
// Day Dial's Restore icon.
//
// WHITE, like every icon on a timeline card (see TaskStarButton): the card
// takes any of a dozen user colours in both themes, and a teal leaf would
// vanish on a teal card. The shape carries the meaning; the strip and the
// dial, on neutral ground, keep the teal.
//
// ONE MARK for both sources. At this size a hand-set leaf and a derived one
// could not be told apart, so they are not drawn apart; on desktop the
// tooltip says which it is.
//
// Interactive on desktop only. There a click flips the block between Restore
// and Effort (flipEnergyOverride: an override is only stored where it
// disagrees with the title), and an Effort card shows a faint leaf on hover so
// it can be marked Restore without the context menu. On a phone or a tablet
// there is no hover, and a small target inside a card that is also dragged
// and tapped would be hit by accident: the leaf only shows there, and the
// long-press menu changes it.
//
// Not on imported events, whose energy cannot be set (the context menu leaves
// them out too). A recurring occurrence is fine: setTaskEnergy stores the
// override on its series, the block's nature recurring with it.
export default function TaskEnergyMarker({ task, size = 12, readOnly = false }) {
  const { t } = useTranslation();
  const setTaskEnergy = useDayPlannerCtx()?.setTaskEnergy;
  if (!task || task.imported) return null;

  const { energy, setByUser } = blockEnergySource(task);
  const restore = energy === ENERGY_RESTORE;
  const name = (value) => t(value === ENERGY_RESTORE ? 'strip.restore' : 'strip.effort');

  if (readOnly || !setTaskEnergy) {
    return restore
      ? <Leaf size={size} className="flex-shrink-0" data-energy-marker="restore" role="img" aria-label={name(energy)} />
      : null;
  }

  // Why it is what it is: the user's word, a restoring word in the title, or
  // nothing in the title at all (Effort is the fallback, not a detection).
  const why = setByUser ? 'strip.energyMarkerSet' : restore ? 'strip.energyMarkerAuto' : 'strip.energyMarkerDefault';
  const label = t(why, {
    value: name(energy),
    other: name(restore ? ENERGY_EFFORT : ENERGY_RESTORE),
  });
  return (
    <button
      type="button"
      data-energy-marker={energy}
      onClick={(e) => {
        e.stopPropagation();
        setTaskEnergy(task.id, flipEnergyOverride(task), false);
      }}
      className={`rounded p-0.5 flex-shrink-0 transition-opacity hover:bg-white/20 ${
        restore ? 'opacity-90 hover:opacity-100' : 'opacity-0 group-hover/card:opacity-40 focus-visible:opacity-70'
      }`}
      title={label}
      aria-label={label}
      aria-pressed={restore}
    >
      <Leaf size={size} />
    </button>
  );
}
