// The daily briefing: gathers everything about your day, then (if an AI key is set)
// asks the assistant to turn it into a short, personal, speakable summary.

import { all, first, run } from './db.js';
import { addDays, prettyDate, zonedParts, greetingFor } from './time.js';
import { listTasks, listHabits, spendingSummary, scoreFor } from './data.js';
import { calendarEvents, unreadEmails } from './google.js';
import { quoteFor } from './quotes.js';
import { generateText, aiConfigured } from './ai.js';

const WEATHER_CODES = {
  0: ['Clear sky', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'],
  75: ['Heavy snow', '❄️'], 80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm & hail', '⛈️'], 99: ['Thunderstorm & hail', '⛈️'],
};

export async function weather(settings) {
  const params = new URLSearchParams({
    latitude: settings.lat, longitude: settings.lon, timezone: settings.timezone,
    current: 'temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,uv_index_max,sunrise,sunset',
    forecast_days: '2',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const d = await res.json();
  const [desc, icon] = WEATHER_CODES[d.current.weather_code] || ['—', '🌡️'];
  const [tDesc, tIcon] = WEATHER_CODES[d.daily.weather_code[0]] || [desc, icon];
  return {
    city: settings.city,
    now: Math.round(d.current.temperature_2m),
    feels: Math.round(d.current.apparent_temperature),
    humidity: d.current.relative_humidity_2m,
    wind: Math.round(d.current.wind_speed_10m),
    desc, icon,
    high: Math.round(d.daily.temperature_2m_max[0]),
    low: Math.round(d.daily.temperature_2m_min[0]),
    rain: d.daily.precipitation_probability_max[0],
    uv: d.daily.uv_index_max[0],
    todayDesc: tDesc, todayIcon: tIcon,
    sunrise: d.daily.sunrise[0]?.slice(11, 16),
    sunset: d.daily.sunset[0]?.slice(11, 16),
    tomorrow: {
      high: Math.round(d.daily.temperature_2m_max[1]),
      low: Math.round(d.daily.temperature_2m_min[1]),
      desc: (WEATHER_CODES[d.daily.weather_code[1]] || ['—'])[0],
    },
  };
}

function decodeEntities(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
}

export function parseRss(xml, max = 4) {
  const items = [];
  const re = /<(item|entry)[\s>][\s\S]*?<\/\1>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const block = m[0];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1];
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] || block.match(/<link[^>]*href="([^"]+)"/)?.[1];
    if (title) items.push({ title: decodeEntities(title), link: link ? decodeEntities(link) : '' });
  }
  const source = decodeEntities(xml.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '');
  return { source, items };
}

export async function news(settings) {
  const feeds = await Promise.all((settings.newsFeeds || []).slice(0, 4).map(async (url) => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'LifeDashboard/1.0' } });
      if (!res.ok) return null;
      return parseRss(await res.text(), 4);
    } catch {
      return null;
    }
  }));
  return feeds.filter(Boolean);
}

export async function prayerTimes(settings, date) {
  const [y, m, d] = date.split('-');
  const res = await fetch(`https://api.aladhan.com/v1/timings/${d}-${m}-${y}?latitude=${settings.lat}&longitude=${settings.lon}&method=5`);
  if (!res.ok) return null;
  const t = (await res.json()).data?.timings;
  return t ? { Fajr: t.Fajr, Dhuhr: t.Dhuhr, Asr: t.Asr, Maghrib: t.Maghrib, Isha: t.Isha } : null;
}

const settle = async (enabled, fn) => {
  if (!enabled) return null;
  try { return await fn(); } catch (err) { return { error: err.message }; }
};

