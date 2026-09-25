// Offline command parser: understands the common voice commands without any AI key,
// and is the fallback when the free AI quota runs out.

import { addDays, weekdayOf } from './time.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const CATEGORY_WORDS = {
  food: ['food', 'lunch', 'dinner', 'breakfast', 'restaurant', 'meal', 'takeaway', 'delivery', 'talabat', 'pizza', 'burger', 'shawarma', 'koshary'],
  coffee: ['coffee', 'starbucks', 'cafe', 'latte', 'tea'],
  groceries: ['groceries', 'grocery', 'supermarket', 'carrefour', 'market'],
  transport: ['uber', 'careem', 'taxi', 'transport', 'fuel', 'gas', 'petrol', 'metro', 'bus', 'parking', 'indrive', 'didi'],
  shopping: ['shopping', 'clothes', 'shoes', 'amazon', 'noon', 'shirt'],
  bills: ['bill', 'bills', 'rent', 'electricity', 'internet', 'phone', 'subscription', 'netflix', 'spotify', 'water'],
  health: ['doctor', 'pharmacy', 'medicine', 'gym', 'dentist', 'health'],
  fun: ['movie', 'cinema', 'games', 'game', 'concert', 'fun', 'outing'],
  gifts: ['gift', 'gifts', 'present'],
  education: ['course', 'book', 'books', 'tuition', 'education', 'udemy'],
};

export function categorize(text) {
  const words = String(text).toLowerCase().split(/[^a-z]+/);
  for (const [cat, keys] of Object.entries(CATEGORY_WORDS)) {
    if (words.some((w) => keys.includes(w))) return cat;
  }
  return 'other';
}

