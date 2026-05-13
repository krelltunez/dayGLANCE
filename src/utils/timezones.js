export const COMMON_TIMEZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Halifax',
  'America/Sao_Paulo',
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Pacific/Fiji',
];

const TZ_FRIENDLY = {
  'Pacific/Honolulu':    'Hawaii',
  'America/Anchorage':   'Alaska',
  'America/Los_Angeles': 'Pacific',
  'America/Denver':      'Mountain',
  'America/Phoenix':     'Arizona (no DST)',
  'America/Chicago':     'Central',
  'America/New_York':    'Eastern',
  'America/Toronto':     'Eastern (Canada)',
};

export function getTzLabel(tz) {
  const display = tz.replace(/_/g, ' ');
  const friendly = TZ_FRIENDLY[tz];
  return friendly ? `${display} — ${friendly}` : display;
}

export function getTzOptions(homeTimezone) {
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const base = [...COMMON_TIMEZONES];
  if (!base.includes(deviceTz)) base.unshift(deviceTz);
  if (homeTimezone && !base.includes(homeTimezone)) base.unshift(homeTimezone);
  return base;
}
