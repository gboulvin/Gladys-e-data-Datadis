// -----------------------------------------------------------------------------
// Time helpers.
//
// Datadis serves the readings of Spanish meters in local peninsular time
// (Europe/Madrid): a reading is a date (`2026/11/20`) plus the hour that ENDS
// the interval (`01:00` ... `24:00`, `25:00` on the autumn DST day). Gladys
// wants UTC instants. These helpers convert between both without any
// dependency, through Intl, so the DST days (23 and 25 hours) stay right.
// -----------------------------------------------------------------------------

export const DATADIS_TIMEZONE = 'Europe/Madrid';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DATADIS_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * Local wall-clock parts of an instant in Europe/Madrid.
 * @param {number} ts - Epoch milliseconds.
 */
export function localParts(ts) {
  const parts = {};
  for (const { type, value } of formatter.formatToParts(new Date(ts))) {
    if (type !== 'literal') {
      parts[type] = Number(value);
    }
  }
  return parts;
}

// Offset of Europe/Madrid from UTC at an instant, in milliseconds.
function offsetAt(ts) {
  const p = localParts(ts);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * UTC instant of a local Europe/Madrid wall-clock time.
 */
export function localToUtc(year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/**
 * `YYYY-MM-DD` local date (Europe/Madrid) of an instant.
 */
export function localDate(ts) {
  const p = localParts(ts);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * `YYYY-MM` local month (Europe/Madrid) of an instant.
 */
export function localMonth(ts) {
  return localDate(ts).slice(0, 7);
}

/**
 * Parse a Datadis date, `YYYY/MM/DD` (or `YYYY-MM-DD`), into its numbers.
 */
export function parseDatadisDate(text) {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(String(text ?? '').trim());
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Start instant of an hourly Datadis reading. `time` is the hour ending the
 * interval (`01:00` = 00:00-01:00 local). Hours are counted from the local
 * midnight, so the 23- and 25-hour DST days map to distinct instants.
 * Resolves `null` for an unusable row (Datadis sometimes emits a stray `00:00`
 * on a day that already has its 24 hours: it is dropped, like python-edata does).
 */
export function hourlyReadingStart(date, time) {
  const day = parseDatadisDate(date);
  const hour = Number.parseInt(String(time ?? '').split(':')[0], 10);
  if (!day || !Number.isInteger(hour) || hour < 1 || hour > 25) {
    return null;
  }
  return localToUtc(day.year, day.month, day.day) + (hour - 1) * HOUR_MS;
}

/**
 * Instant of a Datadis maximeter reading (`date` + `HH:MM`, local time).
 */
export function maxPowerInstant(date, time) {
  const day = parseDatadisDate(date);
  const match = /^(\d{1,2}):(\d{2})/.exec(String(time ?? '').trim());
  if (!day || !match) {
    return null;
  }
  return (
    localToUtc(day.year, day.month, day.day) +
    Number(match[1]) * HOUR_MS +
    Number(match[2]) * 60 * 1000
  );
}

/**
 * The month `offset` months away from a `YYYY-MM` month.
 */
export function addMonths(month, offset) {
  const [year, m] = month.split('-').map(Number);
  const index = year * 12 + (m - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * `YYYY-MM` -> `YYYY/MM`, the month format of the Datadis queries.
 */
export function toDatadisMonth(month) {
  return month.replace('-', '/');
}

/**
 * The `YYYY-MM-DD` date `offset` days away from another one (calendar days).
 */
export function addDays(date, offset) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

/**
 * First instant after the end of a local `YYYY-MM` month.
 */
export function monthEndInstant(month) {
  const [year, m] = addMonths(month, 1).split('-').map(Number);
  return localToUtc(year, m, 1);
}
