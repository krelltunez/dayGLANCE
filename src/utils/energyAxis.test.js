import { describe, it, expect } from 'vitest';
import { deriveBlockEnergy, ENERGY_EFFORT, ENERGY_RESTORE } from './energyAxis.js';

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
