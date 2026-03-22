// dayGLANCE Stress-Test Data Injector
// Paste this entire script into the browser console.
// Injects a large number of tasks for performance and layout testing.
// To clean up: run clearStressData() in the console, then refresh.

(() => {
  const DAYS_BACK = 3;
  const DAYS_FORWARD = 7;
  const TASKS_PER_DAY = 12;
  const INBOX_COUNT = 40;

  const COLORS = [
    'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500',
    'bg-teal-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500',
  ];
  const TAGS = ['#work', '#health', '#admin', '#personal', '#learning', '#deep-work'];
  const TITLES = [
    'Write unit tests for', 'Review and merge PR for', 'Schedule meeting about',
    'Draft proposal for', 'Fix bug in', 'Refactor module', 'Document API for',
    'Research options for', 'Follow up on', 'Deploy feature', 'Investigate issue with',
    'Prepare demo of', 'Update dependencies in', 'Migrate data for', 'Audit logs for',
    'Profile performance of', 'Design schema for', 'Sketch wireframe for',
    'Write changelog entry for', 'Set up monitoring for',
  ];
  const SUBJECTS = [
    'auth service', 'billing integration', 'dashboard layout', 'user profile',
    'notification system', 'search indexer', 'export pipeline', 'admin panel',
    'onboarding flow', 'mobile navigation', 'settings modal', 'error boundary',
    'data migration script', 'rate limiter', 'caching layer',
  ];

  let seq = 0;
  const uid = () => `stress-${Date.now()}-${++seq}`;
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const now = new Date().toISOString();

  const tasks = [];

  for (let dayOffset = -DAYS_BACK; dayOffset <= DAYS_FORWARD; dayOffset++) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    const date = fmt(d);

    // Pack tasks from 07:00, each 30–90 min, with a few gaps
    let cursor = 7 * 60; // minutes from midnight

    for (let i = 0; i < TASKS_PER_DAY; i++) {
      const duration = [15, 30, 45, 60, 90][Math.floor(Math.random() * 5)];
      const hh = String(Math.floor(cursor / 60)).padStart(2, '0');
      const mm = String(cursor % 60).padStart(2, '0');
      const tag = pick(TAGS);
      const title = `${pick(TITLES)} ${pick(SUBJECTS)} ${tag}`;
      const completed = dayOffset < 0 && Math.random() > 0.2;

      tasks.push({
        id: uid(),
        title,
        date,
        startTime: `${hh}:${mm}`,
        duration,
        completed,
        completedAt: completed ? date : undefined,
        priority: Math.floor(Math.random() * 4),
        color: pick(COLORS),
        notes: '',
        subtasks: [],
        lastModified: now,
      });

      cursor += duration + (Math.random() > 0.7 ? 15 : 0); // occasional gap
      if (cursor >= 22 * 60) break; // stop at 22:00
    }
  }

  // Inbox (unscheduled) tasks
  const unscheduled = [];
  for (let i = 0; i < INBOX_COUNT; i++) {
    const tag = pick(TAGS);
    unscheduled.push({
      id: uid(),
      title: `${pick(TITLES)} ${pick(SUBJECTS)} ${tag}`,
      date: null,
      startTime: '00:00',
      duration: [15, 30, 45, 60][Math.floor(Math.random() * 4)],
      completed: false,
      priority: Math.floor(Math.random() * 4),
      color: pick(COLORS),
      notes: '',
      subtasks: [],
      lastModified: now,
    });
  }

  // Merge with any existing tasks so we don't wipe real data
  const existingTasks = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]');
  const existingUnscheduled = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]');

  localStorage.setItem('day-planner-tasks', JSON.stringify([...existingTasks, ...tasks]));
  localStorage.setItem('day-planner-unscheduled', JSON.stringify([...existingUnscheduled, ...unscheduled]));

  console.log(
    `[stress-inject] Injected ${tasks.length} scheduled tasks across ${DAYS_BACK + DAYS_FORWARD + 1} days` +
    ` and ${unscheduled.length} inbox tasks. Refresh to see them.`
  );
  console.log('[stress-inject] To clean up: run clearStressData() then refresh.');

  window.clearStressData = () => {
    const cleanTasks = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]')
      .filter((t) => !t.id.startsWith('stress-'));
    const cleanUnscheduled = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]')
      .filter((t) => !t.id.startsWith('stress-'));
    localStorage.setItem('day-planner-tasks', JSON.stringify(cleanTasks));
    localStorage.setItem('day-planner-unscheduled', JSON.stringify(cleanUnscheduled));
    console.log('[stress-inject] Stress data cleared. Refresh to see changes.');
  };
})();
