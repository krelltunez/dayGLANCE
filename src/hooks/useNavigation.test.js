import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => ({ useCallback: (fn) => fn }));

const { default: useNavigation } = await import('./useNavigation.js');

// #2131: the search can be opened over the Project Planner, and every result
// navigates the calendar or the inbox behind it.
describe('handleSpotlightSelect', () => {
  it('closes the Project Planner so the result is not hidden behind it', () => {
    vi.useFakeTimers();
    const closePlanner = vi.fn();
    const setShowSpotlight = vi.fn();
    const { handleSpotlightSelect } = useNavigation({
      visibleDays: 1, effectiveViewMode: 'multi',
      selectedDate: new Date(2026, 9, 19), setSelectedDate: vi.fn(), setShowMonthView: vi.fn(),
      setShowSpotlight, isMobile: false, setMobileActiveTab: vi.fn(), setTabletActiveTab: vi.fn(),
      setInboxProjectFilter: vi.fn(), setInboxArchivedExpanded: vi.fn(), setDailyNotesModalDate: vi.fn(),
      calendarRef: { current: null }, closePlanner,
    });

    handleSpotlightSelect({ source: 'inbox', task: { id: 't1' } });

    expect(setShowSpotlight).toHaveBeenCalledWith(false);
    expect(closePlanner).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('opens a goal, project or area result in the Goals space (#2131)', () => {
    const openGoalsTarget = vi.fn();
    const closePlanner = vi.fn();
    const { handleSpotlightSelect } = useNavigation({
      visibleDays: 1, effectiveViewMode: 'multi',
      selectedDate: new Date(2026, 9, 19), setSelectedDate: vi.fn(), setShowMonthView: vi.fn(),
      setShowSpotlight: vi.fn(), isMobile: true, setMobileActiveTab: vi.fn(), setTabletActiveTab: vi.fn(),
      setInboxProjectFilter: vi.fn(), setInboxArchivedExpanded: vi.fn(), setDailyNotesModalDate: vi.fn(),
      calendarRef: { current: null }, closePlanner, openGoalsTarget,
    });

    handleSpotlightSelect({ source: 'goal', task: { id: 'g1' } });
    handleSpotlightSelect({ source: 'project', task: { id: 'p1' } });
    handleSpotlightSelect({ source: 'area', task: { id: 'a1' } });

    expect(openGoalsTarget.mock.calls).toEqual([['goal', 'g1'], ['project', 'p1'], ['area', 'a1']]);
    expect(closePlanner).toHaveBeenCalledTimes(3);
  });

  // #2231: the calendar and the Inbox are hidden and inert in the Goals &
  // Projects space, so a result that lives there leaves it; a goal, project or
  // area result is the Goals space and stays.
  it('leaves the Goals space for a result on the calendar or in the Inbox', () => {
    vi.useFakeTimers();
    const setDesktopSpace = vi.fn();
    const { handleSpotlightSelect } = useNavigation({
      visibleDays: 1, effectiveViewMode: 'multi',
      selectedDate: new Date(2026, 9, 19), setSelectedDate: vi.fn(), setShowMonthView: vi.fn(),
      setShowSpotlight: vi.fn(), isMobile: false, setMobileActiveTab: vi.fn(), setTabletActiveTab: vi.fn(),
      setInboxProjectFilter: vi.fn(), setInboxArchivedExpanded: vi.fn(), setDailyNotesModalDate: vi.fn(),
      calendarRef: { current: null }, setDesktopSpace,
    });

    handleSpotlightSelect({ source: 'scheduled', task: { id: 's1', date: '2026-10-20' } });
    handleSpotlightSelect({ source: 'inbox', task: { id: 'i1' } });
    expect(setDesktopSpace.mock.calls).toEqual([['calendar'], ['calendar']]);

    setDesktopSpace.mockClear();
    handleSpotlightSelect({ source: 'project', task: { id: 'p1' } });
    expect(setDesktopSpace).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// #2418: a row of the Overdue list. An Inbox task whose deadline has passed did
// nothing when clicked, and a scheduled one was only scrolled to in MULTI.
describe('goToOverdueTask', () => {
  const fakeEl = (over = {}) => {
    const classes = new Set();
    return {
      classList: { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: (c) => classes.has(c) },
      scrollIntoView: vi.fn(),
      getBoundingClientRect: () => ({ top: 900 }),
      offsetHeight: 40,
      ...over,
    };
  };
  // `found` maps a selector to its element; anything else is not in the page.
  const useSetup = ({ found = {}, isMobile = false, effectiveViewMode = 'day', container = null } = {}) => {
    vi.useFakeTimers();
    const querySelector = vi.fn((sel) => found[sel] ?? null);
    vi.stubGlobal('document', { querySelector });
    const deps = {
      visibleDays: 1, effectiveViewMode,
      selectedDate: new Date(2026, 10, 16), setSelectedDate: vi.fn(), setShowMonthView: vi.fn(),
      setShowSpotlight: vi.fn(), isMobile, setMobileActiveTab: vi.fn(), setTabletActiveTab: vi.fn(),
      setInboxProjectFilter: vi.fn(), setInboxArchivedExpanded: vi.fn(), setDailyNotesModalDate: vi.fn(),
      calendarRef: { current: container }, setDesktopSpace: vi.fn(),
    };
    return { deps, querySelector, ...useNavigation(deps) };
  };
  const done = () => { vi.unstubAllGlobals(); vi.useRealTimers(); };
  const timelineSel = (id) => `[data-task-id="${id}"], [data-sched-task="${id}"]`;

  it('shows an Inbox task with a passed deadline in the Inbox', () => {
    const row = fakeEl();
    const { deps, goToOverdueTask } = useSetup({ found: { '[data-task-id="i1"]': row } });
    const onMissing = vi.fn();

    goToOverdueTask({ id: 'i1', deadline: '2026-11-15', _overdueType: 'deadline' }, { onMissing });
    vi.advanceTimersByTime(300);

    expect(deps.setTabletActiveTab).toHaveBeenCalledWith('inbox');
    expect(deps.setInboxProjectFilter).toHaveBeenCalledWith([]);
    expect(deps.setSelectedDate).not.toHaveBeenCalled();
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(row.classList.contains('ring-blue-400')).toBe(true);
    expect(onMissing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(row.classList.contains('ring-blue-400')).toBe(false);
    done();
  });

  it('opens the Inbox tab on a phone, filtered to the task\'s project', () => {
    const { deps, goToOverdueTask } = useSetup({ found: { '[data-task-id="i1"]': fakeEl() }, isMobile: true });
    goToOverdueTask({ id: 'i1', projectId: 'p9', deadline: '2026-11-15', _overdueType: 'deadline' });
    expect(deps.setMobileActiveTab).toHaveBeenCalledWith('inbox');
    expect(deps.setInboxProjectFilter).toHaveBeenCalledWith(['p9']);
    done();
  });

  it('hands over to onMissing when the Inbox filters the row out', () => {
    const { goToOverdueTask } = useSetup();
    const onMissing = vi.fn();
    goToOverdueTask({ id: 'i1', deadline: '2026-11-15', _overdueType: 'deadline' }, { onMissing });
    expect(onMissing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onMissing).toHaveBeenCalledTimes(1);
    done();
  });

  // The scroll was MULTI-only: in DAY and WEEK the card was ringed off screen.
  it.each(['day', 'week', 'multi', 'jobo'])('goes to a scheduled task\'s date and scrolls to its card in %s', (effectiveViewMode) => {
    const card = fakeEl();
    const container = {
      contains: (el) => el === card, getBoundingClientRect: () => ({ top: 100 }),
      scrollTop: 0, clientHeight: 600, scrollTo: vi.fn(),
    };
    const found = {};
    const { deps, goToOverdueTask } = useSetup({ found, effectiveViewMode, container });

    goToOverdueTask({ id: 's1', date: '2026-11-15', startTime: '03:00', _overdueType: 'scheduled' });
    // The card is drawn once the date has changed.
    found[timelineSel('s1')] = card;
    vi.advanceTimersByTime(300);

    const went = deps.setSelectedDate.mock.calls[0][0];
    expect([went.getFullYear(), went.getMonth(), went.getDate()]).toEqual([2026, 10, 15]);
    // 900 - 100 (card top in the container) - 300 (half the container) + 20 (half the card)
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 520, behavior: 'smooth' });
    expect(card.classList.contains('ring-blue-400')).toBe(true);
    done();
  });

  it('rings a card already on screen without changing the date', () => {
    const card = fakeEl();
    const container = { contains: () => true, getBoundingClientRect: () => ({ top: 100 }), scrollTop: 0, clientHeight: 600, scrollTo: vi.fn() };
    const { deps, goToOverdueTask } = useSetup({ found: { [timelineSel('s1')]: card }, effectiveViewMode: 'week', container });

    goToOverdueTask({ id: 's1', date: '2026-11-15', _overdueType: 'scheduled' });
    vi.advanceTimersByTime(0);

    expect(deps.setSelectedDate).not.toHaveBeenCalled();
    expect(container.scrollTo).toHaveBeenCalled();
    expect(card.classList.contains('ring-blue-400')).toBe(true);
    done();
  });

  it('scrolls an agenda card, which is outside the calendar\'s scroller, in its own list', () => {
    const card = fakeEl();
    const container = { contains: () => false, scrollTo: vi.fn() };
    const { goToOverdueTask } = useSetup({ found: { [timelineSel('s1')]: card }, effectiveViewMode: 'sched', container });

    goToOverdueTask({ id: 's1', date: '2026-11-15', _overdueType: 'scheduled' });
    vi.advanceTimersByTime(0);

    expect(card.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(container.scrollTo).not.toHaveBeenCalled();
    done();
  });

  it('switches a phone to the timeline for a scheduled task', () => {
    const { deps, goToOverdueTask } = useSetup({ isMobile: true });
    goToOverdueTask({ id: 's1', date: '2026-11-15', _overdueType: 'scheduled' });
    expect(deps.setMobileActiveTab).toHaveBeenCalledWith('timeline');
    expect(deps.setSelectedDate).toHaveBeenCalled();
    done();
  });
});
