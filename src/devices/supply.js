// -----------------------------------------------------------------------------
// Device type: ELECTRICITY SUPPLY (one Datadis CUPS).
//
// Every supply point the Datadis account can read becomes one Gladys device,
// keyed by its CUPS (the official, unique and permanent identifier of a
// Spanish supply point): external ids are forever.
//
// All features are read-only measurements fed by the sync engine
// (src/sync.js), never polled by Gladys: Datadis serves yesterday's readings
// at best, there is nothing to read every minute.
//
//   consumption          the hourly readings, dated, through
//                        `publishEnergyConsumption` (30-minute slots): what
//                        the Gladys energy monitoring prices and charts
//   last-day-consumption total of the last complete day (kWh)
//   month-consumption    total of the current month so far (kWh)
//   max-power            highest maximeter peak of the current month (W)
//   contracted-power     highest contracted power of the contract (W)
//   last-data-date       date of the most recent reading (text)
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { maskCups } from '../datadis.js';

export const DEVICE_TYPE = 'supply';

export const FEATURE = {
  CONSUMPTION: 'consumption',
  LAST_DAY_CONSUMPTION: 'last-day-consumption',
  MONTH_CONSUMPTION: 'month-consumption',
  MAX_POWER: 'max-power',
  CONTRACTED_POWER: 'contracted-power',
  LAST_DATA_DATE: 'last-data-date',
};

export function supplyIds(gladys, cups) {
  return gladys.externalIds(DEVICE_TYPE, cups);
}

/** Name proposed for a supply: its address, else its masked CUPS. */
export function supplyName(supply) {
  const place = [supply.address, supply.municipality].filter(Boolean).join(', ');
  return place ? `e-data ${place}`.slice(0, 100) : `e-data ${maskCups(supply.cups)}`;
}

const readOnly = { read_only: true, has_feedback: false };

/**
 * Discovery payload of a supply.
 */
export function buildSupplyDevice(gladys, supply) {
  const ids = supplyIds(gladys, supply.cups);
  return {
    name: supplyName(supply),
    external_id: ids.device,
    // Fed by the sync engine on its own schedule: no Gladys polling.
    should_poll: false,
    features: [
      {
        name: 'Consumption',
        external_id: ids.feature(FEATURE.CONSUMPTION),
        category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
        type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION,
        unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
        min: 0,
        max: 1000,
        keep_history: true,
        ...readOnly,
      },
      {
        name: 'Last day consumption',
        external_id: ids.feature(FEATURE.LAST_DAY_CONSUMPTION),
        category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
        type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY,
        unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
        min: 0,
        max: 100000,
        keep_history: true,
        ...readOnly,
      },
      {
        name: 'Month consumption',
        external_id: ids.feature(FEATURE.MONTH_CONSUMPTION),
        category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
        type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY,
        unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
        min: 0,
        max: 1000000,
        keep_history: true,
        ...readOnly,
      },
      {
        name: 'Month maximum power',
        external_id: ids.feature(FEATURE.MAX_POWER),
        category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
        type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
        unit: DEVICE_FEATURE_UNITS.WATT,
        min: 0,
        max: 1000000,
        keep_history: true,
        ...readOnly,
      },
      {
        name: 'Contracted power',
        external_id: ids.feature(FEATURE.CONTRACTED_POWER),
        category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
        type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
        unit: DEVICE_FEATURE_UNITS.WATT,
        min: 0,
        max: 1000000,
        keep_history: false,
        ...readOnly,
      },
      {
        name: 'Last data date',
        external_id: ids.feature(FEATURE.LAST_DATA_DATE),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        min: 0,
        max: 0,
        keep_history: false,
        ...readOnly,
      },
    ],
  };
}

/**
 * The plain states of a supply (everything but the dated consumption), in the
 * `publishChangedStates` format. Unknown values are left out, never sent as 0.
 */
export function supplyStates(gladys, summary) {
  const ids = supplyIds(gladys, summary.cups);
  const states = [];
  const push = (feature, state) => {
    if (state !== null && state !== undefined) {
      states.push({ device_feature_external_id: ids.feature(feature), state });
    }
  };
  push(FEATURE.LAST_DAY_CONSUMPTION, summary.last_day_kwh);
  push(FEATURE.MONTH_CONSUMPTION, summary.month_kwh ?? (summary.last_day ? 0 : null));
  push(
    FEATURE.MAX_POWER,
    summary.month_peak_kw === null ? null : Math.round(summary.month_peak_kw * 1000),
  );
  push(
    FEATURE.CONTRACTED_POWER,
    summary.contracted_power_kw === null ? null : Math.round(summary.contracted_power_kw * 1000),
  );
  if (summary.last_data_date) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.LAST_DATA_DATE),
      text: summary.last_data_date,
    });
  }
  return states;
}