// Pull "tomorrow at 5pm" style phrases out of text.
export function parseWhen(text, today) {
  let rest = ` ${text} `;
  let date = null;
  let time = null;

  const take = (re, fn) => {
    const m = rest.match(re);
    if (m) { fn(m); rest = rest.replace(m[0], ' '); }
  };

  take(/\s(today|tonight|this evening)\b/i, (m) => {
    date = today;
    if (/tonight|evening/i.test(m[1])) time = time || '20:00';
  });
  take(/\s(tomorrow|tmrw|tmr)\b/i, () => { date = addDays(today, 1); });
  take(/\s(?:day after tomorrow)\b/i, () => { date = addDays(today, 2); });
  take(/\s(?:in (\d+) days?)\b/i, (m) => { date = addDays(today, Number(m[1])); });
  take(/\s(?:on |next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, (m) => {
    const target = DAYS.indexOf(m[1].toLowerCase());
    let diff = (target - weekdayOf(today) + 7) % 7;
    if (diff === 0) diff = 7;
    date = addDays(today, diff);
  });
  take(/\s(?:on )?(\d{4}-\d{2}-\d{2})\b/, (m) => { date = m[1]; });
  take(/\s(?:at |@ ?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$)/i, (m) => {
    let h = Number(m[1]) % 12;
    if (/p/i.test(m[3])) h += 12;
    time = `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
  });
  take(/\sat (\d{1,2}):(\d{2})\b/i, (m) => { time = `${m[1].padStart(2, '0')}:${m[2]}`; });
  take(/\s(?:in the )?morning\b/i, () => { time = time || '09:00'; });
  take(/\s(?:in the )?afternoon\b/i, () => { time = time || '15:00'; });
  take(/\s(?:at )?noon\b/i, () => { time = '12:00'; });

  if (time && !date) date = today;
  return { date, time, rest: rest.replace(/\s+/g, ' ').trim() };
}

function cleanTitle(s) {
  const t = s.replace(/^(to|that i|i need to|i have to|i should)\s+/i, '').replace(/[.!?]+$/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// "Call mum tomorrow 6pm !" -> { title, due_date, due_time, priority }
export function parseQuickTask(text, today) {
  let rest = ` ${text} `;
  let priority = 2;
  if (/(^|\s)(!|!!|#urgent|#important|urgent|asap)(?=\s)/i.test(rest)) {
    priority = 3;
    rest = rest.replace(/(^|\s)(!!?|#urgent|#important|urgent|asap)(?=\s)/ig, ' ');
  }
  let category = '';
  rest = rest.replace(/\s#([\p{L}\d_-]+)/u, (_, c) => { category = c.toLowerCase(); return ' '; });
  let recurrence = 'none';
  rest = rest.replace(/\s(every ?day|daily|every weekday|weekdays|every week|weekly|every month|monthly)\b/i, (_, r) => {
    const k = r.toLowerCase().replace(/\s/g, '');
    recurrence = { everyday: 'daily', daily: 'daily', everyweekday: 'weekdays', weekdays: 'weekdays', everyweek: 'weekly', weekly: 'weekly', everymonth: 'monthly', monthly: 'monthly' }[k];
    return ' ';
  });
  const when = parseWhen(rest, today);
  // A bare time like "6pm" with no "at" is handled by parseWhen; recurring tasks start today.
  const due_date = when.date || (recurrence !== 'none' ? today : null);
  return { title: cleanTitle(when.rest), due_date, due_time: when.time, priority, category, recurrence };
}

// Returns { tool, args } or { reply } or null.
export function parseCommand(input, today) {
  const text = String(input).trim().replace(/^(hey |ok |okay )?(nova|assistant)[,!]?\s*/i, '');
  const lower = text.toLowerCase();
  let m;

  if ((m = text.match(/^(?:please )?(?:add|create|new|make)(?: a| an)?(?: new)?(?: task| todo| to-do| reminder)?(?: to)?:?\s+(.+)$/i))
    || (m = text.match(/^remind me (?:to |about )?(.+)$/i))
    || (m = text.match(/^(?:i need to|i have to|don'?t let me forget to) (.+)$/i))) {
    const when = parseWhen(m[1], today);
    let priority;
    let rest = when.rest;
    if (/\b(urgent|important|high priority|asap)\b/i.test(rest)) {
      priority = 'high';
      rest = rest.replace(/,?\s*\b(it'?s )?(urgent|important|high priority|asap)\b/ig, '');
    }
    const title = cleanTitle(rest);
    if (title) return { tool: 'add_task', args: { title, due_date: when.date, due_time: when.time, priority } };
  }

  if ((m = text.match(/^(?:i'?m |i )?(?:mark|tick off|check off|complete|finish|done with|done|finished|completed|did)\s+(.+?)(?: as done| done| complete)?[.!]?$/i))
    || (m = text.match(/^(.+?) is done[.!]?$/i))) {
    return { tool: 'complete_task', args: { query: m[1].replace(/^(the|my) /i, '') } };
  }

  if ((m = lower.match(/(?:i )?(?:spent|paid|spend|pay)\s+(\d+(?:[.,]\d+)?)\s*(?:egp|le|pounds?|dollars?|usd|\$|€|euros?)?\s*(?:on|for|at)?\s*(.*)$/i))) {
    const amount = Number(m[1].replace(',', '.'));
    const note = m[2].replace(/[.!]+$/, '').trim();
    const when = parseWhen(note, today);
    return { tool: 'log_expense', args: { amount, category: categorize(note), note: when.rest, date: when.date || undefined } };
  }

  if ((m = lower.match(/\b(ran|run|running|jog(?:ged)?|walk(?:ed)?|cycl(?:ed|ing)|bike|swam|swim(?:ming)?|gym|lift(?:ed|ing)?|work(?:ed)? out|workout|yoga|football|padel|tennis|basketball|boxing|hiit|pilates)\b.*?(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?|km|kilomet(?:er|re)s?)/))) {
    const typeMap = {
      ran: 'Running', run: 'Running', running: 'Running', jog: 'Running', jogged: 'Running', walk: 'Walk', walked: 'Walk',
      cycled: 'Cycling', cycling: 'Cycling', bike: 'Cycling', swam: 'Swimming', swim: 'Swimming', swimming: 'Swimming',
      gym: 'Gym', lift: 'Strength', lifted: 'Strength', lifting: 'Strength', yoga: 'Yoga', football: 'Football',
      padel: 'Padel', tennis: 'Tennis', basketball: 'Basketball', boxing: 'Boxing', hiit: 'HIIT', pilates: 'Pilates',
    };
    const type = typeMap[m[1]] || 'Workout';
    const n = Number(m[2]);
    const args = { type, duration_min: 0 };
    if (/^h/.test(m[3])) args.duration_min = Math.round(n * 60);
    else if (/^k/.test(m[3])) {
      args.distance_km = n;
      const mins = lower.match(/(\d+)\s*min/);
      args.duration_min = mins ? Number(mins[1]) : Math.round(n * (type === 'Walk' ? 12 : 6));
    } else args.duration_min = n;
    return { tool: 'log_workout', args };
  }

  if ((m = text.match(/^remember(?: that)?\s+(.+)$/i))) return { tool: 'remember', args: { fact: m[1] } };

  if (/\b(briefing|brief me|morning report|what'?s (?:on )?(?:my|the) day|what(?:'s| is) today|what do i have)\b/.test(lower)) {
    return { tool: 'get_briefing', args: {} };
  }
  if (/\b(score|how am i doing|productivity)\b/.test(lower)) return { tool: 'get_score', args: {} };
  if (/\b(how much).*\b(spen[dt]|spending)\b|\bspending\b/.test(lower)) return { tool: 'spending_summary', args: {} };
  if (/\b(overdue)\b/.test(lower)) return { tool: 'list_tasks', args: { scope: 'overdue' } };
  if (/\b(tasks?|to-?dos?|to do list)\b/.test(lower)) return { tool: 'list_tasks', args: { scope: /upcoming|week|later/.test(lower) ? 'upcoming' : 'today' } };
  if (/\b(steps|sleep|workouts?|fitness|health)\b/.test(lower)) return { tool: 'fitness_summary', args: {} };

  return null;
}

// Turn a tool result into a short spoken reply (used without AI).
export function describeResult(tool, result) {
  if (result.ok === false) return result.error || "I couldn't do that.";
  switch (tool) {
    case 'add_task': return `Added: ${result.task}.`;
    case 'complete_task': return `Nice. "${result.completed}" is done.${result.nextOccurrence ? ` Next one is on ${result.nextOccurrence}.` : ''}`;
    case 'reschedule_task': return `Moved: ${result.task}.`;
    case 'list_tasks': return result.count ? `You have ${result.count}: ${result.tasks.slice(0, 6).join('; ')}.` : 'Nothing there. You\'re clear.';
    case 'log_expense': return `Logged ${result.logged}.`;
    case 'spending_summary': return `You've spent ${result.today} ${result.currency} today, ${result.last7Days} this week and ${result.thisMonth} this month${result.monthlyBudget ? ` out of a ${result.monthlyBudget} budget` : ''}.`;
    case 'log_workout': return `Logged ${result.logged}. Strong work.`;
    case 'fitness_summary': {
      const last = result.daily[result.daily.length - 1];
      return `${result.workoutsThisWeek} workouts this week, ${result.minutesThisWeek} minutes total.${last?.steps != null ? ` Steps today: ${last.steps}.` : ''}`;
    }
    case 'get_score': return `Today's score is ${result.score}, ${result.label.toLowerCase()}. ${result.parts.join('. ')}.`;
    case 'get_briefing': return result.briefing;
    case 'remember': return 'Got it, I\'ll remember that.';
    case 'log_habit': return `Marked ${result.habit} as ${result.done ? 'done' : 'not done'}.`;
    case 'log_focus': return `Logged ${result.minutes} focused minutes.`;
    case 'daily_checkin': return `Check-in saved. You're at ${result.scoreNow} today.`;
    default: return 'Done.';
  }
}

export const HELP = 'Try: "remind me to call mum tomorrow at 6pm", "done call mum", "I spent 120 on lunch", "I ran 5 km", "what\'s my score", or "read my briefing". Add a free Groq key (GROQ_API_KEY) for full conversations.';
