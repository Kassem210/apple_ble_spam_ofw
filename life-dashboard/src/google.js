// Google: Calendar + Gmail (read-only) and the Google Health API (Fitbit Air / Google Health app).
// Two separate connections so they can even be different Google accounts.

import { getKV, setKV, delKV, run } from './db.js';
import { sign } from './auth.js';
import { addDays, localToUtcISO } from './time.js';

export const CONNECTIONS = {
  google: {
    label: 'Google Calendar & Gmail',
    scopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
  },
  health: {
    label: 'Google Health (Fitbit Air)',
    scopes: [
      'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
      'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
      'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
    ],
  },
};

const redirectUri = (origin) => `${origin}/api/oauth/google/callback`;

export function googleConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export async function authUrl(env, origin, which) {
  const conn = CONNECTIONS[which];
  const nonce = crypto.randomUUID();
  const state = `${which}.${nonce}.${await sign(env, `oauth:${which}:${nonce}`)}`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: conn.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function handleCallback(env, origin, url) {
  const [which, nonce, sig] = (url.searchParams.get('state') || '').split('.');
  if (!CONNECTIONS[which] || sig !== await sign(env, `oauth:${which}:${nonce}`)) throw new Error('Invalid OAuth state');
  const code = url.searchParams.get('code');
  if (!code) throw new Error(url.searchParams.get('error') || 'No code returned');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(origin), grant_type: 'authorization_code',
    }),
  });
  const tok = await res.json();
  if (!res.ok) throw new Error(tok.error_description || tok.error || 'Token exchange failed');
  await setKV(env.DB, `token:${which}`, {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + (tok.expires_in - 60) * 1000,
    scope: tok.scope,
  });
  return which;
}

export async function disconnect(env, which) {
  await delKV(env.DB, `token:${which}`);
}

export async function connectionStatus(env) {
  const out = {};
  for (const which of Object.keys(CONNECTIONS)) {
    out[which] = Boolean(await getKV(env.DB, `token:${which}`));
  }
  return out;
}

async function accessToken(env, which) {
  const tok = await getKV(env.DB, `token:${which}`);
  if (!tok) return null;
  if (tok.expires_at > Date.now()) return tok.access_token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tok.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const next = await res.json();
  if (!res.ok) {
    if (next.error === 'invalid_grant') await delKV(env.DB, `token:${which}`); // revoked or expired: ask to reconnect
    throw new Error(`Google token refresh failed: ${next.error}`);
  }
  await setKV(env.DB, `token:${which}`, { ...tok, access_token: next.access_token, expires_at: Date.now() + (next.expires_in - 60) * 1000 });
  return next.access_token;
}

