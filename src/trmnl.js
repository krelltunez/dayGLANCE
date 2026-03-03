/**
 * TRMNL e-ink dashboard integration for dayGLANCE.
 *
 * Gathers the current day's planner data and pushes it to a TRMNL
 * private-plugin webhook so it can be rendered on an 800×480 e-ink display.
 *
 * TRMNL docs: https://docs.usetrmnl.com/go/private-plugins/webhooks
 */

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/** Format minutes as "Xh Ym" or "Ym" */
const fmtDuration = (mins) => {
  if (!mins || mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
};

/** Format "HH:MM" 24-h string into display time */
const fmtTime = (t, use24h) => {
  if (!t) return '';
  const [hh, mm] = t.split(':').map(Number);
  if (use24h) return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
};

/** Priority label */
const priorityLabel = (p) => ['', 'Low', 'Med', 'High'][p] || '';

/** Convert "HH:MM" to total minutes since midnight */
const toMinutes = (t) => {
  if (!t) return -1;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// ---------------------------------------------------------------------------
// Gather planner data for TRMNL
// ---------------------------------------------------------------------------

/**
 * Collect a snapshot of today's planner data suitable for TRMNL merge variables.
 *
 * @param {Object} opts
 * @param {Array}  opts.tasks          - Scheduled tasks array
 * @param {Array}  opts.unscheduledTasks - Inbox tasks array
 * @param {string} opts.selectedDate   - "YYYY-MM-DD"
 * @param {boolean} opts.use24HourClock
 * @param {Array}  opts.habits         - Habit definitions
 * @param {Object} opts.habitLogs      - { "YYYY-MM-DD": { habitId: count } }
 * @param {string} opts.weatherSummary - (unused, kept for backward compat)
 * @param {Object} opts.dailyNotes     - { "YYYY-MM-DD": { text } }
 * @param {Array}  opts.todayRoutines  - Today's routine chips
 * @param {boolean} opts.routinesEnabled - Whether routines feature is on
 * @returns {Object} merge_variables payload (kept under 2 KB for free-tier)
 */
export function gatherTrmnlData({
  tasks = [],
  unscheduledTasks = [],
  selectedDate,
  use24HourClock = false,
  habits = [],
  habitLogs = {},
  weatherSummary = '',
  dailyNotes = {},
  todayRoutines = [],
  routinesEnabled = false,
}) {
  const today = selectedDate || new Date().toISOString().slice(0, 10);
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Today's scheduled tasks, sorted by start time
  const todayTasks = tasks
    .filter((t) => t.date === today)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  // Build compact task list (keep payload small)
  // Add `past` flag for calendar events whose time has passed
  const schedule = todayTasks.map((t) => {
    const isEvent = !!(t.imported && !t.isTaskCalendar);
    const startMins = toMinutes(t.startTime);
    const endMins = startMins >= 0 ? startMins + (t.duration || 0) : -1;
    return {
      time: fmtTime(t.startTime, use24HourClock),
      dur: fmtDuration(t.duration),
      title: (t.title || '').slice(0, 40),
      done: !!t.completed,
      pri: priorityLabel(t.priority),
      allDay: !!t.allDay,
      past: isEvent && !t.allDay && startMins >= 0 && endMins <= nowMins,
    };
  });

  // Stats — only count app tasks and task calendar items (not calendar events)
  const countable = todayTasks.filter((t) => !(t.imported && !t.isTaskCalendar));
  const total = countable.length;
  const completed = countable.filter((t) => t.completed).length;
  const overdue = countable.filter(
    (t) => !t.completed && t.startTime && t.startTime < currentTime && !t.allDay
  ).length;
  const totalMinutes = countable.reduce((s, t) => s + (t.duration || 0), 0);

  // Upcoming (next 3 uncompleted tasks from now)
  const upcoming = todayTasks
    .filter((t) => !t.completed && t.startTime && t.startTime >= currentTime && !t.allDay)
    .slice(0, 3)
    .map((t) => ({
      time: fmtTime(t.startTime, use24HourClock),
      title: (t.title || '').slice(0, 32),
    }));

  // Next task
  const nextTask = upcoming[0] || null;

  // Inbox count
  const inboxCount = unscheduledTasks.filter((t) => !t.completed).length;

  // Habits summary
  const todayLogs = habitLogs[today] || {};
  const habitItems = habits.slice(0, 5).map((h) => {
    const count = todayLogs[h.id] || 0;
    const target = h.target || 1;
    return {
      name: (h.name || '').slice(0, 20),
      count,
      target,
      pct: Math.min(100, Math.round((count / target) * 100)),
    };
  });

  // Daily note snippet
  const noteSnippet = (dailyNotes[today]?.text || '').slice(0, 80);

  // Routines — today's scheduled routine chips with time slots
  // Hide routines whose end time has already passed
  const routineItems = routinesEnabled
    ? todayRoutines
        .filter((r) => {
          if (String(r.id).startsWith('example-')) return false;
          if (r.isAllDay) return true;
          const rStart = toMinutes(r.startTime);
          if (rStart < 0) return true;
          const rEnd = rStart + (r.duration || 0);
          return rEnd > nowMins;
        })
        .sort((a, b) => {
          // All-day routines first, then by startTime
          if (a.isAllDay && !b.isAllDay) return -1;
          if (!a.isAllDay && b.isAllDay) return 1;
          return (a.startTime || '').localeCompare(b.startTime || '');
        })
        .slice(0, 8)
        .map((r) => ({
          name: (r.name || '').slice(0, 30),
          time: r.isAllDay ? 'All day' : fmtTime(r.startTime, use24HourClock),
          dur: r.isAllDay ? '' : fmtDuration(r.duration),
        }))
    : [];

  // Friendly date
  const dateObj = new Date(today + 'T12:00:00');
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const dateLabel = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return {
    date: today,
    day_name: dayName,
    date_label: dateLabel,
    current_time: fmtTime(currentTime, use24HourClock),
    weather: '',
    schedule,
    total,
    completed,
    overdue,
    pct: total > 0 ? Math.round((completed / total) * 100) : 0,
    time_planned: fmtDuration(totalMinutes),
    upcoming,
    next_task: nextTask,
    inbox_count: inboxCount,
    habits: habitItems,
    routines: routineItems,
    note: noteSnippet,
  };
}

// ---------------------------------------------------------------------------
// Push data to TRMNL webhook
// ---------------------------------------------------------------------------

/**
 * Send merge_variables to a TRMNL private-plugin webhook.
 *
 * @param {Object} config
 * @param {string} config.webhookUrl - Full TRMNL webhook URL
 * @param {string} [config.apiKey]   - Optional Bearer token
 * @param {Object} mergeVars         - The merge_variables payload
 * @returns {{ success: boolean, error?: string }}
 */
export async function pushToTrmnl({ webhookUrl, apiKey }, mergeVars) {
  if (!webhookUrl) return { success: false, error: 'No webhook URL configured' };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ merge_variables: mergeVars }),
    });

    if (res.status === 429) return { success: false, error: 'Rate limited — try again later', rateLimited: true };
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Network error' };
  }
}

