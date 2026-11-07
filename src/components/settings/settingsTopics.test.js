import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TOPICS, visibleSectionKeys, visibleTopics, initialTopicId, topicAttention, readRememberedTopic, rememberTopic, SETTINGS_TOPIC_KEY,
} from './settingsTopics.js';

// Step 1 of the Settings redesign (#2075): every block of the dialog moves,
// unchanged, onto exactly one topic page. These pin the mapping against the
// dialog's own section list, so a block can neither be dropped nor shown twice.

// Each topic's sections live in its own file under topics/ (step 1's split),
// named after the topic.
const TOPIC_FILES = {
  general: 'useGeneralTopic', appearance: 'useAppearanceTopic', features: 'useFeaturesTopic',
  ai: 'useAiTopic', sync: 'useSyncTopic', integrations: 'useIntegrationsTopic',
  notifications: 'useNotificationsTopic', backup: 'useBackupTopic', about: 'useAboutTopic',
};
const fileSectionKeys = (name) => {
  const source = readFileSync(new URL(`./topics/${name}.jsx`, import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('\n  return {'), source.indexOf('\n  };\n', source.indexOf('\n  return {')));
  return [...block.matchAll(/^ {4}(\w+): \{\n {6}show:/gm)].map((m) => m[1]);
};
const modalSectionKeys = Object.values(TOPIC_FILES).flatMap(fileSectionKeys);
const en = JSON.parse(readFileSync(new URL('../../../public/locales/en/translation.json', import.meta.url), 'utf8'));

describe('the topic map', () => {
  it('places every block of the dialog on exactly one topic', () => {
    expect(modalSectionKeys.length).toBe(32);
    const placed = TOPICS.flatMap((topic) => topic.sections);
    expect([...placed].sort()).toEqual([...modalSectionKeys].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("keeps each topic's sections in that topic's own file", () => {
    for (const topic of TOPICS) {
      expect([...fileSectionKeys(TOPIC_FILES[topic.id])].sort(), topic.id).toEqual([...topic.sections].sort());
    }
  });

  it('labels every topic in the locale bundle', () => {
    const lookup = (path) => path.split('.').reduce((node, part) => node?.[part], en);
    for (const topic of TOPICS) expect(lookup(topic.labelKey), topic.id).toBe(topic.fallback);
  });

  it('puts sync and integrations on their own topics, as agreed', () => {
    const of = (id) => TOPICS.find((topic) => topic.id === id).sections;
    expect(of('sync')).toEqual(['cloudSync']);
    expect(of('integrations')).toContain('calendarSync');
    expect(of('features')).toContain('multiUser');
  });

  it('holds what were the header bell and save icon as their own topics', () => {
    const ids = TOPICS.map((topic) => topic.id);
    expect(ids).toEqual(['general', 'appearance', 'features', 'ai', 'sync', 'integrations', 'notifications', 'backup', 'about']);
    expect(TOPICS.find((topic) => topic.id === 'notifications').sections).toEqual(['notifications']);
    expect(TOPICS.find((topic) => topic.id === 'backup').sections).toEqual(['backup']);
  });
});

describe('visibility', () => {
  const sections = {
    localization: { show: true }, sound: { show: true }, weather: { show: false }, dailyContent: { show: false },
    globalShortcut: { show: false }, cloudSync: { show: true },
  };

  it('a page lists only the blocks that render here, in topic order', () => {
    expect(visibleSectionKeys(TOPICS[0], sections)).toEqual(['localization', 'sound']);
  });

  it('a topic with nothing to show is not listed', () => {
    const ids = visibleTopics(sections).map((topic) => topic.id);
    expect(ids).toEqual(['general', 'sync']);
    expect(ids).not.toContain('ai');
  });

  it('global shortcuts live on General, last, where the platform has them', () => {
    const general = TOPICS.find((topic) => topic.id === 'general');
    expect(general.sections.at(-1)).toBe('globalShortcut');
    expect(visibleSectionKeys(general, { ...sections, globalShortcut: { show: true } })).toEqual(['localization', 'sound', 'globalShortcut']);
  });

  it('Features holds only what is switched on, Experimental last', () => {
    expect(TOPICS.find((topic) => topic.id === 'features').sections)
      .toEqual(['goals', 'routines', 'habits', 'multiUser', 'experimental']);
  });

  it('Inbox and Follow-ups are everyday preferences on General, after Sounds', () => {
    const general = TOPICS.find((topic) => topic.id === 'general').sections;
    expect(general.slice(general.indexOf('sound'), general.indexOf('sound') + 3)).toEqual(['sound', 'inbox', 'followUpTag']);
  });
});

describe('topic marks', () => {
  const topic = { id: 'x', sections: ['a', 'b', 'c'] };

  it('marks a topic while a visible section needs a look, red over amber', () => {
    expect(topicAttention(topic, { a: { show: true }, b: { show: true, attention: 'amber' } })).toBe('amber');
    expect(topicAttention(topic, { a: { show: true, attention: 'amber' }, c: { show: true, attention: 'red' } })).toBe('red');
  });

  it('never marks for a section that is not shown, or that has nothing to say', () => {
    expect(topicAttention(topic, { a: { show: false, attention: 'red' }, b: { show: true, attention: null } })).toBeNull();
  });

  it('puts the timezone notice first on General and the version and help on About', () => {
    expect(TOPICS.find((tp) => tp.id === 'general').sections[0]).toBe('timezoneNotice');
    expect(TOPICS.at(-1)).toMatchObject({ id: 'about', sections: ['about'] });
  });
});

describe('the remembered topic', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('opens on the topic last used, when it is listed here', () => {
    const listed = [{ id: 'general' }, { id: 'sync' }];
    rememberTopic('sync');
    expect(store.get(SETTINGS_TOPIC_KEY)).toBe('sync');
    expect(initialTopicId(readRememberedTopic(), listed)).toBe('sync');
  });

  it('falls back to the first topic when the remembered one is not listed or storage fails', () => {
    expect(initialTopicId('advanced', [{ id: 'general' }])).toBe('general');
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readRememberedTopic()).toBeNull();
    expect(() => rememberTopic('sync')).not.toThrow();
    expect(initialTopicId(null, [])).toBeNull();
  });
});
