import { describe, expect, it, vi } from 'vitest';
import {
  isMacPlatform, isSubmitShortcut, submitFromAnyField, submitModifierLabel, submitShortcutHandler,
} from './submitShortcut.js';

const key = (over = {}) => ({
  key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false,
  preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over,
});

// A form holding one focused field that commits on blur, as the notes do.
const fixture = ({ requestSubmit = vi.fn(), connected = true } = {}) => {
  const field = { blur: vi.fn() };
  const form = { requestSubmit, isConnected: connected, contains: (el) => el === field };
  const doc = { activeElement: field };
  const deferred = [];
  const defer = (fn) => deferred.push(fn);
  const flush = () => deferred.splice(0).forEach((fn) => fn());
  return { field, form, doc, defer, flush };
};

describe('isSubmitShortcut', () => {
  it('is Ctrl+Enter or Cmd+Enter', () => {
    expect(isSubmitShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSubmitShortcut(key({ metaKey: true }))).toBe(true);
  });

  it('is not plain Enter, Shift+Enter (saves a note) or another key', () => {
    expect(isSubmitShortcut(key())).toBe(false);
    expect(isSubmitShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSubmitShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSubmitShortcut(key({ ctrlKey: true, key: 'a' }))).toBe(false);
    expect(isSubmitShortcut(null)).toBe(false);
  });

  it('leaves Enter to an input method that is composing', () => {
    expect(isSubmitShortcut(key({ ctrlKey: true, nativeEvent: { isComposing: true } }))).toBe(false);
    expect(isSubmitShortcut(key({ ctrlKey: true, nativeEvent: { keyCode: 229 } }))).toBe(false);
    expect(isSubmitShortcut(key({ ctrlKey: true, isComposing: true }))).toBe(false);
  });

  it('ignores a held, repeating key, so one press saves once', () => {
    expect(isSubmitShortcut(key({ ctrlKey: true, repeat: true }))).toBe(false);
  });
});

describe('submitModifierLabel', () => {
  it('names Cmd on Apple platforms and Ctrl elsewhere', () => {
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(submitModifierLabel({ platform: 'MacIntel' })).toBe('⌘');
    expect(submitModifierLabel({ platform: 'Win32' })).toBe('Ctrl');
    expect(submitModifierLabel({ platform: 'Linux x86_64' })).toBe('Ctrl');
    expect(submitModifierLabel(undefined)).toBe('Ctrl');
  });
});

describe('submitFromAnyField', () => {
  it('blurs the focused field BEFORE submitting, so a note committed on blur is saved', () => {
    const order = [];
    const f = fixture({ requestSubmit: vi.fn(() => order.push('submit')) });
    f.field.blur.mockImplementation(() => order.push('blur'));
    expect(submitFromAnyField(f.form, { doc: f.doc, defer: f.defer })).toBe(true);
    // The submit waits a tick for the blur's state to land.
    expect(f.form.requestSubmit).not.toHaveBeenCalled();
    f.flush();
    expect(order).toEqual(['blur', 'submit']);
  });

  it('does not blur a field outside the form', () => {
    const f = fixture();
    const outside = { blur: vi.fn() };
    submitFromAnyField(f.form, { doc: { activeElement: outside }, defer: f.defer });
    f.flush();
    expect(outside.blur).not.toHaveBeenCalled();
    expect(f.form.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit a form that closed in the meantime', () => {
    const f = fixture({ connected: false });
    submitFromAnyField(f.form, { doc: f.doc, defer: f.defer });
    f.flush();
    expect(f.form.requestSubmit).not.toHaveBeenCalled();
  });

  it('does nothing without a form', () => {
    expect(submitFromAnyField(null)).toBe(false);
  });
});

describe('submitShortcutHandler', () => {
  it('takes the key from the field and submits the form', () => {
    const f = fixture();
    const handler = submitShortcutHandler({ doc: f.doc, defer: f.defer });
    const event = key({ ctrlKey: true, currentTarget: f.form });
    handler(event);
    // Taken from the field: a focused picker button would otherwise click,
    // and the notes panel's own Enter handlers never see it.
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    f.flush();
    expect(f.form.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it('leaves every other key to the field', () => {
    const f = fixture();
    const handler = submitShortcutHandler({ doc: f.doc, defer: f.defer });
    for (const event of [key({ currentTarget: f.form }), key({ shiftKey: true, currentTarget: f.form })]) {
      handler(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    f.flush();
    expect(f.form.requestSubmit).not.toHaveBeenCalled();
  });

  it('swallows the shortcut without saving while the form is busy', () => {
    const f = fixture();
    const handler = submitShortcutHandler({ disabled: () => true, doc: f.doc, defer: f.defer });
    const event = key({ metaKey: true, currentTarget: f.form });
    handler(event);
    f.flush();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(f.form.requestSubmit).not.toHaveBeenCalled();
  });
});
