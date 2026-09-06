import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// DB_PATH cho phép trỏ sang file khác (test, hoặc volume khi deploy).
const dbPath = process.env.DB_PATH || fileURLToPath(new URL('../data/bot.db', import.meta.url));
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  username    TEXT NOT NULL DEFAULT '',
  xp          INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS dailies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  report_date TEXT NOT NULL,
  done        TEXT NOT NULL,
  next_plan   TEXT NOT NULL DEFAULT '',
  blocker     TEXT NOT NULL DEFAULT '',
  xp          INTEGER NOT NULL DEFAULT 0,
  on_time     INTEGER NOT NULL DEFAULT 1,
  message_id  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guild_id, user_id, report_date)
);
CREATE INDEX IF NOT EXISTS idx_dailies_lookup ON dailies (guild_id, user_id, report_date);

CREATE TABLE IF NOT EXISTS weekly_plans (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  week_start TEXT NOT NULL,
  plan       TEXT NOT NULL,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, user_id, week_start)
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  week_start TEXT NOT NULL,
  review     TEXT NOT NULL,
  score      REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guild_id, user_id, week_start)
);

CREATE TABLE IF NOT EXISTS day_threads (
  guild_id   TEXT NOT NULL,
  thread_date TEXT NOT NULL,
  thread_id  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, thread_date)
);

