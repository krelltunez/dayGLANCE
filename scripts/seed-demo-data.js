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
  ];

  // ── Recurring task: daily standup ────────────────────────────────────
  const recurringTasks = [
    {
      id: Date.now(),
      title: 'Daily standup note #work',
      startTime: '09:30',
      duration: 15,
      color: 'bg-yellow-500',
      priority: 1,
      notes: 'Write yesterday/today/blockers in the shared doc.',
      recurrence: {
        type: 'weekly',
        startDate: '2026-01-05',
        daysOfWeek: [1, 2, 3, 4, 5], // Mon–Fri
      },
      completedDates: [today],
      exceptions: {},
      lastModified: now,
    },
  ];

  // ── Habits ───────────────────────────────────────────────────────────
  const habits = [
    {
      id: '1710000000001',
      name: 'Exercise',
      icon: '',
      color: '',
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
      icon: '',
      color: '',
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

  console.log('Seed data loaded — refresh the page');
})();
