// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the manifest `config_schema`; the SDK
// fetches it (`gladys.getConfig()`) and notifies every change
// (`gladys.onConfigUpdated()`). This module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or numbers typed as strings.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // NIF/NIE of the Datadis account, and its password (`secret` field).
  username: '',
  password: '',
  // NIF of a supply holder who authorized this account on Datadis (optional).
  authorized_nif: '',
  // Hours between two reads of Datadis. Readings arrive once a day (D+1 at
  // best) and Datadis refuses identical queries asked too often.
  refresh_hours: 12,
  // Months of history imported on the first sync of a supply (24 at most:
  // Datadis serves two years).
  history_months: 3,
  // Daily consumption (kWh) above which `high_daily_consumption` fires; 0
  // disables the trigger.
  daily_threshold_kwh: 0,
  // Share of the contracted power (%) a maximeter peak must reach to fire
  // `power_peak_alarm`.
  power_alert_percent: 90,
};

export const LIMITS = {
  refresh_hours: { min: 6, max: 48 },
  history_months: { min: 1, max: 24 },
  daily_threshold_kwh: { min: 0, max: 10000 },
  power_alert_percent: { min: 50, max: 200 },
};

function clampedNumber(value, key) {
  const number = Number(value ?? DEFAULT_CONFIG[key]);
  if (!Number.isFinite(number)) {
    return DEFAULT_CONFIG[key];
  }
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, number));
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    username: text(raw.username).toUpperCase(),
    // A password is kept verbatim: spaces may be part of it.
    password: typeof raw.password === 'string' ? raw.password : '',
    authorized_nif: text(raw.authorized_nif).toUpperCase(),
    refresh_hours: clampedNumber(raw.refresh_hours, 'refresh_hours'),
    history_months: Math.round(clampedNumber(raw.history_months, 'history_months')),
    daily_threshold_kwh: clampedNumber(raw.daily_threshold_kwh, 'daily_threshold_kwh'),
    power_alert_percent: clampedNumber(raw.power_alert_percent, 'power_alert_percent'),
  };
}

/** Whether the credentials needed to reach Datadis are filled in. */
export function hasCredentials(config) {
  return Boolean(config.username && config.password);
}
