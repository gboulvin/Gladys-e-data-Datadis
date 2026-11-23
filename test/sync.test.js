import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatadisAuthError, DatadisRateLimitError } from '../src/datadis.js';
import { SCENE_TRIGGERS, toHalfHourIntervals } from '../src/sync.js';
import { FEATURE, supplyIds } from '../src/devices/supply.js';
import { DAY_MS, HOUR_MS, localToUtc } from '../src/time.js';
import { NOW, SUPPLY, fakeClient, hourlyDays, setup } from './helpers.js';

const consumption = { '2026/11': hourlyDays(1, 21, 0.5), '2026/10': hourlyDays(1, 31, 0.25, 10) };

test('toHalfHourIntervals splits every elapsed hour into two equal halves', () => {
  const start = localToUtc(2026, 11, 20);
  const intervals = toHalfHourIntervals({ [start]: 1, [NOW]: 2 }, NOW);
  assert.deepEqual(intervals, [
    { starts_at: new Date(start).toISOString(), kwh: 0.5 },
    { starts_at: new Date(start + HOUR_MS / 2).toISOString(), kwh: 0.5 },
  ]);
});

test('a first sync imports the history, publishes the consumption and the states', async () => {
  const client = fakeClient({ consumption });
  const { gladys, engine } = setup({ client, config: { history_months: 2 } });
  const result = await engine.sync();
  assert.deepEqual(result, { ok: true, reason: null, supplies: 1 });

  // Previous and current month, consumption and maximeter each.
  assert.deepEqual(
    client.calls.filter(([what]) => what === 'consumption').map(([, month]) => month),
    ['2026/10', '2026/11'],
  );

  const ids = supplyIds(gladys, SUPPLY.cups);
  const published = gladys.fake.publishedEnergyConsumption.flatMap((batch) => batch.intervals);
  // 31 + 21 days, 24 hours, two halves each.
  assert.equal(published.length, (31 + 21) * 24 * 2);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.LAST_DAY_CONSUMPTION)), 12);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.MONTH_CONSUMPTION)), 21 * 12);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.CONTRACTED_POWER)), 4600);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.LAST_DATA_DATE)), '2026-11-21');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(gladys.fake.transports.at(-1).transport, 'cloud');
  // Importing the history is not "new data".
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('the dated consumption waits until the device is created', async () => {
  const { gladys, engine, store } = setup({ client: fakeClient({ consumption }), created: false });
  await engine.sync();
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
  assert.deepEqual(store.entry(SUPPLY.cups).pending_publication.length > 0, true);
});

test('identical queries are spaced out by the refresh interval, unless forced', async () => {
  const client = fakeClient({ consumption });
  const { engine, clock } = setup({ client, config: { history_months: 1, refresh_hours: 12 } });
  await engine.sync();
  const first = client.calls.length;

  clock.now += HOUR_MS;
  assert.equal(engine.isDue(), false);
  await engine.sync();
  // Nothing re-read: the month queries were sent less than 12 h ago.
  assert.equal(client.calls.length, first);

  await engine.sync({ force: true });
  assert.ok(client.calls.length > first + 2, 'a forced sync re-reads');

  clock.now += 12 * HOUR_MS;
  assert.equal(engine.isDue(), true);
});

test('a new complete day fires new_daily_data, and high_daily_consumption above the threshold', async () => {
  const data = { '2026/11': hourlyDays(1, 20, 0.5) };
  const client = fakeClient({ consumption: data });
  const { gladys, engine, clock } = setup({
    client,
    config: { history_months: 1, daily_threshold_kwh: 20 },
  });
  await engine.sync();
  assert.equal(gladys.fake.sceneEvents.length, 0);

  // Next day: a heavy day arrives.
  data['2026/11'] = [...hourlyDays(1, 20, 0.5), ...hourlyDays(21, 21, 1)];
  clock.now += DAY_MS;
  await engine.sync();
  const device = supplyIds(gladys, SUPPLY.cups).device;
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.NEW_DAILY_DATA,
      data: { device, date: '2026-11-21', consumption_kwh: 24 },
    },
    {
      key: SCENE_TRIGGERS.HIGH_DAILY_CONSUMPTION,
      data: { device, date: '2026-11-21', consumption_kwh: 24, threshold_kwh: 20 },
    },
  ]);

  // The same day read again fires nothing.
  await engine.sync({ force: true });
  assert.equal(gladys.fake.sceneEvents.length, 2);
});

