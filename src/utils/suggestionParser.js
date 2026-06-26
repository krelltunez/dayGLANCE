// Suggestion parser — pure functions for parsing time/tag/date/priority/duration
// shorthand syntax from task input text.  No React state dependencies.

// ---------------------------------------------------------------------------
// Tag suggestions (#tag)
// ---------------------------------------------------------------------------

export const getPartialTag = (text, cursorPos) => {
  let startIndex = cursorPos - 1;
  while (startIndex >= 0) {
    const char = text[startIndex];
    if (char === '#') {
      const partial = text.slice(startIndex + 1, cursorPos);
      if (partial === '' || /^[a-zA-Z]\w*$/.test(partial)) {
        return { tag: partial.toLowerCase(), startIndex };
      }
      return null;
    }
    if (!/\w/.test(char)) return null;
    startIndex--;
  }
  return null;
};

export const getFilteredTags = (partial, allTagsList) => {
  if (!partial && partial !== '') return [];
  const lowerPartial = partial.toLowerCase();
  return allTagsList.filter(tag => tag.toLowerCase().startsWith(lowerPartial)).sort();
};

export const applyTagCompletion = (text, cursorPos, selectedTag) => {
  const partialInfo = getPartialTag(text, cursorPos);
  if (!partialInfo) return { text, newCursorPos: cursorPos };
  const before = text.slice(0, partialInfo.startIndex);
  const after = text.slice(cursorPos);
  const completedTag = `#${selectedTag}`;
  const newText = before + completedTag + after;
  const newCursorPos = before.length + completedTag.length;
  return { text: newText, newCursorPos };
};

// ---------------------------------------------------------------------------
// Trigger-character partial extractors (@date, ~time, $deadline, !priority, %duration)
// ---------------------------------------------------------------------------

