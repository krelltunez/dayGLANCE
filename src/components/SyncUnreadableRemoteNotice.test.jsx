import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import SyncUnreadableRemoteNotice from './SyncUnreadableRemoteNotice.jsx';
import en from '../../public/locales/en/translation.json';
import { syncErrorText } from '../sync/syncErrors.js';
import { REMOTE_UNREADABLE_CODE, REMOTE_UNREADABLE_REASON } from '../sync/unreadableRemote.js';

const t = (key, opts) => key.split('.').reduce((value, part) => value?.[part], en) ?? opts?.defaultValue;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, opts) => t(key, opts) }) }));

const mount = (onReplace) => { let root; act(() => { root = create(<SyncUnreadableRemoteNotice onReplace={onReplace} darkMode={false} />); }); return root.root; };
const button = (root) => root.find((n) => n.type === 'button');
const failedNote = (root) => root.findAll((n) => typeof n.type === 'string' && n.props['data-sync-replace-failed'] !== undefined);
const press = async (root) => { await act(async () => { await button(root).props.onClick(); }); };

describe('SyncUnreadableRemoteNotice (#2409)', () => {
  it('says what the button does before it is pressed, including that it checks first', () => {
    const html = renderToStaticMarkup(<SyncUnreadableRemoteNotice onReplace={() => {}} darkMode={false} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Replace the server copy');
    expect(html).toContain('in place of the unreadable file');
    expect(html).toContain('if it reads normally, nothing is replaced');
    expect(html).not.toContain('data-sync-replace-failed');
  });

  it('runs the replace when pressed, and says nothing more when it worked', async () => {
    const onReplace = vi.fn(async () => ({ outcome: 'replaced' }));
    const root = mount(onReplace);
    await press(root);
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(failedNote(root)).toHaveLength(0);
    expect(button(root).props.disabled).toBe(false);
  });

  it.each(['failed', 'busy', 'disabled'])('says the copy was not replaced when the outcome is %s', async (outcome) => {
    const root = mount(vi.fn(async () => ({ outcome })));
    await press(root);
    expect(failedNote(root)).toHaveLength(1);
    expect(failedNote(root)[0].children.join('')).toBe(en.sync.form.replaceRemoteFailed);
  });

  it('says so too when the action throws or answers nothing', async () => {
    const thrown = mount(vi.fn(async () => { throw new Error('boom'); }));
    await press(thrown);
    expect(failedNote(thrown)).toHaveLength(1);
    const empty = mount(vi.fn(async () => undefined));
    await press(empty);
    expect(failedNote(empty)).toHaveLength(1);
  });

  it('leaves an ordinary cycle to report for itself', async () => {
    const root = mount(vi.fn(async () => ({ outcome: 'not-needed' })));
    await press(root);
    expect(failedNote(root)).toHaveLength(0);
  });

  it('cannot be pressed twice while it runs, and clears an old failure on the next try', async () => {
    let finish;
    const onReplace = vi.fn()
      .mockImplementationOnce(async () => ({ outcome: 'failed' }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const root = mount(onReplace);
    await press(root);
    expect(failedNote(root)).toHaveLength(1);

    let pending;
    act(() => { pending = button(root).props.onClick(); });
    expect(button(root).props.disabled).toBe(true);
    expect(failedNote(root)).toHaveLength(0);
    act(() => { button(root).props.onClick(); });
    expect(onReplace).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ outcome: 'replaced' }); await pending; });
    expect(button(root).props.disabled).toBe(false);
  });
});

describe('the error it sits under', () => {
  it('has its own words in the bundle, not the network error\'s', () => {
    const text = syncErrorText(t, REMOTE_UNREADABLE_REASON, REMOTE_UNREADABLE_CODE);
    expect(text).toBe(en.sync.errors.REMOTE_UNREADABLE);
    expect(text).toMatch(/Nothing was written over it/);
    expect(text).not.toBe(en.sync.errors.NETWORK_ERROR);
    // The fallback the engine carries says the same as the English bundle.
    expect(REMOTE_UNREADABLE_REASON).toBe(en.sync.errors.REMOTE_UNREADABLE);
  });
});