test('a maximeter peak near the contracted power fires power_peak_alarm once', async () => {
  const peaks = { '2026/11': [{ at: localToUtc(2026, 11, 3, 20, 15), kw: 2, period: '1' }] };
  const client = fakeClient({ consumption, maxPower: peaks });
  const { gladys, engine, clock } = setup({ client, config: { history_months: 1 } });
  await engine.sync();
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first sync only arms the detection');

  peaks['2026/11'] = [
    ...peaks['2026/11'],
    { at: localToUtc(2026, 11, 21, 21, 45), kw: 4.5, period: '1' },
  ];
  clock.now += DAY_MS;
  await engine.sync();
  const alarms = gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.POWER_PEAK_ALARM);
  assert.deepEqual(alarms, [
    {
      key: SCENE_TRIGGERS.POWER_PEAK_ALARM,
      data: {
        device: supplyIds(gladys, SUPPLY.cups).device,
        date: '2026-11-21',
        time: '21:45',
        max_power_w: 4500,
        contracted_power_w: 4600,
        percent: 98,
      },
    },
  ]);
  const ids = supplyIds(gladys, SUPPLY.cups);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.MAX_POWER)), 4500);

  await engine.sync({ force: true });
  assert.equal(
    gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.POWER_PEAK_ALARM).length,
    1,
  );
});

test('refused credentials report the status and fire sync_error once', async () => {
  const client = fakeClient({ error: new DatadisAuthError() });
  const { gladys, engine, clock } = setup({ client });
  const result = await engine.sync();
  assert.deepEqual(result, { ok: false, reason: 'auth', supplies: 0 });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.ok(gladys.fake.connectionStatus.message.es);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.data.reason),
    ['auth'],
  );

  clock.now += 3 * HOUR_MS;
  await engine.sync();
  assert.equal(gladys.fake.sceneEvents.length, 1, 'one event per incident');
});

test('a rate limit stops the sync and marks the supply unreachable', async () => {
  const client = fakeClient({ consumption });
  const { gladys, engine } = setup({ client, config: { history_months: 1 } });
  await engine.sync();
  client.getConsumption = async () => {
    throw new DatadisRateLimitError();
  };
  const result = await engine.sync({ force: true });
  assert.equal(result.reason, 'rate_limit');
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  // The cached data stays served.
  const ids = supplyIds(gladys, SUPPLY.cups);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURE.LAST_DAY_CONSUMPTION)), 12);
});

test('no credentials: nothing is read and the status says why', async () => {
  const client = fakeClient();
  const { gladys, engine } = setup({ client });
  engine.setConfig({ ...engine.config, password: '' });
  const result = await engine.sync();
  assert.equal(result.reason, 'credentials');
  assert.equal(client.calls.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('a new supply is published to the Discovery tab', async () => {
  const { gladys, engine } = setup({ client: fakeClient({ consumption }) });
  await engine.sync();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [supplyIds(gladys, SUPPLY.cups).device],
  );
});

test('changing the account resets the cache', async () => {
  const { engine, store } = setup({ client: fakeClient({ consumption }) });
  await engine.sync();
  assert.equal(store.entries().length, 1);
  engine.setConfig({ ...engine.config, username: 'X9999999Z' });
  assert.equal(store.entries().length, 0);
});

test('monthsToRead re-reads the previous month while its late readings can arrive', async () => {
  const { engine, store } = setup({ client: fakeClient({ consumption }) });
  await engine.sync();
  const entry = store.entry(SUPPLY.cups);
  // October was read on 2026-11-23, well after its late readings: done.
  assert.deepEqual(engine.monthsToRead(entry), ['2026-11']);
  // Read on November 2nd: its last days may still come, it is read again.
  entry.fetched_months['2026-10'] = localToUtc(2026, 11, 2);
  assert.deepEqual(engine.monthsToRead(entry), ['2026-10', '2026-11']);
});
