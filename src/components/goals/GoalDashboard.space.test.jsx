import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import GoalDashboard from './GoalDashboard.jsx';

// The cards and the roadmap chart have their own concerns; here they are
// stand-ins so the assertions are about WHERE the space puts things.
vi.mock('../projects/ProjectCard.jsx', () => ({
  default: React.forwardRef(({ project, compact, onMoveToClick }, ref) => (
    <div ref={ref} data-project-card={project.id} data-compact={compact ? '1' : '0'} data-move-to={onMoveToClick ? '1' : '0'}>{project.title}</div>
  )),
}));
vi.mock('./GoalTimeline.jsx', () => ({
  DEFAULT_PERIOD: '6m',
  default: ({ goals, periodKey, showRange = true }) => (
    <div data-goal-timeline={goals.map(g => g.id).join(',')} data-period={periodKey} data-show-range={showRange ? '1' : '0'} />
  ),
  GoalRangeToggle: ({ value }) => <div data-goal-range={value} />,
}));

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

const GOALS = [
  { id: 'done', title: 'Shipped goal', status: 'completed', color: 'bg-green-500', targetDate: '2026-01-01' },
  { id: 'ios', title: 'Ship iOS Apps', status: 'active', color: 'bg-blue-500', areaId: 'dev', targetDate: '2099-01-01' },
  { id: 'electron', title: 'Ship Electron Apps', status: 'active', color: 'bg-purple-500', areaId: 'dev' },
  { id: 'old', title: 'Archived goal', status: 'archived' },
];
const PROJECTS = [
  { id: 'asc', title: 'App Store Connect', goalId: 'ios', status: 'active', sortOrder: 0 },
  { id: 'billing', title: 'Setup App Billing', goalId: 'ios', status: 'completed', sortOrder: 10 },
  { id: 'dg', title: 'dayGLANCE', status: 'active' },
  { id: 'gone', title: 'Archived project', status: 'archived' },
];

const planner = () => ({
  tasks: [{ id: 't1', projectId: 'dg', title: 'x' }], unscheduledTasks: [{ id: 't2', projectId: 'dg', title: 'y' }], recurringTasks: [],
  setTasks: vi.fn(), setUnscheduledTasks: vi.fn(),
  getTodayStr: () => '2026-09-22',
  showAddTask: false, setShowAddTask: vi.fn(), setShowNewTaskDeadlinePicker: vi.fn(),
  isMobile: false, isTablet: false, darkMode: false, use24HourClock: false,
  cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
  expandedNotesTaskId: null, setExpandedNotesTaskId: vi.fn(),
  spaceCardSize: 'normal', setSpaceCardSize: vi.fn(),
});
const features = (overrides = {}) => ({
  goals: GOALS, projects: PROJECTS, setProjects: vi.fn(),
  areas: [{ id: 'dev', name: 'App Development', color: 'bg-orange-500', order: 0 }],
  goalsAreaFilter: 'all', setGoalsAreaFilter: vi.fn(), goalsViewMode: 'list', setGoalsViewMode: vi.fn(),
  goalsDashboardFocusId: null, setGoalsDashboardFocusId: vi.fn(),
  addGoal: vi.fn(), updateGoal: vi.fn(), deleteGoal: vi.fn(),
  addProject: vi.fn(), updateProject: vi.fn(), moveProject: vi.fn(),
  plannerProjectId: null, setPlannerProjectId: vi.fn(),
  isVisibleForUser: () => true, multiUserEnabled: false, users: [],
  ...overrides,
});

let i18n;
beforeEach(async () => { i18n = i18n || await i18nFor('en'); });

const render = (props, feat = {}, plan = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={{ ...planner(), ...plan }}>
      <FeaturesContext.Provider value={features(feat)}>
        <SyncContext.Provider value={{ createProjectNote: vi.fn(), openInObsidian: vi.fn() }}>
          <GoalDashboard {...props} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);
const section = (html, marker) => {
  const start = html.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  return html.slice(start);
};
const cards = (html) => [...html.matchAll(/data-project-card="([^"]+)"/g)].map((m) => m[1]);
const rows = (html) => [...html.matchAll(/<button[^>]*data-goal-row="([^"]+)"[^>]*>/g)].map((m) => ({ id: m[1], selected: m[0].includes('aria-pressed="true"') }));

