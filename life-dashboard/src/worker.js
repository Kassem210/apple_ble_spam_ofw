// Life Dashboard — Cloudflare Worker entry point (API + scheduled jobs).
// Static files in /public are served by Workers Assets; everything under /api lands here.

import { ensureSchema, all, first, run, getKV, setKV } from './db.js';
import { getSettings, saveSettings } from './settings.js';
import {
  isAuthed, checkPassword, makeSessionCookie, clearSessionCookie, loginAllowed, recordLogin, widgetToken,
} from './auth.js';
import { zonedParts, greetingFor, prettyDate } from './time.js';
import {
  listTasks, addTask, updateTask, setTaskDone, deleteTask, listHabits, toggleHabit, addExpense,
  spendingSummary, addWorkout, fitnessSummary, addFocus, saveCheckin, scoreFor, scoreHistory,
  listMemories, remember,
} from './data.js';
import { getBriefing, weather } from './briefing.js';
import { chat, chatHistory, clearChat, aiConfigured, aiProvider } from './ai.js';
import {
  authUrl, handleCallback, disconnect, connectionStatus, googleConfigured, syncHealth, calendarEvents,
} from './google.js';
import { notifyAll } from './push.js';
import { tick } from './cron.js';
import { withSecrets } from './secrets.js';
import { parseQuickTask } from './intents.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});

const bad = (message, status = 400) => json({ error: message }, status);

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

async function context(env) {
  const settings = await getSettings(env);
  const now = zonedParts(new Date(), settings.timezone);
  return { settings, now, today: now.date };
}

async function cachedWeather(env, settings) {
  const cache = await getKV(env.DB, 'weather_cache', null);
  if (cache && cache.at > Date.now() - 30 * 60000 && cache.city === settings.city) return cache.data;
  try {
    const data = await weather(settings);
    await setKV(env.DB, 'weather_cache', { at: Date.now(), city: settings.city, data });
    return data;
  } catch {
    return cache?.data || null;
  }
}

async function todaysEvents(env, settings, today) {
  const cache = await getKV(env.DB, 'calendar_cache', null);
  if (cache && cache.date === today && cache.at > Date.now() - 10 * 60000) return cache.events;
  try {
    const events = await calendarEvents(env, today, settings.timezone);
    await setKV(env.DB, 'calendar_cache', { at: Date.now(), date: today, events });
    return events;
  } catch {
    return cache?.events || null;
  }
}

async function dashboard(env) {
  const { settings, now, today } = await context(env);
  const [briefingRow, todayTasks, upcoming, doneToday, habits, score, history, money, fitness, wx, events, connections, checkin] = await Promise.all([
    first(env.DB, 'SELECT content FROM briefings WHERE date = ?', today),
    listTasks(env, { scope: 'today', today }),
    listTasks(env, { scope: 'upcoming', today, limit: 20 }),
    listTasks(env, { scope: 'done_today', today }),
    listHabits(env, today),
    scoreFor(env, today, settings),
    scoreHistory(env, today, 14),
    spendingSummary(env, today),
    fitnessSummary(env, today),
    cachedWeather(env, settings),
    todaysEvents(env, settings, today),
    connectionStatus(env),
    first(env.DB, 'SELECT * FROM checkins WHERE date = ?', today),
  ]);
  return {
    now: { ...now, pretty: prettyDate(today), greeting: greetingFor(now.hour) },
    settings,
    briefing: briefingRow ? JSON.parse(briefingRow.content) : null,
    tasks: { today: todayTasks, upcoming, doneToday },
    habits,
    score,
    scoreHistory: [...history.filter((h) => h.date !== today), { date: today, score: score.score }],
    money,
    fitness,
    weather: wx,
    events,
    checkin,
    status: {
      ai: aiConfigured(env),
      aiProvider: aiProvider(env),
      google: googleConfigured(env),
      connections,
      push: Boolean(env.VAPID_PUBLIC_KEY),
      healthSync: await getKV(env.DB, 'health_last_sync', null),
    },
  };
}

