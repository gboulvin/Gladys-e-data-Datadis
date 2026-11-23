// -----------------------------------------------------------------------------
// Local cache of the Datadis data, persisted under /data (the only writable
// volume of the container).
//
// Why a cache: Datadis serves yesterday's readings at best, refuses identical
// queries asked too often, and a full month of hourly data takes seconds to
// come. Keeping what was read means a restart re-reads nothing, the widgets
// and the scene actions answer instantly, and only the months that can still
// change are queried again.
//
// Nothing secret is stored here: no password, no token.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { DAY_MS } from './time.js';

const logger = createLogger({ name: 'store' });

const STATE_FILE = 'e-data-state.json';
const STATE_VERSION = 1;

// Datadis serves two years of history: nothing older is worth keeping.
const RETENTION_MS = 760 * DAY_MS;

export function emptySupplyEntry(supply) {
  return {
    supply,
    contract: null,
    contract_fetched_at: null,
    // Hourly consumption: start instant (epoch ms, as a string key) -> kWh.
    hourly: {},
    // Hourly surplus (self-consumption installations), same keys.
    surplus: {},
    // Maximeter readings: [{ at, kw, period }].
    max_power: [],
    // Month (`YYYY-MM`) -> instant of its last successful consumption read.
    fetched_months: {},
    // Last time each identical query was sent (Datadis rate limit).
    queries: {},
    // Edge detection of the scene triggers, so a restart never re-fires them.
    alerts: { last_day: null, high_day: null, power_peak_at: null },
  };
}

export class Store {
  /**
   * @param {object} [options]
   * @param {string|null} [options.dir] - Directory of the state file; `null`
   *   keeps everything in memory (tests).
   */
  constructor({ dir = process.env.DATA_DIR ?? '/data' } = {}) {
    this.dir = dir;
    this.state = { version: STATE_VERSION, supplies_fetched_at: null, supplies: {} };
  }

  async load() {
    if (!this.dir) {
      return;
    }
    try {
      const parsed = JSON.parse(await readFile(join(this.dir, STATE_FILE), 'utf8'));
      if (parsed?.version === STATE_VERSION && parsed.supplies) {
        this.state = parsed;
        logger.info(`Cache loaded: ${Object.keys(parsed.supplies).length} supply(ies)`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cache unreadable, starting from scratch (${err.message})`);
      }
    }
  }

  async save() {
    if (!this.dir) {
      return;
    }
    try {
      await mkdir(this.dir, { recursive: true });
      const file = join(this.dir, STATE_FILE);
      // Write then rename: a crash never leaves a half-written cache.
      await writeFile(`${file}.tmp`, JSON.stringify(this.state));
      await rename(`${file}.tmp`, file);
    } catch (err) {
      logger.error(`Cache could not be saved (${err.message})`);
    }
  }

  /** Every known supply entry. */
  entries() {
    return Object.values(this.state.supplies);
  }

  entry(cups) {
    return this.state.supplies[cups] ?? null;
  }

  /**
   * Replace the list of supplies: new ones get an empty entry, known ones keep
   * their data, the ones the account lost are forgotten.
   */
  setSupplies(supplies, now) {
    const next = {};
    for (const supply of supplies) {
      const previous = this.state.supplies[supply.cups];
      next[supply.cups] = previous ? { ...previous, supply } : emptySupplyEntry(supply);
    }
    this.state.supplies = next;
    this.state.supplies_fetched_at = now;
  }

  /** Drop the readings older than the Datadis history. */
  prune(now) {
    const limit = now - RETENTION_MS;
    for (const entry of this.entries()) {
      for (const key of Object.keys(entry.hourly)) {
        if (Number(key) < limit) {
          delete entry.hourly[key];
          delete entry.surplus[key];
        }
      }
      entry.max_power = entry.max_power.filter((reading) => reading.at >= limit);
      for (const [key, at] of Object.entries(entry.queries)) {
        if (at < now - 7 * DAY_MS) {
          delete entry.queries[key];
        }
      }
    }
  }

  /** Forget everything (another Datadis account was configured). */
  reset() {
    this.state = { version: STATE_VERSION, supplies_fetched_at: null, supplies: {} };
  }
}
