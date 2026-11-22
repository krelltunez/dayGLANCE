// The language every AI prompt answers in.
//
// Every prompt in src/ai-prompts.js is written in English, so a model answers
// in English unless told otherwise, and a user with the app in Chinese got a
// Chinese Evening Reflection card with an English reflection inside it
// (#1789). The fix lives at the one choke point every request passes through,
// aiComplete, rather than in each of the eleven prompts: the system prompt is
// suffixed with an instruction naming the app's current language, so the
// briefings, the weekly summary, and the text fields inside JSON answers
// (subtask titles, reschedule reasons) all follow the setting, and a prompt
// added later is covered without remembering to.
//
// The instruction is emitted for English too. One invariant ("every prompt
// names its language") is easier to keep than a special case, and it costs a
// sentence.

import i18next from 'i18next';
import { resolveLanguage } from '../locales.js';

/** English name and native name, keyed by the tags in public/locales. */
export const LANGUAGE_NAMES = Object.freeze({
  'en': ['English', 'English'],
  'de': ['German', 'Deutsch'],
  'es': ['Spanish', 'Español'],
  'fr': ['French', 'Français'],
  'it': ['Italian', 'Italiano'],
  'ja': ['Japanese', '日本語'],
  'pl': ['Polish', 'Polski'],
  'pt-BR': ['Brazilian Portuguese', 'Português do Brasil'],
  'pt-PT': ['European Portuguese', 'Português de Portugal'],
  'uk': ['Ukrainian', 'Українська'],
  'zh-CN': ['Simplified Chinese', '简体中文'],
  'zh-TW': ['Traditional Chinese', '繁體中文'],
});

/**
 * The language the app is showing right now, as one of the tags we ship.
 * Reads the i18next singleton that src/i18n.js configures; before init (tests,
 * or a call during startup) it resolves to English, which is also the app's
 * fallback language, so the answer is never a tag no bundle exists for.
 */
export function currentAiLanguage(instance = i18next) {
  return resolveLanguage(instance?.resolvedLanguage || instance?.language);
}

/**
 * The sentence appended to a system prompt. Names the language in English,
 * which the prompt is written in, and natively, which removes any ambiguity
 * between regional variants. The second sentence keeps the JSON prompts
 * intact: keys, dates, times and ids are contract, not prose.
 */
export function languageInstruction(language) {
  const tag = resolveLanguage(language);
  const [english, native] = LANGUAGE_NAMES[tag] || [tag, tag];
  const name = english === native ? english : `${english} (${native})`;
  return `Write every user-facing sentence in ${name}. Keep any required JSON keys, ISO dates, HH:MM times and identifiers exactly as specified.`;
}

/** The system prompt with the language instruction as its last paragraph. */
export function withLanguage(systemPrompt, language) {
  return `${systemPrompt}\n\n${languageInstruction(language)}`;
}
