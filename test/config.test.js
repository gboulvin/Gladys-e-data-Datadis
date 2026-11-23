import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCredentials, normalizeConfig } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig coerces numbers typed in a form and clamps them', () => {
  const config = normalizeConfig({
    refresh_hours: '1',
    history_months: '30',
    power_alert_percent: '95',
  });
  assert.equal(config.refresh_hours, 6);
  assert.equal(config.history_months, 24);
  assert.equal(config.power_alert_percent, 95);
  assert.equal(normalizeConfig({ refresh_hours: 'abc' }).refresh_hours, 12);
});

test('identifiers are trimmed and upper-cased, the password kept verbatim', () => {
  const config = normalizeConfig({
    username: ' 12345678z ',
    password: ' p w ',
    authorized_nif: 'x1l',
  });
  assert.equal(config.username, '12345678Z');
  assert.equal(config.password, ' p w ');
  assert.equal(config.authorized_nif, 'X1L');
});

test('hasCredentials needs both the username and the password', () => {
  assert.equal(hasCredentials(normalizeConfig({ username: 'a' })), false);
  assert.equal(hasCredentials(normalizeConfig({ username: 'a', password: 'b' })), true);
});
