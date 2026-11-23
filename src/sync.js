// -----------------------------------------------------------------------------
// Sync engine: reads Datadis on its own schedule, keeps the cache, and pushes
// what changed to Gladys.
//
// One sync:
//   1. log in and list the supplies (once a day, or on demand);
//   2. per supply: the contract (once a week), then the hourly consumption and
//      the maximeter of the months that can still change — the current month,
//      the previous one at the start of a month, and the history months never
//      read (`history_months`);
//   3. publish: the dated consumption (`publishEnergyConsumption`) of the
//      created devices, the plain states (`publishChangedStates`), the
//      transport badge, the scene events, the widget refresh nudges.
//
// Datadis refuses an identical query asked too often (429): an identical
// query is never re-sent within `refresh_hours`, unless the user forces it.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { DatadisClient, DatadisError, DatadisRateLimitError, maskCups } from './datadis.js';
import { hasCredentials } from './config.js';
import { contractedPowerKw, summarize } from './summary.js';
import {
  DAY_MS,
  HOUR_MS,
  addMonths,
  localDate,
  localMonth,
  localParts,
  monthEndInstant,
  toDatadisMonth,
} from './time.js';
import { FEATURE, buildSupplyDevice, supplyIds, supplyStates } from './devices/supply.js';

const logger = createLogger({ name: 'sync' });

export const SCENE_TRIGGERS = {
  NEW_DAILY_DATA: 'new_daily_data',
  HIGH_DAILY_CONSUMPTION: 'high_daily_consumption',
  POWER_PEAK_ALARM: 'power_peak_alarm',
  SYNC_ERROR: 'sync_error',
};

const SUPPLIES_REFRESH_MS = DAY_MS;
const CONTRACT_REFRESH_MS = 7 * DAY_MS;
// The previous month keeps receiving readings (and corrections) for a few
// days after it ends.
const LATE_READINGS_MS = 7 * DAY_MS;
// The scheduler wakes up this often and syncs when a sync is due.
const TICK_MS = 10 * 60 * 1000;
// After a failure, retry sooner than the regular interval.
const RETRY_AFTER_ERROR_MS = 2 * HOUR_MS;
// Unchanged plain states are re-sent this often, so they stay recently dated.
const STATES_HEARTBEAT_MS = 6 * HOUR_MS;
// SDK bound of publishEnergyConsumption.
const MAX_INTERVALS_PER_CALL = 2000;

const ERROR_MESSAGES = {
  credentials: {
    en: 'Enter your Datadis username (NIF/NIE) and password.',
    fr: 'Renseignez votre identifiant Datadis (NIF/NIE) et votre mot de passe.',
    de: 'Geben Sie Ihren Datadis-Benutzernamen (NIF/NIE) und Ihr Passwort ein.',
    es: 'Introduzca su usuario de Datadis (NIF/NIE) y su contraseña.',
  },
  auth: {
    en: 'Datadis refused the username or the password.',
    fr: "Datadis a refusé l'identifiant ou le mot de passe.",
    de: 'Datadis hat den Benutzernamen oder das Passwort abgelehnt.',
    es: 'Datadis ha rechazado el usuario o la contraseña.',
  },
  rate_limit: {
    en: 'Datadis limits the number of queries: the data will be read again later.',
    fr: 'Datadis limite le nombre de requêtes : les données seront relues plus tard.',
    de: 'Datadis begrenzt die Anzahl der Abfragen: Die Daten werden später erneut gelesen.',
    es: 'Datadis limita el número de consultas: los datos se volverán a leer más tarde.',
  },
  unavailable: {
    en: 'Datadis is unavailable for now, the integration will retry.',
    fr: "Datadis est indisponible pour l'instant, l'intégration réessaiera.",
    de: 'Datadis ist derzeit nicht erreichbar, die Integration versucht es erneut.',
    es: 'Datadis no está disponible por ahora, la integración lo volverá a intentar.',
  },
};