// ---------------------------------------------------------------------------
// TRMNL markup templates
// ---------------------------------------------------------------------------
// These are pasted by the user into their TRMNL private-plugin Markup Editor.
// They use Liquid {{ variable }} syntax and TRMNL Design System classes.
// ---------------------------------------------------------------------------

export const TRMNL_MARKUP_FULL = `<div class="layout layout--col">
  <div class="columns" style="flex:1">
    <div class="column" style="flex:2">
      <div class="gap--small">
        {% for t in schedule %}
        <div class="item">
          <div class="meta"><span class="index">{% if t.done %}✓{% else %}{{ forloop.index }}{% endif %}</span></div>
          <div class="content">
            <span class="title title--small"{% if t.done or t.past %} style="text-decoration:line-through;opacity:.5"{% endif %}>{{ t.title }}</span>
            <span class="label"{% if t.done or t.past %} style="text-decoration:line-through;opacity:.5"{% endif %}>{% if t.allDay %}All day{% else %}{{ t.time }} · {{ t.dur }}{% endif %}{% if t.pri != blank %} · {{ t.pri }}{% endif %}</span>
          </div>
        </div>
        {% endfor %}
        {% if schedule.size == 0 %}
        <span class="description">No tasks scheduled</span>
        {% endif %}
      </div>

      {% if routines.size > 0 %}
      <div style="margin-top:12px">
        <span class="label label--gray">ROUTINES</span>
        {% for r in routines %}
        <div style="border-top:1px solid #ccc;margin:4px 0"></div>
        <span class="description">{{ r.time }}{% if r.dur != blank %} · {{ r.dur }}{% endif %} {{ r.name }}</span>
        {% endfor %}
      </div>
      {% endif %}
    </div>

    <div class="column" style="flex:1;display:flex;flex-direction:column">
      <span class="title title--small">{{ day_name }}, {{ date_label }}</span>

      <span class="value" style="margin-top:8px">{{ pct }}%</span>
      <span class="label">{{ completed }}/{{ total }} done</span>
      {% if overdue > 0 %}<span class="label" style="font-weight:bold">{{ overdue }} overdue</span>{% endif %}
      <span class="label label--gray">{{ time_planned }} planned</span>
      {% if inbox_count > 0 %}<span class="label label--gray">{{ inbox_count }} tasks in inbox</span>{% endif %}

      {% if next_task %}
      <div style="margin-top:12px">
        <span class="label label--gray">UP NEXT</span>
        <span class="title title--small">{{ next_task.title }}</span>
        <span class="label">{{ next_task.time }}</span>
      </div>
      {% endif %}

      {% if habits.size > 0 %}
      <div style="margin-top:12px">
        <span class="label label--gray">HABITS</span>
        {% for h in habits %}
        <span class="description">{{ h.name }}: {{ h.count }}/{{ h.target }}</span>
        {% endfor %}
      </div>
      {% endif %}

      <div style="margin-top:auto">
        <div class="title_bar"><span class="title_bar__title">dayGLANCE</span></div>
      </div>
    </div>
  </div>
</div>`;

