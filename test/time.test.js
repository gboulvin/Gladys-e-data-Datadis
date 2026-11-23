import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUR_MS,
  addDays,
  addMonths,
  hourlyReadingStart,
  localDate,
  localToUtc,
  maxPowerInstant,
} from '../src/time.js';

test('localToUtc follows the Madrid offset, winter and summer', () => {
  assert.equal(new Date(localToUtc(2026, 1, 15, 10)).toISOString(), '2026-01-15T09:00:00.000Z');
  assert.equal(new Date(localToUtc(2026, 7, 15, 10)).toISOString(), '2026-07-15T08:00:00.000Z');
});

test('hourly readings: hour 1 starts at the local midnight', () => {
  assert.equal(
    new Date(hourlyReadingStart('2026/11/20', '01:00')).toISOString(),
    '2026-11-19T23:00:00.000Z',
  );
  assert.equal(hourlyReadingStart('2026/11/20', '00:00'), null);
  assert.equal(hourlyReadingStart('nope', '01:00'), null);
});

test('the 25-hour autumn DST day maps to 25 distinct instants', () => {
  const starts = new Set();
  for (let hour = 1; hour <= 25; hour += 1) {
    starts.add(hourlyReadingStart('2026/10/25', `${String(hour).padStart(2, '0')}:00`));
  }
  assert.equal(starts.size, 25);
  const last = hourlyReadingStart('2026/10/25', '25:00');
  assert.equal(localDate(last), '2026-10-25');
  assert.equal(localDate(last + HOUR_MS), '2026-10-26');
});

test('the 23-hour spring DST day ends at the next local midnight', () => {
  const last = hourlyReadingStart('2026/03/29', '23:00');
  assert.equal(last + HOUR_MS, localToUtc(2026, 3, 30));
});

test('maximeter instants are local times', () => {
  assert.equal(
    new Date(maxPowerInstant('2026/11/05', '20:15')).toISOString(),
    '2026-11-05T19:15:00.000Z',
  );
});

test('month and day arithmetic', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
