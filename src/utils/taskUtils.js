// Format a Date object as a YYYY-MM-DD string in local time.
// Defined here (not inline in App.jsx) so that useState initialisers that
// run before any in-component helpers can use it via import.
export const dateToString = (date) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Alias used by top-level useState initialisers (same implementation).
export const localDateStr = dateToString;

// Extract #hashtags from a task title (tags must start with a letter).
export const extractTags = (title) => {
  const matches = title.match(/#([a-zA-Z]\w*)/g);
  return matches ? matches.map(tag => tag.slice(1).toLowerCase()) : [];
};

// Extract all [[wikilink]] note names from a title string.
export const extractWikilinks = (title) => {
  const matches = [...title.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];
  return matches.map(m => m[1]);
};

// Strip [[wikilinks]] — hashtags stay visible in the UI.
export const stripWikilinks = (title) =>
  title.replace(/\[\[[^\]]+\]\]/g, '').replace(/\s+/g, ' ').trim();

// Human-readable label for a recurrence rule object.
export const getRecurrenceLabel = (rec) => {
  if (!rec) return 'None';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th'];

  let label = 'Custom';
  if (rec.type === 'daily') label = 'Every day';
  else if (rec.type === 'weekly') {
    const days = rec.daysOfWeek && rec.daysOfWeek.length > 0
      ? rec.daysOfWeek.sort((a, b) => a - b).map(d => dayNames[d]).join(', ')
      : dayNames[new Date(rec.startDate + 'T12:00:00').getDay()];
    label = `Weekly on ${days}`;
  }
  else if (rec.type === 'biweekly') {
    const days = rec.daysOfWeek && rec.daysOfWeek.length > 0
      ? rec.daysOfWeek.sort((a, b) => a - b).map(d => dayNames[d]).join(', ')
      : dayNames[new Date(rec.startDate + 'T12:00:00').getDay()];
    label = `Every 2 weeks on ${days}`;
  }
  else if (rec.type === 'monthly') {
    if (rec.monthWeekday) {
      label = `Monthly on the ${ordinals[rec.monthWeekday.week]} ${fullDayNames[rec.monthWeekday.day]}`;
    } else {
      const d = rec.monthDay || new Date(rec.startDate + 'T12:00:00').getDate();
      const suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th';
      label = `Monthly on the ${d}${suffix}`;
    }
  }
  else if (rec.type === 'yearly') {
    const sd = new Date(rec.startDate + 'T12:00:00');
    label = `Yearly on ${monthNames[sd.getMonth()]} ${sd.getDate()}`;
  }

  if (rec.endDate) {
    const ed = new Date(rec.endDate + 'T12:00:00');
    label += ` until ${monthNames[ed.getMonth()].slice(0, 3)} ${ed.getDate()}`;
  } else if (rec.maxOccurrences) {
    label += ` (${rec.maxOccurrences} times)`;
  }
  return label;
};

// Format a Date object as "Monday, Jan 5".
export const formatDate = (date) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
};

// Format an array of Date objects as a human-readable range string.
export const formatDateRange = (dates) => {
  if (dates.length === 1) {
    return formatDate(dates[0]);
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const first = dates[0];
  const last = dates[dates.length - 1];

  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return `${months[first.getMonth()]} ${first.getDate()} - ${last.getDate()}, ${first.getFullYear()}`;
  } else if (first.getFullYear() === last.getFullYear()) {
    return `${months[first.getMonth()]} ${first.getDate()} - ${months[last.getMonth()]} ${last.getDate()}, ${first.getFullYear()}`;
  } else {
    return `${months[first.getMonth()]} ${first.getDate()}, ${first.getFullYear()} - ${months[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;
  }
};

// Format a Date object as "Mon, Jan 5" (abbreviated day name).
export const formatShortDate = (date) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
};

// Format a deadline YYYY-MM-DD string as "Today", "Tomorrow", or "Jan 5".
export const formatDeadlineDate = (deadline) => {
  if (!deadline) return null;
  const todayStr = dateToString(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = dateToString(tomorrow);

  if (deadline === todayStr) return 'Today';
  if (deadline === tomorrowStr) return 'Tomorrow';

  const date = new Date(deadline + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