export const getPartialDate = (text, cursorPos) => {
  let startIndex = cursorPos - 1;
  while (startIndex >= 0) {
    const char = text[startIndex];
    if (char === '@') {
      const partial = text.slice(startIndex + 1, cursorPos);
      if (partial.length >= 1 && /^[\w\s/\-,]*$/.test(partial)) {
        return { partial, startIndex };
      }
      return null;
    }
    if (/[#~!$%]/.test(char)) return null;
    startIndex--;
  }
  return null;
};

export const getPartialTime = (text, cursorPos) => {
  let startIndex = cursorPos - 1;
  while (startIndex >= 0) {
    const char = text[startIndex];
    if (char === '~') {
      const partial = text.slice(startIndex + 1, cursorPos);
      if (partial.length >= 1 && /^[\w\s:]*$/.test(partial)) {
        return { partial, startIndex };
      }
      return null;
    }
    if (/[#@!$%]/.test(char)) return null;
    startIndex--;
  }
  return null;
};

export const getPartialDeadline = (text, cursorPos) => {
  let startIndex = cursorPos - 1;
  while (startIndex >= 0) {
    const char = text[startIndex];
    if (char === '$') {
      const partial = text.slice(startIndex + 1, cursorPos);
      if (partial.length >= 1 && /^[\w\s/\-,]*$/.test(partial)) {
        return { partial, startIndex };
      }
      return null;
    }
    if (/[#@~!%]/.test(char)) return null;
    startIndex--;
  }
  return null;
};

export const getPartialPriority = (text, cursorPos) => {
  let endIndex = cursorPos;
  let startIndex = cursorPos - 1;
  let count = 0;
  while (startIndex >= 0 && text[startIndex] === '!') {
    count++;
    startIndex--;
  }
  if (count === 0) return null;
  if (startIndex >= 0 && !/\s/.test(text[startIndex])) return null;
  const priority = Math.min(count, 3);
  return { count: priority, startIndex: startIndex + 1, endIndex };
};

export const getPartialDuration = (text, cursorPos) => {
  let startIndex = cursorPos - 1;
  while (startIndex >= 0) {
    const char = text[startIndex];
    if (char === '%') {
      const partial = text.slice(startIndex + 1, cursorPos);
      if (/^\d*$/.test(partial)) {
        return { partial, startIndex, endIndex: cursorPos };
      }
      return null;
    }
    if (!/\d/.test(char)) return null;
    startIndex--;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Date candidates (@)
// ---------------------------------------------------------------------------

export const getDateCandidates = (partial) => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const currentYear = today.getFullYear();
  const lowerPartial = partial.toLowerCase().trim();
  if (!lowerPartial) return [];

  const candidates = [];

  const naturalDates = [
    { keywords: ['today', 'tod'], getDate: () => today, display: 'Today', keyword: 'today' },
    { keywords: ['tomorrow', 'tom'], getDate: () => { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }, display: 'Tomorrow', keyword: 'tomorrow' },
    { keywords: ['yesterday'], getDate: () => { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }, display: 'Yesterday', keyword: 'yesterday' },
  ];
  for (const nd of naturalDates) {
    if (nd.keywords.some(k => k.startsWith(lowerPartial) || lowerPartial === k)) {
      candidates.push({ date: nd.getDate(), display: nd.display, keyword: nd.keyword });
    }
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayAbbrevs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  for (let i = 0; i < dayNames.length; i++) {
    if (dayNames[i].startsWith(lowerPartial) || dayAbbrevs[i] === lowerPartial) {
      const targetDate = new Date(today);
      const currentDay = today.getDay();
      let daysToAdd = i - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      targetDate.setDate(targetDate.getDate() + daysToAdd);
      candidates.push({ date: targetDate, display: dayNames[i].charAt(0).toUpperCase() + dayNames[i].slice(1), keyword: dayNames[i] });
    }
  }

  if ('next week'.startsWith(lowerPartial) || lowerPartial === 'next week') {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    candidates.push({ date: nextWeek, display: 'Next week', keyword: 'next week' });
  }

  const nextDayMatch = lowerPartial.match(/^next\s+(\w+)$/);
  if (nextDayMatch) {
    const dayName = nextDayMatch[1];
    for (let i = 0; i < dayNames.length; i++) {
      if (dayNames[i].startsWith(dayName) || dayAbbrevs[i] === dayName) {
        const targetDate = new Date(today);
        const currentDay = today.getDay();
        let daysToAdd = i - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7;
        targetDate.setDate(targetDate.getDate() + daysToAdd);
        candidates.push({ date: targetDate, display: `Next ${dayNames[i].charAt(0).toUpperCase() + dayNames[i].slice(1)}`, keyword: `next ${dayNames[i]}` });
      }
    }
  }

  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthAbbrevs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  const monthDayMatch = lowerPartial.match(/^(\w+)\s+(\d{1,2})(?:[,\s]+(\d{4}))?$/);
  if (monthDayMatch) {
    const [, monthStr, dayStr, yearStr] = monthDayMatch;
    let monthIdx = monthNames.findIndex(m => m.startsWith(monthStr));
    if (monthIdx === -1) monthIdx = monthAbbrevs.findIndex(m => m === monthStr);
    if (monthIdx !== -1) {
      const day = parseInt(dayStr, 10);
      const year = yearStr ? parseInt(yearStr, 10) : currentYear;
      if (day >= 1 && day <= 31) {
        const targetDate = new Date(year, monthIdx, day, 12, 0, 0);
        if (!isNaN(targetDate.getTime())) {
          candidates.push({ date: targetDate, display: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
        }
      }
    }
  }

  const dashMatch = partial.match(/^(\d{1,2})-(\d{1,2})(?:-(\d{4}))?$/);
  if (dashMatch) {
    const [, monthStr, dayStr, yearStr] = dashMatch;
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const year = yearStr ? parseInt(yearStr, 10) : currentYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const targetDate = new Date(year, month - 1, day, 12, 0, 0);
      if (!isNaN(targetDate.getTime())) {
        candidates.push({ date: targetDate, display: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
      }
    }
  }

  const slashMatch = partial.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (slashMatch) {
    const [, monthStr, dayStr, yearStr] = slashMatch;
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const year = yearStr ? parseInt(yearStr, 10) : currentYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const targetDate = new Date(year, month - 1, day, 12, 0, 0);
      if (!isNaN(targetDate.getTime())) {
        candidates.push({ date: targetDate, display: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
      }
    }
  }

  return candidates;
};

// Backward-compat wrapper: returns first match or null.
export const parseFlexibleDate = (partial) => {
  const candidates = getDateCandidates(partial);
  return candidates.length > 0 ? candidates[0] : null;
};

// ---------------------------------------------------------------------------
// Time candidates (~)
// ---------------------------------------------------------------------------

export const getTimeCandidates = (partial) => {
  const lowerPartial = partial.toLowerCase().trim();
  if (!lowerPartial) return [];

  const candidates = [];

  const naturalTimes = [
    { keywords: ['noon'], time: '12:00', display: '12:00 PM (Noon)', keyword: 'noon' },
    { keywords: ['midnight'], time: '00:00', display: '12:00 AM (Midnight)', keyword: 'midnight' },
    { keywords: ['morning', 'morn'], time: '09:00', display: '9:00 AM (Morning)', keyword: 'morning' },
    { keywords: ['afternoon'], time: '14:00', display: '2:00 PM (Afternoon)', keyword: 'afternoon' },
    { keywords: ['evening', 'eve'], time: '18:00', display: '6:00 PM (Evening)', keyword: 'evening' },
    { keywords: ['night'], time: '21:00', display: '9:00 PM (Night)', keyword: 'night' },
  ];
  for (const nt of naturalTimes) {
    if (nt.keywords.some(k => k.startsWith(lowerPartial) || lowerPartial === k)) {
      candidates.push({ time: nt.time, display: nt.display, keyword: nt.keyword });
    }
  }

  const bareNumberMatch = lowerPartial.match(/^(\d{1,2})$/);
  if (bareNumberMatch) {
    const num = parseInt(bareNumberMatch[1], 10);
    if (num >= 1 && num <= 12) {
      const amHour = num === 12 ? 0 : num;
      const pmHour = num === 12 ? 12 : num + 12;
      candidates.push({ time: `${amHour.toString().padStart(2, '0')}:00`, display: `${num}:00 AM`, keyword: `${num}am` });
      candidates.push({ time: `${pmHour.toString().padStart(2, '0')}:00`, display: `${num}:00 PM`, keyword: `${num}pm` });
    } else if (num >= 13 && num <= 23) {
      const displayHour = num > 12 ? num - 12 : num;
      candidates.push({ time: `${num.toString().padStart(2, '0')}:00`, display: `${displayHour}:00 PM`, keyword: `${num}:00` });
    }
  }

  const partialAmPmMatch = lowerPartial.match(/^(\d{1,2})(a|p)$/);
  if (partialAmPmMatch) {
    const num = parseInt(partialAmPmMatch[1], 10);
    const ap = partialAmPmMatch[2];
    if (num >= 1 && num <= 12) {
      if (ap === 'a') {
        const hour = num === 12 ? 0 : num;
        candidates.push({ time: `${hour.toString().padStart(2, '0')}:00`, display: `${num}:00 AM`, keyword: `${num}am` });
      } else {
        const hour = num === 12 ? 12 : num + 12;
        candidates.push({ time: `${hour.toString().padStart(2, '0')}:00`, display: `${num}:00 PM`, keyword: `${num}pm` });
      }
    }
  }

  const colonPartialMatch = lowerPartial.match(/^(\d{1,2}):(\d?)$/);
  if (colonPartialMatch) {
    const hour = parseInt(colonPartialMatch[1], 10);
    const minPartial = colonPartialMatch[2];
    if (hour >= 1 && hour <= 12) {
      const minuteOptions = ['00', '15', '30', '45'].filter(m => m.startsWith(minPartial));
      for (const min of minuteOptions) {
        const amHour = hour === 12 ? 0 : hour;
        const pmHour = hour === 12 ? 12 : hour + 12;
        candidates.push({ time: `${amHour.toString().padStart(2, '0')}:${min}`, display: `${hour}:${min} AM`, keyword: `${hour}:${min}am` });
        candidates.push({ time: `${pmHour.toString().padStart(2, '0')}:${min}`, display: `${hour}:${min} PM`, keyword: `${hour}:${min}pm` });
      }
    } else if (hour >= 13 && hour <= 23) {
      const minuteOptions = ['00', '15', '30', '45'].filter(m => m.startsWith(minPartial));
      const displayHour = hour > 12 ? hour - 12 : hour;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      for (const min of minuteOptions) {
        candidates.push({ time: `${hour.toString().padStart(2, '0')}:${min}`, display: `${displayHour}:${min} ${ampm}`, keyword: `${hour}:${min}` });
      }
    }
  }

  const militaryMatch = partial.match(/^(\d{1,2}):(\d{2})$/);
  if (militaryMatch) {
    const hours = parseInt(militaryMatch[1], 10);
    const minutes = militaryMatch[2];
    if (hours >= 0 && hours <= 23 && !candidates.some(c => c.time === `${hours.toString().padStart(2, '0')}:${minutes}`)) {
      const timeStr = `${hours.toString().padStart(2, '0')}:${minutes}`;
      const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      candidates.push({ time: timeStr, display: `${displayHour}:${minutes} ${ampm}` });
    }
  }

  const twelveHourMatch = lowerPartial.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (twelveHourMatch) {
    let hours = parseInt(twelveHourMatch[1], 10);
    const minutes = twelveHourMatch[2] || '00';
    const ampm = twelveHourMatch[3];
    if (hours >= 1 && hours <= 12 && parseInt(minutes, 10) <= 59) {
      if (ampm === 'pm' && hours !== 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      const timeStr = `${hours.toString().padStart(2, '0')}:${minutes}`;
      if (!candidates.some(c => c.time === timeStr)) {
        const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        const displayAmpm = hours >= 12 ? 'PM' : 'AM';
        candidates.push({ time: timeStr, display: `${displayHour}:${minutes} ${displayAmpm}` });
      }
    }
  }

  return candidates;
};

// Backward-compat wrapper: returns first match or null.
export const parseFlexibleTime = (partial) => {
  const candidates = getTimeCandidates(partial);
  return candidates.length > 0 ? candidates[0] : null;
};

// ---------------------------------------------------------------------------
// Title text helpers
// ---------------------------------------------------------------------------

// Replace partial shorthand text with the accepted keyword (e.g. "@to" → "@today").
export const completeShortcutText = (title, suggestion) => {
  if (!suggestion.keyword) return { text: title, cursorPos: title.length };
  const triggerChar = title[suggestion.startIndex];
  const before = title.slice(0, suggestion.startIndex);
  const after = title.slice(suggestion.endIndex);
  const completed = before + triggerChar + suggestion.keyword;
  return { text: completed + after, cursorPos: completed.length };
};

// Strip all shorthand sequences from a title before saving.
export const cleanTitle = (title) => {
  return title
    .replace(/%\d+/g, '')
    .replace(/@[\w\s/\-,]*/g, '')
    .replace(/~[\w\s:]*/g, '')
    .replace(/\$[\w\s/\-,]*/g, '')
    .replace(/!{1,3}(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Remove a detected date/time span from title text.
export const removeFromTitle = (text, startIndex, endIndex) => {
  const before = text.slice(0, startIndex);
  const after = text.slice(endIndex);
  return (before + after).replace(/\s+/g, ' ').trimStart();
};