// Everything the briefing (and the assistant) knows about a day.
export async function gatherDay(env, settings, date) {
  const s = settings.sections;
  const yesterday = addDays(date, -1);
  const [wx, cal, mail, headlines, prayers, today, overdue, upcoming, habits, money, health, yScore, workoutsY] = await Promise.all([
    settle(s.weather, () => weather(settings)),
    settle(s.calendar, () => calendarEvents(env, date, settings.timezone)),
    settle(s.email, () => unreadEmails(env, 5)),
    settle(s.news, () => news(settings)),
    settle(settings.prayerTimes, () => prayerTimes(settings, date)),
    listTasks(env, { scope: 'today', today: date }),
    listTasks(env, { scope: 'overdue', today: date }),
    all(env.DB, 'SELECT * FROM tasks WHERE done = 0 AND due_date > ? AND due_date <= ? ORDER BY due_date, due_time LIMIT 8', date, addDays(date, 3)),
    listHabits(env, date),
    s.money ? spendingSummary(env, date) : null,
    all(env.DB, 'SELECT * FROM health_daily WHERE date IN (?, ?)', date, yesterday),
    first(env.DB, 'SELECT score, breakdown FROM scores WHERE date = ?', yesterday),
    all(env.DB, 'SELECT type, duration_min FROM workouts WHERE date = ?', yesterday),
  ]);
  const yMoney = s.money ? await first(env.DB, 'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date = ?', yesterday) : null;
  return {
    date,
    prettyDate: prettyDate(date),
    weather: wx,
    calendar: cal,
    email: mail,
    news: headlines,
    prayers,
    tasks: {
      dueToday: today.filter((t) => t.due_date === date),
      overdue,
      upcoming,
      top: [...today].sort((a, b) => b.priority - a.priority).slice(0, 3),
    },
    habits,
    money: money && {
      yesterday: yMoney?.total || 0,
      month: money.month,
      budget: settings.monthlyBudget || 0,
      currency: settings.currency,
      topCategory: money.byCategory[0] || null,
    },
    health: {
      lastNight: health.find((h) => h.date === date) || null, // sleep ending this morning
      yesterday: health.find((h) => h.date === yesterday) || null,
      workoutsYesterday: workoutsY,
    },
    yesterdayScore: yScore ? { score: yScore.score, ...JSON.parse(yScore.breakdown) } : null,
    quote: s.quote ? quoteFor(date) : null,
  };
}

function fmtTime(iso, tz) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
}

// Plain-language briefing used when no AI key is configured (and as the AI's fallback).
export function templateBriefing(day, settings) {
  const name = settings.name ? `, ${settings.name}` : '';
  const lines = [`Good morning${name}. It's ${day.prettyDate}.`];
  const w = day.weather;
  if (w && !w.error) {
    lines.push(`In ${w.city} it's ${w.now}° and ${w.desc.toLowerCase()}, heading for ${w.high}° with a low of ${w.low}°${w.rain >= 30 ? ` and a ${w.rain}% chance of rain` : ''}.`);
  }
  if (Array.isArray(day.calendar)) {
    if (day.calendar.length) {
      const ev = day.calendar.slice(0, 3).map((e) => (e.allDay ? e.title : `${e.title} at ${fmtTime(e.start, settings.timezone)}`));
      lines.push(`You have ${day.calendar.length} event${day.calendar.length > 1 ? 's' : ''}: ${ev.join(', ')}.`);
    } else lines.push('Your calendar is clear today.');
  }
  const t = day.tasks;
  if (t.dueToday.length || t.overdue.length) {
    let s = `You have ${t.dueToday.length} task${t.dueToday.length === 1 ? '' : 's'} due today`;
    if (t.overdue.length) s += ` and ${t.overdue.length} overdue`;
    s += '.';
    if (t.top.length) s += ` Top priority: ${t.top[0].title}.`;
    lines.push(s);
  } else {
    lines.push('No tasks due today. A good day to get ahead.');
  }
  if (day.email && !day.email.error && day.email.count) {
    lines.push(`${day.email.count} unread email${day.email.count > 1 ? 's' : ''}, latest from ${day.email.messages[0]?.from || 'someone'}.`);
  }
  const sleep = day.health.lastNight?.sleep_min;
  if (sleep) lines.push(`You slept ${Math.floor(sleep / 60)} hours ${sleep % 60} minutes.`);
  const steps = day.health.yesterday?.steps;
  if (steps != null) lines.push(`Yesterday: ${steps.toLocaleString('en-US')} steps.`);
  if (day.yesterdayScore) lines.push(`Your productivity score yesterday was ${day.yesterdayScore.score}.`);
  if (day.money && day.money.budget) {
    const left = Math.round(day.money.budget - day.money.month);
    lines.push(left >= 0 ? `${left.toLocaleString('en-US')} ${day.money.currency} left in this month's budget.` : `You're ${Math.abs(left).toLocaleString('en-US')} ${day.money.currency} over budget this month.`);
  }
  if (day.quote) lines.push(`"${day.quote.text}" — ${day.quote.author}.`);
  return lines.join(' ');
}

