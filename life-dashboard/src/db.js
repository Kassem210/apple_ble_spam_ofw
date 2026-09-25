// D1 helpers + schema. The schema is applied automatically on first use,
// so there is no separate migration step when deploying.

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  due_date TEXT,
  due_time TEXT,
  priority INTEGER NOT NULL DEFAULT 2,
  category TEXT DEFAULT '',
  recurrence TEXT NOT NULL DEFAULT 'none',
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  done_date TEXT,
  reminded INTEGER NOT NULL DEFAULT 0,
  snooze_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(done, due_date);
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '✨',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS habit_logs (habit_id INTEGER NOT NULL, date TEXT NOT NULL, PRIMARY KEY (habit_id, date));
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  note TEXT DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  duration_min REAL DEFAULT 0,
  calories REAL,
  distance_km REAL,
  avg_hr REAL,
  notes TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
CREATE TABLE IF NOT EXISTS health_daily (
  date TEXT PRIMARY KEY,
  steps INTEGER,
  calories REAL,
  resting_hr REAL,
  sleep_min INTEGER,
  active_zone_min INTEGER,
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS focus_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  label TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checkins (date TEXT PRIMARY KEY, mood INTEGER, energy INTEGER, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS scores (date TEXT PRIMARY KEY, score INTEGER NOT NULL, breakdown TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS briefings (date TEXT PRIMARY KEY, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))
`;

export const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
export const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();

export async function getKV(db, key, fallback = null) {
  const row = await first(db, 'SELECT value FROM kv WHERE key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
}

export async function setKV(db, key, value) {
  await run(db, 'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value));
}

export async function delKV(db, key) {
  await run(db, 'DELETE FROM kv WHERE key = ?', key);
}

let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  let version = 0;
  try {
    version = await getKV(db, 'schema_version', 0);
  } catch {
    version = 0; // kv table does not exist yet
  }
  if (version < SCHEMA_VERSION) {
    const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
    await setKV(db, 'schema_version', SCHEMA_VERSION);
  }
  schemaReady = true;
}
