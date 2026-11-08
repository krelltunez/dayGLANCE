import { extractTags } from './taskUtils.js';

// Energy axis (summary strip phase 2): every timed block is either EFFORT
// (output — work, meetings, errands) or RESTORE (input — meals, movement,
// rest). Binary by design, and the labels are deliberately judgment-free:
// "Effort/Restore", never "Grind". Tone decides whether the strip reads as
// clarifying or as scolding.
//
// Resolution order:
//   1. Explicit per-block override (task.energy) — the user's word is final.
//   2. Keyword match on the block's #tags and title words, or a Chinese
//      phrase anywhere in the title → restore.
//   3. Everything else → effort.
//
// Effort is the fallback because scheduled blocks are output by default; the
// keyword list only argues a block INTO restore, never out of it, so a wrong
// guess is always one tap away from correct via the override.
//
// Deliberately NOT derived from GTD frame energyLevel: that field means energy
// REQUIRED for the frame's work ("high energy → deep/complex work, low energy →
// admin/easy tasks" — see ai-prompts.js). A low-energy frame is still effort,
// so mapping it to restore would misclassify exactly the admin blocks it
// describes.

export const ENERGY_EFFORT = 'effort';
export const ENERGY_RESTORE = 'restore';

// Conservative on purpose — false "restore" reads worse than false "effort",
// and the per-block override exists for everything this list misses. Matched
// against whole words only, so "restaurant" never matches "rest". The Android
// launcher provider keeps a copy for device events (LauncherDeviceEvents.kt);
// launcherDeviceEvents.fixture.test.js holds the two equal.
//
// Every language the app ships, matched whatever the interface language is: a
// title is written in whatever the user thinks in (#2331, where every block a
// Chinese-speaking user wrote resolved to Effort). Base forms only, and a word
// that is also an ordinary word elsewhere is left out: French "repos" (rest)
// is English "repos", "course" (run) is an errand, "marche" is "it works";
// German and French "pause" is the English verb ("Pause the campaign"),
// Polish "spacer" (walk) and "sen" (sleep) are "spacer" and "Sen."; German
// "laufen" (run) is also software running. Inflected forms are a miss,
// never a false match, and the override covers them.
const RESTORE_WORDS = {
  en: [
    'health', 'gym', 'workout', 'exercise', 'run', 'running', 'walk', 'yoga',
    'meditate', 'meditation', 'breakfast', 'lunch', 'dinner', 'meal', 'eat',
    'break', 'rest', 'nap', 'sleep', 'recharge', 'recovery',
    'relax', 'relaxation', 'unwind', 'chill',
  ],
  de: [
    'fitnessstudio', 'joggen', 'spaziergang', 'spazieren', 'meditieren',
    'frühstück', 'mittagessen', 'abendessen', 'essen', 'mittagspause',
    'nickerchen', 'schlafen', 'schlaf', 'erholung', 'entspannen', 'entspannung',
  ],
  es: [
    'gimnasio', 'ejercicio', 'correr', 'caminar', 'paseo', 'meditar', 'meditación',
    'desayuno', 'almuerzo', 'comida', 'cena', 'comer', 'descanso', 'descansar',
    'siesta', 'dormir', 'relajarse',
  ],
  fr: [
    'exercice', 'courir', 'promenade', 'méditer', 'méditation', 'déjeuner',
    'dîner', 'repas', 'manger', 'sieste', 'détente', 'détendre',
  ],
  it: [
    'palestra', 'allenamento', 'esercizio', 'corsa', 'correre', 'camminata',
    'passeggiata', 'meditare', 'meditazione', 'colazione', 'pranzo', 'pasto',
    'mangiare', 'pausa', 'riposo', 'pisolino', 'dormire', 'rilassarsi',
  ],
  pl: [
    'siłownia', 'trening', 'ćwiczenia', 'bieg', 'bieganie', 'spacerować', 'joga',
    'medytacja', 'śniadanie', 'obiad', 'kolacja', 'posiłek', 'jedzenie',
    'przerwa', 'odpoczynek', 'drzemka', 'spanie', 'relaks',
  ],
  pt: [
    'ginásio', 'treino', 'exercício', 'corrida', 'caminhada', 'passeio',
    'meditação', 'almoço', 'jantar', 'refeição', 'descanso', 'descansar',
    'soneca', 'sesta', 'relaxar',
  ],
  uk: [
    'спортзал', 'тренування', 'біг', 'прогулянка', 'йога', 'медитація',
    'сніданок', 'обід', 'вечеря', 'їжа', 'перерва', 'відпочинок', 'сон',
    'дрімота', 'релакс',
  ],
};
export const RESTORE_KEYWORDS = new Set(Object.values(RESTORE_WORDS).flat());

// Chinese puts no space between words, so no word can be split out of a
// title; these are matched as substrings instead ("中午吃饭" holds "吃饭").
// Two characters at least, each naming the restoring thing itself; a word
// that also has a working sense is left out (锻炼 is to exercise and also to
// build a skill, 运动 is also a campaign). Simplified, then the Traditional
// forms where they differ.
export const RESTORE_PHRASES = [
  '早餐', '早饭', '午餐', '午饭', '晚餐', '晚饭', '吃饭', '用餐',
  '午休', '午睡', '小睡', '休息', '睡觉', '健身', '跑步', '散步',
  '瑜伽', '冥想', '放松',
  '早飯', '午飯', '晚飯', '吃飯', '睡覺', '放鬆',
];

/**
 * @param task Timeline block (needs title; energy optional).
 * @returns 'effort' | 'restore'
 */
export function deriveBlockEnergy(task) {
  if (task?.energy === ENERGY_RESTORE || task?.energy === ENERGY_EFFORT) return task.energy;
  const title = task?.title || '';
  const words = new Set([
    ...extractTags(title),
    ...title.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean),
  ]);
  for (const w of words) {
    if (RESTORE_KEYWORDS.has(w)) return ENERGY_RESTORE;
  }
  if (RESTORE_PHRASES.some((phrase) => title.includes(phrase))) return ENERGY_RESTORE;
  return ENERGY_EFFORT;
}

const isOverride = (energy) => energy === ENERGY_RESTORE || energy === ENERGY_EFFORT;

/**
 * What the block resolves to and why (#2331, the card's marker): `energy` as
 * deriveBlockEnergy gives it, and `setByUser` when that is the user's own
 * override rather than the derivation.
 */
export function blockEnergySource(task) {
  return { energy: deriveBlockEnergy(task), setByUser: isOverride(task?.energy) };
}

/**
 * The override a click on the card's marker writes: the other value, or null
 * (back to auto) when the derivation already gives the other value. So an
 * override is only ever stored where it disagrees with the derivation, and a
 * second click undoes the first. The context menu's cycle, which can also
 * return to auto, stays as it is.
 *
 * @returns 'effort' | 'restore' | null
 */
export function flipEnergyOverride(task) {
  const target = deriveBlockEnergy(task) === ENERGY_RESTORE ? ENERGY_EFFORT : ENERGY_RESTORE;
  const derived = deriveBlockEnergy({ ...task, energy: undefined });
  return derived === target ? null : target;
}

/**
 * The override, carried onto a task built from another (a series turned into
 * a one-off and back, an occurrence moved to another date or postponed):
 * every such path writes the new row field by field, and one that forgot
 * `energy` dropped the user's word (#2331). Spread it beside carryCreatedAt.
 */
export const carryEnergy = (source) => (isOverride(source?.energy) ? { energy: source.energy } : {});
