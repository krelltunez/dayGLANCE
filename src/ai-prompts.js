// AI Prompt templates for each feature

export function voiceParseSystemPrompt(context) {
  const { todayDate, existingTags, timezone } = context;
  return `You are a task parser for a day planner app. The user will give you a voice transcript (natural language) describing one or more tasks they want to add.

Parse the transcript into structured task(s) as a JSON array. Each task object should have:
- "title": string — concise task title (imperative/action-oriented)
- "tags": string[] — relevant tags. Reuse from the user's existing tags when possible: [${existingTags.map(t => `"${t}"`).join(', ')}]. Only create new tags if none fit. Tags should be lowercase, no # prefix.
- "date": string|null — ISO date "YYYY-MM-DD" if mentioned, null for inbox. Today is ${todayDate}. Interpret "tomorrow", "next Monday", etc. relative to today.
- "time": string|null — "HH:MM" (24h) if a specific time is mentioned, null otherwise
- "duration": number — estimated minutes (default 30 if not specified)
- "priority": number — 0 (none), 1 (low), 2 (medium), 3 (high). Infer from urgency words like "urgent", "important", "ASAP" → 3, "soon" → 2, etc. Default 0.
- "deadline": string|null — ISO date if a deadline/due date is mentioned (distinct from scheduled date)
- "notes": string — any extra context from the transcript that doesn't fit other fields, or empty string

${timezone ? `The user's timezone is ${timezone}.` : ''}

Rules:
- If the transcript mentions multiple tasks, return multiple objects in the array
- Be smart about splitting: "call mom and pick up groceries" = 2 tasks
- But "buy milk and eggs" = 1 task (single errand)
- Infer reasonable tags from context (e.g. "gym" → "fitness", "meeting with boss" → "work")
- If no date/time is specified, leave them null (task goes to inbox)
- Keep titles concise but descriptive
- Return ONLY the JSON array, no other text`;
}

export function voiceParseUserPrompt(transcript) {
  return `Parse this voice transcript into tasks:\n\n"${transcript}"`;
}

// --- Phase 2: Morning dayGLANCE ---

export function morningSummarySystemPrompt() {
  return `You are a friendly daily planner assistant. Generate a concise, warm morning briefing based on the user's schedule data. Write in second person ("You have...").

Rules:
- Keep it to 2-4 short sentences
- Lead with the most important thing (deadlines, high-priority tasks, heavy/light day)
- Mention the number of tasks and approximate time commitment
- If there are deadlines today or upcoming, highlight them
- If the day is light, note the free time positively
- If there are overdue/incomplete tasks from yesterday, mention them gently
- If there are inbox items, suggest scheduling them
- End with a brief encouraging note — not cheesy, just natural
- Do NOT use markdown, bullet points, or formatting — plain text only
- Do NOT use emojis`;
}

export function morningSummaryUserPrompt(data) {
  const { todayDate, dayOfWeek, scheduledTasks, recurringTasks, inboxCount, overdueTasks, deadlinesToday, upcomingDeadlines, totalMinutes } = data;
  const lines = [`Today is ${dayOfWeek}, ${todayDate}.`];

  if (scheduledTasks.length > 0) {
    lines.push(`Scheduled tasks (${scheduledTasks.length}): ${scheduledTasks.map(t => {
      let s = t.title;
      if (t.time) s += ` at ${t.time}`;
      if (t.priority === 3) s += ' [HIGH PRIORITY]';
      return s;
    }).join('; ')}.`);
  } else {
    lines.push('No tasks scheduled for today.');
  }

  if (recurringTasks.length > 0) {
    lines.push(`Recurring tasks today (${recurringTasks.length}): ${recurringTasks.map(t => t.title + (t.time ? ` at ${t.time}` : '')).join('; ')}.`);
  }

  lines.push(`Total planned time: ${Math.round(totalMinutes / 60 * 10) / 10} hours (${totalMinutes} min).`);

  if (deadlinesToday.length > 0) {
    lines.push(`DEADLINES TODAY: ${deadlinesToday.map(t => t.title).join(', ')}.`);
  }

  if (upcomingDeadlines.length > 0) {
    lines.push(`Upcoming deadlines this week: ${upcomingDeadlines.map(t => `${t.title} (${t.deadline})`).join('; ')}.`);
  }

  if (overdueTasks.length > 0) {
    lines.push(`Overdue from previous days: ${overdueTasks.map(t => t.title).join(', ')}.`);
  }

  if (inboxCount > 0) {
    lines.push(`${inboxCount} unscheduled task${inboxCount === 1 ? '' : 's'} in inbox.`);
  }

  return lines.join('\n');
}

// --- Phase 3: Enhanced Weekly dayGLANCE ---

export function weeklySummarySystemPrompt() {
  return `You are a friendly productivity coach reviewing a user's week in a day planner app. Generate a concise, insightful weekly summary based on the stats provided.

Rules:
- Write 3-5 short sentences of natural-language analysis
- Comment on the completion rate — celebrate if high, encourage if low
- If there's a clear best day or pattern, mention it
- If recurring tasks have low completion, note which ones gently
- If there are many incomplete tasks, suggest prioritizing or breaking them down
- Mention any notable tag patterns if data is available
- End with a brief forward-looking note for next week
- Do NOT use markdown, bullet points, headers, or formatting — plain text only
- Do NOT use emojis
- Be warm and constructive, never critical`;
}

export function weeklySummaryUserPrompt(data) {
  const { dateRange, tasksCompleted, tasksScheduled, completionRate, timeSpent, timePlanned, focusMinutes,
    recurringCompleted, recurringScheduled, bestDay, bestDayCount,
    incompleteCount, tagBreakdown, inboxCount } = data;

  const lines = [`Week: ${dateRange}.`];
  lines.push(`Tasks completed: ${tasksCompleted} of ${tasksScheduled} (${completionRate}% completion rate).`);
  lines.push(`Time spent: ${timeSpent} min of ${timePlanned} min planned.`);

  if (focusMinutes > 0) {
    lines.push(`Focus time: ${focusMinutes} min.`);
  }

  lines.push(`Recurring tasks: ${recurringCompleted} of ${recurringScheduled} completed.`);

  if (bestDay) {
    lines.push(`Best day: ${bestDay} with ${bestDayCount} tasks completed.`);
  }

  if (incompleteCount > 0) {
    lines.push(`${incompleteCount} tasks were left incomplete.`);
  }

  if (tagBreakdown && tagBreakdown.length > 0) {
    lines.push(`Tag breakdown: ${tagBreakdown.map(t => `#${t.tag}: ${t.completed}/${t.total}`).join(', ')}.`);
  }

  if (inboxCount > 0) {
    lines.push(`${inboxCount} tasks currently in inbox.`);
  }

  return lines.join('\n');
}
