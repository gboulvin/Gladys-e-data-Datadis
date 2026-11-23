import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { ACTIONS } from '../src/actions.js';
import { SCENE_TRIGGERS } from '../src/sync.js';
import { DatadisAuthError } from '../src/datadis.js';
import { supplyIds } from '../src/devices/supply.js';
import { DAY_MS, localToUtc } from '../src/time.js';
import { SUPPLY, fakeClient, hourlyDays, setup } from './helpers.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declaration = (list, key) => manifest[list].find((entry) => entry.key === key);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

async function synced() {
  const client = fakeClient({
    consumption: {
      '2026/10': hourlyDays(1, 31, 0.25, 10),
      '2026/11': hourlyDays(1, 21, 0.5),
    },
    maxPower: { '2026/11': [{ at: localToUtc(2026, 11, 18, 21), kw: 3.9, period: '1' }] },
  });
  const ctx = setup({ client, config: { history_months: 2 } });
  await ctx.engine.sync();
  return ctx;
}

function assertDeclaredOutputs(key, outputs) {
  const declared = keysOf(declaration('scene_actions', key).outputs);
  assert.deepEqual(Object.keys(outputs).sort(), [...declared].sort());
  for (const value of Object.values(outputs)) {
    assert.ok(value === null || typeof value !== 'object', 'outputs are scalars');
  }
}

test('get_consumption answers every declared period with the declared outputs', async () => {
  const ctx = await synced();
  const device = supplyIds(ctx.gladys, SUPPLY.cups).device;
  const run = (period) =>
    SCENE_ACTIONS.get_consumption(ctx.gladys, { fields: { device, period }, engine: ctx.engine });

  const periods = declaration('scene_actions', 'get_consumption')
    .fields.find((f) => f.key === 'period')
    .options.map((o) => o.value);
  for (const period of periods) {
    assertDeclaredOutputs('get_consumption', await run(period));
  }

  assert.deepEqual(await run('last_day'), {
    consumption_kwh: 12,
    days: 1,
    start_date: '2026-11-21',
    end_date: '2026-11-21',
    max_power_w: 0,
  });
  assert.equal((await run('last_7_days')).consumption_kwh, 84);
  assert.equal((await run('current_month')).max_power_w, 3900);
  assert.equal((await run('previous_month')).consumption_kwh, 31 * 6);
});

test('get_consumption on an unknown device fails this action only', async () => {
  const ctx = await synced();
  await assert.rejects(
    SCENE_ACTIONS.get_consumption(ctx.gladys, {
      fields: { device: 'ext:nope:supply:x', period: 'last_day' },
      engine: ctx.engine,
    }),
    /Unknown supply/,
  );
});

test('refresh_data forces a sync and returns the declared outputs', async () => {
  const ctx = await synced();
  const outputs = await SCENE_ACTIONS.refresh_data(ctx.gladys, { fields: {}, engine: ctx.engine });
  assert.deepEqual(outputs, { success: true, supplies: 1 });
  assertDeclaredOutputs('refresh_data', outputs);
});

test('scene event data only carries the keys its trigger declares', async () => {
  const data = { '2026/11': hourlyDays(1, 20, 0.5) };
  const peaks = { '2026/11': [{ at: localToUtc(2026, 11, 2, 20), kw: 1, period: '1' }] };
  const ctx = setup({
    client: fakeClient({ consumption: data, maxPower: peaks }),
    config: { history_months: 1, daily_threshold_kwh: 1 },
  });
  await ctx.engine.sync();
  data['2026/11'] = hourlyDays(1, 21, 0.5);
  peaks['2026/11'] = [
    ...peaks['2026/11'],
    { at: localToUtc(2026, 11, 21, 20), kw: 5, period: '1' },
  ];
  ctx.clock.now += DAY_MS;
  await ctx.engine.sync();

  const failing = setup({ client: fakeClient({ error: new DatadisAuthError() }) });
  await failing.engine.sync();

  const events = [...ctx.gladys.fake.sceneEvents, ...failing.gladys.fake.sceneEvents];
  assert.deepEqual(
    [...new Set(events.map((e) => e.key))].sort(),
    Object.values(SCENE_TRIGGERS).sort(),
    'every trigger is exercised',
  );
  for (const { key, data: eventData } of events) {
    const trigger = declaration('scene_triggers', key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    for (const [field, value] of Object.entries(eventData)) {
      assert.ok(declared.includes(field), `${key}: data.${field} is not declared`);
      assert.ok(value === null || typeof value !== 'object');
    }
  }
});

test('test_connection reports the supplies found, or why it failed', async () => {
  const config = { username: 'A', password: 'B' };
  const ok = await ACTIONS.test_connection(null, { config, createClient: () => fakeClient() });
  assert.match(ok.en, /1 supply/);
  assert.ok(ok.de && ok.es && ok.fr);
  const refused = await ACTIONS.test_connection(null, {
    config,
    createClient: () => fakeClient({ error: new DatadisAuthError() }),
  });
  assert.match(refused.en, /refused/);
  const missing = await ACTIONS.test_connection(null, { config: { username: '', password: '' } });
  assert.match(missing.en, /Enter/);
});

test('refresh_now syncs and says so', async () => {
  const ctx = await synced();
  const message = await ACTIONS.refresh_now(ctx.gladys, { engine: ctx.engine });
  assert.match(message.en, /refreshed for 1 supply/);
});
