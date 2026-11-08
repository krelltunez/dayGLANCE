import { describe, it, expect } from 'vitest';
import { blockEnergySource, carryEnergy, deriveBlockEnergy, flipEnergyOverride, ENERGY_EFFORT, ENERGY_RESTORE } from './energyAxis.js';

describe('deriveBlockEnergy', () => {
  it('defaults to effort — scheduled blocks are output unless argued otherwise', () => {
    expect(deriveBlockEnergy({ title: 'Quarterly planning' })).toBe(ENERGY_EFFORT);
    expect(deriveBlockEnergy({ title: 'Team sync #work' })).toBe(ENERGY_EFFORT);
    expect(deriveBlockEnergy({ title: '' })).toBe(ENERGY_EFFORT);
    expect(deriveBlockEnergy({})).toBe(ENERGY_EFFORT);
  });

  it('classifies restore from a #tag', () => {
    expect(deriveBlockEnergy({ title: 'Morning session #gym' })).toBe(ENERGY_RESTORE);
    expect(deriveBlockEnergy({ title: 'Steps #health' })).toBe(ENERGY_RESTORE);
    expect(deriveBlockEnergy({ title: 'Evening #relax' })).toBe(ENERGY_RESTORE);
  });

  it('classifies restore from a plain title word — no tagging required', () => {
    // The notes' rule: never require per-task tagging.
    expect(deriveBlockEnergy({ title: 'Lunch with Sam' })).toBe(ENERGY_RESTORE);
    expect(deriveBlockEnergy({ title: 'Afternoon walk' })).toBe(ENERGY_RESTORE);
    expect(deriveBlockEnergy({ title: 'Nap' })).toBe(ENERGY_RESTORE);
  });

  it('matches whole words only — "restaurant" is not "rest"', () => {
    expect(deriveBlockEnergy({ title: 'Restaurant reservations for the event' })).toBe(ENERGY_EFFORT);
    expect(deriveBlockEnergy({ title: 'Breakfast catering order' })).toBe(ENERGY_RESTORE); // 'breakfast' IS a whole word here
  });

  it('the explicit override is final, in both directions', () => {
    // A working lunch is effort; a deliberately restorative work block is restore.
    expect(deriveBlockEnergy({ title: 'Lunch with investors', energy: 'effort' })).toBe(ENERGY_EFFORT);
    expect(deriveBlockEnergy({ title: 'Quarterly planning', energy: 'restore' })).toBe(ENERGY_RESTORE);
  });

  it('ignores a junk energy value and falls back to derivation', () => {
    expect(deriveBlockEnergy({ title: 'Lunch', energy: 'banana' })).toBe(ENERGY_RESTORE);
  });
});

describe('blockEnergySource', () => {
  it('says whether the user set it or the title did', () => {
    expect(blockEnergySource({ title: 'Lunch' })).toEqual({ energy: 'restore', setByUser: false });
    expect(blockEnergySource({ title: 'Planning', energy: 'restore' })).toEqual({ energy: 'restore', setByUser: true });
    expect(blockEnergySource({ title: 'Lunch', energy: 'effort' })).toEqual({ energy: 'effort', setByUser: true });
    expect(blockEnergySource({ title: 'Planning', energy: 'banana' })).toEqual({ energy: 'effort', setByUser: false });
  });
});

describe('flipEnergyOverride: the card marker\'s click', () => {
  it('sets the other value where the title says otherwise', () => {
    expect(flipEnergyOverride({ title: 'Planning' })).toBe('restore');
    expect(flipEnergyOverride({ title: 'Lunch' })).toBe('effort');
  });

  it('goes back to auto where the title already gives the other value, so a second click undoes the first', () => {
    expect(flipEnergyOverride({ title: 'Planning', energy: 'restore' })).toBeNull();
    expect(flipEnergyOverride({ title: 'Lunch', energy: 'effort' })).toBeNull();
  });

  it('flips an override that agrees with the title', () => {
    expect(flipEnergyOverride({ title: 'Lunch', energy: 'restore' })).toBe('effort');
    expect(flipEnergyOverride({ title: 'Planning', energy: 'effort' })).toBe('restore');
  });
});

describe('carryEnergy', () => {
  it('carries an override, and nothing else', () => {
    expect(carryEnergy({ energy: 'restore' })).toEqual({ energy: 'restore' });
    expect(carryEnergy({ energy: 'effort' })).toEqual({ energy: 'effort' });
    expect(carryEnergy({ energy: 'banana' })).toEqual({});
    expect(carryEnergy({})).toEqual({});
    expect(carryEnergy(undefined)).toEqual({});
  });
});
