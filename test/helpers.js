// Shared fixtures of the tests: a fake Datadis client and a sync engine wired
// to the SDK's fake Gladys. Tests never touch the network.

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { SyncEngine } from '../src/sync.js';
import { HOUR_MS, localToUtc } from '../src/time.js';
import { buildSupplyDevice } from '../src/devices/supply.js';

export const SUPPLY = {
  cups: 'ES0021000000000001AA0F',
  address: 'CALLE MAYOR 1',
  postal_code: '28001',
  province: 'MADRID',
  municipality: 'MADRID',
  distributor: 'i-DE',
  distributor_code: '8',
  point_type: 5,
  valid_from: '2020/01/01',
  valid_to: '',
};

export const CONTRACT = {
  marketer: 'COMERCIALIZADORA DEMO',
  access_fare: '2.0TD',
  time_discrimination: '',
  contracted_power_kw: [4.6, 4.6],
  start_date: '2020/01/01',
  end_date: '',
  self_consumption: false,
};

// "Now": 2026-11-23 10:00 in Madrid.
export const NOW = localToUtc(2026, 11, 23, 10);

/** Hourly readings of whole local days, `kwhPerHour` each. */
export function hourlyDays(fromDay, toDay, kwhPerHour = 0.5, month = 11, year = 2026) {
  const readings = [];
  for (let day = fromDay; day <= toDay; day += 1) {
    const midnight = localToUtc(year, month, day);
    for (let hour = 0; hour < 24; hour += 1) {
      readings.push({ start: midnight + hour * HOUR_MS, kwh: kwhPerHour, surplus_kwh: 0 });
    }
  }
  return readings;
}

/** A fake Datadis client recording its calls. */
export function fakeClient({
  supplies = [SUPPLY],
  contract = CONTRACT,
  consumption = {},
  maxPower = {},
  error = null,
} = {}) {
  const calls = [];
  const fail = () => {
    if (error) {
      throw error;
    }
  };
  return {
    calls,
    async getSupplies() {
      calls.push(['supplies']);
      fail();
      return supplies;
    },
    async getContract() {
      calls.push(['contract']);
      fail();
      return contract;
    },
    async getConsumption(_supply, start) {
      calls.push(['consumption', start]);
      fail();
      return consumption[start] ?? [];
    },
    async getMaxPower(_supply, start) {
      calls.push(['max-power', start]);
      fail();
      return maxPower[start] ?? [];
    },
  };
}

/**
 * A sync engine over the fake Gladys. `created: true` makes the supply a
 * device the user already added (so the dated consumption is accepted).
 */
export function setup({ client = fakeClient(), config = {}, created = true, now = NOW } = {}) {
  const probe = createFakeGladys();
  const devices = created ? [buildSupplyDevice(probe, SUPPLY)] : [];
  const gladys = createFakeGladys({ devices });
  gladys.devices = devices;
  const store = new Store({ dir: null });
  const clock = { now };
  const engine = new SyncEngine({
    gladys,
    store,
    createClient: () => client,
    now: () => clock.now,
  });
  engine.setConfig(normalizeConfig({ username: '12345678z', password: 'secret', ...config }));
  return { gladys, store, engine, client, clock };
}
