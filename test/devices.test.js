import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildSupplyDevice, supplyName } from '../src/devices/supply.js';
import { Store } from '../src/store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SUPPLY } from './helpers.js';

test('the supply device is accepted by Gladys', async () => {
  const gladys = createFakeGladys();
  await gladys.publishDiscoveredDevices([buildSupplyDevice(gladys, SUPPLY)]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('every feature carries the columns Gladys needs to create it', () => {
  const gladys = createFakeGladys();
  for (const feature of buildSupplyDevice(gladys, SUPPLY).features) {
    for (const key of ['name', 'min', 'max', 'read_only', 'has_feedback']) {
      assert.notEqual(feature[key], undefined, `${feature.external_id}.${key}`);
    }
    assert.equal(feature.read_only, true);
  }
});

test('external ids are built from the CUPS, never from a label', () => {
  const gladys = createFakeGladys();
  const device = buildSupplyDevice(gladys, SUPPLY);
  assert.equal(device.external_id, gladys.externalIds('supply', SUPPLY.cups).device);
  const renamed = buildSupplyDevice(gladys, { ...SUPPLY, address: 'OTRA CALLE' });
  assert.equal(renamed.external_id, device.external_id);
});

test('a supply without address is named after its masked CUPS', () => {
  assert.equal(
    supplyName({ cups: SUPPLY.cups, address: '', municipality: '' }),
    'e-data ES0021…01AA0F',
  );
  assert.equal(supplyName(SUPPLY), 'e-data CALLE MAYOR 1, MADRID');
});

test('the cache survives a restart, written atomically under the data directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edata-'));
  try {
    const store = new Store({ dir });
    store.setSupplies([SUPPLY], 1);
    store.entry(SUPPLY.cups).hourly[1000] = 0.5;
    await store.save();
    const reloaded = new Store({ dir });
    await reloaded.load();
    assert.equal(reloaded.entry(SUPPLY.cups).hourly[1000], 0.5);
    assert.equal(JSON.stringify(reloaded.state).includes('password'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
