import {
  voiceSupported, speak, stopSpeaking, isSpeaking, listenOnce, WakeWord, chime, listVoices,
} from './voice.js';

// ---------- State ----------
const state = {
  data: null,
  view: 'today',
  taskTab: 'today',
  taskLists: {},
  chat: [],
  voice: 'idle', // idle | listening | thinking | speaking
  voiceStatus: '',
  briefingOpen: false,
  wakeOn: false,
  focus: loadLocal('focus', null),
};
let wake = null;

const root = document.getElementById('root');
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadLocal(key, fallback) {
  try { const v = localStorage.getItem(`life:${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveLocal(key, value) {
  try { localStorage.setItem(`life:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}

// ---------- API ----------
class Locked extends Error {}
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/api/login') { renderLogin(true); throw new Locked(); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function guard(fn) {
  try { return await fn(); } catch (err) { if (!(err instanceof Locked)) toast(err.message); return undefined; }
}

// ---------- Icons ----------
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
};

// ---------- Theme ----------
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme(loadLocal('theme', 'auto'));

// ---------- Formatting ----------
const S = () => state.data?.settings || {};
const today = () => state.data?.now?.date;
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US')} ${esc(S().currency || '')}`;
const fmtMin = (m) => (m == null ? '—' : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`);
function relDate(d) {
  if (!d) return '';
  const t = today();
  if (d === t) return 'Today';
  const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / 86400000);
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: S().timezone });
}

// ---------- Login ----------
function renderLogin(expired = false) {
  stopWake();
  root.innerHTML = `
    <div class="login">
      <form class="card login-card fade-in" data-form="login">
        <img class="login-logo" src="/icons/icon-192.png" alt="">
        <h1>Welcome back</h1>
        <p class="muted" style="margin:0 0 20px">${expired ? 'Enter your password to unlock.' : 'Your day, organised.'}</p>
        <input class="input" type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus>
        <button class="btn primary" style="width:100%;margin-top:12px;padding:13px">Unlock</button>
        <p class="small faint" id="login-msg" style="margin:14px 0 0"></p>
      </form>
    </div>`;
}

// ---------- Shell ----------
function render() {
  const d = state.data;
  const theme = loadLocal('theme', 'auto');
  const name = d.settings.name;
  root.innerHTML = `
    <div class="app">
      <header class="topbar">
        <div>
          <div class="eyebrow">${esc(d.now.pretty)}</div>
          <h1 class="hello">${esc(d.now.greeting)}${name ? `, <em>${esc(name)}</em>` : ''}</h1>
        </div>
        <div class="top-actions">
          <button class="btn icon ghost" data-action="theme" title="Theme">${I[theme === 'auto' ? 'auto' : theme === 'dark' ? 'moon' : 'sun']}</button>
          <button class="btn icon ghost" data-action="view" data-view="settings" title="Settings">${I.gear}</button>
        </div>
      </header>
      <main id="view"></main>
    </div>
    <nav class="nav">
      ${navBtn('today', 'Today', I.home)}
      ${navBtn('tasks', 'Tasks', I.tasks)}
      <div><button class="mic ${state.voice === 'listening' ? 'listening' : ''}" data-action="talk" aria-label="Talk to ${esc(d.settings.assistantName)}">${I.mic}</button></div>
      ${navBtn('health', 'Health', I.heart)}
      ${navBtn('money', 'Money', I.wallet)}
    </nav>`;
  renderView();
}

function navBtn(view, label, icon) {
  return `<button class="${state.view === view ? 'active' : ''}" data-action="view" data-view="${view}">${icon}<span>${label}</span></button>`;
}

function renderView() {
  const el = $('#view');
  if (!el) return;
  const views = { today: viewToday, tasks: viewTasks, assistant: viewAssistant, health: viewHealth, money: viewMoney, settings: viewSettings };
  el.innerHTML = (views[state.view] || viewToday)();
  document.querySelectorAll('.nav button[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  if (state.view === 'assistant') scrollChat();
  if (state.view === 'settings') hydrateSettings();
  if (state.view === 'tasks' && !state.taskLists[state.taskTab]) loadTaskTab(state.taskTab);
  tickFocus();
}

function go(view) {
  state.view = view;
  history.replaceState(null, '', view === 'today' ? '/' : `/#${view}`);
  renderView();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

async function refresh() {
  const data = await api('/api/dashboard');
  state.data = data;
  state.taskLists = {};
  if (!$('#view')) render(); else renderView();
}

// ---------- Cards ----------
function briefingCard() {
  const d = state.data;
  const b = d.briefing;
  const w = d.weather;
  const wx = w ? `
    <div class="wx">
      <div class="wx-icon">${w.icon}</div>
      <div><div class="wx-temp">${w.now}°</div><div class="small muted">${esc(w.desc)} · H ${w.high}° L ${w.low}°${w.rain >= 20 ? ` · ☔ ${w.rain}%` : ''}</div></div>
    </div>` : '';
  const speakingNow = isSpeaking() && state.speakingBriefing;
  return `
    <section class="card briefing span-8 fade-in">
      <div class="card-head">
        <h2 class="card-title"><span class="dot"></span>Daily briefing</h2>
        ${wx}
      </div>
      ${b ? `
        <p class="briefing-text ${state.briefingOpen ? '' : 'clamped'}" data-action="toggle-briefing">${esc(b.text)}</p>
        <div class="row wrap" style="margin-top:14px">
          <button class="btn primary" data-action="listen-briefing">${speakingNow ? I.stop : I.play}${speakingNow ? 'Stop' : 'Listen'}</button>
          <button class="btn ghost sm" data-action="refresh-briefing">${I.refresh}Refresh</button>
          <span class="spacer"></span>
          <span class="small faint">${b.ai ? `by ${esc(d.settings.assistantName)}` : ''}</span>
        </div>` : `
        <p class="briefing-text muted">Your briefing lands every morning at <b>${esc(d.settings.briefingTime)}</b>. Want today's now?</p>
        <div class="row" style="margin-top:14px"><button class="btn primary" data-action="refresh-briefing">${I.play}Brief me now</button></div>`}
    </section>`;
}

function ring(score, size = 132) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return `
    <div class="ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 120 120">
        <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="0.6" stop-color="var(--teal)"/><stop offset="1" stop-color="var(--coral)"/></linearGradient></defs>
        <circle class="track" cx="60" cy="60" r="${r}" fill="none" stroke-width="11"/>
        <circle class="val" cx="60" cy="60" r="${r}" fill="none" stroke="url(#rg)" stroke-width="11" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
      </svg>
      <div class="ring-label"><div><b>${score}</b><span>score</span></div></div>
    </div>`;
}

function sparkline(points) {
  if (!points || points.length < 2) return '';
  const w = 300; const h = 44; const pad = 4;
  const xs = points.map((_, i) => pad + (i * (w - pad * 2)) / (points.length - 1));
  const ys = points.map((p) => h - pad - (p.score / 100) * (h - pad * 2));
  const line = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${line} L${xs.at(-1)},${h} L${xs[0]},${h} Z" fill="var(--accent-soft)"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${xs.at(-1)}" cy="${ys.at(-1)}" r="3.5" fill="var(--accent)"/>
  </svg>`;
}

function scoreCard(span = 'span-4') {
  const s = state.data.score;
  const hist = state.data.scoreHistory || [];
  const avg = hist.length > 1 ? Math.round(hist.slice(0, -1).reduce((n, h) => n + h.score, 0) / (hist.length - 1)) : null;
  return `
    <section class="card ${span} fade-in">
      <div class="card-head">
        <h2 class="card-title"><span class="dot" style="background:var(--teal)"></span>Productivity</h2>
        <span class="badge">${esc(s.label)}</span>
      </div>
      <div class="score-wrap">
        ${ring(s.score)}
        <div class="parts">
          ${s.parts.map((p) => `<div class="part" title="${esc(p.detail)}"><span class="muted">${esc(p.label)}</span><div class="bar"><i style="width:${p.max ? (p.points / p.max) * 100 : 0}%"></i></div><span class="small">${p.points}/${p.max}</span></div>`).join('')}
        </div>
      </div>
      ${sparkline(hist)}
      <div class="row small muted" style="margin-top:4px">
        <span>${avg != null ? `${hist.length - 1}-day avg ${avg}` : 'Your trend appears after a day or two'}</span>
        <span class="spacer"></span>
        ${state.data.checkin ? '<span class="badge teal">Checked in</span>' : '<button class="btn sm" data-action="checkin">Check in</button>'}
      </div>
    </section>`;
}

function taskRow(t) {
  const isDone = Boolean(t.done);
  const overdue = !isDone && t.due_date && t.due_date < today();
  const meta = [];
  if (t.due_date) meta.push(`<span class="${overdue ? 'overdue' : ''}">${overdue ? 'Overdue · ' : ''}${esc(relDate(t.due_date))}${t.due_time ? ` · ${esc(t.due_time)}` : ''}</span>`);
  if (t.category) meta.push(`<span>#${esc(t.category)}</span>`);
  if (t.recurrence && t.recurrence !== 'none') meta.push(`<span>↻ ${esc(t.recurrence)}</span>`);
  return `
    <div class="task ${isDone ? 'is-done' : ''}" data-id="${t.id}">
      <button class="check p${t.priority} ${isDone ? 'done' : ''}" data-action="${isDone ? 'undo-task' : 'done-task'}" data-id="${t.id}" aria-label="Toggle done"></button>
      <div class="task-body" data-action="edit-task" data-id="${t.id}">
        <div class="task-title">${esc(t.title)}</div>
        ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
      </div>
    </div>`;
}