function compactDay(day, settings) {
  // A lean JSON view for the model: fewer tokens, no links.
  return {
    date: day.prettyDate,
    weather: day.weather && !day.weather.error ? {
      now: day.weather.now, desc: day.weather.desc, high: day.weather.high, low: day.weather.low, rainChance: day.weather.rain, uv: day.weather.uv,
    } : undefined,
    calendar: Array.isArray(day.calendar) ? day.calendar.map((e) => ({ title: e.title, time: e.allDay ? 'all day' : fmtTime(e.start, settings.timezone), location: e.location || undefined })) : undefined,
    tasksDueToday: day.tasks.dueToday.map((t) => ({ title: t.title, time: t.due_time || undefined, priority: t.priority })),
    overdueTasks: day.tasks.overdue.map((t) => ({ title: t.title, due: t.due_date })),
    comingUp: day.tasks.upcoming.map((t) => ({ title: t.title, due: t.due_date })),
    habits: day.habits.map((h) => h.name),
    unreadEmail: day.email && !day.email.error ? day.email.messages.map((m) => ({ from: m.from, subject: m.subject })) : undefined,
    sleepLastNightMin: day.health.lastNight?.sleep_min ?? undefined,
    stepsYesterday: day.health.yesterday?.steps ?? undefined,
    restingHr: day.health.lastNight?.resting_hr ?? day.health.yesterday?.resting_hr ?? undefined,
    workoutsYesterday: day.health.workoutsYesterday,
    yesterdayScore: day.yesterdayScore ? { score: day.yesterdayScore.score, parts: day.yesterdayScore.parts?.map((p) => `${p.label} ${p.points}/${p.max}`) } : undefined,
    money: day.money || undefined,
    prayerTimes: day.prayers || undefined,
    headlines: day.news?.flatMap?.((f) => f.items.slice(0, 2).map((i) => i.title)),
    quote: day.quote ? `${day.quote.text} — ${day.quote.author}` : undefined,
  };
}

export async function buildBriefing(env, settings, date) {
  const day = await gatherDay(env, settings, date);
  let text = templateBriefing(day, settings);
  let ai = false;
  if (aiConfigured(env)) {
    const memories = await all(env.DB, 'SELECT text FROM memories ORDER BY id DESC LIMIT 40');
    const prompt = [
      `Write ${settings.name || 'the user'}'s morning briefing for today, to be read aloud by you, ${settings.assistantName}.`,
      'Rules: 120-180 words, natural spoken English, no markdown, no bullet points, no emojis.',
      'Open with a warm greeting by name. Cover: weather (and what to wear or bring if relevant), schedule, the 1-3 most important tasks and any overdue ones, anything notable in email, sleep/activity from the health data, money if a budget is set.',
      'Suggest one concrete focus for the day that ties to their goals. Mention yesterday\'s score briefly if present, encouragingly.',
      'Skip sections with no data. End with the quote if present, then a short upbeat sign-off.',
      `About them: ${settings.about || 'n/a'}. Goals: ${settings.goals || 'n/a'}. Tone: ${settings.tone}.`,
      memories.length ? `Things they told you to remember: ${memories.map((m) => m.text).join(' | ')}` : '',
      `Today's data (JSON): ${JSON.stringify(compactDay(day, settings))}`,
    ].filter(Boolean).join('\n');
    try {
      const out = await generateText(env, prompt);
      if (out && out.length > 40) { text = out.trim(); ai = true; }
    } catch (err) {
      console.log('AI briefing failed, using template', err.message);
    }
  }
  const briefing = { date, text, ai, day, generatedAt: new Date().toISOString() };
  await run(env.DB,
    'INSERT INTO briefings (date, content) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET content = excluded.content, created_at = datetime(\'now\')',
    date, JSON.stringify(briefing));
  return briefing;
}

export async function getBriefing(env, settings, date, { refresh = false } = {}) {
  if (!refresh) {
    const row = await first(env.DB, 'SELECT content FROM briefings WHERE date = ?', date);
    if (row) return JSON.parse(row.content);
  }
  return buildBriefing(env, settings, date);
}

export function briefingNotification(briefing, settings) {
  const d = briefing.day;
  const bits = [];
  if (d.weather && !d.weather.error) bits.push(`${d.weather.todayIcon} ${d.weather.high}°/${d.weather.low}°`);
  const due = d.tasks.dueToday.length + d.tasks.overdue.length;
  bits.push(`${due} task${due === 1 ? '' : 's'}`);
  if (Array.isArray(d.calendar)) bits.push(`${d.calendar.length} event${d.calendar.length === 1 ? '' : 's'}`);
  if (d.yesterdayScore) bits.push(`yesterday ${d.yesterdayScore.score}`);
  const hour = zonedParts(new Date(), settings.timezone).hour;
  return {
    title: `${greetingFor(hour)}${settings.name ? `, ${settings.name}` : ''} ☀️`,
    body: `${bits.join(' · ')}\nTap to hear your briefing.`,
    url: '/?briefing=1',
    tag: `briefing-${briefing.date}`,
  };
}
