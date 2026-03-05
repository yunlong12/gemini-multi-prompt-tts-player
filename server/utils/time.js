const DEFAULT_TIMEZONE = process.env.APP_DEFAULT_TIMEZONE || 'Europe/Paris';

function dateParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  return parts;
}

function formatDateFromParts(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function weekdayToIndex(weekday) {
  const map = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? 0;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function timezoneOffsetMs(date, timezone) {
  const parts = dateParts(date, timezone);
  const utcEquivalent = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return utcEquivalent - date.getTime();
}

function zonedDateTimeToUtc(timezone, year, month, day, hour, minute) {
  const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = timezoneOffsetMs(approxUtc, timezone);
  return new Date(approxUtc.getTime() - offset);
}

function parseTimeOfDay(timeOfDay) {
  const [hourPart = '0', minutePart = '0'] = String(timeOfDay || '00:00').split(':');
  return {
    hour: Number(hourPart),
    minute: Number(minutePart),
  };
}

function addDaysInTimezone(date, days, timezone) {
  const shifted = new Date(date.getTime() + days * 86400000);
  const parts = dateParts(shifted, timezone);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

export function getDefaultTimezone() {
  return DEFAULT_TIMEZONE;
}

export function formatDateForTimezone(date, timezone = DEFAULT_TIMEZONE) {
  return formatDateFromParts(dateParts(date, timezone));
}

export function interpolatePromptTemplate(promptTemplate, now = new Date(), timezone = DEFAULT_TIMEZONE) {
  const today = formatDateForTimezone(now, timezone);
  const yesterday = formatDateForTimezone(new Date(now.getTime() - 86400000), timezone);

  return String(promptTemplate || '')
    .replaceAll('{{today}}', today)
    .replaceAll('{{yesterday}}', yesterday)
    .replaceAll('{{timezone}}', timezone);
}

export function computeNextRunAt(schedule, fromDate = new Date()) {
  const timezone = schedule.timezone || DEFAULT_TIMEZONE;

  if (schedule.frequency === 'custom_interval') {
    const intervalMinutes = Math.max(1, Number(schedule.intervalMinutes || 60));
    const baseDate = schedule.lastRunAt ? new Date(schedule.lastRunAt) : fromDate;
    return new Date(baseDate.getTime() + intervalMinutes * 60000).toISOString();
  }

  const localNowParts = dateParts(fromDate, timezone);
  const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
  const todayUtc = zonedDateTimeToUtc(
    timezone,
    Number(localNowParts.year),
    Number(localNowParts.month),
    Number(localNowParts.day),
    hour,
    minute
  );

  if (schedule.frequency === 'daily') {
    if (todayUtc.getTime() > fromDate.getTime()) {
      return todayUtc.toISOString();
    }

    const nextDay = addDaysInTimezone(fromDate, 1, timezone);
    return zonedDateTimeToUtc(timezone, nextDay.year, nextDay.month, nextDay.day, hour, minute).toISOString();
  }

  const daysOfWeek = Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0
    ? schedule.daysOfWeek.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6)
    : [weekdayToIndex(localNowParts.weekday)];
  const currentWeekday = weekdayToIndex(localNowParts.weekday);

  for (let delta = 0; delta <= 7; delta += 1) {
    const candidateWeekday = (currentWeekday + delta) % 7;
    if (!daysOfWeek.includes(candidateWeekday)) {
      continue;
    }

    const candidateDay = addDaysInTimezone(fromDate, delta, timezone);
    const candidateUtc = zonedDateTimeToUtc(
      timezone,
      candidateDay.year,
      candidateDay.month,
      candidateDay.day,
      hour,
      minute
    );

    if (candidateUtc.getTime() > fromDate.getTime()) {
      return candidateUtc.toISOString();
    }
  }

  const fallbackDay = addDaysInTimezone(fromDate, 7, timezone);
  return zonedDateTimeToUtc(timezone, fallbackDay.year, fallbackDay.month, fallbackDay.day, hour, minute).toISOString();
}