describe('GoalDashboard desktop space', () => {
  it('renders the sidebar and the main area, not the old modal', () => {
    const html = render({ desktop: true, isActive: true });
    expect(html).toContain('data-goals-sidebar');
    expect(html).toContain('data-goals-main');
    expect(html).not.toContain('max-w-6xl');
    expect(html).not.toContain('bg-black/50');
    expect(html).not.toContain('goal-carousel');
  });

  it('lists the active goals in carousel order with the first active one selected (D6)', () => {
    const html = render({ desktop: true, isActive: true });
    // completed first, then by target date; archived never listed
    expect(rows(html)).toEqual([
      { id: 'done', selected: false },
      { id: 'ios', selected: true },
      { id: 'electron', selected: false },
    ]);
    const sidebar = html.slice(html.indexOf('data-goals-sidebar'), html.indexOf('data-goals-main'));
    expect(sidebar).toContain('App Development');
    expect(sidebar).toContain('Goals <span');
    expect(sidebar).toContain('>3</span>');
    // the Projects tab counts OPEN standalone projects
    expect(sidebar).toContain('Projects <span');
    expect(sidebar).toContain('>1</span>');
  });

  it('keeps the area filter, Manage Areas and Add Goal on the Goals tab of the sidebar (D8, D10)', () => {
    const html = render({ desktop: true, isActive: true });
    const sidebar = html.slice(html.indexOf('data-goals-sidebar'), html.indexOf('data-goals-main'));
    expect(sidebar).toContain('<select');
    expect(sidebar).toContain('All areas');
    expect(sidebar).toContain('aria-label="Manage Areas"');
    expect(sidebar).not.toContain('data-project-filter');
  });

  it('puts only List/Roadmap in the main toolbar; creating lives in the FAB, the card and Manage Areas', () => {
    const main = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    const toolbar = main.slice(0, main.indexOf('overflow-y-auto'));
    expect(toolbar).toContain(' List</button>');
    expect(toolbar).toContain(' Roadmap</button>');
    expect(toolbar).not.toContain('Add Area');
    expect(toolbar).not.toContain('Add Goal');
    expect(toolbar).not.toContain('Add Project');
    expect(main).toContain('overflow-y-auto');
    // the divider matches the calendar area's (border-x) and the toolbar row is
    // 46px plus its border like the sidebar tab row, so the lines meet
    expect(main).toContain('border-x border-stone-200');
    expect(main).toContain('height:var(--header-row-h);box-sizing:content-box');
  });

  it('puts the card size on the right of the toolbar on List and Projects, and Range there on Roadmap', () => {
    const toolbar = (html) => { const main = section(html, 'data-goals-main'); return main.slice(0, main.indexOf('overflow-y-auto')); };
    const list = toolbar(render({ desktop: true, isActive: true }, {}, { spaceCardSize: 'large' }));
    expect(list).toMatch(/data-card-size-toggle[^>]*>[^]*?<option value="large" selected="">Large<\/option>/);
    expect(list).not.toContain('data-goal-range');
    const projectsTab = toolbar(render({ desktop: true, isActive: true, initialSidebarTab: 'projects' }));
    expect(projectsTab).toContain('data-card-size-toggle');
    const roadmapHtml = render({ desktop: true, isActive: true }, { goalsViewMode: 'timeline' });
    const roadmap = toolbar(roadmapHtml);
    expect(roadmap).toContain('data-goal-range="6m"');
    expect(roadmap).not.toContain('data-card-size-toggle');
    // the chart takes the toolbar's period and drops its own buttons
    expect(roadmapHtml).toContain('data-period="6m" data-show-range="0"');
  });

  it('stacks the FABs bottom-right over the main scroll area, contextual to the tab, above the Archived footer', () => {
    const html = render({ desktop: true, isActive: true });
    const main = section(html, 'data-goals-main');
    const fabs = main.slice(main.indexOf('data-goals-fabs'));
    expect(fabs).toContain('absolute bottom-6 right-6');
    expect(fabs).toContain('flex-col');
    // A goal is on screen, so the + offers a choice (GoalsAddMenu, #2133).
    expect(fabs).toContain('aria-label="Add"');
    expect(fabs).toContain('aria-haspopup="menu"');
    expect(main.indexOf('data-goals-fabs')).toBeLessThan(main.indexOf('data-archived-section'));
    expect(main).toContain('pb-28');
    const projects = section(render({ desktop: true, isActive: true, initialSidebarTab: 'projects' }), 'data-goals-fabs');
    expect(projects).toContain('aria-label="Add Project"');
    expect(html).not.toContain('bottom-6 left-4');
  });

  it('anchors the Archived section under the scroll area, expanding upward', () => {
    const main = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    const archived = main.slice(main.indexOf('data-archived-section'));
    expect(archived).toContain('flex flex-col-reverse');
    expect(main.indexOf('overflow-y-auto')).toBeLessThan(main.indexOf('data-archived-section'));
    expect(archived).toContain('aria-expanded="false"');
  });

  it('shows the selected goal card and only ITS project cards, with Move to… wired', () => {
    const main = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    expect(main).toContain('data-goal-list-view="ios"');
    expect(main).toContain('Ship iOS Apps');
    expect(cards(main)).toEqual(['asc', 'billing']);
    expect(main).toContain('data-project-card="billing" data-compact="1"');
    expect(main).toContain('data-move-to="1"');
    expect(main).not.toContain('dayGLANCE');
    // every goal row is a reassign drop target; the goal's group and its cards carry the move semantics too
    expect(render({ desktop: true, isActive: true })).toContain('data-move-goal="electron"');
    expect(main).toContain('data-move-goal="ios" data-move-before="asc"');
    // cards sit in a measured-column grid: one active + one done card here, each in
    // its own one-column grid capped at one card's max width (no ResizeObserver on
    // the server, so the default 3 columns apply and 1 < 3)
    expect(main).toContain('grid-template-columns:repeat(1, minmax(0, 1fr))');
    expect(main).toContain('max-width:560px');
    // cards are dealt into stacked columns, in order
    expect(main).toContain('data-card-column');
    expect(main).not.toContain('w-[260px]');
    expect(main).not.toContain('w-[325px]');
  });

  it('shows the empty state for a selected goal without projects', () => {
    const feat = { goals: GOALS.filter(g => g.id !== 'ios' && g.id !== 'done') };
    const main = section(render({ desktop: true, isActive: true }, feat), 'data-goals-main');
    expect(main).toContain('data-goal-list-view="electron"');
    expect(main).toContain('No projects linked to this goal yet');
    expect(cards(main)).toEqual([]);
  });

  it('honours the area filter for the list and the roadmap alike', () => {
    const html = render({ desktop: true, isActive: true }, { goalsAreaFilter: 'uncategorized' });
    expect(rows(html)).toEqual([{ id: 'done', selected: true }]);
    const roadmap = render({ desktop: true, isActive: true }, { goalsAreaFilter: 'dev', goalsViewMode: 'timeline' });
    expect(roadmap).toContain('data-goal-timeline="ios,electron"');
    expect(roadmap).not.toContain('data-goal-list-view');
  });

  it('on the Projects tab: Open | Completed with icons and count badges, rows with a ring and done/total, never Stalled', () => {
    const html = render({ desktop: true, isActive: true, initialSidebarTab: 'projects' });
    const sidebar = html.slice(html.indexOf('data-goals-sidebar'), html.indexOf('data-goals-main'));
    const main = section(html, 'data-goals-main');
    // toolbar: no List/Roadmap; Open (active, white badge on blue) and Completed (blue badge)
    expect(main).not.toContain(' Roadmap</button>');
    expect(main).toContain('lucide-circle-dashed');
    expect(main).toContain('lucide-circle-check-big');
    expect(main).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Open<span class="[^"]*bg-white text-blue-600">1<\/span>/);
    expect(main).toMatch(/aria-pressed="false"[^>]*>[\s\S]*?Completed<span class="[^"]*bg-blue-600 text-white">0<\/span>/);
    // the open standalone project's card is in the grid; completed ones are not
    expect(cards(main)).toEqual(['dg']);
    // sidebar row: progress ring and "done/total". The row uses the card's gate, so a
    // STANDALONE project is never flagged Stalled even though the raw rule would say so
    // (open tasks, nothing completed) — exactly as its card shows nothing.
    const row = sidebar.match(/<button[^>]*data-project-row="dg"[\s\S]*?<\/button>/)[0];
    expect(row).toContain('<svg width="18"');
    expect(row).toContain('>0/2</span>');
    expect(row).not.toContain('Stalled');
    expect(main).not.toContain('Stalled');
    // rows are separated by hairlines (none before the first)
    expect(sidebar.match(/data-row-divider/g) ?? []).toHaveLength(0); // one open standalone project: no divider
    // the filter field sits where the area filter sits on the Goals tab
    expect(sidebar).toContain('data-project-filter');
    expect(sidebar).toContain('placeholder="Filter projects…"');
    // a text input: a search input adds the browser's own clear button beside ours
    const input = sidebar.match(/<input[^>]*data-project-filter[^>]*>/)[0];
    expect(input).toContain('type="text"');
    expect(input).toContain('enterKeyHint="search"');
    expect(sidebar).toContain('>/</span>');
  });

  it('keeps the sidebar tab across renders it was given, but starts on Goals by default', () => {
    expect(render({ desktop: true, isActive: true })).toContain(' Roadmap</button>');
  });

  it('stacks the Aspire FAB above + only when the experimental switch is on', () => {
    const off = section(render({ desktop: true, isActive: true }), 'data-goals-fabs');
    expect(off).not.toContain('data-aspire-fab');
    const on = section(render({ desktop: true, isActive: true }, { aspireEnabled: true }), 'data-goals-fabs');
    expect(on).toContain('aria-label="Aspire"');
    expect(on.indexOf('data-aspire-fab')).toBeLessThan(on.indexOf('data-goals-plus'));
    expect(on).not.toContain('data-aspire-modal');
  });

  it('deals cards into the columns in order and stacks each column', () => {
    // five open standalone projects, default 3 columns (no ResizeObserver on the server)
    const five = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, title: id, status: 'active', sortOrder: i }));
    const main = section(render({ desktop: true, isActive: true, initialSidebarTab: 'projects' }, { projects: five }), 'data-goals-main');
    expect(main).toContain('data-columns="3"');
    const columns = [...main.matchAll(/<div[^>]*data-card-column[^>]*>([\s\S]*?)<\/div><\/div><\/div>/g)];
    expect(columns.length).toBeGreaterThanOrEqual(1);
    const order = cards(main);
    // column 1 holds a and d, column 2 b and e, column 3 c: DOM order is column-major
    expect(order).toEqual(['a', 'd', 'b', 'e', 'c']);
  });

  it('draws the cards at the card size from Settings, and at Normal unzoomed', () => {
    const normal = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    expect(normal).not.toContain('zoom:');
    expect(normal).toContain('width:420px');
    const large = section(render({ desktop: true, isActive: true }, {}, { spaceCardSize: 'large' }), 'data-goals-main');
    // the goal card's slot grows with it, and the project grids zoom as a whole
    expect(large).toContain('width:483px');
    expect(large).toMatch(/data-card-scale="1.15"/);
    expect(large.match(/zoom:1\.15/g)?.length).toBe(3);
  });

  it('lists the archived goals and projects under the main area', () => {
    const main = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    expect(main).toContain('Archived (2)');
  });
});

