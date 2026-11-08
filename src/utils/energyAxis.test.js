import { describe, it, expect } from 'vitest';
import {
  blockEnergySource, carryEnergy, deriveBlockEnergy, flipEnergyOverride,
  ENERGY_EFFORT, ENERGY_RESTORE, RESTORE_KEYWORDS, RESTORE_PHRASES,
} from './energyAxis.js';

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

// #2331: every block a Chinese-speaking user wrote resolved to Effort, since
// the list was English and a Chinese title has no spaces to split words on.
describe('deriveBlockEnergy in the languages the app ships', () => {
  const restore = (title) => expect(deriveBlockEnergy({ title }), title).toBe(ENERGY_RESTORE);
  const effort = (title) => expect(deriveBlockEnergy({ title }), title).toBe(ENERGY_EFFORT);

  it('reads a restoring word in any shipped language, whatever the interface language', () => {
    restore('Mittagessen mit Anna');
    restore('Abendessen');
    restore('Almuerzo con Marta');
    restore('Siesta');
    restore('Déjeuner avec Paul');
    restore('Pranzo');
    restore('Passeggiata nel parco');
    restore('Śniadanie');
    restore('Odpoczynek');
    restore('Almoço com a equipe');
    restore('Pequeno-almoço');
    restore('Обід з колегами');
    restore('Прогулянка');
  });

  it('reads a Chinese phrase anywhere in the title, with no spaces to split on', () => {
    restore('午饭');
    restore('中午吃饭');
    restore('和朋友吃饭');
    restore('下午茶后散步');
    restore('午休 #休息');
    restore('健身房训练');
    restore('睡覺');
  });

  it('leaves Chinese work blocks as effort', () => {
    effort('写季度报告');
    effort('团队会议');
    effort('锻炼写作能力');
    effort('运动会策划');
  });

  it('the override still wins over a phrase', () => {
    expect(deriveBlockEnergy({ title: '和投资人吃饭', energy: 'effort' })).toBe(ENERGY_EFFORT);
  });

  it('leaves out words that are ordinary words in another language', () => {
    effort('Pause the ad campaign');
    effort('Clean up old repos');
    effort('Call Sen. Okafor');
    effort('Add a spacer to the header');
    effort('Course registration');
  });

  it('every keyword can match: lowercase, one word, letters only', () => {
    for (const word of RESTORE_KEYWORDS) {
      expect(word, word).toBe(word.toLowerCase());
      expect(word.split(/[^\p{L}]+/u), word).toEqual([word]);
    }
  });

  it('every phrase is two characters or more, so no single character argues a block into restore', () => {
    for (const phrase of RESTORE_PHRASES) expect([...phrase].length, phrase).toBeGreaterThanOrEqual(2);
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
