// Apple Health → dashboard, via an iPhone Shortcut (no Google project needed).
// The Shortcut POSTs whatever it finds; everything here is deliberately lenient
// because Shortcuts formats numbers, lists and dates in a few different ways.

import { first, run, setKV, getKV } from './db.js';
import { sign } from './auth.js';
import { zonedParts } from './time.js';

export async function ingestToken(env) {
  return (await sign(env, 'apple-health-v1')).slice(0, 32);
}

// "7,532" / "7532 steps" / 7532 / "7.532,5" -> number (or null)
export function parseNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/ /g, ' ').match(/-?\d[\d.,\s]*/);
  if (!m) return null;
  let s = m[0].replace(/\s/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = /,\d{3}(?!\d)/.test(s) && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Shortcuts sends a list either as a JSON array or as newline-separated text.
export function toList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap(toList);
  if (typeof v === 'object') return [v];
  return String(v).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// A day's total. With "Group By: Day" the Shortcut sends one number (or one per
// source, e.g. iPhone + Fitbit, where the largest is the best guess at the real total
// — adding them would double count). Many small values mean ungrouped samples: sum them.
function quantity(v) {
  const nums = toList(v).map(parseNum).filter((n) => n != null && n >= 0);
  if (!nums.length) return null;
  return nums.length <= 3 ? Math.max(...nums) : nums.reduce((a, b) => a + b, 0);
}

const ASLEEP = /asleep|core|deep|rem|light|^[1345]$/i;
const IN_BED = /in ?bed|^0$/i;

function parseDate(s) {
  if (s == null) return null;
  const t = Date.parse(String(s).trim().replace(' at ', ' '));
  return Number.isFinite(t) ? t : null;
}

// Merge overlapping intervals so two trackers recording the same night count once.
function mergedMinutes(intervals) {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of sorted) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else {
      cur[1] = Math.max(cur[1], b);
    }
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round(total / 60000);
}

export function sleepMinutes(body) {
  // Direct numbers win: sleep_min, or sleep_hours.
  const direct = parseNum(Array.isArray(body.sleep_min) ? body.sleep_min[0] : body.sleep_min);
  if (direct) return Math.round(direct);
  const hours = parseNum(Array.isArray(body.sleep_hours) ? body.sleep_hours[0] : body.sleep_hours);
  if (hours) return Math.round(hours * 60);

  const values = toList(body.sleep_value);
  const starts = toList(body.sleep_start).map(parseDate);
  const ends = toList(body.sleep_end).map(parseDate);
  const n = Math.min(starts.length, ends.length);
  if (!n) return null;
  const asleep = [];
  const inBed = [];
  for (let i = 0; i < n; i++) {
    if (starts[i] == null || ends[i] == null) continue;
    const v = values[i] ?? 'asleep';
    if (IN_BED.test(v)) inBed.push([starts[i], ends[i]]);
    else if (ASLEEP.test(v)) asleep.push([starts[i], ends[i]]);
  }
  // Some trackers only write "In Bed"; use it when there are no sleep stages.
  const minutes = mergedMinutes(asleep.length ? asleep : inBed);
  return minutes > 0 ? minutes : null;
}

export async function ingest(env, settings, body) {
  const today = zonedParts(new Date(), settings.timezone).date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : today;
  const parsed = {
    date,
    steps: quantity(body.steps),
    sleep_min: sleepMinutes(body),
    resting_hr: quantity(body.resting_hr ?? body.rhr),
    calories: quantity(body.active_kcal ?? body.calories),
  };
  if (parsed.steps != null) parsed.steps = Math.round(parsed.steps);
  if (parsed.resting_hr != null) parsed.resting_hr = Math.round(parsed.resting_hr);
  if (parsed.calories != null) parsed.calories = Math.round(parsed.calories);

  await run(env.DB,
    `INSERT INTO health_daily (date, steps, calories, resting_hr, sleep_min, synced_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(date) DO UPDATE SET
       steps = CASE WHEN excluded.steps IS NULL THEN steps ELSE MAX(COALESCE(steps, 0), excluded.steps) END,
       calories = COALESCE(excluded.calories, calories),
       resting_hr = COALESCE(excluded.resting_hr, resting_hr),
       sleep_min = COALESCE(excluded.sleep_min, sleep_min),
       synced_at = excluded.synced_at`,
    date, parsed.steps, parsed.calories, parsed.resting_hr, parsed.sleep_min);

  // Keep what arrived so the Settings screen can show it (handy when tuning the Shortcut).
  const raw = JSON.stringify(body);
  await setKV(env.DB, 'apple_health_last', { at: new Date().toISOString(), parsed, raw: raw.length > 1500 ? `${raw.slice(0, 1500)}…` : raw });

  const row = await first(env.DB, 'SELECT * FROM health_daily WHERE date = ?', date);
  const bits = [];
  if (row?.steps != null) bits.push(`${row.steps.toLocaleString('en-US')} steps`);
  if (row?.sleep_min) bits.push(`${Math.floor(row.sleep_min / 60)}h ${row.sleep_min % 60}m sleep`);
  if (row?.resting_hr) bits.push(`${row.resting_hr} bpm resting`);
  return { parsed, message: `Life synced ✓ ${bits.join(' · ') || '(no data found)'}` };
}

export async function lastIngest(env) {
  return getKV(env.DB, 'apple_health_last', null);
}
