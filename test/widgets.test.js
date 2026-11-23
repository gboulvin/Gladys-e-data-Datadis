import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DatadisAuthError } from '../src/datadis.js';
import {
  SUPPLIES_SUMMARY_WIDGET,
  SUPPLY_OVERVIEW_WIDGET,
  WIDGETS,
  refreshWidgets,
} from '../src/widgets.js';
import { supplyIds } from '../src/devices/supply.js';
import { localToUtc } from '../src/time.js';
import { SUPPLY, fakeClient, hourlyDays, setup } from './helpers.js';

const LANGUAGES = ['en', 'fr', 'de', 'es'];

async function syncedEngine() {
  const client = fakeClient({
    consumption: { '2026/11': hourlyDays(1, 21, 0.5) },
    maxPower: { '2026/11': [{ at: localToUtc(2026, 11, 5, 20), kw: 3.2, period: '1' }] },
  });
  const ctx = setup({ client, config: { history_months: 1 } });
  await ctx.engine.sync();
  return ctx;
}

const get = (ctx, key, settings = {}) =>
  WIDGETS[key].get(ctx.gladys, { settings, language: 'en', units: 'metric', engine: ctx.engine });

// Every text of a content is a 4-language object (or a plain number/string value).
function assertTranslated(node, path = 'content') {
  if (Array.isArray(node)) {
    node.forEach((child, i) => assertTranslated(child, `${path}[${i}]`));
  } else if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      for (const lang of LANGUAGES) {
        assert.ok(node[lang], `${path} lacks ${lang}`);
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      assertTranslated(child, `${path}.${key}`);
    }
  }
}

test('supply_overview is rendered exactly as sent, in four languages', async () => {
  const ctx = await syncedEngine();
  const content = await get(ctx, SUPPLY_OVERVIEW_WIDGET, {
    device: supplyIds(ctx.gladys, SUPPLY.cups).device,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assertTranslated(content);
  const types = content.components.map((c) => c.type);
  assert.deepEqual(types, ['value', 'value', 'gauge', 'chart', 'status', 'button']);
  assert.equal(content.components[0].value, 12);
  assert.equal(content.components[2].value, 3.2);
  assert.equal(content.components[2].max, 4.6);
});

test('supply_overview without a chosen supply asks for one', async () => {
  const ctx = await syncedEngine();
  const content = await get(ctx, SUPPLY_OVERVIEW_WIDGET);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].type, 'text');
});

test('supply_overview of a supply without data yet is valid', async () => {
  const ctx = setup({ client: fakeClient(), config: { history_months: 1 } });
  await ctx.engine.sync();
  const content = await get(ctx, SUPPLY_OVERVIEW_WIDGET, {
    device: supplyIds(ctx.gladys, SUPPLY.cups).device,
  });
  assert.deepEqual(validateWidgetContent(content), []);
});

test('supplies_summary is valid, with data and in error', async () => {
  const ctx = await syncedEngine();
  const content = await get(ctx, SUPPLIES_SUMMARY_WIDGET);
  assert.deepEqual(validateWidgetContent(content), []);
  assertTranslated(content);
  assert.equal(content.components[0].items.length, 1);

  const failing = setup({ client: fakeClient({ error: new DatadisAuthError() }) });
  await failing.engine.sync();
  const error = await get(failing, SUPPLIES_SUMMARY_WIDGET);
  assert.deepEqual(validateWidgetContent(error), []);
});

test('the refresh button of every widget syncs and answers a short toast', async () => {
  const ctx = await syncedEngine();
  for (const key of Object.keys(WIDGETS)) {
    const message = await WIDGETS[key].action(ctx.gladys, {
      actionKey: 'refresh',
      params: {},
      settings: {},
      engine: ctx.engine,
    });
    for (const lang of LANGUAGES) {
      assert.ok(message[lang].length <= 200);
    }
  }
});

test('an unknown widget action fails', async () => {
  const ctx = await syncedEngine();
  await assert.rejects(
    WIDGETS[SUPPLY_OVERVIEW_WIDGET].action(ctx.gladys, { actionKey: 'nope', engine: ctx.engine }),
    /Unknown widget action/,
  );
});

test('refreshWidgets nudges every widget', () => {
  const fresh = createFakeGladys();
  refreshWidgets(fresh);
  assert.deepEqual(fresh.fake.widgetRefreshes, Object.keys(WIDGETS));
});