async function gget(env, which, url, init = {}) {
  const token = await accessToken(env, which);
  if (!token) return null;
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---------- Calendar ----------

export async function calendarEvents(env, date, tz, days = 1) {
  const params = new URLSearchParams({
    timeMin: localToUtcISO(date, '00:00', tz),
    timeMax: localToUtcISO(addDays(date, days), '00:00', tz),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '25',
    timeZone: tz,
  });
  const data = await gget(env, 'google', `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
  if (!data) return null;
  return (data.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({
    title: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: Boolean(e.start?.date),
    location: e.location || '',
    link: e.htmlLink,
  }));
}

// ---------- Gmail ----------

export async function unreadEmails(env, max = 5) {
  const list = await gget(env, 'google',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: 'is:unread category:primary newer_than:2d', maxResults: String(max) })}`);
  if (!list) return null;
  const messages = await Promise.all((list.messages || []).map((m) => gget(env, 'google',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)));
  const header = (m, name) => m.payload?.headers?.find((h) => h.name === name)?.value || '';
  return {
    count: list.resultSizeEstimate || messages.length,
    messages: messages.map((m) => ({
      from: header(m, 'From').replace(/<.*>/, '').replace(/"/g, '').trim(),
      subject: header(m, 'Subject') || '(no subject)',
      snippet: (m.snippet || '').slice(0, 140),
      link: `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
    })),
  };
}

// ---------- Google Health API (Fitbit Air) ----------

const HEALTH = 'https://health.googleapis.com/v4/users/me/dataTypes';

const civil = (date) => {
  const [year, month, day] = date.split('-').map(Number);
  return { date: { year, month, day } };
};

async function dailyRollUp(env, dataType, from, to) {
  const data = await gget(env, 'health', `${HEALTH}/${dataType}/dataPoints:dailyRollUp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: { start: civil(from), end: civil(addDays(to, 1)) }, windowSizeDays: 1 }),
  });
  const out = {};
  for (const p of data?.rollupDataPoints || []) {
    const d = p.civilStartTime?.date;
    if (d) out[`${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`] = p;
  }
  return out;
}

async function listPoints(env, dataType, filter, pageSize) {
  const params = new URLSearchParams({ filter });
  if (pageSize) params.set('pageSize', String(pageSize));
  const data = await gget(env, 'health', `${HEALTH}/${dataType}/dataPoints?${params}`);
  return data?.dataPoints || [];
}

const civilToDate = (c) => c?.date
  ? `${c.date.year}-${String(c.date.month).padStart(2, '0')}-${String(c.date.day).padStart(2, '0')}`
  : null;

// Pull the last few days into health_daily + workouts. Each metric is fetched
// independently so one unsupported data type doesn't break the rest.
export async function syncHealth(env, today, days = 3) {
  if (!(await getKV(env.DB, 'token:health'))) return { skipped: true };
  const from = addDays(today, -(days - 1));
  const rows = {};
  const row = (d) => (rows[d] ||= {});
  const errors = [];
  const attempt = async (name, fn) => {
    try { await fn(); } catch (err) { errors.push(`${name}: ${err.message}`); }
  };

  await attempt('steps', async () => {
    for (const [d, p] of Object.entries(await dailyRollUp(env, 'steps', from, today))) row(d).steps = Number(p.steps?.countSum || 0);
  });
  await attempt('total-calories', async () => {
    for (const [d, p] of Object.entries(await dailyRollUp(env, 'total-calories', from, today))) row(d).calories = Math.round(p.totalCalories?.kcalSum || 0);
  });
  await attempt('active-zone-minutes', async () => {
    for (const [d, p] of Object.entries(await dailyRollUp(env, 'active-zone-minutes', from, today))) {
      const z = p.activeZoneMinutes || {};
      row(d).active_zone_min = Number(z.sumInFatBurnHeartZone || 0) + Number(z.sumInCardioHeartZone || 0) + Number(z.sumInPeakHeartZone || 0);
    }
  });
  await attempt('daily-resting-heart-rate', async () => {
    const points = await listPoints(env, 'daily-resting-heart-rate', `daily_resting_heart_rate.date >= "${from}"`);
    for (const p of points) {
      const r = p.dailyRestingHeartRate;
      const d = r?.date && `${r.date.year}-${String(r.date.month).padStart(2, '0')}-${String(r.date.day).padStart(2, '0')}`;
      if (d) row(d).resting_hr = Number(r.beatsPerMinute);
    }
  });
  await attempt('sleep', async () => {
    const points = await listPoints(env, 'sleep', `sleep.interval.civil_end_time >= "${from}"`, 25);
    for (const p of points) {
      const s = p.sleep;
      const d = civilToDate(s?.interval?.civilEndTime); // sleep counts toward the day you wake up
      if (d && s.summary?.minutesAsleep) row(d).sleep_min = (row(d).sleep_min || 0) + Number(s.summary.minutesAsleep);
    }
  });
  await attempt('exercise', async () => {
    const points = await listPoints(env, 'exercise', `exercise.interval.civil_start_time >= "${from}"`, 25);
    for (const p of points) {
      const e = p.exercise;
      if (!e) continue;
      const start = e.interval?.startTime;
      const end = e.interval?.endTime;
      const activeSecs = e.activeDuration ? parseFloat(e.activeDuration) : null;
      const minutes = activeSecs ? activeSecs / 60 : (start && end ? (Date.parse(end) - Date.parse(start)) / 60000 : 0);
      const m = e.metricsSummary || {};
      await run(env.DB,
        `INSERT INTO workouts (date, type, duration_min, calories, distance_km, avg_hr, notes, source, external_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'health', ?)
         ON CONFLICT(external_id) DO UPDATE SET type = excluded.type, duration_min = excluded.duration_min,
           calories = excluded.calories, distance_km = excluded.distance_km, avg_hr = excluded.avg_hr`,
        civilToDate(e.interval?.civilStartTime) || today,
        e.displayName || prettyExercise(e.exerciseType),
        Math.round(minutes),
        m.caloriesKcal != null ? Math.round(m.caloriesKcal) : null,
        m.distanceMillimeters ? Math.round(m.distanceMillimeters / 10000) / 100 : null,
        m.averageHeartRateBeatsPerMinute ? Number(m.averageHeartRateBeatsPerMinute) : null,
        e.notes || '',
        p.name || `health:${start}`);
    }
  });

  for (const [date, r] of Object.entries(rows)) {
    await run(env.DB,
      `INSERT INTO health_daily (date, steps, calories, resting_hr, sleep_min, active_zone_min, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(date) DO UPDATE SET
         steps = COALESCE(excluded.steps, steps), calories = COALESCE(excluded.calories, calories),
         resting_hr = COALESCE(excluded.resting_hr, resting_hr), sleep_min = COALESCE(excluded.sleep_min, sleep_min),
         active_zone_min = COALESCE(excluded.active_zone_min, active_zone_min), synced_at = excluded.synced_at`,
      date, r.steps ?? null, r.calories ?? null, r.resting_hr ?? null, r.sleep_min ?? null, r.active_zone_min ?? null);
  }
  await setKV(env.DB, 'health_last_sync', { at: new Date().toISOString(), errors });
  return { days: Object.keys(rows).length, errors };
}

function prettyExercise(type) {
  return String(type || 'Workout').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
