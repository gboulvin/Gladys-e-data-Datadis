// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+), declared in the manifest
// `scene_actions` field and registered by index.js with
// `gladys.onSceneAction(key, ...)`.
//
//   refresh_data     read Datadis now (outputs: success, supplies)
//   get_consumption  consumption of a supply over a period, from the cache
//                    (outputs: consumption_kwh, days, start_date, end_date,
//                    max_power_w), e.g. to send a monthly report
//
// Scene TRIGGERS go the other way: the sync engine fires them
// (src/sync.js, SCENE_TRIGGERS). Rules: `fields` arrive resolved, outputs are
// scalars and declared, throwing fails this action only, and an action never
// fires a scene event (a refresh run from a scene does not report new daily
// data a second time: the edge detection of the sync engine is persisted).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { periodConsumption } from './summary.js';

const logger = createLogger({ name: 'scenes' });

export const PERIODS = [
  'last_day',
  'last_7_days',
  'last_30_days',
  'current_month',
  'previous_month',
];

export const SCENE_ACTIONS = {
  async refresh_data(_gladys, { engine }) {
    logger.info('Scene action refresh_data');
    const result = await engine.sync({ force: true });
    return { success: result.ok, supplies: result.supplies };
  },

  async get_consumption(_gladys, { fields, engine }) {
    logger.info(`Scene action get_consumption (${fields.period})`);
    const entry = engine.entryByDevice(fields.device);
    if (!entry) {
      throw new Error('Unknown supply: add it from the Discovery tab first');
    }
    const period = PERIODS.includes(fields.period) ? fields.period : 'current_month';
    return periodConsumption(entry, period, engine.now());
  },
};
