// dayGLANCE Demo Seed Data
// Paste this entire script into the browser console.
// Persona: solo indie developer / knowledge worker, works from home.

(() => {
  const TODAY = new Date();
  const TOMORROW = new Date(TODAY);
  TOMORROW.setDate(TOMORROW.getDate() + 1);

  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const today = fmt(TODAY);
  const tomorrow = fmt(TOMORROW);
  const now = new Date().toISOString();

  let idCounter = 0;
  const uid = () => `demo-${Date.now()}-${++idCounter}`;

  // ── Goals ────────────────────────────────────────────────────────────
  const goalLaunch = {
    id: uid(),
    title: 'Launch v2.0 client SaaS platform',
    description: 'Ship billing, auth, and API milestones to production and hand off to the client.',
    status: 'active',
    color: 'bg-blue-500',
    targetDate: '2026-06-30',
    createdAt: now,
    updatedAt: now,
  };
  const goalBrand = {
    id: uid(),
    title: 'Grow personal dev brand',
    description: 'Publish, speak, and ship demos to build reputation as a product-minded indie dev.',
    status: 'active',
    color: 'bg-purple-500',
    targetDate: '2026-12-31',
    createdAt: now,
    updatedAt: now,
  };
  const goals = [goalLaunch, goalBrand];

  // ── Projects ──────────────────────────────────────────────────────────
  const projBilling = {
    id: uid(),
    title: 'Billing Integration',
    description: 'Stripe webhook handling for subscription lifecycle events.',
    status: 'active',
    goalId: goalLaunch.id,
    createdAt: now,
    updatedAt: now,
  };
  const projApiDocs = {
    id: uid(),
    title: 'API Documentation',
    description: 'OpenAPI spec + developer guides for /users and /projects endpoints.',
    status: 'active',
    goalId: goalLaunch.id,
    createdAt: now,
    updatedAt: now,
  };
  const projAuth = {
    id: uid(),
    title: 'Auth Refactor',
    description: 'Extract token validation into shared middleware util; close out PR #247.',
    status: 'active',
    goalId: goalLaunch.id,
    createdAt: now,
    updatedAt: now,
  };
  const projPortfolio = {
    id: uid(),
    title: 'Portfolio Refresh',
    description: 'Update case studies, screenshots, and copy for 2026 projects.',
    status: 'active',
    goalId: goalBrand.id,
    createdAt: now,
    updatedAt: now,
  };
  const projBlog = {
    id: uid(),
    title: 'Tech Blog',
    description: 'Publish short-form technical posts on topics I am learning or shipping.',
    status: 'active',
    goalId: goalBrand.id,
    createdAt: now,
    updatedAt: now,
  };
  const projects = [projBilling, projApiDocs, projAuth, projPortfolio, projBlog];

  // ── Scheduled tasks (today) ──────────────────────────────────────────
  const tasks = [
    {
      id: uid(),
      title: 'Morning routine & coffee #health',
      date: today,
      startTime: '08:00',
      duration: 30,
      completed: true,
      completedAt: today,
      priority: 0,
      color: 'bg-green-500',
      notes: '',
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Review pull requests #work',
      date: today,
      startTime: '08:30',
      duration: 60,
      completed: true,
      completedAt: today,
      priority: 2,
      color: 'bg-blue-500',
      notes: 'Focus on the auth refactor PR — Ben asked for a second pass.',
      projectId: projAuth.id,
      subtasks: [
        { id: uid(), title: 'Auth refactor PR (#247)', completed: true },
        { id: uid(), title: 'CI pipeline fix PR (#251)', completed: true },
        { id: uid(), title: 'Dependency bump PR (#253)', completed: false },
      ],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Client check-in call #work',
      date: today,
      startTime: '10:00',
      duration: 45,
      completed: true,
      completedAt: today,
      priority: 1,
      color: 'bg-orange-500',
      notes: 'Agenda: sprint demo, discuss Q2 timeline, billing question.',
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Write API documentation #work',
      date: today,
      startTime: '11:00',
      duration: 90,
      completed: false,
      priority: 2,
      color: 'bg-indigo-500',
      notes: 'Endpoints for /users and /projects. Use the OpenAPI template.',
      projectId: projApiDocs.id,
      subtasks: [
        { id: uid(), title: 'Document /users endpoints', completed: false },
        { id: uid(), title: 'Document /projects endpoints', completed: false },
        { id: uid(), title: 'Add example request/response pairs', completed: false },
      ],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Lunch & walk #health',
      date: today,
      startTime: '12:30',
      duration: 60,
      completed: false,
      priority: 0,
      color: 'bg-teal-500',
      notes: '',
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Deep work: billing integration #work',
      date: today,
      startTime: '14:00',
      duration: 90,
      completed: false,
      priority: 3,
      color: 'bg-red-500',
      notes: 'Stripe webhook handling for subscription changes. Blocked until API docs are done.',
      projectId: projBilling.id,
      subtasks: [
        { id: uid(), title: 'Set up webhook endpoint', completed: false },
        { id: uid(), title: 'Handle subscription.updated event', completed: false },
        { id: uid(), title: 'Write integration tests', completed: false },
      ],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Reply to community Discord questions #admin',
      date: today,
      startTime: '16:00',
      duration: 30,
      completed: false,
      priority: 1,
      color: 'bg-purple-500',
      notes: '',
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'End-of-day review & plan tomorrow #admin',
      date: today,
      startTime: '17:00',
      duration: 30,
      completed: false,
      priority: 0,
      color: 'bg-yellow-500',
      notes: 'Check off completed items, move anything unfinished to tomorrow.',
      subtasks: [],
      lastModified: now,
    },
  ];

  // ── Tomorrow's tasks ─────────────────────────────────────────────────
  const tomorrowTasks = [
    {
      id: uid(),
      title: 'Finish billing integration #work',
      date: tomorrow,
      startTime: '09:00',
      duration: 90,
      completed: false,
      priority: 3,
      color: 'bg-red-500',
      notes: 'Continue from today if not done.',
      projectId: projBilling.id,
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Weekly 1:1 with designer #work',
      date: tomorrow,
      startTime: '11:00',
      duration: 30,
      completed: false,
      priority: 1,
      color: 'bg-orange-500',
      notes: 'Review new dashboard mockups.',
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Grocery run #personal',
      date: tomorrow,
      startTime: '12:30',
      duration: 45,
      completed: false,
      priority: 0,
      color: 'bg-green-500',
      notes: '',
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Refactor auth middleware #work',
      date: tomorrow,
      startTime: '14:00',
      duration: 60,
      completed: false,
      priority: 2,
      color: 'bg-blue-500',
      notes: 'Extract token validation into shared util.',
      projectId: projAuth.id,
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Read chapter 5 of Designing Data-Intensive Applications #learning',
      date: tomorrow,
      startTime: '17:00',
      duration: 45,
      completed: false,
      priority: 0,
      color: 'bg-purple-500',
      notes: '',
      subtasks: [],
      lastModified: now,
    },
  ];

  // ── Inbox (unscheduled) tasks ────────────────────────────────────────
  const unscheduled = [
    {
      id: uid(),
      title: 'Research Nextcloud backup options #admin',
      date: null,
      startTime: '00:00',
      duration: 30,
      completed: false,
      priority: 1,
      color: 'bg-teal-500',
      notes: 'Self-hosted vs managed. Check Hetzner storage boxes.',
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Reply to accountant email #admin',
      date: null,
      startTime: '00:00',
      duration: 15,
      completed: false,
      priority: 2,
      color: 'bg-orange-500',
      notes: 'She needs the Q1 invoice breakdown by March 25.',
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Update portfolio site with new project screenshots',
      date: null,
      startTime: '00:00',
      duration: 45,
      completed: false,
      priority: 0,
      color: 'bg-blue-500',
      notes: '',
      projectId: projPortfolio.id,
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Fix broken link in README #work',
      date: null,
      startTime: '00:00',
      duration: 10,
      completed: false,
      priority: 1,
      color: 'bg-purple-500',
      notes: 'Someone reported it in the GitHub issues.',
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Look into upgrading Node to v22 LTS',
      date: null,
      startTime: '00:00',
      duration: 30,
      completed: false,
      priority: 0,
      color: 'bg-indigo-500',
      notes: '',
      subtasks: [],
      lastModified: now,
    },
    // Project-specific inbox tasks
    {
      id: uid(),
      title: 'Add rate limiting to /users endpoint #work',
      date: null,
      startTime: '00:00',
      duration: 60,
      completed: false,
      priority: 2,
      color: 'bg-indigo-500',
      notes: 'Cap at 100 req/min per API key. Document in OpenAPI spec.',
      projectId: projApiDocs.id,
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Handle subscription.cancelled webhook event #work',
      date: null,
      startTime: '00:00',
      duration: 45,
      completed: false,
      priority: 2,
      color: 'bg-red-500',
      notes: 'Downgrade user to free tier and send cancellation email.',
      projectId: projBilling.id,
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Draft blog post: lessons from the auth refactor #writing',
      date: null,
      startTime: '00:00',
      duration: 60,
      completed: false,
      priority: 1,
      color: 'bg-yellow-500',
      notes: 'What went wrong, what we fixed, and why shared middleware matters.',
      projectId: projBlog.id,
      subtasks: [
        { id: uid(), title: 'Outline key sections', completed: false },
        { id: uid(), title: 'Write first draft', completed: false },
        { id: uid(), title: 'Publish to blog', completed: false },
      ],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Set up blog with Astro + Netlify #work',
      date: null,
      startTime: '00:00',
      duration: 90,
      completed: false,
      priority: 2,
      color: 'bg-yellow-500',
      notes: 'Use the minimal Astro blog starter. Custom domain already owned.',
      projectId: projBlog.id,
      subtasks: [],
      lastModified: now,
    },
    {
      id: uid(),
      title: 'Write case study for client SaaS project #work',
      date: null,
      startTime: '00:00',
      duration: 90,
      completed: false,
      priority: 1,
      color: 'bg-purple-500',
      notes: 'Cover problem, approach, results. Add to portfolio once v2 ships.',
      projectId: projPortfolio.id,
      subtasks: [
        { id: uid(), title: 'Draft problem & approach sections', completed: false },
        { id: uid(), title: 'Gather metrics / results', completed: false },
        { id: uid(), title: 'Design layout in Figma', completed: false },
      ],
      lastModified: now,
    },
  ];

  // ── Recurring tasks ──────────────────────────────────────────────────
  // (standup moved to routines)
  const recurringTasks = [];

  // ── Routines ─────────────────────────────────────────────────────────
  // Chip IDs need to be stable so todayRoutines can reference them.
  const rStandup     = { id: uid(), name: 'Daily standup note',            lastModified: now };
  const rWeekPlan    = { id: uid(), name: 'Weekly planning & prioritisation', lastModified: now };
  const rEmailClear  = { id: uid(), name: 'Clear email & Discord backlog', lastModified: now };
  const rBilling     = { id: uid(), name: 'Billing & finances check',      lastModified: now };
  const rTriage      = { id: uid(), name: 'Triage GitHub issues & PRs',    lastModified: now };
  const rRetro       = { id: uid(), name: 'Weekly retro & log',            lastModified: now };
  const rMealPrep    = { id: uid(), name: 'Meal prep for the week',        lastModified: now };
  const rWeekAhead   = { id: uid(), name: 'Week ahead planning',           lastModified: now };

  const routineDefinitions = {
    everyday:  [rStandup],
    monday:    [rWeekPlan],
    tuesday:   [rEmailClear],
    wednesday: [rBilling],
    thursday:  [rTriage],
    friday:    [rRetro],
    saturday:  [rMealPrep],
    sunday:    [rWeekAhead],
  };

  // Today is Tuesday — place everyday standup (done) + tuesday chip on the timeline.
  const todayRoutines = [
    { id: rStandup.id,    name: rStandup.name,    bucket: 'everyday', startTime: '09:30', duration: 15, isAllDay: false, completed: true,  lastModified: now },
    { id: rEmailClear.id, name: rEmailClear.name, bucket: 'tuesday',  startTime: null,    duration: 15, isAllDay: true,  completed: false, lastModified: now },
  ];

  // ── Habits ───────────────────────────────────────────────────────────
  const habits = [
    {
      id: '1710000000001',
      name: 'Exercise',
      icon: 'Dumbbell',
      color: 'green',
      description: '30 min of movement — run, yoga, or weights',
      frequency: 'daily',
      target: 1,
      source: 'user',
      createdAt: '2026-01-01T08:00:00.000Z',
      archived: false,
    },
    {
      id: '1710000000002',
      name: 'Read',
      icon: 'BookOpen',
      color: 'purple',
      description: 'At least 20 pages',
      frequency: 'daily',
      target: 1,
      source: 'user',
      createdAt: '2026-01-01T08:00:00.000Z',
      archived: false,
    },
  ];

  // Build a week of habit log history for realism
  const habitLogs = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - i);
    const key = fmt(d);
    habitLogs[key] = {
      '1710000000001': i === 2 ? 0 : 1, // missed exercise 2 days ago
      '1710000000002': i === 0 || i === 1 || i === 3 || i === 5 ? 1 : 0,
    };
  }

  // ── Daily notes ──────────────────────────────────────────────────────
  const dailyNotes = {
    [today]: {
      text:
        "Good start to the day — got through the PR backlog before the client call. Energy feels solid after yesterday's long walk. Main goal today: nail down the API docs so I can unblock the billing integration this afternoon.",
      lastModified: now,
    },
  };

  // ── Write everything to localStorage ─────────────────────────────────
  const allTasks = [...tasks, ...tomorrowTasks];

  localStorage.setItem('day-planner-tasks', JSON.stringify(allTasks));
  localStorage.setItem('day-planner-unscheduled', JSON.stringify(unscheduled));
  localStorage.setItem('day-planner-recurring-tasks', JSON.stringify(recurringTasks));
  localStorage.setItem('day-planner-habits', JSON.stringify(habits));
  localStorage.setItem('day-planner-habits-enabled', JSON.stringify(true));
  localStorage.setItem('day-planner-habit-logs', JSON.stringify(habitLogs));
  localStorage.setItem('day-planner-daily-notes', JSON.stringify(dailyNotes));
  localStorage.setItem('day-planner-recycle-bin', JSON.stringify([]));
  localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify({}));
  localStorage.setItem('day-planner-goals', JSON.stringify(goals));
  localStorage.setItem('day-planner-projects', JSON.stringify(projects));
  localStorage.setItem('day-planner-goals-projects-enabled', JSON.stringify(true));
  localStorage.setItem('day-planner-routine-definitions', JSON.stringify(routineDefinitions));
  localStorage.setItem('day-planner-today-routines', JSON.stringify(todayRoutines));
  localStorage.setItem('day-planner-routines-date', today);
  localStorage.setItem('day-planner-routines-enabled', JSON.stringify(true));

  console.log('Seed data loaded — refresh the page');
})();