async function widget(env) {
  const { settings, now, today } = await context(env);
  const [tasks, doneToday, score, wx, money, health, habits] = await Promise.all([
    listTasks(env, { scope: 'today', today }),
    first(env.DB, 'SELECT COUNT(*) AS n FROM tasks WHERE done = 1 AND done_date = ?', today),
    scoreFor(env, today, settings),
    cachedWeather(env, settings),
    first(env.DB, 'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date = ?', today),
    first(env.DB, 'SELECT steps FROM health_daily WHERE date = ?', today),
    listHabits(env, today),
  ]);
  const nowHM = now.time;
  const next = tasks.find((t) => t.due_date === today && t.due_time && t.due_time >= nowHM)
    || [...tasks].sort((a, b) => b.priority - a.priority)[0] || null;
  return {
    name: settings.name,
    greeting: greetingFor(now.hour),
    date: prettyDate(today),
    time: nowHM,
    score: score.score,
    scoreLabel: score.label,
    tasksLeft: tasks.length,
    doneToday: doneToday.n,
    next: next ? { title: next.title, time: next.due_time, overdue: next.due_date < today } : null,
    weather: wx ? { temp: wx.now, icon: wx.icon, desc: wx.desc, high: wx.high, low: wx.low } : null,
    steps: health?.steps ?? null,
    spentToday: money.total,
    currency: settings.currency,
    habits: { done: habits.filter((h) => h.doneToday).length, total: habits.length },
  };
}