export const TRMNL_MARKUP_HALF_HORIZONTAL = `<div class="layout layout--col">
  <div style="display:flex;justify-content:space-between;align-items:baseline">
    <span class="title title--small">{{ day_name }}, {{ date_label }}</span>
    <span class="label" style="white-space:nowrap">| {{ completed }}/{{ total }} · {{ pct }}%</span>
  </div>
  <div style="border-top:1px solid #ccc;margin:4px 0"></div>
  <div class="gap--small">
    {% for t in schedule limit:4 %}
    <div class="item">
      <div class="meta"><span class="index">{% if t.done %}✓{% else %}{{ forloop.index }}{% endif %}</span></div>
      <div class="content">
        <span class="title title--small"{% if t.done or t.past %} style="text-decoration:line-through;opacity:.5"{% endif %}>{{ t.title }}</span>
        <span class="label"{% if t.done or t.past %} style="text-decoration:line-through;opacity:.5"{% endif %}>{% if t.allDay %}All day{% else %}{{ t.time }}{% endif %}</span>
      </div>
    </div>
    {% endfor %}
    {% if schedule.size == 0 %}<span class="description">No tasks scheduled</span>{% endif %}
  </div>
  <div class="title_bar"><span class="title_bar__title">dayGLANCE</span></div>
</div>`;

export const TRMNL_MARKUP_HALF_VERTICAL = `<div class="layout layout--col">
  <span class="title title--small">{{ day_name }}</span>
  <span class="label">{{ date_label }}</span>
  <span class="value" style="margin:4px 0">{{ pct }}%</span>
  <span class="label">{{ completed }}/{{ total }} done</span>
  {% if overdue > 0 %}<span class="label" style="font-weight:bold">{{ overdue }} overdue</span>{% endif %}
  {% if next_task %}
  <div style="margin-top:8px">
    <span class="label label--gray">NEXT</span>
    <span class="description">{{ next_task.time }} {{ next_task.title }}</span>
  </div>
  {% endif %}
  <div class="title_bar"><span class="title_bar__title">dayGLANCE</span></div>
</div>`;

export const TRMNL_MARKUP_QUADRANT = `<div class="layout layout--col layout--center">
  <span class="value">{{ pct }}%</span>
  <span class="label">{{ completed }}/{{ total }}</span>
  {% if next_task %}<span class="description" style="margin-top:4px">{{ next_task.time }} {{ next_task.title }}</span>{% endif %}
  <div class="title_bar"><span class="title_bar__title">dayGLANCE</span></div>
</div>`;
