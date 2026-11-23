// -----------------------------------------------------------------------------
// Figures derived from the cached readings of ONE supply: what the device
// features, the widgets, the scene triggers and the scene actions show.
// Pure functions of (entry, now): no I/O, easy to test.
// -----------------------------------------------------------------------------

import { addDays, addMonths, localDate, localMonth } from './time.js';

// A day counts as complete with 23 hours or more (the spring DST day has 23).
const COMPLETE_DAY_HOURS = 23;

const round = (value, digits = 3) =>
  value === null || value === undefined ? null : Number(value.toFixed(digits));

/**
 * Daily totals of a supply: `YYYY-MM-DD` -> { kwh, surplus_kwh, hours }.
 */
export function dailyTotals(entry) {
  const days = new Map();
  for (const [key, kwh] of Object.entries(entry.hourly)) {
    const date = localDate(Number(key));
    const day = days.get(date) ?? { kwh: 0, surplus_kwh: 0, hours: 0 };
    day.kwh += kwh;
    day.surplus_kwh += entry.surplus[key] ?? 0;
    day.hours += 1;
    days.set(date, day);
  }
  return days;
}

/** Highest contracted power of the contract (P1, P2... the max), in kW. */
export function contractedPowerKw(entry) {
  const powers = entry.contract?.contracted_power_kw ?? [];
  return powers.length > 0 ? Math.max(...powers) : null;
}

function peakBetween(entry, fromDate, toDate) {
  let peak = null;
  for (const reading of entry.max_power) {
    const date = localDate(reading.at);
    if (date >= fromDate && date <= toDate && (!peak || reading.kw > peak.kw)) {
      peak = reading;
    }
  }
  return peak;
}

/**
 * Everything the integration shows about a supply.
 */
export function summarize(entry, now) {
  const days = dailyTotals(entry);
  const dates = [...days.keys()].sort();
  const completeDates = dates.filter((date) => days.get(date).hours >= COMPLETE_DAY_HOURS);
  const lastDay = completeDates.at(-1) ?? null;

  const month = localMonth(now);
  const previousMonth = addMonths(month, -1);
  const sumMonth = (m) => {
    let total = null;
    for (const date of dates) {
      if (date.startsWith(m)) {
        total = (total ?? 0) + days.get(date).kwh;
      }
    }
    return total;
  };

  const monthPeak = peakBetween(entry, `${month}-01`, `${month}-31`);
  const contracted = contractedPowerKw(entry);

  // Last 14 days ending on the last complete day, for the widget chart.
  const recent = [];
  if (lastDay) {
    for (let i = 13; i >= 0; i -= 1) {
      const date = addDays(lastDay, -i);
      const day = days.get(date);
      if (day) {
        recent.push({ date, kwh: round(day.kwh) });
      }
    }
  }

  return {
    cups: entry.supply.cups,
    last_day: lastDay,
    last_day_kwh: lastDay ? round(days.get(lastDay).kwh) : null,
    last_day_surplus_kwh: lastDay ? round(days.get(lastDay).surplus_kwh) : null,
    last_data_date: dates.at(-1) ?? null,
    month,
    month_kwh: round(sumMonth(month)),
    previous_month: previousMonth,
    previous_month_kwh: round(sumMonth(previousMonth)),
    month_peak_kw: monthPeak ? round(monthPeak.kw) : null,
    month_peak_at: monthPeak ? monthPeak.at : null,
    contracted_power_kw: contracted,
    recent,
  };
}

/**
 * Consumption over a named period, for the `get_consumption` scene action.
 * `period`: `last_day` | `last_7_days` | `last_30_days` | `current_month` |
 * `previous_month`. Periods are anchored on the last COMPLETE day: Datadis
 * serves yesterday at best, so "today" never has data.
 */
export function periodConsumption(entry, period, now) {
  const summary = summarize(entry, now);
  const month = localMonth(now);
  let from;
  let to;
  switch (period) {
    case 'last_day':
      from = summary.last_day;
      to = summary.last_day;
      break;
    case 'last_7_days':
      to = summary.last_day;
      from = to ? addDays(to, -6) : null;
      break;
    case 'last_30_days':
      to = summary.last_day;
      from = to ? addDays(to, -29) : null;
      break;
    case 'previous_month':
      from = `${addMonths(month, -1)}-01`;
      to = `${addMonths(month, -1)}-31`;
      break;
    case 'current_month':
    default:
      from = `${month}-01`;
      to = `${month}-31`;
      break;
  }
  if (!from || !to) {
    return { consumption_kwh: 0, days: 0, start_date: '', end_date: '', max_power_w: 0 };
  }
  const days = dailyTotals(entry);
  let kwh = 0;
  let count = 0;
  let first = null;
  let last = null;
  for (const [date, day] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (date >= from && date <= to) {
      kwh += day.kwh;
      count += 1;
      first ??= date;
      last = date;
    }
  }
  const peak = peakBetween(entry, from, to);
  return {
    consumption_kwh: round(kwh),
    days: count,
    start_date: first ?? '',
    end_date: last ?? '',
    max_power_w: peak ? Math.round(peak.kw * 1000) : 0,
  };
}
