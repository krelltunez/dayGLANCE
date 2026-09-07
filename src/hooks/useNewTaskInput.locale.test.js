import { describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import zhCN from '../../public/locales/zh-CN/translation.json';

// Capture the hook's pure suggestion builder; no DOM events are needed here.
vi.mock('react', () => ({
  useState: (value) => [value, vi.fn()],
  useRef: (value) => ({ current: value }),
  useEffect: () => {},
}));
import useNewTaskInput from './useNewTaskInput.js';

describe('task-input clock preference', () => {
  it.each([false, true])('passes the saved clock preference to actual suggestions (%s)', async (use24HourClock) => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } } });
    const { buildSuggestions } = useNewTaskInput({
      allTags: [], showAddTask: true, t: i18n.t.bind(i18n), language: 'zh-CN', use24HourClock,
    });
    const display = buildSuggestions('Task ~9', 7).find(item => item.value === '21:00').display;
    const expected = new Intl.DateTimeFormat('zh-CN', {
      hour: use24HourClock ? '2-digit' : 'numeric', minute: '2-digit',
      hourCycle: use24HourClock ? 'h23' : 'h12', timeZone: 'UTC',
    }).format(new Date('2026-01-01T21:00:00Z'));
    expect(display).toBe(expected);
  });
});