function quickAdd(placeholder = 'Add a task — "call mum tomorrow 6pm"') {
  return `
    <form class="quick-add" data-form="quick-task">
      <input class="input" name="text" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done">
      <button class="btn primary icon" aria-label="Add">${I.plus}</button>
    </form>`;
}

function tasksCard() {
  const { today: list, doneToday } = state.data.tasks;
  const shown = list.slice(0, 7);
  return `
    <section class="card span-7 fade-in">
      <div class="card-head">
        <h2 class="card-title"><span class="dot" style="background:var(--coral)"></span>Today's tasks</h2>
        <span class="small muted">${doneToday.length} done · ${list.length} left</span>
      </div>
      ${quickAdd()}
      <div>${shown.length ? shown.map(taskRow).join('') : `<div class="empty">${doneToday.length ? 'All clear. Enjoy it. ✨' : 'Nothing due today.'}</div>`}</div>
      ${list.length > shown.length || state.data.tasks.upcoming.length ? `<button class="btn ghost sm" style="margin-top:6px" data-action="view" data-view="tasks">See all tasks →</button>` : ''}
    </section>`;
}

function calendarCard() {
  const d = state.data;
  let bodyHtml;
  if (!d.status.connections.google) {
    bodyHtml = `<p class="muted small" style="margin:0 0 10px">Connect Google to see today's events and important email in your briefing.</p>
      <button class="btn sm" data-action="view" data-view="settings">Connect Google</button>`;
  } else if (!d.events?.length) {
    bodyHtml = '<div class="empty">No events today. Deep-work day?</div>';
  } else {
    bodyHtml = d.events.map((e) => `
      <div class="list-item">
        <span class="badge">${e.allDay ? 'All day' : esc(fmtClock(e.start))}</span>
        <div style="min-width:0"><div style="font-weight:600">${esc(e.title)}</div>${e.location ? `<div class="small muted">${esc(e.location)}</div>` : ''}</div>
      </div>`).join('');
  }
  return `
    <section class="card span-5 fade-in">
      <div class="card-head"><h2 class="card-title"><span class="dot" style="background:var(--amber)"></span>Schedule</h2></div>
      ${bodyHtml}
    </section>`;
}

function habitsCard(span = 'span-5') {
  const hs = state.data.habits;
  return `
    <section class="card ${span} fade-in">
      <div class="card-head">
        <h2 class="card-title"><span class="dot" style="background:var(--green)"></span>Habits</h2>
        <button class="btn ghost sm" data-action="add-habit">${I.plus}New</button>
      </div>
      ${hs.length ? `<div class="habits">${hs.map((h) => `
        <button class="habit ${h.doneToday ? 'done' : ''}" data-action="toggle-habit" data-id="${h.id}" data-done="${h.doneToday ? 1 : 0}">
          <span>${esc(h.icon)}</span>${esc(h.name)}<small>${h.week}/7</small>
        </button>`).join('')}</div>`
    : '<div class="empty">Build a streak: water, reading, prayer, no sugar… Tap “New”.</div>'}
    </section>`;
}

