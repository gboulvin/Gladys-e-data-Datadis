// -----------------------------------------------------------------------------
// Datadis private API client (https://datadis.es), the platform the Spanish
// electricity distributors publish their meter readings on — the same API the
// "e-data" project reads.
//
// Flow: POST the user's NIF/NIE and password to the login endpoint, which
// answers a bearer token as plain text; then GET the `*-v2` endpoints with it.
// A 401 re-logs in once. Datadis refuses (429) a query repeated too often:
// the sync engine (src/sync.js) spaces identical queries out.
//
// Never log the password, the token or a full CUPS: `maskCups` is the only
// form of a supply id that reaches the logs.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { hourlyReadingStart, maxPowerInstant } from './time.js';

const logger = createLogger({ name: 'datadis' });

export const DATADIS_BASE_URL = 'https://datadis.es';
const LOGIN_PATH = '/nikola-auth/tokens/login';
const API_PATH = '/api-private/api';

// Datadis is slow on a full month of hourly data: two minutes, like e-data.
const DEFAULT_TIMEOUT_MS = 120_000;

// Codes of the Spanish distributors on Datadis (supply `distributorCode`).
export const DISTRIBUTORS = {
  1: 'Viesgo',
  2: 'e-distribución',
  3: 'E-redes',
  4: 'ASEME',
  5: 'UFD',
  6: 'EOSA',
  7: 'CIDE',
  8: 'i-DE',
};

/** Base class of every Datadis failure. `reason` feeds the `sync_error` trigger. */
export class DatadisError extends Error {
  constructor(message, { status = null, reason = 'unavailable' } = {}) {
    super(message);
    this.name = 'DatadisError';
    this.status = status;
    this.reason = reason;
  }
}

/** Datadis refused the credentials. */
export class DatadisAuthError extends DatadisError {
  constructor(message = 'Datadis refused the username or the password') {
    super(message, { status: 401, reason: 'auth' });
    this.name = 'DatadisAuthError';
  }
}

/** Datadis refused a query asked too often (HTTP 429). */
export class DatadisRateLimitError extends DatadisError {
  constructor(message = 'Datadis rate limit reached') {
    super(message, { status: 429, reason: 'rate_limit' });
    this.name = 'DatadisRateLimitError';
  }
}

/**
 * `ES0021000012345678AB0F` -> `ES0021…78AB0F`: enough to tell supplies apart
 * in the logs and the UI without exposing the full identifier.
 */
export function maskCups(cups) {
  const text = String(cups ?? '');
  return text.length <= 10 ? text : `${text.slice(0, 6)}…${text.slice(-6)}`;
}

// Datadis answers either the v2 envelope (`{ supplies: [...] }`) or a bare
// array (v1): accept both.
function rowsOf(body, key) {
  if (Array.isArray(body)) {
    return body;
  }
  if (body && Array.isArray(body[key])) {
    return body[key];
  }
  return [];
}

function logDistributorErrors(body, what) {
  for (const error of body?.distributorError ?? []) {
    logger.warn(
      `Datadis ${what}: distributor ${error.distributorName ?? error.distributorCode ?? '?'} ` +
        `answered an error (${error.errorCode ?? '?'}: ${error.errorDescription ?? 'no description'})`,
    );
  }
}

