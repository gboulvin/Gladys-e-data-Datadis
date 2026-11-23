import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DatadisAuthError,
  DatadisClient,
  DatadisError,
  DatadisRateLimitError,
  maskCups,
} from '../src/datadis.js';
import { localToUtc } from '../src/time.js';

const SUPPLY = {
  cups: 'ES0021000000000001AA0F',
  distributor_code: '2',
  point_type: 5,
};

// A fake fetch answering from a route table, recording the requests.
function fakeFetch(routes) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    requests.push({ pathname, query: Object.fromEntries(searchParams), init });
    const route = routes[pathname];
    const answer = typeof route === 'function' ? route(requests.at(-1)) : route;
    const { status = 200, body = '' } = answer ?? { status: 404 };
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => text,
    };
  };
  return { fetch, requests };
}

const LOGIN = '/nikola-auth/tokens/login';
const api = (endpoint) => `/api-private/api/${endpoint}`;

function client(routes, options = {}) {
  const fake = fakeFetch({ [LOGIN]: { body: 'token-1' }, ...routes });
  return {
    ...fake,
    client: new DatadisClient({
      username: '12345678Z',
      password: 'pw',
      fetch: fake.fetch,
      ...options,
    }),
  };
}

test('login posts the credentials as a form and keeps the bearer token', async () => {
  const { client: datadis, requests } = client({
    [api('get-supplies-v2')]: { body: { supplies: [], distributorError: [] } },
  });
  await datadis.getSupplies();
  assert.equal(requests[0].pathname, LOGIN);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.body, 'username=12345678Z&password=pw');
  assert.equal(requests[1].init.headers.Authorization, 'Bearer token-1');
});

test('Datadis "Bad credentials" (HTTP 500) is an authentication error', async () => {
  const { client: datadis } = client({ [LOGIN]: { status: 500, body: 'Bad credentials' } });
  await assert.rejects(datadis.getSupplies(), DatadisAuthError);
});

test('missing credentials fail before any request', async () => {
  const fake = fakeFetch({});
  const datadis = new DatadisClient({ username: '', password: '', fetch: fake.fetch });
  await assert.rejects(datadis.login(), DatadisAuthError);
  assert.equal(fake.requests.length, 0);
});

test('a 401 logs in again once, then retries', async () => {
  let calls = 0;
  const { client: datadis, requests } = client({
    [api('get-supplies-v2')]: () => {
      calls += 1;
      return calls === 1 ? { status: 401 } : { body: { supplies: [] } };
    },
  });
  await datadis.getSupplies();
  assert.equal(requests.filter((r) => r.pathname === LOGIN).length, 2);
});

test('a 429 is a rate limit error, a 500 a Datadis error', async () => {
  const { client: limited } = client({ [api('get-supplies-v2')]: { status: 429 } });
  await assert.rejects(limited.getSupplies(), DatadisRateLimitError);
  const { client: broken } = client({ [api('get-supplies-v2')]: { status: 500 } });
  await assert.rejects(
    broken.getSupplies(),
    (err) => err instanceof DatadisError && err.status === 500,
  );
});

test('a network failure is reported as unavailable', async () => {
  const datadis = new DatadisClient({
    username: 'a',
    password: 'b',
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(datadis.login(), (err) => err.reason === 'unavailable');
});

test('supplies are normalized, v2 envelope or bare array', async () => {
  const raw = {
    cups: 'es0021000000000001aa0f',
    address: 'CALLE MAYOR 1',
    postalCode: '28001',
    province: 'MADRID',
    municipality: 'MADRID',
    distributor: 'E-DISTRIBUCION',
    validDateFrom: '2020/01/01',
    validDateTo: '',
    pointType: 5,
    distributorCode: '2',
  };
  for (const body of [{ supplies: [raw], distributorError: [] }, [raw]]) {
    const { client: datadis } = client({ [api('get-supplies-v2')]: { body } });
    const [supply] = await datadis.getSupplies();
    assert.equal(supply.cups, 'ES0021000000000001AA0F');
    assert.equal(supply.distributor_code, '2');
    assert.equal(supply.point_type, 5);
  }
});

test('the authorized NIF is sent with every query', async () => {
  const { client: datadis, requests } = client(
    { [api('get-supplies-v2')]: { body: { supplies: [] } } },
    { authorizedNif: 'X1234567L' },
  );
  await datadis.getSupplies();
  assert.equal(requests.at(-1).query.authorizedNif, 'X1234567L');
});

test('consumption: monthly query, hours ending the interval mapped to local starts', async () => {
  const { client: datadis, requests } = client({
    [api('get-consumption-data-v2')]: {
      body: {
        timeCurve: [
          {
            cups: 'x',
            date: '2026/11/20',
            time: '01:00',
            consumptionKWh: 0.4,
            obtainMethod: 'Real',
          },
          {
            cups: 'x',
            date: '2026/11/20',
            time: '24:00',
            consumptionKWh: 0.6,
            obtainMethod: 'Estimada',
            surplusEnergyKWh: 0.1,
          },
          { cups: 'x', date: '2026/11/20', time: '00:00', consumptionKWh: 9, obtainMethod: 'Real' },
          { cups: 'x', date: 'garbage', time: '02:00', consumptionKWh: 1, obtainMethod: 'Real' },
        ],
      },
    },
  });
  const readings = await datadis.getConsumption(SUPPLY, '2026/11', '2026/11');
  assert.deepEqual(requests.at(-1).query, {
    cups: SUPPLY.cups,
    distributorCode: '2',
    startDate: '2026/11',
    endDate: '2026/11',
    measurementType: '0',
    pointType: '5',
  });
  assert.deepEqual(readings, [
    { start: localToUtc(2026, 11, 20, 0), kwh: 0.4, surplus_kwh: 0, real: true },
    { start: localToUtc(2026, 11, 20, 23), kwh: 0.6, surplus_kwh: 0.1, real: false },
  ]);
});

test('maximeter readings are in kW at a local time', async () => {
  const { client: datadis } = client({
    [api('get-max-power-v2')]: {
      body: {
        maxPower: [
          { cups: 'x', date: '2026/11/05', time: '20:15', maxPower: 3.45, period: 'VALLE' },
        ],
      },
    },
  });
  assert.deepEqual(await datadis.getMaxPower(SUPPLY, '2026/11', '2026/11'), [
    { at: localToUtc(2026, 11, 5, 20, 15), kw: 3.45, period: 'VALLE' },
  ]);
});

test('the current contract is the open-ended one', async () => {
  const { client: datadis } = client({
    [api('get-contract-detail-v2')]: {
      body: {
        contract: [
          {
            marketer: 'OLD',
            contractedPowerkW: [3.3],
            startDate: '2019/01/01',
            endDate: '2021/12/31',
          },
          { marketer: 'NEW', contractedPowerkW: [4.6, 5.75], startDate: '2022/01/01', endDate: '' },
        ],
      },
    },
  });
  const contract = await datadis.getContract(SUPPLY);
  assert.equal(contract.marketer, 'NEW');
  assert.deepEqual(contract.contracted_power_kw, [4.6, 5.75]);
});

test('maskCups never shows a full CUPS', () => {
  assert.equal(maskCups('ES0021000000000001AA0F'), 'ES0021…01AA0F');
});