function healthCard(span = 'span-7') {
  const f = state.data.fitness;
  const t = f.today || {};
  const lastSleep = f.health.filter((h) => h.sleep_min).at(-1);
  const stepGoal = S().stepGoal || 8000;
  return `
    <section class="card ${span} fade-in">
      <div class="card-head">
        <h2 class="card-title"><span class="dot" style="background:var(--red)"></span>Health</h2>
        <button class="btn ghost sm" data-action="log-workout">${I.plus}Workout</button>
      </div>
      <div class="stats">
        <div class="stat"><b>${t.steps != null ? t.steps.toLocaleString('en-US') : '—'}</b><span>steps · goal ${stepGoal.toLocaleString('en-US')}</span>
          ${t.steps != null ? `<div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, (t.steps / stepGoal) * 100)}%"></i></div>` : ''}</div>
        <div class="stat"><b>${fmtMin(lastSleep?.sleep_min)}</b><span>last sleep</span></div>
        <div class="stat"><b>${t.resting_hr ?? f.health.filter((h) => h.resting_hr).at(-1)?.resting_hr ?? '—'}</b><span>resting bpm</span></div>
        <div class="stat"><b>${f.weekCount}</b><span>workouts · ${f.weekMinutes} min / 7d</span></div>
      </div>
      ${!state.data.status.connections.health ? `<p class="small muted" style="margin:12px 0 0">Connect Google Health in Settings to pull steps, sleep and workouts from your Fitbit Air automatically.</p>` : ''}
    </section>`;
}

function moneyCard(span = 'span-6') {
  const m = state.data.money;
  const budget = S().monthlyBudget || 0;
  const pct = budget ? Math.min(100, (m.month / budget) * 100) : 0;
  return `
    <section class="card ${span} fade-in">
      <div class="card-head">
        <h2 class="card-title"><span class="dot" style="background:var(--amber)"></span>Spending</h2>
        <button class="btn ghost sm" data-action="add-expense">${I.plus}Log</button>
      </div>
      <div class="stats">
        <div class="stat"><b>${money(m.today)}</b><span>today</span></div>
        <div class="stat"><b>${money(m.week)}</b><span>last 7 days</span></div>
        <div class="stat"><b>${money(m.month)}</b><span>this month</span></div>
      </div>
      ${budget ? `<div style="margin-top:12px"><div class="row small"><span class="muted">Budget</span><span class="spacer"></span><b>${money(Math.max(0, budget - m.month))} left</b></div>
        <div class="bar" style="margin-top:6px;height:8px"><i style="width:${pct}%;background:${pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--amber)' : 'linear-gradient(90deg,var(--accent),var(--teal))'}"></i></div></div>` : ''}
    </section>`;
}

function focusCard(span = 'span-6') {
  const f = state.focus;
  return `
    <section class="card ${span} fade-in">
      <div class="card-head">
        <h2 class="card-title"><span class="dot"></span>Focus</h2>
        <span class="small muted">goal ${S().focusGoalMin || 120} min/day</span>
      </div>
      <div class="row focus-row">
        <div class="focus-time" id="focus-time">${f ? '' : '25:00'}</div>
        <span class="spacer"></span>
        ${f ? `<button class="btn" data-action="focus-stop">${I.stop}End</button>` : `
          <button class="btn sm" data-action="focus-start" data-min="25">25m</button>
          <button class="btn sm" data-action="focus-start" data-min="50">50m</button>
          <button class="btn primary sm" data-action="focus-start" data-min="90">90m</button>`}
      </div>
      ${f?.label ? `<div class="small muted">On: ${esc(f.label)}</div>` : ''}
    </section>`;
}

function inboxCard() {
  const e = state.data.briefing?.day?.email;
  if (!e || e.error || !e.messages?.length) return '';
  return `
    <section class="card span-6 fade-in">
      <div class="card-head"><h2 class="card-title"><span class="dot" style="background:var(--red)"></span>Inbox</h2><span class="small muted">${e.count} unread</span></div>
      ${e.messages.map((m) => `<a class="list-item" href="${esc(m.link)}" target="_blank" rel="noopener" style="color:inherit"><div style="min-width:0"><div style="font-weight:700">${esc(m.from)}</div><div class="small muted">${esc(m.subject)}</div></div></a>`).join('')}
    </section>`;
}

function newsCard() {
  const n = state.data.briefing?.day?.news;
  if (!n?.length || n.error) return '';
  const items = n.flatMap((f) => f.items.slice(0, 3));
  return `
    <section class="card span-6 fade-in">
      <div class="card-head"><h2 class="card-title"><span class="dot" style="background:var(--muted)"></span>Headlines</h2></div>
      ${items.map((i) => `<a class="list-item" href="${esc(i.link)}" target="_blank" rel="noopener" style="color:inherit">${esc(i.title)}</a>`).join('')}
    </section>`;
}

function prayerCard() {
  const p = state.data.briefing?.day?.prayers;
  if (!p || p.error) return '';
  return `
    <section class="card span-12 fade-in">
      <div class="card-head"><h2 class="card-title"><span class="dot" style="background:var(--teal)"></span>Prayer times</h2></div>
      <div class="stats">${Object.entries(p).map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
    </section>`;
}

function checkinNudge() {
  const d = state.data;
  if (d.checkin || d.now.hour < 18) return '';
  return `
    <section class="card span-12 fade-in" style="background:linear-gradient(120deg,var(--accent-soft),transparent)">
      <div class="row wrap">
        <div><div style="font-weight:800">How did today go?</div><div class="small muted">A 20-second check-in finishes your score for the day.</div></div>
        <span class="spacer"></span>
        <button class="btn primary" data-action="checkin">Check in</button>
      </div>
    </section>`;
}

// ---------- Views ----------
function viewToday() {
  return `<div class="grid">
    ${briefingCard()}
    ${scoreCard()}
    ${checkinNudge()}
    ${tasksCard()}
    ${calendarCard()}
    ${habitsCard()}
    ${healthCard()}
    ${moneyCard()}
    ${focusCard()}
    ${prayerCard()}
    ${inboxCard()}
    ${newsCard()}
  </div>`;
}

const TASK_TABS = [['today', 'Today'], ['upcoming', 'Upcoming'], ['someday', 'Someday'], ['done', 'Done']];

function viewTasks() {
  const list = state.taskLists[state.taskTab];
  return `<div class="grid">
    <section class="card span-8 fade-in">
      <div class="card-head"><h2 class="card-title"><span class="dot" style="background:var(--coral)"></span>Tasks</h2>
        <button class="btn sm" data-action="new-task">${I.plus}Detailed</button></div>
      ${quickAdd()}
      <div class="tabs">${TASK_TABS.map(([k, l]) => `<button class="tab ${state.taskTab === k ? 'active' : ''}" data-action="task-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="task-list">${!list ? '<div class="empty">Loading…</div>' : list.length ? list.map(taskRow).join('') : '<div class="empty">Nothing here.</div>'}</div>
    </section>
    ${scoreCard('span-4')}
    ${habitsCard('span-4')}
  </div>`;
}

async function loadTaskTab(tab) {
  const list = await guard(() => api(`/api/tasks?scope=${tab}`));
  if (!list) return;
  state.taskLists[tab] = list;
  if (state.view === 'tasks' && state.taskTab === tab) renderView();
}

function barChart(values, { height = 110, color = 'var(--accent)', labels = [], goal } = {}) {
  const w = 320;
  const max = Math.max(goal || 0, ...values.map((v) => v || 0), 1);
  const bw = w / values.length;
  const bars = values.map((v, i) => {
    const h = ((v || 0) / max) * (height - 18);
    return `<rect x="${i * bw + bw * 0.18}" y="${height - 16 - h}" width="${bw * 0.64}" height="${Math.max(h, v ? 2 : 0)}" rx="${Math.min(4, bw * 0.3)}" fill="${color}" opacity="${i === values.length - 1 ? 1 : 0.55}"/>`;
  }).join('');
  const goalLine = goal ? `<line x1="0" x2="${w}" y1="${height - 16 - (goal / max) * (height - 18)}" y2="${height - 16 - (goal / max) * (height - 18)}" stroke="var(--faint)" stroke-dasharray="4 4"/>` : '';
  const lbl = labels.map((l, i) => (l ? `<text x="${i * bw + bw / 2}" y="${height - 2}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(l)}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${w} ${height}" style="width:100%;height:${height}px">${goalLine}${bars}${lbl}</svg>`;
}

function lastNDays(n) {
  const out = [];
  const t = Date.parse(`${today()}T00:00:00Z`);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(t - i * 86400000).toISOString().slice(0, 10));
  return out;
}

function viewHealth() {
  const f = state.data.fitness;
  const days = lastNDays(14);
  const byDate = Object.fromEntries(f.health.map((h) => [h.date, h]));
  const labels = days.map((d, i) => (i % 2 === 1 ? '' : new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' })));
  const sync = state.data.status.healthSync;
  return `<div class="grid">
    ${healthCard('span-12')}
    <section class="card span-6 fade-in">
      <div class="card-head"><h2 class="card-title">Steps · 14 days</h2></div>
      ${barChart(days.map((d) => byDate[d]?.steps || 0), { labels, goal: S().stepGoal, color: 'var(--accent)' })}
    </section>
    <section class="card span-6 fade-in">
      <div class="card-head"><h2 class="card-title">Sleep · 14 days</h2></div>
      ${barChart(days.map((d) => byDate[d]?.sleep_min || 0), { labels, goal: S().sleepGoalMin, color: 'var(--teal)' })}
    </section>
    <section class="card span-12 fade-in">
      <div class="card-head">
        <h2 class="card-title">Workouts</h2>
        <div class="row">
          ${state.data.status.connections.health ? `<button class="btn ghost sm" data-action="sync-health">${I.refresh}Sync</button>` : ''}
          <button class="btn primary sm" data-action="log-workout">${I.plus}Log workout</button>
        </div>
      </div>
      ${f.workouts.length ? f.workouts.map((w) => `
        <div class="list-item">
          <span class="badge ${w.source === 'health' ? 'teal' : ''}">${esc(relDate(w.date))}</span>
          <div style="flex:1;min-width:0"><b>${esc(w.type)}</b> <span class="muted small">· ${Math.round(w.duration_min)} min${w.distance_km ? ` · ${w.distance_km} km` : ''}${w.calories ? ` · ${Math.round(w.calories)} kcal` : ''}${w.avg_hr ? ` · ${Math.round(w.avg_hr)} bpm` : ''}</span>${w.notes ? `<div class="small muted">${esc(w.notes)}</div>` : ''}</div>
          ${w.source === 'manual' ? `<button class="task-del" data-action="del-workout" data-id="${w.id}" aria-label="Delete">${I.x}</button>` : ''}
        </div>`).join('') : '<div class="empty">No workouts in the last 30 days. Today\'s a good day to start.</div>'}
      ${sync ? `<p class="small faint" style="margin:10px 0 0">Last health sync ${new Date(sync.at).toLocaleString('en-GB', { timeZone: S().timezone })}${sync.errors?.length ? ` · ${sync.errors.length} data types unavailable` : ''}</p>` : ''}
    </section>
  </div>`;
}

function viewMoney() {
  const m = state.data.money;
  const days = lastNDays(30);
  const byDate = Object.fromEntries((m.daily || []).map((x) => [x.date, x.total]));
  const maxCat = Math.max(1, ...m.byCategory.map((c) => c.total));
  return `<div class="grid">
    ${moneyCard('span-12')}
    <section class="card span-6 fade-in">
      <div class="card-head"><h2 class="card-title">Quick log</h2></div>
      <form data-form="expense" class="stack">
        <div class="field-grid">
          <label class="field"><span>Amount (${esc(S().currency)})</span><input class="input" name="amount" type="number" inputmode="decimal" step="0.01" min="0" required></label>
          <label class="field"><span>Category</span><select class="input" name="category">${['food', 'groceries', 'coffee', 'transport', 'shopping', 'bills', 'health', 'fun', 'gifts', 'education', 'other'].map((c) => `<option>${c}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Note</span><input class="input" name="note" placeholder="optional"></label>
        <button class="btn primary">${I.plus}Add expense</button>
      </form>
    </section>
    <section class="card span-6 fade-in">
      <div class="card-head"><h2 class="card-title">This month by category</h2></div>
      ${m.byCategory.length ? `<div class="cat-bars">${m.byCategory.map((c) => `<div class="cat-row"><span>${esc(c.category)}</span><div class="bar"><i style="width:${(c.total / maxCat) * 100}%"></i></div><b class="small">${money(c.total)}</b></div>`).join('')}</div>` : '<div class="empty">No spending logged this month.</div>'}
    </section>
    <section class="card span-12 fade-in">
      <div class="card-head"><h2 class="card-title">Last 30 days</h2></div>
      ${barChart(days.map((d) => byDate[d] || 0), { color: 'var(--coral)', labels: days.map((d, i) => (i % 5 === 4 ? d.slice(8) : '')) })}
    </section>
    <section class="card span-12 fade-in">
      <div class="card-head"><h2 class="card-title">Recent</h2></div>
      ${m.recent.length ? m.recent.map((e) => `
        <div class="list-item">
          <span class="badge">${esc(relDate(e.date))}</span>
          <div style="flex:1;min-width:0"><b>${money(e.amount)}</b> <span class="muted small">· ${esc(e.category)}${e.note ? ` · ${esc(e.note)}` : ''}</span></div>
          <button class="task-del" data-action="del-expense" data-id="${e.id}" aria-label="Delete">${I.x}</button>
        </div>`).join('') : '<div class="empty">Say “I spent 80 on coffee” to the assistant, or use the form.</div>'}
    </section>
  </div>`;
}

const SUGGESTIONS = [
  'Brief me', 'What should I focus on today?', "What's my score?", 'Remind me to drink water at 4pm',
  'I spent 150 on lunch', 'I ran 5 km in 30 minutes', 'Plan my evening', 'How did I sleep?', 'What\'s left for today?',
];

function viewAssistant() {
  const name = S().assistantName || 'Nova';
  const voiceOk = voiceSupported.listen;
  return `<div class="grid">
    <section class="card span-12 fade-in">
      <div class="orb-wrap">
        <button class="orb ${state.voice}" data-action="talk" aria-label="Talk">${state.voice === 'speaking' ? I.stop : I.mic}</button>
        <div class="orb-status" id="orb-status">${esc(state.voiceStatus || (voiceOk ? `Tap and talk, or say “Hey ${name}”` : 'Voice input isn\'t supported in this browser. Type below.'))}</div>
        ${voiceOk ? `<button class="chip wake-pill ${state.wakeOn ? 'on' : ''}" data-action="toggle-wake" style="margin-top:10px"><i></i>“Hey ${esc(name)}” ${state.wakeOn ? 'listening' : 'off'}</button>` : ''}
      </div>
      <div class="chat" id="chat">
        ${state.chat.length ? state.chat.map(msgHtml).join('') : `<div class="empty">I'm ${esc(name)}. Ask me anything about your day, or tell me to add tasks, log spending, workouts, habits — or to remember things about you.</div>`}
      </div>
      <div class="suggestions">${SUGGESTIONS.map((s) => `<button class="chip" data-action="suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <form class="composer" data-form="chat">
        <input class="input" name="message" placeholder="Message ${esc(name)}…" autocomplete="off" enterkeyhint="send">
        <button class="btn primary icon" aria-label="Send">${I.send}</button>
      </form>
      <div class="row small faint" style="margin-top:8px">
        <span>${state.data.status.ai ? `AI: ${esc(state.data.status.aiProvider)} (free tier)` : 'Offline command mode — add a free Groq key for full conversation'}</span>
        <span class="spacer"></span>
        ${state.chat.length ? '<button class="btn ghost sm" data-action="clear-chat">Clear</button>' : ''}
      </div>
    </section>
  </div>`;
}

const TOOL_LABELS = {
  add_task: 'Task added', complete_task: 'Task done', reschedule_task: 'Task moved', log_expense: 'Expense logged',
  log_workout: 'Workout logged', log_habit: 'Habit updated', remember: 'Remembered', log_focus: 'Focus logged', daily_checkin: 'Checked in',
};

function msgHtml(m) {
  const acts = (m.actions || []).filter((a) => TOOL_LABELS[a.tool] && a.ok);
  return `<div class="msg ${m.role}">${esc(m.content)}${acts.length ? `<div class="acts">${acts.map((a) => `<span class="badge teal">✓ ${TOOL_LABELS[a.tool]}</span>`).join('')}</div>` : ''}</div>`;
}

function scrollChat() {
  const c = $('#chat');
  if (c) c.scrollTop = c.scrollHeight;
}

// ---------- Settings ----------
function viewSettings() {
  const s = S();
  const st = state.data.status;
  const sec = s.sections || {};
  const sectionLabels = { weather: 'Weather', calendar: 'Calendar', email: 'Email', tasks: 'Tasks', habits: 'Habits', health: 'Health', money: 'Money', news: 'News', quote: 'Quote', score: 'Yesterday\'s score' };
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `<div class="grid">
  <form class="card span-12 fade-in" data-form="settings">
    <div class="settings-section">
      <h3>About you</h3>
      <p class="small muted" style="margin:-6px 0 12px">The more ${esc(s.assistantName)} knows, the more personal your briefings and answers get.</p>
      <div class="field-grid">
        <label class="field"><span>Your name</span><input class="input" name="name" value="${esc(s.name)}"></label>
        <label class="field"><span>City</span><input class="input" name="city" value="${esc(s.city)}"></label>
      </div>
      <label class="field" style="margin-top:12px"><span>About you (work, routine, what matters)</span><textarea class="input" name="about" placeholder="e.g. Software engineer, work Sun–Thu 9–5, gym in the evenings, learning German…">${esc(s.about)}</textarea></label>
      <label class="field" style="margin-top:12px"><span>Your goals</span><textarea class="input" name="goals" placeholder="e.g. Run a half marathon by March, save 20% of income, read 2 books a month">${esc(s.goals)}</textarea></label>
    </div>
    <div class="settings-section">
      <h3>Assistant</h3>
      <div class="field-grid">
        <label class="field"><span>Assistant name (wake word)</span><input class="input" name="assistantName" value="${esc(s.assistantName)}"></label>
        <label class="field"><span>Personality</span><input class="input" name="tone" value="${esc(s.tone)}"></label>
        <label class="field"><span>Language</span><select class="input" name="voiceLang">${[['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ar-EG', 'Arabic (Egypt)'], ['fr-FR', 'French'], ['de-DE', 'German']].map(([v, l]) => `<option value="${v}" ${s.voiceLang === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Voice</span><select class="input" name="voiceName" id="voice-select"><option value="">Best available</option></select></label>
      </div>
      <div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-action="preview-voice">${I.play}Preview voice</button></div>
      <label class="switch"><span>Listen for “Hey ${esc(s.assistantName)}” while the app is open</span><input type="checkbox" name="wakeWord" ${s.wakeWord ? 'checked' : ''}></label>
    </div>
    <div class="settings-section">
      <h3>Schedule</h3>
      <div class="field-grid">
        <label class="field"><span>Morning briefing</span><input class="input" type="time" name="briefingTime" value="${esc(s.briefingTime)}"></label>
        <label class="field"><span>Evening check-in</span><input class="input" type="time" name="checkinTime" value="${esc(s.checkinTime)}"></label>
        <label class="field"><span>Remind me before tasks (min)</span><input class="input" type="number" name="reminderLead" value="${esc(s.reminderLead)}" min="0" max="240"></label>
        <label class="field"><span>Time zone</span><input class="input" name="timezone" value="${esc(s.timezone)}"></label>
      </div>
      <div style="margin-top:12px"><span class="small muted" style="font-weight:600">Weekend days</span>
        <div class="row wrap" style="margin-top:6px">${days.map((d, i) => `<label class="chip"><input type="checkbox" name="weekend" value="${i}" ${s.weekendDays?.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
      <div class="field-grid" style="margin-top:12px">
        <label class="field"><span>Latitude</span><input class="input" name="lat" value="${esc(s.lat)}" inputmode="decimal"></label>
        <label class="field"><span>Longitude</span><input class="input" name="lon" value="${esc(s.lon)}" inputmode="decimal"></label>
      </div>
      <button type="button" class="btn sm" style="margin-top:10px" data-action="use-location">📍 Use my location</button>
    </div>
    <div class="settings-section">
      <h3>Goals & money</h3>
      <div class="field-grid">
        <label class="field"><span>Daily steps</span><input class="input" type="number" name="stepGoal" value="${esc(s.stepGoal)}"></label>
        <label class="field"><span>Sleep (minutes)</span><input class="input" type="number" name="sleepGoalMin" value="${esc(s.sleepGoalMin)}"></label>
        <label class="field"><span>Focus (minutes/day)</span><input class="input" type="number" name="focusGoalMin" value="${esc(s.focusGoalMin)}"></label>
        <label class="field"><span>Currency</span><input class="input" name="currency" value="${esc(s.currency)}"></label>
        <label class="field"><span>Monthly budget (0 = none)</span><input class="input" type="number" name="monthlyBudget" value="${esc(s.monthlyBudget)}"></label>
      </div>
    </div>
    <div class="settings-section">
      <h3>Briefing</h3>
      <div class="row wrap">${Object.entries(sectionLabels).map(([k, l]) => `<label class="chip"><input type="checkbox" name="sec_${k}" ${sec[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <label class="switch"><span>Include prayer times (Egyptian General Authority method)</span><input type="checkbox" name="prayerTimes" ${s.prayerTimes ? 'checked' : ''}></label>
      <label class="field"><span>News feeds (RSS, one per line)</span><textarea class="input" name="newsFeeds">${esc((s.newsFeeds || []).join('\n'))}</textarea></label>
    </div>
    <div class="row"><button class="btn primary">Save settings</button></div>
  </form>

  <section class="card span-6 fade-in">
    <h3 style="margin:0 0 10px">Connections</h3>
    <div class="conn"><span class="status ${st.ai ? 'on' : ''}"></span><div style="flex:1"><b>AI brain</b><div class="small muted">${st.ai ? `${esc(st.aiProvider)} connected (free tier)` : 'Add a free GROQ_API_KEY secret in Cloudflare for full conversations'}</div></div></div>
    <div class="conn"><span class="status ${st.connections.google ? 'on' : ''}"></span><div style="flex:1"><b>Google Calendar & Gmail</b><div class="small muted">Events + important email in your briefing</div></div>
      ${!st.google ? '<span class="small faint">Needs setup</span>' : st.connections.google ? '<button class="btn sm" data-action="disconnect" data-which="google">Disconnect</button>' : '<a class="btn primary sm" href="/api/oauth/google/start?which=google">Connect</a>'}</div>
    <div class="conn"><span class="status ${st.connections.health ? 'on' : ''}"></span><div style="flex:1"><b>Google Health · Fitbit Air</b><div class="small muted">Steps, sleep, heart rate, workouts</div></div>
      ${!st.google ? '<span class="small faint">Needs setup</span>' : st.connections.health ? '<button class="btn sm" data-action="disconnect" data-which="health">Disconnect</button>' : '<a class="btn primary sm" href="/api/oauth/google/start?which=health">Connect</a>'}</div>
  </section>

  <section class="card span-6 fade-in">
    <h3 style="margin:0 0 10px">Notifications</h3>
    <p class="small muted" style="margin:0 0 12px" id="push-state">Morning briefing at ${esc(s.briefingTime)}, task reminders, and the evening check-in.</p>
    <div class="row wrap">
      <button class="btn primary sm" data-action="enable-push">Enable on this device</button>
      <button class="btn sm" data-action="test-push">Send a test</button>
    </div>
    ${/iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone ? '<p class="small" style="margin:12px 0 0">📱 On iPhone: tap <b>Share → Add to Home Screen</b> first, then open the app from your home screen and enable notifications there.</p>' : ''}
  </section>

  <section class="card span-6 fade-in">
    <h3 style="margin:0 0 10px">Home-screen widget</h3>
    <p class="small muted" style="margin:0 0 10px">Shows your score, next task, weather and steps. Keep this link private.</p>
    <code class="block" id="widget-url">Loading…</code>
    <div class="row wrap" style="margin-top:10px">
      <button class="btn primary sm" data-action="copy-widget-script">Copy iPhone widget script</button>
      <button class="btn sm" data-action="copy-widget">Copy link only</button>
    </div>
  </section>

  <section class="card span-6 fade-in">
    <h3 style="margin:0 0 10px">What ${esc(s.assistantName)} remembers</h3>
    <div id="memories"><div class="empty">Loading…</div></div>
    <form class="quick-add" data-form="memory" style="margin-top:10px"><input class="input" name="text" placeholder="Add something to remember"><button class="btn icon primary">${I.plus}</button></form>
  </section>

  <section class="card span-12 fade-in">
    <div class="row wrap">
      <a class="btn sm" href="/api/export">Export all my data</a>
      <button class="btn sm" data-action="onboarding">Re-run setup</button>
      <span class="spacer"></span>
      <button class="btn sm" data-action="logout">Lock</button>
    </div>
  </section>
  </div>`;
}

async function hydrateSettings() {
  const sel = $('#voice-select');
  const fill = () => {
    if (!sel) return;
    const voices = listVoices(S().voiceLang);
    sel.innerHTML = `<option value="">Best available</option>${voices.map((v) => `<option ${v.name === S().voiceName ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}`;
  };
  fill();
  if (voiceSupported.speak) speechSynthesis.onvoiceschanged = fill;

  const [w, mem] = await Promise.all([guard(() => api('/api/widget/token')), guard(() => api('/api/memories'))]);
  if (w && $('#widget-url')) $('#widget-url').textContent = w.url;
  // Pre-load the widget script with your link baked in, so "Copy" works in one tap on iPhone.
  if (w && !state.widgetScript) {
    const code = await fetch('/widget/scriptable.js').then((r) => r.text()).catch(() => '');
    if (code) state.widgetScript = code.replace('PASTE_YOUR_WIDGET_LINK_HERE', w.url);
  }
  if (mem && $('#memories')) {
    $('#memories').innerHTML = mem.length ? mem.map((m) => `<div class="list-item"><div style="flex:1">${esc(m.text)}</div><button class="task-del" data-action="del-memory" data-id="${m.id}">${I.x}</button></div>`).join('')
      : '<div class="empty">Nothing yet. Tell the assistant “remember that…”.</div>';
  }
  if ('Notification' in window && $('#push-state')) {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) $('#push-state').innerHTML += ' <b style="color:var(--green)">On for this device ✓</b>';
  }
}

// ---------- Sheets ----------
function sheet(html, onMount) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
  el.addEventListener('click', (e) => { if (e.target === el) closeSheet(); });
  document.body.appendChild(el);
  onMount?.(el);
  return el;
}
function closeSheet() { document.querySelector('.sheet-backdrop')?.remove(); }

function taskSheet(t = {}) {
  sheet(`
    <h2>${t.id ? 'Edit task' : 'New task'}</h2>
    <form data-form="task" data-id="${t.id || ''}" class="stack" style="margin-top:14px">
      <input class="input" name="title" placeholder="What needs doing?" value="${esc(t.title)}" required>
      <div class="field-grid">
        <label class="field"><span>Date</span><input class="input" type="date" name="due_date" value="${esc(t.due_date || '')}"></label>
        <label class="field"><span>Time (reminder)</span><input class="input" type="time" name="due_time" value="${esc(t.due_time || '')}"></label>
        <label class="field"><span>Priority</span><select class="input" name="priority">${[[1, 'Low'], [2, 'Normal'], [3, 'High']].map(([v, l]) => `<option value="${v}" ${(t.priority || 2) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Repeat</span><select class="input" name="recurrence">${['none', 'daily', 'weekdays', 'weekly', 'monthly'].map((r) => `<option ${(t.recurrence || 'none') === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Category</span><input class="input" name="category" value="${esc(t.category || '')}" placeholder="work, home, study…"></label>
      <label class="field"><span>Notes</span><textarea class="input" name="notes">${esc(t.notes || '')}</textarea></label>
      <div class="row">
        ${t.id ? `<button type="button" class="btn ghost" data-action="delete-task" data-id="${t.id}" style="color:var(--red)">Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button class="btn primary">Save</button>
      </div>
    </form>`);
}

function workoutSheet() {
  sheet(`
    <h2>Log a workout</h2>
    <form data-form="workout" class="stack" style="margin-top:14px">
      <div class="row wrap">${['Gym', 'Running', 'Walk', 'Football', 'Padel', 'Swimming', 'Cycling', 'Yoga'].map((t) => `<button type="button" class="chip" data-action="pick-workout" data-type="${t}">${t}</button>`).join('')}</div>
      <input class="input" name="type" placeholder="Type" required>
      <div class="field-grid">
        <label class="field"><span>Minutes</span><input class="input" type="number" name="duration_min" required min="1"></label>
        <label class="field"><span>Distance (km)</span><input class="input" type="number" step="0.01" name="distance_km"></label>
        <label class="field"><span>Calories</span><input class="input" type="number" name="calories"></label>
      </div>
      <input class="input" name="notes" placeholder="Notes (e.g. PR on squat 100kg)">
      <div class="row"><span class="spacer"></span><button type="button" class="btn" data-action="close-sheet">Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
}

function expenseSheet() {
  sheet(`
    <h2>Log spending</h2>
    <form data-form="expense" class="stack" style="margin-top:14px">
      <input class="input" name="amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Amount (${esc(S().currency)})" required autofocus>
      <div class="row wrap">${['food', 'coffee', 'groceries', 'transport', 'shopping', 'bills', 'health', 'fun', 'other'].map((c) => `<label class="chip"><input type="radio" name="category" value="${c}" ${c === 'food' ? 'checked' : ''}> ${c}</label>`).join('')}</div>
      <input class="input" name="note" placeholder="Note (optional)">
      <div class="row"><span class="spacer"></span><button type="button" class="btn" data-action="close-sheet">Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
}

function habitSheet() {
  sheet(`
    <h2>New habit</h2>
    <form data-form="habit" class="stack" style="margin-top:14px">
      <div class="row wrap">${[['💧', 'Drink water'], ['📖', 'Read 20 min'], ['🧘', 'Meditate'], ['🏋️', 'Exercise'], ['🕌', 'Pray on time'], ['🚭', 'No smoking'], ['🍎', 'Eat healthy'], ['🌙', 'Sleep by 12']].map(([i, n]) => `<button type="button" class="chip" data-action="pick-habit" data-icon="${i}" data-name="${n}">${i} ${n}</button>`).join('')}</div>
      <div class="row"><input class="input" name="icon" value="✨" style="width:64px;text-align:center"><input class="input" name="name" placeholder="Habit name" required></div>
      <div class="row"><span class="spacer"></span><button type="button" class="btn" data-action="close-sheet">Cancel</button><button class="btn primary">Add</button></div>
    </form>`);
}

function checkinSheet() {
  const moods = ['😞', '😕', '😐', '🙂', '😄'];
  sheet(`
    <h2>Daily check-in</h2>
    <p class="muted" style="margin:0 0 14px">Today's score so far: <b>${state.data.score.score}</b>. How did it feel?</p>
    <form data-form="checkin" class="stack">
      <span class="small muted" style="font-weight:600">Mood</span>
      <div class="mood" data-group="mood">${moods.map((m, i) => `<button type="button" data-action="pick" data-group="mood" data-val="${i + 1}">${m}</button>`).join('')}</div>
      <span class="small muted" style="font-weight:600">Energy</span>
      <div class="mood" data-group="energy">${['🪫', '😴', '⚡', '🔋', '🚀'].map((m, i) => `<button type="button" data-action="pick" data-group="energy" data-val="${i + 1}">${m}</button>`).join('')}</div>
      <input type="hidden" name="mood"><input type="hidden" name="energy">
      <textarea class="input" name="note" placeholder="One line about today — a win, a lesson, anything."></textarea>
      <div class="row"><span class="spacer"></span><button type="button" class="btn" data-action="close-sheet">Later</button><button class="btn primary">Save</button></div>
    </form>`);
}

function onboardingSheet() {
  const s = S();
  sheet(`
    <h2>Let's make this yours</h2>
    <p class="muted" style="margin:0 0 16px">A few details so your assistant can actually be personal. You can change everything later in Settings.</p>
    <form data-form="onboarding" class="stack">
      <div class="field-grid">
        <label class="field"><span>What should I call you?</span><input class="input" name="name" value="${esc(s.name)}" required></label>
        <label class="field"><span>Name your assistant</span><input class="input" name="assistantName" value="${esc(s.assistantName)}"></label>
      </div>
      <label class="field"><span>Tell me about you</span><textarea class="input" name="about" placeholder="Job, schedule, family, hobbies, what a good day looks like…">${esc(s.about)}</textarea></label>
      <label class="field"><span>What are you working towards?</span><textarea class="input" name="goals" placeholder="Health, career, money, learning…">${esc(s.goals)}</textarea></label>
      <div class="field-grid">
        <label class="field"><span>Briefing time</span><input class="input" type="time" name="briefingTime" value="${esc(s.briefingTime)}"></label>
        <label class="field"><span>Monthly budget (${esc(s.currency)})</span><input class="input" type="number" name="monthlyBudget" value="${esc(s.monthlyBudget || '')}" placeholder="optional"></label>
      </div>
      <div class="row"><span class="spacer"></span><button class="btn primary">Continue</button></div>
    </form>`);
}

function notifySheet() {
  const ios = /iphone|ipad/i.test(navigator.userAgent);
  sheet(`
    <h2>Stay in the loop</h2>
    <p class="muted">Get your briefing at ${esc(S().briefingTime)}, reminders when tasks are due, and your score each evening.</p>
    ${ios && !navigator.standalone ? '<p>📱 <b>First:</b> tap <b>Share → Add to Home Screen</b>, then open Life from your home screen. iPhones only allow notifications for installed apps.</p>' : ''}
    <div class="row" style="margin-top:16px"><button class="btn" data-action="close-sheet">Not now</button><span class="spacer"></span><button class="btn primary" data-action="enable-push">Turn on notifications</button></div>`);
}

// ---------- Voice / assistant ----------
function setVoice(v, status = '') {
  state.voice = v;
  state.voiceStatus = status;
  const orb = document.querySelector('.orb');
  if (orb) {
    orb.className = `orb ${v}`;
    orb.innerHTML = v === 'speaking' ? I.stop : I.mic;
  }
  const st = $('#orb-status');
  if (st) st.textContent = status || (v === 'idle' ? `Tap and talk, or say “Hey ${S().assistantName}”` : '');
  document.querySelector('.nav .mic')?.classList.toggle('listening', v === 'listening');
}

const voiceOpts = () => ({ lang: S().voiceLang || 'en-US', voiceName: S().voiceName || '' });

async function talk({ initial = null } = {}) {
  if (state.voice === 'speaking') { stopSpeaking(); setVoice('idle'); resumeWake(); return; }
  if (state.voice === 'listening' || state.voice === 'thinking') return;
  if (state.view !== 'assistant') go('assistant');
  if (!voiceSupported.listen && !initial) { $('input[name=message]')?.focus(); return; }
  wake?.pause();
  let text = initial;
  if (!text) {
    chime(true);
    setVoice('listening', 'Listening…');
    text = await listenOnce({ lang: voiceOpts().lang, onInterim: (t) => setVoice('listening', t || 'Listening…') });
  }
  if (!text || text.error) {
    const msg = text?.error === 'not-allowed' ? 'Microphone permission is blocked. Allow it in your browser settings.' : "Didn't catch that — tap to try again.";
    setVoice('idle', msg);
    resumeWake();
    return;
  }
  await send(text, { voice: true });
}

async function send(text, { voice = false } = {}) {
  state.chat.push({ role: 'user', content: text });
  if (state.view === 'assistant') { renderChatOnly(); }
  setVoice('thinking', 'Thinking…');
  let r;
  try {
    r = await api('/api/chat', { method: 'POST', body: { message: text } });
  } catch (err) {
    if (!(err instanceof Locked)) { state.chat.push({ role: 'assistant', content: `Something went wrong: ${err.message}` }); renderChatOnly(); }
    setVoice('idle');
    resumeWake();
    return;
  }
  state.chat.push({ role: 'assistant', content: r.reply, actions: r.actions });
  renderChatOnly();
  if (r.changed?.length) guard(refreshQuietly);

  if (voice && voiceSupported.speak) {
    setVoice('speaking', '');
    await speak(r.reply, voiceOpts());
    setVoice('idle');
    // Conversation mode: keep listening for a follow-up unless the user wraps up.
    if (voiceSupported.listen && !/^(thanks|thank you|stop|that'?s all|bye|nothing)/i.test(text) && state.view === 'assistant') {
      chime(true);
      setVoice('listening', 'Anything else?');
      const follow = await listenOnce({ lang: voiceOpts().lang, timeoutMs: 7000, onInterim: (t) => setVoice('listening', t) });
      if (follow && !follow.error && !/^(no|nope|that'?s (it|all)|thanks|thank you|stop)\b/i.test(follow.trim())) {
        await send(follow, { voice: true });
        return;
      }
      chime(false);
    }
  }
  setVoice('idle');
  resumeWake();
}

function renderChatOnly() {
  const c = $('#chat');
  if (!c) return;
  c.innerHTML = state.chat.map(msgHtml).join('');
  scrollChat();
}

async function refreshQuietly() {
  state.data = await api('/api/dashboard');
  state.taskLists = {};
  if (state.view !== 'assistant') renderView();
}

function startWake() {
  if (!voiceSupported.listen || !S().wakeWord) return;
  wake?.stop();
  wake = new WakeWord({
    name: S().assistantName || 'Nova',
    lang: voiceOpts().lang,
    onWake: (rest) => {
      chime(true);
      if (rest && rest.split(/\s+/).length >= 2) talk({ initial: rest });
      else talk();
    },
  });
  state.wakeOn = wake.start();
}
function stopWake() { wake?.stop(); wake = null; state.wakeOn = false; }
function resumeWake() { if (wake && state.wakeOn && !isSpeaking()) wake.resume(); }

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { resumeWake(); if (state.data) guard(refreshQuietly); }
});

// ---------- Focus timer ----------
let focusTimer = null;
function tickFocus() {
  clearInterval(focusTimer);
  const upd = () => {
    const el = $('#focus-time');
    const f = state.focus;
    if (!f) { if (el) el.textContent = '25:00'; return; }
    const left = Math.max(0, f.end - Date.now());
    if (el) el.textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
    if (left <= 0) finishFocus(f.minutes);
  };
  upd();
  if (state.focus) focusTimer = setInterval(upd, 1000);
}

async function finishFocus(minutes) {
  const f = state.focus;
  state.focus = null;
  saveLocal('focus', null);
  clearInterval(focusTimer);
  if (minutes >= 1) {
    await guard(() => api('/api/focus', { method: 'POST', body: { minutes, label: f?.label || '' } }));
    chime(false);
    toast(`Focus block done: ${minutes} min 🎯`);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (Notification.permission === 'granted') reg?.showNotification('Focus block complete 🎯', { body: `${minutes} minutes logged. Take a short break.`, icon: '/icons/icon-192.png' });
    } catch { /* notifications unavailable */ }
  }
  await guard(refreshQuietly);
  renderView();
}

// ---------- Push ----------
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast(/iphone|ipad/i.test(navigator.userAgent) ? 'Add Life to your Home Screen first, then enable notifications from there.' : 'This browser does not support push notifications.', 4500);
    return;
  }
  const { key } = await api('/api/push/key');
  if (!key) { toast('Push keys are not configured on the server yet (see README).'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications were not allowed.'); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  saveLocal('pushAsked', true);
  closeSheet();
  toast('Notifications on ✓');
  if (state.view === 'settings') renderView();
}

// ---------- Event handling ----------
const actions = {
  view: (el) => go(el.dataset.view),
  theme: () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(loadLocal('theme', 'auto')) + 1) % 3];
    saveLocal('theme', next);
    applyTheme(next);
    render();
    toast(`Theme: ${next}`);
  },
  talk: () => talk(),
  'toggle-wake': () => {
    if (state.wakeOn) { stopWake(); toast('Wake word off'); } else { startWake(); toast(state.wakeOn ? `Say “Hey ${S().assistantName}”` : 'Wake word unavailable here'); }
    renderView();
  },
  suggest: (el) => send(el.dataset.text, { voice: false }),
  'clear-chat': async () => { await guard(() => api('/api/chat', { method: 'DELETE' })); state.chat = []; renderView(); },
  'toggle-briefing': () => { state.briefingOpen = !state.briefingOpen; renderView(); },
  'listen-briefing': () => {
    if (isSpeaking()) { stopSpeaking(); state.speakingBriefing = false; renderView(); return; }
    state.speakingBriefing = true;
    wake?.pause();
    speak(state.data.briefing.text, { ...voiceOpts(), onEnd: () => { state.speakingBriefing = false; if (state.view === 'today') renderView(); resumeWake(); } });
    renderView();
  },
  'refresh-briefing': async (el) => {
    el.disabled = true;
    el.innerHTML = 'Preparing…';
    const b = await guard(() => api('/api/briefing?refresh=1'));
    if (b) { state.data.briefing = b; state.briefingOpen = true; }
    renderView();
  },
  'done-task': async (el) => {
    el.classList.add('done');
    const r = await guard(() => api(`/api/tasks/${el.dataset.id}/done`, { method: 'POST' }));
    if (r) { chime(false); toast(r.next ? `Done ✓ Next: ${relDate(r.next.due_date)}` : 'Done ✓'); await guard(refreshQuietly); }
  },
  'undo-task': async (el) => {
    await guard(() => api(`/api/tasks/${el.dataset.id}/undo`, { method: 'POST' }));
    await guard(refreshQuietly);
  },
  'edit-task': (el) => {
    const id = Number(el.dataset.id);
    const all = [...state.data.tasks.today, ...state.data.tasks.upcoming, ...state.data.tasks.doneToday, ...Object.values(state.taskLists).flat()];
    const t = all.find((x) => x.id === id);
    if (t) taskSheet(t);
  },
  'new-task': () => taskSheet(),
  'delete-task': async (el) => {
    await guard(() => api(`/api/tasks/${el.dataset.id}`, { method: 'DELETE' }));
    closeSheet();
    await guard(refreshQuietly);
  },
  'task-tab': (el) => { state.taskTab = el.dataset.tab; renderView(); },
  'toggle-habit': async (el) => {
    const done = el.dataset.done !== '1';
    el.classList.toggle('done', done);
    await guard(() => api(`/api/habits/${el.dataset.id}/toggle`, { method: 'POST', body: { done } }));
    if (done) chime(false);
    await guard(refreshQuietly);
  },
  'add-habit': () => habitSheet(),
  'pick-habit': (el) => { const f = el.closest('form'); f.icon.value = el.dataset.icon; f.name.value = el.dataset.name; },
  'log-workout': () => workoutSheet(),
  'pick-workout': (el) => { el.closest('form').type.value = el.dataset.type; },
  'add-expense': () => expenseSheet(),
  'del-expense': async (el) => { await guard(() => api(`/api/expenses/${el.dataset.id}`, { method: 'DELETE' })); await guard(refreshQuietly); },
  'del-workout': async (el) => { await guard(() => api(`/api/workouts/${el.dataset.id}`, { method: 'DELETE' })); await guard(refreshQuietly); },
  'sync-health': async (el) => {
    el.disabled = true;
    const r = await guard(() => api('/api/health/sync', { method: 'POST' }));
    if (r) toast(`Synced ${r.days ?? 0} days${r.errors?.length ? ` (${r.errors.length} data types unavailable)` : ''}`);
    await guard(refreshQuietly);
  },
  'focus-start': (el) => {
    const minutes = Number(el.dataset.min);
    state.focus = { end: Date.now() + minutes * 60000, minutes, start: Date.now() };
    saveLocal('focus', state.focus);
    chime(true);
    renderView();
  },
  'focus-stop': () => {
    const f = state.focus;
    const spent = f ? Math.floor((Date.now() - f.start) / 60000) : 0;
    finishFocus(spent);
  },
  checkin: () => checkinSheet(),
  pick: (el) => {
    const g = el.dataset.group;
    el.closest('form').querySelector(`[name=${g}]`).value = el.dataset.val;
    el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b === el));
  },
  'close-sheet': () => closeSheet(),
  'enable-push': () => guard(enablePush),
  'test-push': async () => {
    const r = await guard(() => api('/api/push/test', { method: 'POST' }));
    if (r) toast(r.sent ? `Sent to ${r.sent} device(s)` : (r.reason || 'No devices subscribed yet. Enable notifications first.'), 4000);
  },
  'preview-voice': () => {
    const f = document.querySelector('form[data-form=settings]');
    speak(`Hi${S().name ? ` ${S().name}` : ''}, I'm ${f.assistantName.value || 'Nova'}. Here's how I sound.`, { lang: f.voiceLang.value, voiceName: f.voiceName.value });
  },
  'use-location': () => {
    navigator.geolocation?.getCurrentPosition((p) => {
      const f = document.querySelector('form[data-form=settings]');
      f.lat.value = p.coords.latitude.toFixed(4);
      f.lon.value = p.coords.longitude.toFixed(4);
      toast('Location filled in — hit Save');
    }, () => toast('Could not get your location'));
  },
  'copy-widget-script': async () => {
    if (!state.widgetScript) { toast('Still loading, try again in a second'); return; }
    try {
      await navigator.clipboard.writeText(state.widgetScript);
      toast('Copied! Now paste it into a new Scriptable script.', 3500);
    } catch {
      toast('Copy was blocked. Try again.');
    }
  },
  'copy-widget': async () => {
    try { await navigator.clipboard.writeText($('#widget-url').textContent); toast('Copied'); } catch { toast('Copy failed — long-press the link'); }
  },
  disconnect: async (el) => {
    await guard(() => api('/api/google/disconnect', { method: 'POST', body: { which: el.dataset.which } }));
    await guard(refreshQuietly);
  },
  'del-memory': async (el) => { await guard(() => api(`/api/memories/${el.dataset.id}`, { method: 'DELETE' })); hydrateSettings(); },
  onboarding: () => onboardingSheet(),
  logout: async () => { await guard(() => api('/api/logout', { method: 'POST' })); renderLogin(); },
};

root.addEventListener('click', handleClick);
document.body.addEventListener('click', (e) => { if (!root.contains(e.target)) handleClick(e); });
function handleClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  if (el.tagName === 'A') return;
  e.preventDefault();
  actions[el.dataset.action](el, e);
}

const forms = {
  login: async (f) => {
    const msg = $('#login-msg');
    try {
      await api('/api/login', { method: 'POST', body: { password: f.password.value } });
      await start();
    } catch (err) {
      msg.textContent = err.message;
      f.password.select();
    }
  },
  'quick-task': async (f) => {
    const text = f.text.value.trim();
    if (!text) return;
    f.text.value = '';
    const t = await guard(() => api('/api/tasks/quick', { method: 'POST', body: { text } }));
    if (t) { toast(`Added${t.due_date ? ` · ${relDate(t.due_date)}${t.due_time ? ` ${t.due_time}` : ''}` : ''}`); await guard(refreshQuietly); }
  },
  task: async (f) => {
    const body = Object.fromEntries(new FormData(f));
    body.priority = Number(body.priority);
    const id = f.dataset.id;
    await guard(() => (id ? api(`/api/tasks/${id}`, { method: 'PATCH', body }) : api('/api/tasks', { method: 'POST', body })));
    closeSheet();
    await guard(refreshQuietly);
  },
  workout: async (f) => {
    const body = Object.fromEntries(new FormData(f));
    for (const k of ['distance_km', 'calories']) if (!body[k]) delete body[k];
    await guard(() => api('/api/workouts', { method: 'POST', body }));
    closeSheet();
    toast('Workout logged 💪');
    await guard(refreshQuietly);
  },
  expense: async (f) => {
    const body = Object.fromEntries(new FormData(f));
    const r = await guard(() => api('/api/expenses', { method: 'POST', body }));
    if (r) { closeSheet(); f.reset?.(); toast(`Logged ${money(r.amount)}`); await guard(refreshQuietly); }
  },
  habit: async (f) => {
    await guard(() => api('/api/habits', { method: 'POST', body: Object.fromEntries(new FormData(f)) }));
    closeSheet();
    await guard(refreshQuietly);
  },
  checkin: async (f) => {
    const body = Object.fromEntries(new FormData(f));
    if (!body.mood) { toast('Pick a mood'); return; }
    const s = await guard(() => api('/api/checkin', { method: 'POST', body }));
    closeSheet();
    if (s) toast(`Saved. Today: ${s.score} · ${s.label}`);
    await guard(refreshQuietly);
  },
  chat: (f) => {
    const text = f.message.value.trim();
    if (!text) return;
    f.message.value = '';
    send(text, { voice: false });
  },
  memory: async (f) => {
    const text = f.text.value.trim();
    if (!text) return;
    await guard(() => api('/api/memories', { method: 'POST', body: { text } }));
    f.text.value = '';
    hydrateSettings();
  },
  settings: async (f) => {
    const fd = new FormData(f);
    const body = {};
    for (const k of ['name', 'city', 'about', 'goals', 'assistantName', 'tone', 'voiceLang', 'voiceName', 'briefingTime', 'checkinTime',
      'reminderLead', 'timezone', 'lat', 'lon', 'stepGoal', 'sleepGoalMin', 'focusGoalMin', 'currency', 'monthlyBudget', 'newsFeeds']) body[k] = fd.get(k);
    body.wakeWord = f.wakeWord.checked;
    body.prayerTimes = f.prayerTimes.checked;
    body.weekendDays = fd.getAll('weekend').map(Number);
    body.sections = {};
    for (const k of Object.keys(S().sections || {})) body.sections[k] = f[`sec_${k}`]?.checked ?? true;
    const saved = await guard(() => api('/api/settings', { method: 'PUT', body }));
    if (saved) {
      toast('Saved ✓');
      await guard(refreshQuietly);
      stopWake();
      startWake();
    }
  },
  onboarding: async (f) => {
    const body = Object.fromEntries(new FormData(f));
    if (!body.monthlyBudget) delete body.monthlyBudget;
    await guard(() => api('/api/settings', { method: 'PUT', body }));
    await guard(refreshQuietly);
    render();
    notifySheet();
  },
};

document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f || !forms[f.dataset.form]) return;
  e.preventDefault();
  forms[f.dataset.form](f);
});

// ---------- Boot ----------
async function start() {
  const data = await api('/api/dashboard');
  state.data = data;
  const params = new URLSearchParams(location.search);
  const hashView = location.hash.slice(1);
  state.view = params.get('view') || (['tasks', 'assistant', 'health', 'money', 'settings'].includes(hashView) ? hashView : 'today');
  render();
  guard(async () => { state.chat = (await api('/api/chat')).map((m) => ({ role: m.role, content: m.content })); if (state.view === 'assistant') renderChatOnly(); });

  if (params.get('connected')) toast(`Connected ${params.get('connected') === 'health' ? 'Google Health' : 'Google'} ✓`);
  if (params.get('oauth_error')) toast(`Google connection failed: ${params.get('oauth_error')}`, 5000);
  if (params.get('checkin')) checkinSheet();
  if (params.get('add') && state.view === 'tasks') taskSheet();
  if (params.get('add') && state.view === 'money') expenseSheet();
  if (params.get('briefing')) {
    state.view = 'today';
    renderView();
    if (!data.briefing) actions['refresh-briefing']($('[data-action=refresh-briefing]'));
  }
  if (params.get('listen')) setTimeout(() => talk(), 300);
  if ([...params.keys()].length) history.replaceState(null, '', state.view === 'today' ? '/' : `/#${state.view}`);

  if (!data.settings.name) onboardingSheet();
  else if ('Notification' in window && Notification.permission === 'default' && !loadLocal('pushAsked', false) && data.status.push) {
    saveLocal('pushAsked', true);
    setTimeout(notifySheet, 1200);
  }
  startWake();
}

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open' && e.data.url) { location.href = e.data.url; }
    });
  }
  try {
    const s = await api('/api/session');
    if (!s.configured) {
      root.innerHTML = '<div class="login"><div class="card login-card"><h1>Almost there</h1><p class="muted">Add a secret called <b>APP_PASSWORD</b> in Cloudflare → your Worker → Settings → Variables and Secrets, then reload this page.</p></div></div>';
      return;
    }
    if (!s.authed) { renderLogin(); return; }
    await start();
  } catch (err) {
    if (!(err instanceof Locked)) {
      root.innerHTML = `<div class="login"><div class="card login-card"><h1>Offline</h1><p class="muted">${esc(err.message)}</p><button class="btn primary" onclick="location.reload()">Retry</button></div></div>`;
    }
  }
}

boot();