export function errorMessage(reason) {
  return ERROR_MESSAGES[reason] ?? ERROR_MESSAGES.unavailable;
}

function accountKey(config) {
  return createHash('sha256')
    .update(`${config.username}|${config.authorized_nif}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Split hourly readings into the 30-minute intervals of
 * `publishEnergyConsumption`: two equal halves per hour, elapsed ones only.
 */
export function toHalfHourIntervals(hourly, now) {
  const intervals = [];
  for (const [key, kwh] of Object.entries(hourly)) {
    const start = Number(key);
    if (start + HOUR_MS > now) {
      continue;
    }
    const half = Number((kwh / 2).toFixed(6));
    intervals.push({ starts_at: new Date(start).toISOString(), kwh: half });
    intervals.push({ starts_at: new Date(start + HOUR_MS / 2).toISOString(), kwh: half });
  }
  return intervals.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export class SyncEngine {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {import('./store.js').Store} options.store
   * @param {(config) => DatadisClient} [options.createClient] - Injected in the tests.
   * @param {() => number} [options.now]
   * @param {() => void} [options.onUpdate] - Called after every sync (widgets refresh).
   */
  constructor({
    gladys,
    store,
    createClient = (config) =>
      new DatadisClient({
        username: config.username,
        password: config.password,
        authorizedNif: config.authorized_nif,
      }),
    now = () => Date.now(),
    onUpdate = () => {},
  }) {
    this.gladys = gladys;
    this.store = store;
    this.createClient = createClient;
    this.now = now;
    this.onUpdate = onUpdate;
    this.config = null;
    this.client = null;
    this.running = null;
    this.timer = null;
    // Outcome of the last sync, shown in the widgets and the status.
    this.status = {
      ok: null,
      reason: null,
      last_attempt_at: null,
      last_success_at: null,
      // Per supply: true when its last read failed.
      failed: new Set(),
    };
  }

  /** Apply a (new) configuration. */
  setConfig(config) {
    const changed =
      !this.config ||
      this.config.username !== config.username ||
      this.config.password !== config.password ||
      this.config.authorized_nif !== config.authorized_nif;
    this.config = config;
    if (changed) {
      this.client = hasCredentials(config) ? this.createClient(config) : null;
      // Another account: its supplies are another set.
      const key = accountKey(config);
      if (this.store.state.account && this.store.state.account !== key) {
        logger.info('Datadis account changed: the cache is reset');
        this.store.reset();
      }
      this.store.state.account = key;
      this.status.last_attempt_at = null;
    }
    return changed;
  }

  /** Every known supply. */
  supplies() {
    return this.store.entries().map((entry) => entry.supply);
  }

  /** Discovery payload: one device per supply. */
  buildDevices() {
    return this.supplies().map((supply) => buildSupplyDevice(this.gladys, supply));
  }

  /** The cached entry behind a device external id, `null` if none. */
  entryByDevice(deviceExternalId) {
    return (
      this.store
        .entries()
        .find((entry) => supplyIds(this.gladys, entry.supply.cups).device === deviceExternalId) ??
      null
    );
  }

  summary(entry) {
    return summarize(entry, this.now());
  }

  /** Transport badges: cloud, or unreachable when the last read failed. */
  transportEntries() {
    return this.supplies().map((supply) => ({
      external_id: supplyIds(this.gladys, supply.cups).device,
      transport: this.status.failed.has(supply.cups)
        ? DEVICE_TRANSPORTS.UNREACHABLE
        : DEVICE_TRANSPORTS.CLOUD,
    }));
  }

  /** Whether a regular sync is due. */
  isDue() {
    if (!this.client) {
      return false;
    }
    const last = this.status.last_attempt_at;
    if (last === null) {
      return true;
    }
    const interval =
      this.status.ok === false
        ? Math.min(RETRY_AFTER_ERROR_MS, this.config.refresh_hours * HOUR_MS)
        : this.config.refresh_hours * HOUR_MS;
    return this.now() - last >= interval;
  }

  /** Start the scheduler. */
  start() {
    this.stop();
    this.timer = setInterval(() => {
      if (this.isDue()) {
        this.sync().catch((err) => logger.error('Scheduled sync failed', err));
      }
    }, TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a sync (or join the one running). `force` re-reads the supplies and
   * ignores the spacing of identical queries.
   * Resolves `{ ok, reason, supplies }`.
   */
  sync({ force = false } = {}) {
    if (!this.running) {
      this.running = this.#run(force).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  async #run(force) {
    if (!this.client) {
      await this.#reportStatus(false, 'credentials');
      return { ok: false, reason: 'credentials', supplies: 0 };
    }
    const now = this.now();
    this.status.last_attempt_at = now;
    let failure = null;
    let suppliesChanged = false;

    try {
      if (
        force ||
        this.store.state.supplies_fetched_at === null ||
        now - this.store.state.supplies_fetched_at >= SUPPLIES_REFRESH_MS
      ) {
        const before = JSON.stringify(this.supplies());
        const supplies = await this.client.getSupplies();
        this.store.setSupplies(supplies, now);
        suppliesChanged = before !== JSON.stringify(this.supplies());
        logger.info(`Datadis lists ${supplies.length} supply(ies)`);
      }
    } catch (err) {
      failure = err;
    }

    if (suppliesChanged) {
      await this.gladys
        .publishDiscoveredDevices(this.buildDevices())
        .catch((err) => logger.error('Could not publish the supplies', err));
    }

    if (!failure) {
      for (const entry of this.store.entries()) {
        try {
          await this.#syncSupply(entry, force);
          this.status.failed.delete(entry.supply.cups);
        } catch (err) {
          this.status.failed.add(entry.supply.cups);
          logger.warn(`Supply ${maskCups(entry.supply.cups)}: ${err.message}`);
          // A rejected account or a rate limit stops the whole sync: every
          // following query would be refused the same way.
          if (err.reason === 'auth' || err instanceof DatadisRateLimitError) {
            failure = err;
            break;
          }
          failure ??= err;
        }
      }
    }

    this.store.prune(now);
    await this.store.save();
    await this.publishAll();

    const ok = !failure;
    const reason = failure
      ? failure instanceof DatadisError
        ? failure.reason
        : 'unavailable'
      : null;
    if (failure && !(failure instanceof DatadisError)) {
      logger.error('Sync failed', failure);
    }
    await this.#reportStatus(ok, reason);
    if (ok) {
      this.status.last_success_at = now;
    }
    this.onUpdate();
    return { ok, reason, supplies: this.store.entries().length };
  }

  async #reportStatus(ok, reason) {
    const wasOk = this.status.ok;
    const previousReason = this.status.reason;
    this.status.ok = ok;
    this.status.reason = reason;
    try {
      await this.gladys.setConnectionStatus(ok, ok ? undefined : errorMessage(reason));
      // `sync_error` fires on the transition only (or when the reason changes):
      // one event per incident, never one per retry.
      if (!ok && reason !== 'credentials' && (wasOk !== false || previousReason !== reason)) {
        await this.gladys.publishSceneEvent(SCENE_TRIGGERS.SYNC_ERROR, {
          reason,
          message: errorMessage(reason).en,
        });
      }
    } catch (err) {
      logger.warn(`Could not report the connection status (${err.message})`);
    }
  }

  // Send a query unless an identical one was sent within `refresh_hours`.
  async #query(entry, key, force, run) {
    const last = entry.queries[key];
    const spacing = this.config.refresh_hours * HOUR_MS - TICK_MS;
    if (!force && last !== undefined && this.now() - last < spacing) {
      return null;
    }
    entry.queries[key] = this.now();
    return run();
  }

  // Months to (re)read for a supply, oldest first.
  monthsToRead(entry) {
    const now = this.now();
    const current = localMonth(now);
    const previous = addMonths(current, -1);
    const validFrom = entry.supply.valid_from
      ? entry.supply.valid_from.replaceAll('/', '-').slice(0, 7)
      : null;
    const months = [];
    for (let i = this.config.history_months - 1; i >= 1; i -= 1) {
      const month = addMonths(current, -i);
      if (validFrom && month < validFrom) {
        continue;
      }
      const fetchedAt = entry.fetched_months[month];
      // Never read, or read before its late readings could arrive.
      if (fetchedAt === undefined || fetchedAt < monthEndInstant(month) + LATE_READINGS_MS) {
        months.push(month);
      }
    }
    // The previous month, whatever the history setting: the last days of a
    // month arrive after it ends.
    const previousFetchedAt = entry.fetched_months[previous];
    if (
      (!validFrom || previous >= validFrom) &&
      (previousFetchedAt === undefined ||
        previousFetchedAt < monthEndInstant(previous) + LATE_READINGS_MS)
    ) {
      months.push(previous);
    }
    months.push(current);
    return [...new Set(months)].sort();
  }

  async #syncSupply(entry, force) {
    const { supply } = entry;
    const now = this.now();

    if (
      force ||
      entry.contract_fetched_at === null ||
      now - entry.contract_fetched_at >= CONTRACT_REFRESH_MS
    ) {
      const contract = await this.client.getContract(supply);
      entry.contract = contract ?? entry.contract;
      entry.contract_fetched_at = now;
    }

    for (const month of this.monthsToRead(entry)) {
      const datadisMonth = toDatadisMonth(month);
      const readings = await this.#query(entry, `consumption|${month}`, force, () =>
        this.client.getConsumption(supply, datadisMonth, datadisMonth),
      );
      if (readings) {
        for (const reading of readings) {
          entry.hourly[reading.start] = reading.kwh;
          if (reading.surplus_kwh > 0) {
            entry.surplus[reading.start] = reading.surplus_kwh;
          }
        }
        entry.fetched_months[month] = now;
        entry.pending_publication ??= [];
        entry.pending_publication.push(month);
        logger.info(`Supply ${maskCups(supply.cups)}: ${readings.length} reading(s) for ${month}`);
      }
      const peaks = await this.#query(entry, `max-power|${month}`, force, () =>
        this.client.getMaxPower(supply, datadisMonth, datadisMonth),
      );
      if (peaks) {
        const others = entry.max_power.filter((reading) => localMonth(reading.at) !== month);
        entry.max_power = [...others, ...peaks].sort((a, b) => a.at - b.at);
      }
    }
  }

  /** Created device of a supply, `undefined` if the user has not added it. */
  #createdDevice(cups) {
    const externalId = supplyIds(this.gladys, cups).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === externalId);
  }

  /**
   * Push the cached data of every supply to Gladys, and fire the scene events
   * of what is new.
   */
  async publishAll() {
    try {
      await this.gladys.publishTransports(this.transportEntries());
    } catch (err) {
      logger.warn(`Could not publish the transports (${err.message})`);
    }
    for (const entry of this.store.entries()) {
      await this.publishSupply(entry);
    }
    await this.store.save();
  }

  /** Push the cached data of one supply (also run when its device is created). */
  async publishSupply(entry, { all = false } = {}) {
    const { cups } = entry.supply;
    const summary = this.summary(entry);
    try {
      await this.gladys.publishChangedStates(supplyStates(this.gladys, summary), {
        heartbeat: STATES_HEARTBEAT_MS,
      });
    } catch (err) {
      logger.warn(`Supply ${maskCups(cups)}: states not published (${err.message})`);
    }

    // Dated consumption: only on a created device (404 otherwise). Kept
    // pending until it is accepted, so a device created later gets it all.
    if (this.#createdDevice(cups)) {
      const months = all ? null : new Set(entry.pending_publication ?? []);
      if (all || months.size > 0) {
        const hourly = Object.fromEntries(
          Object.entries(entry.hourly).filter(
            ([key]) => months === null || months.has(localMonth(Number(key))),
          ),
        );
        try {
          await this.#publishConsumption(cups, hourly);
          entry.pending_publication = [];
        } catch (err) {
          logger.warn(`Supply ${maskCups(cups)}: consumption not published (${err.message})`);
        }
      }
    }

    await this.#fireSceneEvents(entry, summary);
  }

  async #publishConsumption(cups, hourly) {
    const intervals = toHalfHourIntervals(hourly, this.now());
    const featureId = supplyIds(this.gladys, cups).feature(FEATURE.CONSUMPTION);
    for (let i = 0; i < intervals.length; i += MAX_INTERVALS_PER_CALL) {
      await this.gladys.publishEnergyConsumption(
        featureId,
        intervals.slice(i, i + MAX_INTERVALS_PER_CALL),
      );
    }
    if (intervals.length > 0) {
      logger.info(`Supply ${maskCups(cups)}: ${intervals.length} half-hour interval(s) published`);
    }
  }

  async #fireSceneEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} not published (${err.message})`);
    }
  }

  async #fireSceneEvents(entry, summary) {
    const device = supplyIds(this.gladys, entry.supply.cups).device;
    const { alerts } = entry;
    const firstSync = alerts.last_day === null;

    // A new complete day arrived. Never on the very first sync: importing the
    // history is not "new data", and it would fire one event per old day.
    if (summary.last_day && summary.last_day !== alerts.last_day) {
      if (!firstSync) {
        await this.#fireSceneEvent(SCENE_TRIGGERS.NEW_DAILY_DATA, {
          device,
          date: summary.last_day,
          consumption_kwh: summary.last_day_kwh,
        });
        const threshold = this.config?.daily_threshold_kwh ?? 0;
        if (
          threshold > 0 &&
          summary.last_day_kwh >= threshold &&
          alerts.high_day !== summary.last_day
        ) {
          await this.#fireSceneEvent(SCENE_TRIGGERS.HIGH_DAILY_CONSUMPTION, {
            device,
            date: summary.last_day,
            consumption_kwh: summary.last_day_kwh,
            threshold_kwh: threshold,
          });
          alerts.high_day = summary.last_day;
        }
      }
      alerts.last_day = summary.last_day;
    }

    // A maximeter peak close to (or above) the contracted power: the
    // integration's alarm. One event for the highest NEW peak only.
    const contracted = contractedPowerKw(entry);
    if (contracted) {
      const ratio = (this.config?.power_alert_percent ?? 90) / 100;
      const newPeaks = entry.max_power.filter(
        (reading) => alerts.power_peak_at === null || reading.at > alerts.power_peak_at,
      );
      const latest = entry.max_power.at(-1);
      if (newPeaks.length > 0) {
        const alarming = newPeaks.filter((reading) => reading.kw >= contracted * ratio);
        // The very first sync only arms the detection, like the daily data.
        if (alerts.power_peak_at !== null && alarming.length > 0) {
          const peak = alarming.reduce((a, b) => (b.kw > a.kw ? b : a));
          await this.#fireSceneEvent(SCENE_TRIGGERS.POWER_PEAK_ALARM, {
            device,
            date: localDate(peak.at),
            time: `${String(localParts(peak.at).hour).padStart(2, '0')}:${String(localParts(peak.at).minute).padStart(2, '0')}`,
            max_power_w: Math.round(peak.kw * 1000),
            contracted_power_w: Math.round(contracted * 1000),
            percent: Math.round((peak.kw / contracted) * 100),
          });
        }
        alerts.power_peak_at = latest.at;
      }
    }
  }
}