describe('GoalDashboard embedded (phone) mode', () => {
  const phone = (props = {}, feat = {}) => render({ embedded: true, isActive: true, ...props }, feat);
  const chips = (html) => [...html.matchAll(/<button[^>]*data-goal-chip="([^"]+)"[^>]*>/g)].map((m) => ({ id: m[1], active: m[0].includes('aria-pressed="true"') }));

  it('has no sidebar or toolbar: the space is folded into one column', () => {
    const html = phone();
    expect(html).not.toContain('data-goals-sidebar');
    expect(html).not.toContain('data-goals-main');
  });

  it('opens with Goals | Projects on top, counting every active goal and the OPEN standalone projects', () => {
    const tabs = section(phone(), 'data-goals-tabs');
    // Goals is the selected tab (the tablist's own label also says "Projects")
    expect(tabs).toMatch(/aria-selected="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)? <span[^>]*>Goals<\/span>/);
    expect(tabs).toMatch(/aria-selected="false"[^>]*>(?:<svg[\s\S]*?<\/svg>)? <span[^>]*>Projects<\/span>/);
    expect(tabs).toMatch(/Goals<\/span> <span[^>]*>3<\/span>/);
    expect(tabs).toMatch(/Projects<\/span> <span[^>]*>1<\/span>/);
    // the tabs come before the goals-only controls
    const html = phone();
    expect(html.indexOf('data-goals-tabs')).toBeLessThan(html.indexOf('aria-label="Area"'));
  });

  it('lists the goals as chips in carousel order, the first active one selected, over one page per goal', () => {
    const html = phone();
    expect(chips(html)).toEqual([
      { id: 'done', active: false },
      { id: 'ios', active: true },
      { id: 'electron', active: false },
    ]);
    expect(html).toContain('goal-carousel');
    const pages = [...html.matchAll(/data-goal-page="([^"]+)"/g)].map((m) => m[1]);
    expect(pages).toEqual(['done', 'ios', 'electron']);
    // no dots and arrows any more, and no standalone page at the end of the swipe
    expect(html).not.toContain('w-4 h-2.5 bg-blue-500');
    expect(html).not.toContain('Standalone projects');
  });

  it('draws the real GoalCard full width on each page, with the area badge the old card left out', () => {
    const page = section(phone(), 'data-goal-page="ios"');
    const ios = page.slice(0, page.indexOf('data-goal-page="electron"'));
    expect(ios).toContain('rounded-xl overflow-hidden border-2 w-full');
    expect(ios).toContain('App Development');
    // then its projects: active first, completed compact under them
    expect(cards(ios)).toEqual(['asc', 'billing']);
    expect(ios).toContain('data-project-card="billing" data-compact="1"');
  });

  it('shows the standalone projects on the Projects tab, with Open | Completed and a search button on one row', () => {
    const html = phone({ initialSidebarTab: 'projects' });
    const list = section(html, 'data-standalone-list');
    expect(cards(list)).toEqual(['dg']);
    const row = section(html, 'data-projects-controls');
    const controls = row.slice(0, row.indexOf('data-standalone-list'));
    // the words stay; the filter is a button until tapped, beside the toggle
    expect(controls).toContain(' Open');
    expect(controls).toContain(' Completed');
    expect(controls).toContain('data-open-filter');
    expect(controls).toContain('aria-label="Filter projects…"');
    // the closed filter fills the rest of the row, labelled, at the toggle's height
    const button = controls.match(/<button[^>]*data-open-filter[^>]*>[\s\S]*?<\/button>/)[0];
    expect(button).toContain('flex-1');
    expect(button).toContain('h-8');
    expect(button).toContain('>Filter</span>');
    expect(controls).not.toContain('data-project-filter');
    // it wraps rather than squeezing where a language's labels are long
    expect(controls).toMatch(/data-projects-controls[^>]*flex-wrap/);
    expect(html).not.toContain('aria-label="Area"');
    expect(html).not.toContain('goal-carousel');
  });

  it('keeps the area select readable: List | Roadmap in words only, wrapping below it when the row is short', () => {
    const row = section(phone(), 'data-goal-controls');
    const controls = row.slice(0, row.indexOf('data-goal-chips'));
    expect(controls).toMatch(/data-goal-controls[^>]*flex-wrap/);
    expect(controls.match(/<select[^>]*>/)[0]).toContain('min-w-[9rem]');
    // words, no icons, on the phone's view toggle
    const toggle = controls.slice(controls.indexOf('role="group"'));
    expect(toggle).toContain(' List</button>');
    expect(toggle).toContain(' Roadmap</button>');
    expect(toggle.slice(0, toggle.indexOf('</div>'))).not.toContain('<svg');
    // the desktop toolbar's toggle keeps its icons
    const main = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    const desktopToggle = main.slice(main.indexOf('role="group"'));
    expect(desktopToggle.slice(0, desktopToggle.indexOf('</div>'))).toContain('<svg');
  });

  describe('the controls chevron', () => {
    const withStorage = (value, fn) => {
      const saved = globalThis.localStorage;
      const store = { 'dayglance-goals-phone-controls-collapsed': value };
      globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
      try { return fn(); } finally { globalThis.localStorage = saved; }
    };
    const toggle = (html) => html.match(/<button[^>]*data-controls-toggle[^>]*>/)[0];

    it('sits in the Goals | Projects row, expanded by default, and starts expanded without storage', () => {
      const html = phone();
      const t = toggle(html);
      expect(t).toContain('aria-expanded="true"');
      expect(t).toContain('aria-label="Hide filters"');
      expect(html).toContain('data-goal-chips');
      expect(html).toContain('aria-label="Area"');
    });

    it('hides the area and view row and the chips on Goals, but keeps the carousel', () => {
      const html = withStorage('1', () => phone());
      expect(toggle(html)).toContain('aria-expanded="false"');
      expect(toggle(html)).toContain('aria-label="Show filters"');
      expect(html).not.toContain('data-goal-chips');
      expect(html).not.toContain('aria-label="Area"');
      expect(html).toContain('goal-carousel');
    });

    it('hides Open | Completed and the filter on Projects, and keeps the list', () => {
      const html = withStorage('1', () => phone({ initialSidebarTab: 'projects' }));
      expect(html).not.toContain('data-projects-controls');
      expect(cards(section(html, 'data-standalone-list'))).toEqual(['dg']);
    });

    it('marks itself only when a hidden control is narrowing the list', () => {
      expect(withStorage('1', () => phone())).not.toContain('data-filters-active');
      const narrowed = withStorage('1', () => phone({}, { goalsAreaFilter: 'dev' }));
      expect(narrowed).toContain('data-filters-active');
      expect(toggle(narrowed)).toContain('aria-label="Show filters · Filters active"');
      // shown controls speak for themselves: no dot while expanded
      expect(phone({}, { goalsAreaFilter: 'dev' })).not.toContain('data-filters-active');
    });
  });

  it('floats one contextual + over the content, above the Archived footer, with Aspire above it when on', () => {
    const goals = section(phone(), 'data-goals-fabs');
    expect(goals).toContain('absolute bottom-4 right-4');
    expect(goals).toContain('aria-label="Add"');
    expect(goals).toContain('aria-haspopup="menu"');
    expect(goals).not.toContain('data-aspire-fab');
    const html = phone();
    expect(html.indexOf('data-goals-fabs')).toBeLessThan(html.indexOf('data-archived-section'));
    expect(section(phone({ initialSidebarTab: 'projects' }), 'data-goals-fabs')).toContain('aria-label="Add Project"');
    const on = section(phone({}, { aspireEnabled: true }), 'data-goals-fabs');
    expect(on.indexOf('data-aspire-fab')).toBeLessThan(on.indexOf('data-goals-plus'));
  });

  it('keeps the roadmap under the tabs, and only on the Goals tab', () => {
    const html = phone({}, { goalsViewMode: 'timeline' });
    expect(html.indexOf('data-goals-tabs')).toBeLessThan(html.indexOf('data-goal-timeline'));
    expect(html).not.toContain('goal-carousel');
    // the phone has no toolbar: the chart keeps its own Range buttons
    expect(html).toContain('data-show-range="1"');
    expect(html).not.toContain('data-card-size-toggle');
    const projects = phone({ initialSidebarTab: 'projects' }, { goalsViewMode: 'timeline' });
    expect(projects).not.toContain('data-goal-timeline');
    expect(projects).toContain('data-standalone-list');
  });

  it('stacks the archive lists instead of two columns', () => {
    expect(phone()).toContain('Archived (2)');
  });

  it('renders nothing outside either mode', () => {
    expect(render({})).toBe('');
  });
});

// Projects on hold (utils/projectStatus.js): a third list on the Projects
// tab, and after the active projects within a goal.
describe('projects on hold', () => {
  const withPaused = {
    projects: [
      ...PROJECTS,
      { id: 'paused-solo', title: 'Paused side project', status: 'on-hold' },
      { id: 'paused-ios', title: 'Paused iOS work', goalId: 'ios', status: 'on-hold', sortOrder: -10 },
    ],
  };

  it('the Projects tab has Open | On hold | Completed, each with its count, Open leaving the paused one out', () => {
    const main = section(render({ desktop: true, isActive: true, initialSidebarTab: 'projects' }, withPaused), 'data-goals-main');
    expect(main).toContain('lucide-circle-pause');
    expect(main).toMatch(/Open<span class="[^"]*">1<\/span>/);
    expect(main).toMatch(/On hold<span class="[^"]*">1<\/span>/);
    expect(main).toMatch(/Completed<span class="[^"]*">0<\/span>/);
    expect(cards(main)).toEqual(['dg']);
  });

  it('within a goal, a paused project comes after the active ones, before the completed', () => {
    // Its sortOrder would put it first; on hold puts it after.
    const main = section(render({ desktop: true, isActive: true }, withPaused), 'data-goals-main');
    expect(cards(main)).toEqual(['asc', 'paused-ios', 'billing']);
  });

  it('on the phone, the same three lists', () => {
    const html = render({ embedded: true, isActive: true, initialSidebarTab: 'projects' }, withPaused);
    expect(html).toMatch(/On hold<span class="[^"]*">1<\/span>/);
  });
});

