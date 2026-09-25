import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fake-d1.mjs';
import { ensureSchema, first } from '../src/db.js';
import { parseNum, toList, sleepMinutes, ingest } from '../src/apple-health.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

test('parseNum copes with Shortcuts number formats', () => {
  assert.equal(parseNum('7,532'), 7532);
  assert.equal(parseNum('7532 steps'), 7532);
  assert.equal(parseNum('12,345,678'), 12345678);
  assert.equal(parseNum('62.5'), 62.5);
  assert.equal(parseNum('62,5'), 62.5);
  assert.equal(parseNum('1.234,5'), 1234.5);
  assert.equal(parseNum(58), 58);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('n/a'), null);
});

test('toList accepts arrays and newline text', () => {
  assert.deepEqual(toList('a\nb\n'), ['a', 'b']);
  assert.deepEqual(toList(['a', ['b']]), ['a', 'b']);
  assert.deepEqual(toList(null), []);
});

test('sleep: stages summed, awake/in-bed ignored, overlapping trackers merged', () => {
  const body = {
    sleep_value: 'In Bed\nCore\nDeep\nAwake\nREM\nAsleep',
    sleep_start: [
      '2026-09-24T23:30:00+03:00', // in bed (ignored because stages exist)
      '2026-09-25T00:00:00+03:00', // core 2h
      '2026-09-25T02:00:00+03:00', // deep 1h
      '2026-09-25T03:00:00+03:00', // awake 15m (ignored)
      '2026-09-25T03:15:00+03:00', // rem 2h45
      '2026-09-25T00:30:00+03:00', // second tracker, overlaps -> merged
    ].join('\n'),
    sleep_end: [
      '2026-09-25T07:00:00+03:00',
      '2026-09-25T02:00:00+03:00',
      '2026-09-25T03:00:00+03:00',
      '2026-09-25T03:15:00+03:00',
      '2026-09-25T06:00:00+03:00',
      '2026-09-25T05:30:00+03:00',
    ].join('\n'),
  };
  // asleep union: 00:00-03:00 plus 03:15-06:00, and the second tracker covers 03:00-03:15 too -> 00:00-06:00
  assert.equal(sleepMinutes(body), 360);
});

test('sleep: falls back to In Bed, and accepts direct hours', () => {
  assert.equal(sleepMinutes({ sleep_value: ['In Bed'], sleep_start: ['2026-09-25T00:00:00Z'], sleep_end: ['2026-09-25T07:30:00Z'] }), 450);
  assert.equal(sleepMinutes({ sleep_hours: '7.5' }), 450);
  assert.equal(sleepMinutes({}), null);
});

test('ingest stores data, steps only go up, empty fields keep old values', async () => {
  const env = { DB: fakeD1(), SESSION_SECRET: 'x' };
  await ensureSchema(env.DB);
  const r1 = await ingest(env, DEFAULT_SETTINGS, { date: '2026-09-25', steps: '1,200', sleep_hours: '7', resting_hr: '58' });
  assert.match(r1.message, /1,200 steps · 7h 0m sleep · 58 bpm/);
  await ingest(env, DEFAULT_SETTINGS, { date: '2026-09-25', steps: ['9,800', '6,000'], sleep_value: '', sleep_start: '', sleep_end: '' });
  const row = await first(env.DB, 'SELECT * FROM health_daily WHERE date = ?', '2026-09-25');
  assert.equal(row.steps, 9800);
  assert.equal(row.sleep_min, 420);
  assert.equal(row.resting_hr, 58);
  await ingest(env, DEFAULT_SETTINGS, { date: '2026-09-25', steps: '300' }); // stale/partial read must not lower it
  assert.equal((await first(env.DB, 'SELECT steps FROM health_daily WHERE date = ?', '2026-09-25')).steps, 9800);
});
