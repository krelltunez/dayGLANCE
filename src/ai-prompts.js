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
