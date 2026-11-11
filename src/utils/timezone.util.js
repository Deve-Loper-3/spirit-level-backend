/**
 * Facility-local date/time helpers shared by schedule and cafe order services.
 * Keep these free of domain imports so cafe code does not load schedule.service.
 */

const localDateTimeToUtc = (dateStr, timeStr, timeZone = 'Asia/Dubai') => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(utcGuess);
  const getPart = (type) => parts.find((p) => p.type === type)?.value;

  const targetYear = parseInt(getPart('year'), 10);
  const targetMonth = parseInt(getPart('month'), 10);
  const targetDay = parseInt(getPart('day'), 10);
  let targetHour = parseInt(getPart('hour'), 10);
  if (targetHour === 24) targetHour = 0;
  const targetMinute = parseInt(getPart('minute'), 10);

  const formattedAsUtc = Date.UTC(
    targetYear,
    targetMonth - 1,
    targetDay,
    targetHour,
    targetMinute,
    0,
  );
  const offsetMs = formattedAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offsetMs);
};

const getTodayInTimezone = (timeZone = 'Asia/Dubai') => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
};

// The facility-local calendar date ('YYYY-MM-DD') of any instant.
const getDateInTimezone = (date, timeZone = 'Asia/Dubai') =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const addDaysToDateStr = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().substring(0, 10);
};

const getIsoDayOfWeek = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  return day === 0 ? 7 : day;
};

module.exports = {
  localDateTimeToUtc,
  getTodayInTimezone,
  getDateInTimezone,
  addDaysToDateStr,
  getIsoDayOfWeek,
};