const toNumber = (value) => {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Normalize a Datadis supply.
 */
export function normalizeSupply(raw) {
  return {
    cups: String(raw.cups ?? '')
      .trim()
      .toUpperCase(),
    address: String(raw.address ?? '').trim(),
    postal_code: String(raw.postalCode ?? '').trim(),
    province: String(raw.province ?? '').trim(),
    municipality: String(raw.municipality ?? '').trim(),
    distributor: String(raw.distributor ?? DISTRIBUTORS[raw.distributorCode] ?? '').trim(),
    distributor_code: String(raw.distributorCode ?? '').trim(),
    point_type: toNumber(raw.pointType) ?? 5,
    valid_from: String(raw.validDateFrom ?? '').trim(),
    valid_to: String(raw.validDateTo ?? '').trim(),
  };
}

/**
 * Normalize a Datadis contract (the current one when several are listed).
 */
export function normalizeContract(raw) {
  const powers = (Array.isArray(raw.contractedPowerkW) ? raw.contractedPowerkW : [])
    .map(toNumber)
    .filter((value) => value !== null && value > 0);
  return {
    marketer: String(raw.marketer ?? '').trim(),
    access_fare: String(raw.accessFare ?? raw.codeFare ?? '').trim(),
    time_discrimination: String(raw.timeDiscrimination ?? '').trim(),
    contracted_power_kw: powers,
    start_date: String(raw.startDate ?? '').trim(),
    end_date: String(raw.endDate ?? '').trim(),
    self_consumption: Boolean(raw.selfConsumptionTypeCode),
  };
}

export class DatadisClient {
  /**
   * @param {object} options
   * @param {string} options.username - NIF/NIE of the Datadis account.
   * @param {string} options.password - Datadis password.
   * @param {string} [options.authorizedNif] - NIF of a holder who authorized this account.
   * @param {typeof fetch} [options.fetch] - Injected in the tests.
   */
  constructor({
    username,
    password,
    authorizedNif = '',
    fetch: fetchImpl = globalThis.fetch,
    baseUrl = DATADIS_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    this.username = String(username ?? '').trim();
    this.password = String(password ?? '');
    this.authorizedNif = String(authorizedNif ?? '').trim();
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.token = null;
  }

  async #send(url, init) {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new DatadisError(`Datadis is unreachable (${err.name ?? 'Error'})`);
    }
  }

  /** Log in and keep the token. */
  async login() {
    if (!this.username || !this.password) {
      throw new DatadisAuthError('The Datadis username or password is missing');
    }
    const response = await this.#send(`${this.baseUrl}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: this.username, password: this.password }).toString(),
    });
    const text = await response.text();
    // Datadis answers wrong credentials with a 500 "Bad credentials" (401 and
    // 403 are taken the same way in case it switches to the standard codes).
    if ([401, 403].includes(response.status) || /bad credentials/i.test(text)) {
      throw new DatadisAuthError();
    }
    if (response.status === 429) {
      throw new DatadisRateLimitError();
    }
    if (!response.ok || !text.trim()) {
      throw new DatadisError(`Datadis login failed (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    this.token = text.trim();
    logger.debug('Logged in to Datadis');
  }

  async #get(endpoint, params, retried = false) {
    if (!this.token) {
      await this.login();
    }
    const query = new URLSearchParams(params);
    if (this.authorizedNif) {
      query.set('authorizedNif', this.authorizedNif);
    }
    const response = await this.#send(`${this.baseUrl}${API_PATH}/${endpoint}?${query}`, {
      headers: { Authorization: `Bearer ${this.token}`, 'Accept-Encoding': 'identity' },
    });
    if (response.status === 401 && !retried) {
      this.token = null;
      return this.#get(endpoint, params, true);
    }
    if (response.status === 401 || response.status === 403) {
      throw new DatadisAuthError('Datadis refused the session');
    }
    if (response.status === 429) {
      throw new DatadisRateLimitError();
    }
    if (!response.ok) {
      throw new DatadisError(`Datadis ${endpoint} failed (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    const text = await response.text();
    if (!text.trim()) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new DatadisError(`Datadis ${endpoint} answered an invalid JSON body`);
    }
  }

  /** Supplies (CUPS) the account can read. */
  async getSupplies() {
    const body = await this.#get('get-supplies-v2', {});
    logDistributorErrors(body, 'supplies');
    return rowsOf(body, 'supplies')
      .map(normalizeSupply)
      .filter((supply) => supply.cups);
  }

  /** Current contract of a supply, `null` when Datadis lists none. */
  async getContract(supply) {
    const body = await this.#get('get-contract-detail-v2', {
      cups: supply.cups,
      distributorCode: supply.distributor_code,
    });
    logDistributorErrors(body, 'contract');
    const contracts = rowsOf(body, 'contract').map(normalizeContract);
    if (contracts.length === 0) {
      return null;
    }
    // The open-ended (or latest ending) contract is the current one.
    return contracts.reduce((best, contract) =>
      (contract.end_date || '9999') >= (best.end_date || '9999') ? contract : best,
    );
  }

  /**
   * Hourly consumption between two months (`YYYY/MM`, both included).
   * Resolves `[{ start, kwh, surplus_kwh, real }]`, `start` in epoch ms.
   */
  async getConsumption(supply, startMonth, endMonth) {
    const body = await this.#get('get-consumption-data-v2', {
      cups: supply.cups,
      distributorCode: supply.distributor_code,
      startDate: startMonth,
      endDate: endMonth,
      measurementType: '0',
      pointType: String(supply.point_type),
    });
    logDistributorErrors(body, 'consumption');
    const readings = [];
    for (const row of rowsOf(body, 'timeCurve')) {
      const start = hourlyReadingStart(row.date, row.time);
      const kwh = toNumber(row.consumptionKWh);
      if (start === null || kwh === null || kwh < 0) {
        continue;
      }
      readings.push({
        start,
        kwh,
        surplus_kwh: Math.max(0, toNumber(row.surplusEnergyKWh) ?? 0),
        real: row.obtainMethod === 'Real',
      });
    }
    return readings;
  }

  /**
   * Monthly maximum power readings (the maximeter) between two months.
   * Resolves `[{ at, kw, period }]`, `at` in epoch ms.
   */
  async getMaxPower(supply, startMonth, endMonth) {
    const body = await this.#get('get-max-power-v2', {
      cups: supply.cups,
      distributorCode: supply.distributor_code,
      startDate: startMonth,
      endDate: endMonth,
    });
    logDistributorErrors(body, 'max power');
    const readings = [];
    for (const row of rowsOf(body, 'maxPower')) {
      const at = maxPowerInstant(row.date, row.time);
      const kw = toNumber(row.maxPower);
      if (at === null || kw === null || kw < 0) {
        continue;
      }
      readings.push({ at, kw, period: String(row.period ?? '') });
    }
    return readings;
  }
}
