// Actions the assistant can take. Declared once, used by both the AI (function
// calling) and the offline command parser.

import {
  addTask, findTask, setTaskDone, listTasks, updateTask, addExpense, spendingSummary, addWorkout,
  findHabit, toggleHabit, remember, scoreFor, saveCheckin, addFocus, fitnessSummary,
} from './data.js';
import { getBriefing } from './briefing.js';
import { calendarEvents } from './google.js';
import { all } from './db.js';

const S = (description, extra = {}) => ({ type: 'STRING', description, ...extra });
const N = (description) => ({ type: 'NUMBER', description });

export const TOOL_DECLARATIONS = [
  {
    name: 'add_task',
    description: 'Create a task or reminder. Use for "remind me to...", "add a task...", "I need to...". Resolve relative dates yourself.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: S('Short imperative title, e.g. "Call the dentist"'),
        due_date: S('YYYY-MM-DD, if a day was mentioned or implied'),
        due_time: S('HH:MM 24h, if a time was mentioned'),
        priority: S('low, normal or high', { enum: ['low', 'normal', 'high'] }),
        category: S('Optional short category like work, home, health, study'),
        recurrence: S('Repeat rule', { enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly'] }),
        notes: S('Optional extra details'),
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark an open task as done, matched by its title words.',
    parameters: { type: 'OBJECT', properties: { query: S('Words from the task title') }, required: ['query'] },
  },
  {
    name: 'reschedule_task',
    description: 'Move an open task to a new date and/or time.',
    parameters: {
      type: 'OBJECT',
      properties: { query: S('Words from the task title'), due_date: S('YYYY-MM-DD'), due_time: S('HH:MM 24h') },
      required: ['query'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Get tasks. scope: today (due today or overdue), overdue, upcoming, someday (no date), open (all open), done_today.',
    parameters: {
      type: 'OBJECT',
      properties: { scope: S('Which tasks', { enum: ['today', 'overdue', 'upcoming', 'someday', 'open', 'done_today'] }) },
      required: ['scope'],
    },
  },
  {
    name: 'log_expense',
    description: 'Record money spent.',
    parameters: {
      type: 'OBJECT',
      properties: {
        amount: N('Amount in the user\'s currency'),
        category: S('One of: food, groceries, transport, shopping, bills, health, fun, coffee, gifts, education, other'),
        note: S('What it was for'),
        date: S('YYYY-MM-DD if not today'),
      },
      required: ['amount', 'category'],
    },
  },
  {
    name: 'spending_summary',
    description: 'Get spending totals for today, the last 7 days and this month, by category.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'log_workout',
    description: 'Record a workout or physical activity.',
    parameters: {
      type: 'OBJECT',
      properties: {
        type: S('e.g. Running, Gym, Walk, Football, Swimming, Yoga'),
        duration_min: N('Minutes'),
        distance_km: N('Kilometres, if relevant'),
        calories: N('Calories, if known'),
        notes: S('Optional notes'),
        date: S('YYYY-MM-DD if not today'),
      },
      required: ['type', 'duration_min'],
    },
  },
  {
    name: 'fitness_summary',
    description: 'Get recent workouts and health data (steps, sleep, resting heart rate) from the last two weeks.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'log_habit',
    description: 'Mark one of the user\'s habits as done (or undone) for today.',
    parameters: {
      type: 'OBJECT',
      properties: { name: S('Habit name'), done: { type: 'BOOLEAN', description: 'false to un-mark' } },
      required: ['name'],
    },
  },
  {
    name: 'log_focus',
    description: 'Record a block of focused work.',
    parameters: { type: 'OBJECT', properties: { minutes: N('Minutes of focus'), label: S('What it was on') }, required: ['minutes'] },
  },
  {
    name: 'daily_checkin',
    description: 'Save the evening check-in: mood and energy from 1 (low) to 5 (great), plus a short reflection.',
    parameters: {
      type: 'OBJECT',
      properties: { mood: N('1-5'), energy: N('1-5'), note: S('Reflection on the day') },
      required: ['mood'],
    },
  },
  {
    name: 'get_score',
    description: 'Get today\'s productivity score with its breakdown.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_briefing',
    description: 'Get today\'s full daily briefing text (weather, schedule, tasks, email, health, money, quote).',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_calendar',
    description: 'Get calendar events for a date (needs Google connected).',
    parameters: { type: 'OBJECT', properties: { date: S('YYYY-MM-DD'), days: N('How many days from that date, default 1') }, required: ['date'] },
  },
  {
    name: 'remember',
    description: 'Save a lasting fact or preference about the user so you can personalise future help. Use when they say "remember..." or share something clearly worth keeping.',
    parameters: { type: 'OBJECT', properties: { fact: S('The fact, in third person, e.g. "Prefers workouts in the evening"') }, required: ['fact'] },
  },
];

const taskLine = (t) => `${t.title}${t.due_date ? ` (due ${t.due_date}${t.due_time ? ` ${t.due_time}` : ''})` : ''}${t.priority === 3 ? ' [high]' : ''}`;

// Every executor returns { result, changed } — `result` goes back to the model,
// `changed` tells the UI which panels to refresh.
export async function runTool(env, name, args, ctx) {
  const { today, settings } = ctx;
  switch (name) {
    case 'add_task': {
      const t = await addTask(env, args);
      return { result: { ok: true, task: taskLine(t) }, changed: ['tasks'] };
    }
    case 'complete_task': {
      const t = await findTask(env, args.query);
      if (!t) return { result: { ok: false, error: `No open task matching "${args.query}"` } };
      const r = await setTaskDone(env, t.id, true, today, settings);
      return { result: { ok: true, completed: t.title, nextOccurrence: r.next ? r.next.due_date : undefined }, changed: ['tasks', 'score'] };
    }
    case 'reschedule_task': {
      const t = await findTask(env, args.query);
      if (!t) return { result: { ok: false, error: `No open task matching "${args.query}"` } };
      const patch = {};
      if (args.due_date) patch.due_date = args.due_date;
      if (args.due_time) patch.due_time = args.due_time;
      const u = await updateTask(env, t.id, patch);
      return { result: { ok: true, task: taskLine(u) }, changed: ['tasks'] };
    }
    case 'list_tasks': {
      const tasks = await listTasks(env, { scope: args.scope || 'today', today, limit: 25 });
      return { result: { count: tasks.length, tasks: tasks.map(taskLine) } };
    }
    case 'log_expense': {
      const e = await addExpense(env, args, today);
      return { result: { ok: true, logged: `${e.amount} ${settings.currency} on ${e.category}` }, changed: ['money'] };
    }
    case 'spending_summary': {
      const s = await spendingSummary(env, today);
      return {
        result: {
          currency: settings.currency, today: s.today, last7Days: s.week, thisMonth: s.month,
          monthlyBudget: settings.monthlyBudget || null, byCategory: s.byCategory,
        },
      };
    }
    case 'log_workout': {
      const w = await addWorkout(env, args, today);
      return { result: { ok: true, logged: `${w.type}, ${w.duration_min} min` }, changed: ['fitness', 'score'] };
    }
    case 'fitness_summary': {
      const f = await fitnessSummary(env, today);
      return {
        result: {
          workoutsThisWeek: f.weekCount, minutesThisWeek: f.weekMinutes,
          recentWorkouts: f.workouts.slice(0, 8).map((w) => `${w.date}: ${w.type} ${w.duration_min}min`),
          daily: f.health.map((h) => ({ date: h.date, steps: h.steps, sleepMin: h.sleep_min, restingHr: h.resting_hr })),
        },
      };
    }
    case 'log_habit': {
      const h = await findHabit(env, args.name);
      if (!h) {
        const habits = await all(env.DB, 'SELECT name FROM habits WHERE archived = 0');
        return { result: { ok: false, error: 'No such habit', existingHabits: habits.map((x) => x.name) } };
      }
      await toggleHabit(env, h.id, today, args.done !== false);
      return { result: { ok: true, habit: h.name, done: args.done !== false }, changed: ['habits', 'score'] };
    }
    case 'log_focus': {
      const f = await addFocus(env, args.minutes, args.label, today);
      return { result: { ok: true, minutes: f.minutes }, changed: ['score'] };
    }
    case 'daily_checkin': {
      await saveCheckin(env, today, args);
      const s = await scoreFor(env, today, settings);
      return { result: { ok: true, scoreNow: s.score }, changed: ['score'] };
    }
    case 'get_score': {
      const s = await scoreFor(env, today, settings);
      return { result: { score: s.score, label: s.label, parts: s.parts.map((p) => `${p.label}: ${p.points}/${p.max} (${p.detail})`) } };
    }
    case 'get_briefing': {
      const b = await getBriefing(env, settings, today);
      return { result: { briefing: b.text } };
    }
    case 'get_calendar': {
      const ev = await calendarEvents(env, args.date || today, settings.timezone, Math.min(7, args.days || 1));
      if (ev === null) return { result: { ok: false, error: 'Google Calendar is not connected. It can be connected in Settings.' } };
      return { result: { events: ev.map((e) => ({ title: e.title, start: e.start, allDay: e.allDay, location: e.location })) } };
    }
    case 'remember': {
      await remember(env, args.fact);
      return { result: { ok: true } };
    }
    default:
      return { result: { ok: false, error: `Unknown tool ${name}` } };
  }
}