async function handleApi(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const origin = url.origin;

  // ----- Public endpoints -----
  if (path === '/api/health') return json({ ok: true });

  if (path === '/api/login' && method === 'POST') {
    if (!env.APP_PASSWORD) return bad('APP_PASSWORD is not set yet. Add it in Cloudflare → your Worker → Settings → Variables and Secrets.', 500);
    if (!(await loginAllowed(env))) return bad('Too many attempts. Try again in 15 minutes.', 429);
    const { password } = await body(request);
    const ok = await checkPassword(env, password);
    await recordLogin(env, ok);
    if (!ok) return bad('Wrong password', 401);
    return json({ ok: true }, 200, { 'Set-Cookie': await makeSessionCookie(env) });
  }

  if (path === '/api/widget' && method === 'GET') {
    if (!env.SESSION_SECRET || url.searchParams.get('t') !== await widgetToken(env)) return bad('Bad widget token', 401);
    return json(await widget(env), 200, { 'Access-Control-Allow-Origin': '*' });
  }

  const authed = env.SESSION_SECRET && await isAuthed(request, env);
  if (path === '/api/session') return json({ authed: Boolean(authed), configured: Boolean(env.APP_PASSWORD) });
  if (!authed) return bad('Locked', 401);

  // Cross-site requests can't carry our SameSite=Lax cookie on POST, but be explicit anyway.
  if (method !== 'GET' && request.headers.get('Origin') && request.headers.get('Origin') !== origin) return bad('Bad origin', 403);

  // ----- Authenticated endpoints -----
  if (path === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });

  if (path === '/api/dashboard') return json(await dashboard(env));

  if (path === '/api/briefing') {
    const { settings, today } = await context(env);
    return json(await getBriefing(env, settings, today, { refresh: url.searchParams.get('refresh') === '1' }));
  }

  // Tasks
  if (path === '/api/tasks' && method === 'GET') {
    const { today } = await context(env);
    return json(await listTasks(env, { scope: url.searchParams.get('scope') || 'open', today }));
  }
  if (path === '/api/tasks' && method === 'POST') {
    try { return json(await addTask(env, await body(request)), 201); } catch (err) { return bad(err.message); }
  }
  if (path === '/api/tasks/quick' && method === 'POST') {
    const { text } = await body(request);
    const { today } = await context(env);
    const parsed = parseQuickTask(String(text || ''), today);
    if (!parsed.title) return bad('Type a task first');
    return json(await addTask(env, parsed), 201);
  }
  let m = path.match(/^\/api\/tasks\/(\d+)(?:\/(done|undo|snooze))?$/);
  if (m) {
    const id = Number(m[1]);
    const { settings, today, now } = await context(env);
    if (m[2] === 'done' && method === 'POST') return json(await setTaskDone(env, id, true, today, settings));
    if (m[2] === 'undo' && method === 'POST') return json(await setTaskDone(env, id, false, today, settings));
    if (m[2] === 'snooze' && method === 'POST') {
      const { minutes = 15 } = await body(request);
      const at = zonedParts(new Date(Date.now() + Number(minutes) * 60000), settings.timezone);
      await run(env.DB, 'UPDATE tasks SET reminded = 0, snooze_until = ? WHERE id = ?', `${at.date} ${at.time}`, id);
      return json({ ok: true, until: `${at.date} ${at.time}`, now: now.time });
    }
    if (!m[2] && method === 'PATCH') return json(await updateTask(env, id, await body(request)));
    if (!m[2] && method === 'DELETE') { await deleteTask(env, id); return json({ ok: true }); }
  }

  // Habits
  if (path === '/api/habits' && method === 'GET') return json(await listHabits(env, (await context(env)).today));
  if (path === '/api/habits' && method === 'POST') {
    const { name, icon } = await body(request);
    if (!name) return bad('Name required');
    return json(await first(env.DB, 'INSERT INTO habits (name, icon) VALUES (?, ?) RETURNING *', String(name).slice(0, 60), String(icon || '✨').slice(0, 8)), 201);
  }
  m = path.match(/^\/api\/habits\/(\d+)(?:\/(toggle))?$/);
  if (m) {
    if (m[2] === 'toggle' && method === 'POST') {
      const { done } = await body(request);
      await toggleHabit(env, Number(m[1]), (await context(env)).today, done !== false);
      return json({ ok: true });
    }
    if (!m[2] && method === 'DELETE') {
      await run(env.DB, 'UPDATE habits SET archived = 1 WHERE id = ?', Number(m[1]));
      return json({ ok: true });
    }
  }

  // Money
  if (path === '/api/money') return json(await spendingSummary(env, (await context(env)).today));
  if (path === '/api/expenses' && method === 'POST') {
    try { return json(await addExpense(env, await body(request), (await context(env)).today), 201); } catch (err) { return bad(err.message); }
  }
  m = path.match(/^\/api\/expenses\/(\d+)$/);
  if (m && method === 'DELETE') { await run(env.DB, 'DELETE FROM expenses WHERE id = ?', Number(m[1])); return json({ ok: true }); }

  // Fitness
  if (path === '/api/fitness') return json(await fitnessSummary(env, (await context(env)).today));
  if (path === '/api/workouts' && method === 'POST') return json(await addWorkout(env, await body(request), (await context(env)).today), 201);
  m = path.match(/^\/api\/workouts\/(\d+)$/);
  if (m && method === 'DELETE') { await run(env.DB, 'DELETE FROM workouts WHERE id = ?', Number(m[1])); return json({ ok: true }); }
  if (path === '/api/health/sync' && method === 'POST') {
    try { return json(await syncHealth(env, (await context(env)).today, 7)); } catch (err) { return bad(err.message, 502); }
  }

  // Focus, check-in, score
  if (path === '/api/focus' && method === 'POST') {
    const { minutes, label } = await body(request);
    return json(await addFocus(env, minutes, label, (await context(env)).today), 201);
  }
  if (path === '/api/checkin' && method === 'POST') {
    const { settings, today } = await context(env);
    await saveCheckin(env, today, await body(request));
    return json(await scoreFor(env, today, settings, { save: true }));
  }
  if (path === '/api/score') {
    const { settings, today } = await context(env);
    return json({ today: await scoreFor(env, today, settings), history: await scoreHistory(env, today, 30) });
  }

  // Assistant
  if (path === '/api/chat' && method === 'POST') {
    const { message } = await body(request);
    if (!message || !String(message).trim()) return bad('Say something');
    return json(await chat(env, await getSettings(env), message));
  }
  if (path === '/api/chat' && method === 'GET') return json(await chatHistory(env));
  if (path === '/api/chat' && method === 'DELETE') { await clearChat(env); return json({ ok: true }); }

  // Memory
  if (path === '/api/memories' && method === 'GET') return json(await listMemories(env));
  if (path === '/api/memories' && method === 'POST') {
    const { text } = await body(request);
    if (!text) return bad('Text required');
    return json(await remember(env, text), 201);
  }
  m = path.match(/^\/api\/memories\/(\d+)$/);
  if (m && method === 'DELETE') { await run(env.DB, 'DELETE FROM memories WHERE id = ?', Number(m[1])); return json({ ok: true }); }

  // Settings
  if (path === '/api/settings' && method === 'GET') return json(await getSettings(env));
  if (path === '/api/settings' && method === 'PUT') {
    const next = await saveSettings(env, await body(request));
    await setKV(env.DB, 'weather_cache', null);
    return json(next);
  }

  // Push notifications
  if (path === '/api/push/key') return json({ key: env.VAPID_PUBLIC_KEY || null });
  if (path === '/api/push/subscribe' && method === 'POST') {
    const sub = await body(request);
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return bad('Invalid subscription');
    await run(env.DB,
      'INSERT INTO push_subs (endpoint, p256dh, auth) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth',
      sub.endpoint, sub.keys.p256dh, sub.keys.auth);
    return json({ ok: true });
  }
  if (path === '/api/push/test' && method === 'POST') {
    const { settings } = await context(env);
    return json(await notifyAll(env, {
      title: `${settings.assistantName} here 👋`,
      body: 'Notifications are working. Your briefing arrives every morning at ' + settings.briefingTime + '.',
      url: '/',
      tag: 'test',
    }));
  }

  // Google
  if (path === '/api/oauth/google/start') {
    if (!googleConfigured(env)) return bad('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. See the README.', 500);
    const which = url.searchParams.get('which') === 'health' ? 'health' : 'google';
    return Response.redirect(await authUrl(env, origin, which), 302);
  }
  if (path === '/api/oauth/google/callback') {
    try {
      const which = await handleCallback(env, origin, url);
      if (which === 'health') ctx.waitUntil(syncHealth(env, (await context(env)).today, 14).catch(() => {}));
      return Response.redirect(`${origin}/?connected=${which}#settings`, 302);
    } catch (err) {
      return Response.redirect(`${origin}/?oauth_error=${encodeURIComponent(err.message)}#settings`, 302);
    }
  }
  if (path === '/api/google/disconnect' && method === 'POST') {
    const { which } = await body(request);
    await disconnect(env, which === 'health' ? 'health' : 'google');
    return json({ ok: true });
  }

  // Widget token + data export
  if (path === '/api/widget/token') return json({ token: await widgetToken(env), url: `${origin}/api/widget?t=${await widgetToken(env)}` });
  if (path === '/api/export') {
    const tables = ['tasks', 'habits', 'habit_logs', 'expenses', 'workouts', 'health_daily', 'focus_sessions', 'checkins', 'scores', 'memories'];
    const out = { exportedAt: new Date().toISOString(), settings: await getSettings(env) };
    for (const t of tables) out[t] = await all(env.DB, `SELECT * FROM ${t}`);
    return json(out, 200, { 'Content-Disposition': `attachment; filename="life-dashboard-${(await context(env)).today}.json"` });
  }

  // Manual trigger for the scheduled job (handy for testing).
  if (path === '/api/cron/run' && method === 'POST') return json({ log: await tick(env) });

  return bad('Not found', 404);
}

export default {
  async fetch(request, rawEnv, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return rawEnv.ASSETS.fetch(request);
    try {
      await ensureSchema(rawEnv.DB);
      const env = await withSecrets(rawEnv);
      return await handleApi(request, env, ctx, url);
    } catch (err) {
      console.log('API error', err.stack || err.message);
      return bad(`Server error: ${err.message}`, 500);
    }
  },

  async scheduled(event, rawEnv, ctx) {
    await ensureSchema(rawEnv.DB);
    const env = await withSecrets(rawEnv);
    ctx.waitUntil(tick(env).then((log) => log.length && console.log('cron', log.join(' | '))));
  },
};
