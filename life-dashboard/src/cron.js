// Runs every 5 minutes (see wrangler.toml). All times are in your own time zone.

import { all, run, getKV, setKV } from './db.js';
import { getSettings } from './settings.js';
import { zonedParts, addDays, minutesOf } from './time.js';
import { scoreFor, listTasks } from './data.js';
import { buildBriefing, briefingNotification } from './briefing.js';
import { syncHealth } from './google.js';
import { notifyAll } from './push.js';

const BRIEFING_WINDOW_MIN = 180; // if the worker was down at 07:30, still send until 10:30
const REMINDER_STALE_MIN = 60; // don't fire reminders that are more than an hour late

export async function tick(env, date = new Date()) {
  const settings = await getSettings(env);
  const now = zonedParts(date, settings.timezone);
  const today = now.date;
  const yesterday = addDays(today, -1);
  const nowMin = now.hour * 60 + now.minute;
  const state = await getKV(env.DB, 'cron_state', {});
  const log = [];

  // 1. Lock in yesterday's productivity score once per day.
  if (state.scoredDate !== yesterday) {
    await scoreFor(env, yesterday, settings, { save: true });
    state.scoredDate = yesterday;
    log.push('scored yesterday');
  }

  // 2. Health sync from Google Health (Fitbit Air), once an hour.
  const hourKey = `${today}T${now.hour}`;
  if (state.healthHour !== hourKey) {
    state.healthHour = hourKey;
    try {
      const r = await syncHealth(env, today);
      if (!r.skipped) log.push(`health sync: ${r.days} days${r.errors.length ? `, ${r.errors.length} errors` : ''}`);
    } catch (err) {
      log.push(`health sync failed: ${err.message}`);
    }
  }

  // 3. Morning briefing + push notification.
  const briefingAt = minutesOf(settings.briefingTime);
  if (state.briefingDate !== today && nowMin >= briefingAt && nowMin < briefingAt + BRIEFING_WINDOW_MIN) {
    state.briefingDate = today;
    await setKV(env.DB, 'cron_state', state); // claim it first so a slow run can't double-send
    const briefing = await buildBriefing(env, settings, today);
    const r = await notifyAll(env, briefingNotification(briefing, settings));
    log.push(`briefing sent to ${r.sent} device(s)`);
  }

  // 4. Task reminders.
  log.push(...await taskReminders(env, settings, today, nowMin, now));

  // 5. Evening check-in with today's score.
  const checkinAt = minutesOf(settings.checkinTime);
  if (state.checkinDate !== today && nowMin >= checkinAt && nowMin < checkinAt + BRIEFING_WINDOW_MIN) {
    state.checkinDate = today;
    await setKV(env.DB, 'cron_state', state);
    const score = await scoreFor(env, today, settings, { save: true });
    const open = await listTasks(env, { scope: 'today', today });
    await notifyAll(env, {
      title: `Today's score: ${score.score} · ${score.label}`,
      body: `${open.length ? `${open.length} task${open.length === 1 ? '' : 's'} still open. ` : 'Everything due is done! '}Tap for your 30-second check-in.`,
      url: '/?checkin=1',
      tag: `checkin-${today}`,
    });
    log.push('check-in sent');
  }

  await setKV(env.DB, 'cron_state', state);
  return log;
}

async function taskReminders(env, settings, today, nowMin, now) {
  const log = [];
  const lead = Number(settings.reminderLead) || 0;
  const nowLocal = `${today} ${now.time}`;

  // Timed tasks from earlier days that never fired: mark them so they don't fire late.
  await run(env.DB, 'UPDATE tasks SET reminded = 1 WHERE done = 0 AND reminded = 0 AND snooze_until IS NULL AND due_time IS NOT NULL AND due_date < ?', today);

  const candidates = await all(env.DB,
    `SELECT * FROM tasks WHERE done = 0 AND reminded = 0 AND (
       (snooze_until IS NOT NULL AND snooze_until <= ?)
       OR (snooze_until IS NULL AND due_date = ? AND due_time IS NOT NULL)
     )`, nowLocal, today);

  for (const task of candidates) {
    let fire = false;
    let body;
    if (task.snooze_until) {
      fire = true;
      body = 'Snoozed reminder';
    } else {
      const dueMin = minutesOf(task.due_time);
      if (nowMin >= dueMin - lead) {
        fire = nowMin - dueMin <= REMINDER_STALE_MIN;
        const until = dueMin - nowMin;
        body = until > 0 ? `Due at ${task.due_time} · in ${until} min` : `Due now (${task.due_time})`;
        if (!fire) await run(env.DB, 'UPDATE tasks SET reminded = 1 WHERE id = ?', task.id);
      }
    }
    if (!fire) continue;
    await run(env.DB, 'UPDATE tasks SET reminded = 1, snooze_until = NULL WHERE id = ?', task.id);
    await notifyAll(env, {
      title: `${task.priority === 3 ? '🔴 ' : '⏰ '}${task.title}`,
      body: task.notes ? `${body}\n${task.notes.slice(0, 120)}` : body,
      url: `/?task=${task.id}`,
      tag: `task-${task.id}`,
      taskId: task.id,
      actions: [{ action: 'done', title: '✓ Done' }, { action: 'snooze', title: 'Snooze 15 min' }],
    });
    log.push(`reminded: ${task.title}`);
  }
  return log;
}