CREATE TABLE IF NOT EXISTS guild_config (
  guild_id       TEXT PRIMARY KEY,
  channel_id     TEXT,
  remind_hour    INTEGER NOT NULL DEFAULT 21,
  last_call_hour INTEGER NOT NULL DEFAULT 23,
  weekly_dow     INTEGER NOT NULL DEFAULT 0,
  weekly_hour    INTEGER NOT NULL DEFAULT 20,
  use_threads    INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

if (!db.prepare('PRAGMA table_info(dailies)').all().some((c) => c.name === 'message_id')) {
  db.exec('ALTER TABLE dailies ADD COLUMN message_id TEXT');
}

// Migration cho DB tao truoc khi co che do thread.
if (!db.prepare('PRAGMA table_info(guild_config)').all().some((c) => c.name === 'use_threads')) {
  db.exec('ALTER TABLE guild_config ADD COLUMN use_threads INTEGER NOT NULL DEFAULT 1');
}

const q = (sql) => db.prepare(sql);

/* ------------------------------------------------------------------ users */

const selUser = q('SELECT * FROM users WHERE guild_id=? AND user_id=?');
const insUser = q(
  `INSERT INTO users (guild_id, user_id, username) VALUES (?,?,?)
   ON CONFLICT(guild_id, user_id) DO UPDATE SET username=excluded.username`,
);

export function touchUser(guildId, userId, username) {
  insUser.run(guildId, userId, username ?? '');
  return selUser.get(guildId, userId);
}

export function getUser(guildId, userId) {
  return selUser.get(guildId, userId) ?? null;
}

export function addXp(guildId, userId, amount) {
  if (amount) q('UPDATE users SET xp = xp + ? WHERE guild_id=? AND user_id=?').run(amount, guildId, userId);
}

export function recordBestStreak(guildId, userId, streak) {
  q('UPDATE users SET best_streak=? WHERE guild_id=? AND user_id=? AND best_streak < ?')
    .run(streak, guildId, userId, streak);
}

export function listActiveUsers(guildId) {
  return q('SELECT * FROM users WHERE guild_id=? AND active=1').all(guildId);
}

export function setActive(guildId, userId, active) {
  q('UPDATE users SET active=? WHERE guild_id=? AND user_id=?').run(active ? 1 : 0, guildId, userId);
}

/* ---------------------------------------------------------------- dailies */

const selDaily = q('SELECT * FROM dailies WHERE guild_id=? AND user_id=? AND report_date=?');

export function getDaily(guildId, userId, date) {
  return selDaily.get(guildId, userId, date) ?? null;
}

export function saveDaily({ guildId, userId, date, done, nextPlan, blocker, xp, onTime }) {
  q(
    `INSERT INTO dailies (guild_id, user_id, report_date, done, next_plan, blocker, xp, on_time)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(guild_id, user_id, report_date) DO UPDATE SET
       done=excluded.done,
       next_plan=excluded.next_plan,
       blocker=excluded.blocker,
       updated_at=datetime('now')`,
  ).run(guildId, userId, date, done, nextPlan ?? '', blocker ?? '', xp, onTime ? 1 : 0);
  return selDaily.get(guildId, userId, date);
}

/** Nhớ tin nhắn công khai của báo cáo để lần sửa sau chỉnh đúng chỗ, không đăng trùng. */
export function setDailyMessageId(guildId, userId, date, messageId) {
  q('UPDATE dailies SET message_id=? WHERE guild_id=? AND user_id=? AND report_date=?')
    .run(messageId, guildId, userId, date);
}

/** Mọi ngày đã báo cáo của user, mới nhất trước. */
export function listDailyDates(guildId, userId) {
  return q('SELECT report_date FROM dailies WHERE guild_id=? AND user_id=? ORDER BY report_date DESC')
    .all(guildId, userId)
    .map((r) => r.report_date);
}

export function listDailiesBetween(guildId, userId, from, to) {
  return q(
    `SELECT * FROM dailies WHERE guild_id=? AND user_id=? AND report_date BETWEEN ? AND ?
     ORDER BY report_date ASC`,
  ).all(guildId, userId, from, to);
}

export function listRecentDailies(guildId, userId, limit) {
  return q('SELECT * FROM dailies WHERE guild_id=? AND user_id=? ORDER BY report_date DESC LIMIT ?')
    .all(guildId, userId, limit);
}

export function userIdsReportedOn(guildId, date) {
  return new Set(
    q('SELECT user_id FROM dailies WHERE guild_id=? AND report_date=?')
      .all(guildId, date)
      .map((r) => r.user_id),
  );
}

export function usersWithDailiesBetween(guildId, from, to) {
  return q('SELECT DISTINCT user_id FROM dailies WHERE guild_id=? AND report_date BETWEEN ? AND ?')
    .all(guildId, from, to)
    .map((r) => r.user_id);
}

/* ----------------------------------------------------------- weekly plans */

export function getPlan(guildId, userId, weekStart) {
  return q('SELECT * FROM weekly_plans WHERE guild_id=? AND user_id=? AND week_start=?')
    .get(guildId, userId, weekStart) ?? null;
}

export function savePlan(guildId, userId, weekStart, plan, xpAwarded) {
  q(
    `INSERT INTO weekly_plans (guild_id, user_id, week_start, plan, xp_awarded)
     VALUES (?,?,?,?,?)
     ON CONFLICT(guild_id, user_id, week_start) DO UPDATE SET
       plan=excluded.plan, updated_at=datetime('now')`,
  ).run(guildId, userId, weekStart, plan, xpAwarded);
}

export function usersWithPlan(guildId, weekStart) {
  return q('SELECT user_id FROM weekly_plans WHERE guild_id=? AND week_start=?')
    .all(guildId, weekStart)
    .map((r) => r.user_id);
}

/* --------------------------------------------------------- weekly reviews */

export function getReview(guildId, userId, weekStart) {
  return q('SELECT * FROM weekly_reviews WHERE guild_id=? AND user_id=? AND week_start=?')
    .get(guildId, userId, weekStart) ?? null;
}

export function saveReview(guildId, userId, weekStart, review, score) {
  q(
    `INSERT INTO weekly_reviews (guild_id, user_id, week_start, review, score) VALUES (?,?,?,?,?)
     ON CONFLICT(guild_id, user_id, week_start) DO UPDATE SET
       review=excluded.review, score=excluded.score, created_at=datetime('now')`,
  ).run(guildId, userId, weekStart, review, score);
}

/* ------------------------------------------------------------ leaderboard */

export function leaderboardAllTime(guildId, limit = 15) {
  return q('SELECT * FROM users WHERE guild_id=? ORDER BY xp DESC, username ASC LIMIT ?')
    .all(guildId, limit);
}

export function leaderboardBetween(guildId, from, to, limit = 15) {
  return q(
    `SELECT d.user_id AS user_id, COALESCE(u.username,'') AS username,
            SUM(d.xp) AS xp, COUNT(*) AS reports
     FROM dailies d LEFT JOIN users u ON u.guild_id=d.guild_id AND u.user_id=d.user_id
     WHERE d.guild_id=? AND d.report_date BETWEEN ? AND ?
     GROUP BY d.user_id ORDER BY xp DESC, reports DESC LIMIT ?`,
  ).all(guildId, from, to, limit);
}

/* ----------------------------------------------------------- guild config */

export function getGuildConfig(guildId) {
  const row = q('SELECT * FROM guild_config WHERE guild_id=?').get(guildId);
  if (row) return row;
  q('INSERT INTO guild_config (guild_id) VALUES (?)').run(guildId);
  return q('SELECT * FROM guild_config WHERE guild_id=?').get(guildId);
}

export function updateGuildConfig(guildId, patch) {
  getGuildConfig(guildId);
  const fields = Object.keys(patch).filter((k) => patch[k] !== undefined && patch[k] !== null);
  if (!fields.length) return;
  const assignments = fields.map((f) => `${f}=?`).join(', ');
  q(`UPDATE guild_config SET ${assignments}, updated_at=datetime('now') WHERE guild_id=?`)
    .run(...fields.map((f) => patch[f]), guildId);
}

/* ------------------------------------------------------- thread theo ngay */

export function getDayThreadId(guildId, date) {
  return q('SELECT thread_id FROM day_threads WHERE guild_id=? AND thread_date=?')
    .get(guildId, date)?.thread_id ?? null;
}

export function saveDayThreadId(guildId, date, threadId) {
  q(`INSERT INTO day_threads (guild_id, thread_date, thread_id) VALUES (?,?,?)
     ON CONFLICT(guild_id, thread_date) DO UPDATE SET thread_id=excluded.thread_id`)
    .run(guildId, date, threadId);
}

export function forgetDayThread(guildId, date) {
  q('DELETE FROM day_threads WHERE guild_id=? AND thread_date=?').run(guildId, date);
}

export function listConfiguredGuilds() {
  return q('SELECT * FROM guild_config WHERE channel_id IS NOT NULL').all();
}
