// Domain operations shared by the REST API, the assistant's tools and the cron jobs.

import { all, first, run } from './db.js';
import { addDays, weekdayOf, monthStart } from './time.js';
import { computeScore } from './score.js';

// ---------- Tasks ----------

export const PRIORITY = { low: 1, normal: 2, medium: 2, high: 3, urgent: 3 };

export function normalizeTask(input) {
  const t = {};
  if (input.title != null) t.title = String(input.title).trim().slice(0, 300);
  if (input.notes != null) t.notes = String(input.notes).slice(0, 4000);
  if (input.due_date !== undefined) t.due_date = /^\d{4}-\d{2}-\d{2}$/.test(input.due_date || '') ? input.due_date : null;
  if (input.due_time !== undefined) t.due_time = /^\d{2}:\d{2}$/.test(input.due_time || '') ? input.due_time : null;
  if (input.priority != null) {
    const p = typeof input.priority === 'string' ? PRIORITY[input.priority.toLowerCase()] : Number(input.priority);
    t.priority = [1, 2, 3].includes(p) ? p : 2;
  }
  if (input.category != null) t.category = String(input.category).trim().slice(0, 40);
  if (input.recurrence != null) {
    t.recurrence = ['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(input.recurrence) ? input.recurrence : 'none';
  }
  return t;
}

export function nextOccurrence(date, recurrence, weekendDays = [5, 6]) {
  if (recurrence === 'daily') return addDays(date, 1);
  if (recurrence === 'weekly') return addDays(date, 7);
  if (recurrence === 'monthly') {
    const [y, m, d] = date.split('-').map(Number);
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
  }
  if (recurrence === 'weekdays') {
    let next = addDays(date, 1);
    for (let i = 0; i < 7 && weekendDays.includes(weekdayOf(next)); i++) next = addDays(next, 1);
    return next;
  }
  return null;
}

export async function listTasks(env, { scope = 'open', today, limit = 200 } = {}) {
  const db = env.DB;
  const order = 'ORDER BY due_date IS NULL, due_date, due_time IS NULL, due_time, priority DESC, id';
  switch (scope) {
    case 'today':
      return all(db, `SELECT * FROM tasks WHERE done = 0 AND due_date <= ? ${order} LIMIT ?`, today, limit);
    case 'overdue':
      return all(db, `SELECT * FROM tasks WHERE done = 0 AND due_date < ? ${order} LIMIT ?`, today, limit);
    case 'upcoming':
      return all(db, `SELECT * FROM tasks WHERE done = 0 AND due_date > ? ${order} LIMIT ?`, today, limit);
    case 'someday':
      return all(db, `SELECT * FROM tasks WHERE done = 0 AND due_date IS NULL ${order} LIMIT ?`, limit);
    case 'done':
      return all(db, 'SELECT * FROM tasks WHERE done = 1 ORDER BY done_at DESC LIMIT ?', limit);
    case 'done_today':
      return all(db, 'SELECT * FROM tasks WHERE done = 1 AND done_date = ? ORDER BY done_at DESC', today);
    default:
      return all(db, `SELECT * FROM tasks WHERE done = 0 ${order} LIMIT ?`, limit);
  }
}

export async function addTask(env, input) {
  const t = normalizeTask(input);
  if (!t.title) throw new Error('A task needs a title');
  const row = await first(env.DB,
    `INSERT INTO tasks (title, notes, due_date, due_time, priority, category, recurrence)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    t.title, t.notes || '', t.due_date || null, t.due_time || null, t.priority || 2, t.category || '', t.recurrence || 'none');
  return row;
}

export async function updateTask(env, id, input) {
  const t = normalizeTask(input);
  const keys = Object.keys(t);
  if (!keys.length) return first(env.DB, 'SELECT * FROM tasks WHERE id = ?', id);
  // Moving a task's time re-arms its reminder.
  const rearm = ('due_date' in t || 'due_time' in t) ? ', reminded = 0, snooze_until = NULL' : '';
  return first(env.DB,
    `UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}${rearm} WHERE id = ? RETURNING *`,
    ...keys.map((k) => t[k]), id);
}

export async function setTaskDone(env, id, done, today, settings) {
  const task = await first(env.DB, 'SELECT * FROM tasks WHERE id = ?', id);
  if (!task) throw new Error('Task not found');
  if (done && !task.done) {
    await run(env.DB, "UPDATE tasks SET done = 1, done_at = datetime('now'), done_date = ? WHERE id = ?", today, id);
    let next = null;
    if (task.recurrence && task.recurrence !== 'none') {
      const due = nextOccurrence(task.due_date || today, task.recurrence, settings?.weekendDays);
      next = await addTask(env, { ...task, due_date: due });
    }
    return { task: { ...task, done: 1, done_date: today }, next };
  }
  if (!done && task.done) {
    await run(env.DB, 'UPDATE tasks SET done = 0, done_at = NULL, done_date = NULL WHERE id = ?', id);
  }
  return { task: { ...task, done: done ? 1 : 0 } };
}

export async function deleteTask(env, id) {
  await run(env.DB, 'DELETE FROM tasks WHERE id = ?', id);
}

// Find an open task from spoken/typed words ("the dentist one").
export async function findTask(env, query) {
  const words = String(query).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !['the', 'task', 'and', 'for', 'one', 'that', 'this'].includes(w));
  const open = await all(env.DB, 'SELECT * FROM tasks WHERE done = 0 ORDER BY due_date IS NULL, due_date LIMIT 300');
  if (!words.length) return null;
  let best = null;
  let bestScore = 0;
  for (const t of open) {
    const title = t.title.toLowerCase();
    const hits = words.filter((w) => title.includes(w)).length;
    const score = hits / words.length + (title === query.toLowerCase() ? 1 : 0);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}

// ---------- Habits ----------

export async function listHabits(env, today) {
  const habits = await all(env.DB, 'SELECT * FROM habits WHERE archived = 0 ORDER BY id');
  const since = addDays(today, -6);
  const logs = await all(env.DB, 'SELECT habit_id, date FROM habit_logs WHERE date >= ?', since);
  return habits.map((h) => {
    const days = logs.filter((l) => l.habit_id === h.id).map((l) => l.date);
    return { ...h, doneToday: days.includes(today), week: days.length };
  });
}

export async function toggleHabit(env, id, date, done) {
  if (done) await run(env.DB, 'INSERT OR IGNORE INTO habit_logs (habit_id, date) VALUES (?, ?)', id, date);
  else await run(env.DB, 'DELETE FROM habit_logs WHERE habit_id = ? AND date = ?', id, date);
}

export async function findHabit(env, name) {
  const q = String(name).toLowerCase();
  const habits = await all(env.DB, 'SELECT * FROM habits WHERE archived = 0');
  return habits.find((h) => h.name.toLowerCase() === q)
    || habits.find((h) => h.name.toLowerCase().includes(q) || q.includes(h.name.toLowerCase()));
}

// ---------- Money ----------

export const EXPENSE_CATEGORIES = ['food', 'groceries', 'transport', 'shopping', 'bills', 'health', 'fun', 'coffee', 'gifts', 'education', 'other'];

export async function addExpense(env, { amount, category, note, date }, today) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Amount must be a positive number');
  const cat = String(category || 'other').toLowerCase().trim().slice(0, 30) || 'other';
  return first(env.DB, 'INSERT INTO expenses (amount, category, note, date) VALUES (?, ?, ?, ?) RETURNING *',
    Math.round(amt * 100) / 100, cat, String(note || '').slice(0, 200), /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today);
}

export async function spendingSummary(env, today) {
  const month = monthStart(today);
  const weekAgo = addDays(today, -6);
  const [todayRow, weekRow, monthRow, byCat, daily, recent] = await Promise.all([
    first(env.DB, 'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date = ?', today),
    first(env.DB, 'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date >= ?', weekAgo),
    first(env.DB, 'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date >= ?', month),
    all(env.DB, 'SELECT category, SUM(amount) AS total FROM expenses WHERE date >= ? GROUP BY category ORDER BY total DESC', month),
    all(env.DB, 'SELECT date, SUM(amount) AS total FROM expenses WHERE date >= ? GROUP BY date', addDays(today, -29)),
    all(env.DB, 'SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 30'),
  ]);
  return { today: todayRow.total, week: weekRow.total, month: monthRow.total, byCategory: byCat, daily, recent };
}

// ---------- Fitness ----------

export async function addWorkout(env, w, today) {
  const type = String(w.type || 'workout').trim().slice(0, 60);
  return first(env.DB,
    `INSERT INTO workouts (date, type, duration_min, calories, distance_km, notes, source)
     VALUES (?, ?, ?, ?, ?, ?, 'manual') RETURNING *`,
    /^\d{4}-\d{2}-\d{2}$/.test(w.date || '') ? w.date : today, type,
    Number(w.duration_min) || 0, w.calories != null ? Number(w.calories) : null,
    w.distance_km != null ? Number(w.distance_km) : null, String(w.notes || '').slice(0, 500));
}

export async function fitnessSummary(env, today) {
  const since = addDays(today, -13);
  const [workouts, health] = await Promise.all([
    all(env.DB, 'SELECT * FROM workouts WHERE date >= ? ORDER BY date DESC, id DESC', addDays(today, -30)),
    all(env.DB, 'SELECT * FROM health_daily WHERE date >= ? ORDER BY date', since),
  ]);
  const week = workouts.filter((w) => w.date >= addDays(today, -6));
  return {
    workouts,
    health,
    today: health.find((h) => h.date === today) || null,
    weekMinutes: Math.round(week.reduce((n, w) => n + (w.duration_min || 0), 0)),
    weekCount: week.length,
  };
}

// ---------- Focus, check-in, memory ----------

export async function addFocus(env, minutes, label, today) {
  const m = Math.max(1, Math.min(600, Math.round(Number(minutes) || 0)));
  return first(env.DB, 'INSERT INTO focus_sessions (date, minutes, label) VALUES (?, ?, ?) RETURNING *', today, m, String(label || '').slice(0, 100));
}

export async function saveCheckin(env, date, { mood, energy, note }) {
  await run(env.DB,
    `INSERT INTO checkins (date, mood, energy, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET mood = excluded.mood, energy = excluded.energy, note = excluded.note`,
    date, mood != null ? Number(mood) : null, energy != null ? Number(energy) : null, String(note || '').slice(0, 2000));
}

export async function remember(env, text) {
  return first(env.DB, 'INSERT INTO memories (text) VALUES (?) RETURNING *', String(text).slice(0, 500));
}

export async function listMemories(env) {
  return all(env.DB, 'SELECT * FROM memories ORDER BY id DESC LIMIT 100');
}

// ---------- Score ----------

export async function scoreInputs(env, date) {
  const db = env.DB;
  const [plannedOpen, doneToday, habits, habitLogs, health, workouts, focus, checkin] = await Promise.all([
    first(db, `SELECT COUNT(*) AS n, COALESCE(SUM(priority), 0) AS w FROM tasks
               WHERE due_date <= ? AND (done = 0 OR done_date > ?)`, date, date),
    first(db, 'SELECT COUNT(*) AS n, COALESCE(SUM(priority), 0) AS w FROM tasks WHERE done = 1 AND done_date = ?', date),
    first(db, 'SELECT COUNT(*) AS n FROM habits WHERE archived = 0'),
    first(db, 'SELECT COUNT(*) AS n FROM habit_logs l JOIN habits h ON h.id = l.habit_id WHERE h.archived = 0 AND l.date = ?', date),
    first(db, 'SELECT * FROM health_daily WHERE date = ?', date),
    first(db, 'SELECT COUNT(*) AS n FROM workouts WHERE date = ?', date),
    first(db, 'SELECT COALESCE(SUM(minutes), 0) AS m FROM focus_sessions WHERE date = ?', date),
    first(db, 'SELECT 1 AS ok FROM checkins WHERE date = ?', date),
  ]);
  return {
    // Everything due by `date` that wasn't finished before it, plus anything finished on it.
    plannedWeight: plannedOpen.w + doneToday.w,
    plannedCount: plannedOpen.n + doneToday.n,
    doneWeight: doneToday.w,
    doneCount: doneToday.n,
    habitsTotal: habits.n,
    habitsDone: habitLogs.n,
    steps: health?.steps ?? null,
    sleepMin: health?.sleep_min ?? null,
    workouts: workouts.n,
    focusMin: focus.m,
    checkedIn: Boolean(checkin),
  };
}

export async function scoreFor(env, date, settings, { save = false } = {}) {
  const result = computeScore(await scoreInputs(env, date), settings);
  if (save) {
    await run(env.DB,
      'INSERT INTO scores (date, score, breakdown) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET score = excluded.score, breakdown = excluded.breakdown',
      date, result.score, JSON.stringify(result));
  }
  return result;
}

export async function scoreHistory(env, today, days = 14) {
  return all(env.DB, 'SELECT date, score FROM scores WHERE date >= ? ORDER BY date', addDays(today, -days + 1));
}
