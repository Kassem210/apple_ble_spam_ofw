import { getKV, setKV } from './db.js';

export const DEFAULT_SETTINGS = {
  // About you — fed to the assistant so it can be personal.
  name: '',
  about: '',
  goals: '',
  // Assistant
  assistantName: 'Nova',
  tone: 'warm, concise and a little witty',
  voiceLang: 'en-US',
  voiceName: '',
  wakeWord: true,
  // Place & time
  city: 'Cairo',
  lat: 30.0444,
  lon: 31.2357,
  timezone: 'Africa/Cairo',
  briefingTime: '07:30',
  checkinTime: '21:30',
  reminderLead: 10,
  weekendDays: [5, 6], // 0 = Sunday ... 6 = Saturday; Egypt's weekend is Fri + Sat
  // Targets that feed the productivity score
  stepGoal: 8000,
  sleepGoalMin: 450,
  focusGoalMin: 120,
  // Money
  currency: 'EGP',
  monthlyBudget: 0,
  // Briefing content
  newsFeeds: [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
  ],
  prayerTimes: false,
  sections: {
    weather: true, calendar: true, email: true, tasks: true, habits: true,
    health: true, money: true, news: true, quote: true, score: true,
  },
};

const NUMERIC = ['lat', 'lon', 'reminderLead', 'stepGoal', 'sleepGoalMin', 'focusGoalMin', 'monthlyBudget'];
const TIME = ['briefingTime', 'checkinTime'];

export async function getSettings(env) {
  const stored = await getKV(env.DB, 'settings', {});
  const tz = stored.timezone || env.TIMEZONE || DEFAULT_SETTINGS.timezone;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    timezone: tz,
    sections: { ...DEFAULT_SETTINGS.sections, ...(stored.sections || {}) },
  };
}

export async function saveSettings(env, patch) {
  const current = await getKV(env.DB, 'settings', {});
  const next = { ...current };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (NUMERIC.includes(key)) {
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = n;
    } else if (TIME.includes(key)) {
      if (/^\d{2}:\d{2}$/.test(value)) next[key] = value;
    } else if (key === 'timezone') {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        next[key] = value;
      } catch { /* ignore invalid zone */ }
    } else if (key === 'sections') {
      next.sections = { ...(current.sections || {}), ...value };
    } else if (key === 'newsFeeds') {
      next.newsFeeds = (Array.isArray(value) ? value : String(value).split('\n'))
        .map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)).slice(0, 6);
    } else if (key === 'weekendDays') {
      next.weekendDays = (Array.isArray(value) ? value : []).map(Number).filter((d) => d >= 0 && d <= 6);
    } else if (key === 'wakeWord' || key === 'prayerTimes') {
      next[key] = Boolean(value);
    } else {
      next[key] = String(value).slice(0, 2000);
    }
  }
  await setKV(env.DB, 'settings', next);
  return getSettings(env);
}
