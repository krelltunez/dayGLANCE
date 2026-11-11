import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import TaskLinkPicker from './TaskLinkPicker.jsx';

// #2369: a task the `@@` picker found by its tag shows that tag.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const render = (candidates) => {
  let root;
  act(() => { root = create(<I18nextProvider i18n={i18n}><TaskLinkPicker candidates={candidates} index={0} onPick={() => {}} /></I18nextProvider>); });
  return root;
};
const text = (node) => (typeof node === 'string' ? node : (node?.children || []).map(text).join(''));

describe('TaskLinkPicker', () => {
  it('shows the tags a task was found by', () => {
    const root = render([{ task: { id: 'h1' }, title: 'Call the roofer', tags: ['home', 'homework'] }]);
    const tags = root.root.findAll((n) => n.props?.['data-task-link-tags']);
    expect(tags).toHaveLength(1);
    expect(text(tags[0])).toBe('#home #homework');
  });

  it('shows none for a task found by its title', () => {
    const root = render([{ task: { id: 'w1' }, title: 'Write the report', tags: [] }, { task: { id: 'x' }, title: 'No tags field' }]);
    expect(root.root.findAll((n) => n.props?.['data-task-link-tags'])).toHaveLength(0);
  });
});
