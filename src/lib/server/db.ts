import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/server/auth";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
let db: Database.Database | null = null;

/**
 * Single SQLite file. WAL keeps the background refresh job writing while requests read.
 */
export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, "betmatic.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  ensureAdmin(db);
  return db;
}

/**
 * The admin account comes from env so nothing is committed. Outside production a known default
 * is created so the panel opens on a fresh checkout.
 */
function ensureAdmin(d: Database.Database): void {
  const prod = process.env.NODE_ENV === "production";
  const email = (process.env.ADMIN_EMAIL ?? (prod ? "" : "admin@betmatic.app")).trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? (prod ? "" : "betmatic2026");
  if (!email || !password) return;
  if (d.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return;
  // A paid plan needs an expiry to count as active; the admin's never runs out.
  d.prepare("INSERT INTO users (id,email,name,passwordHash,role,planId,planPeriod,planExpiresAt,coins,lang,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(`usr_${randomBytes(10).toString("hex")}`, email, "Admin", hashPassword(password), "admin", "max", "yearly", "2099-01-01T00:00:00.000Z", 0, "pt", new Date().toISOString());
}

function migrate(d: Database.Database): void {
  d.exec(`
    -- First access: tour progress and the first session's events, per user or anonymous cookie.
    CREATE TABLE IF NOT EXISTS onboarding (
      id TEXT PRIMARY KEY,
      tourCompleted INTEGER NOT NULL DEFAULT 0,
      tourStep INTEGER NOT NULL DEFAULT 0,
      firstSeenAt TEXT NOT NULL,
      completedAt TEXT,
      events TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',           -- 'user' | 'admin'
      planId TEXT NOT NULL DEFAULT 'free',
      planPeriod TEXT NOT NULL DEFAULT 'monthly',
      planExpiresAt TEXT,
      coins INTEGER NOT NULL DEFAULT 0,
      lang TEXT NOT NULL DEFAULT 'pt',
      createdAt TEXT NOT NULL,
      lastSeenAt TEXT
    );

    CREATE TABLE IF NOT EXISTS coin_ledger (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,                       -- positive = credit, negative = spend
      reason TEXT NOT NULL,
      balanceAfter INTEGER NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coin_ledger_user ON coin_ledger(userId, createdAt);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                           -- 'coins' | 'plan'
      reference TEXT NOT NULL,                      -- packId or planId
      period TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      status TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected
      providerId TEXT,
      createdAt TEXT NOT NULL,
      settledAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(userId, createdAt);

    -- Pre-generated inventory. Users never trigger generation; they read this.
    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,                          -- 'game' | 'slate'
      sportKey TEXT NOT NULL,
      gameId TEXT,
      dateKey TEXT NOT NULL,
      lang TEXT NOT NULL,
      matchup TEXT NOT NULL DEFAULT '',
      startsAt TEXT,
      payload TEXT NOT NULL,                        -- serialised BetSlate
      generatedAt TEXT NOT NULL,
      costUsd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_predictions_lookup ON predictions(sportKey, dateKey, lang, scope);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_unique ON predictions(scope, sportKey, COALESCE(gameId,''), dateKey, lang);

    -- Cached per-game research (injuries, market, measured props) so the FE renders instantly.
    CREATE TABLE IF NOT EXISTS game_research (
      id TEXT PRIMARY KEY,
      sportKey TEXT NOT NULL,
      gameId TEXT NOT NULL,
      dateKey TEXT NOT NULL,
      lang TEXT NOT NULL,
      payload TEXT NOT NULL,
      generatedAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_research_unique ON game_research(sportKey, gameId, lang);

    -- On-demand generations, one row per attempt: this is what the daily caps count.
    CREATE TABLE IF NOT EXISTS generation_requests (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      sportKey TEXT NOT NULL,
      gameId TEXT NOT NULL,
      dateKey TEXT NOT NULL,
      status TEXT NOT NULL,                         -- running | ok
      costUsd REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      finishedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_genreq_created ON generation_requests(createdAt);
    CREATE INDEX IF NOT EXISTS idx_genreq_user ON generation_requests(userId, createdAt);

    -- Versioned generation prompts. The code default is implicit version 0; every admin feedback or
    -- manual edit adds a version, and exactly one per (kind, lang) is active.
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,                           -- game | slate
      lang TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,                         -- feedback | manual | revert
      feedback TEXT NOT NULL DEFAULT '',
      rationale TEXT NOT NULL DEFAULT '',
      batch TEXT NOT NULL DEFAULT '',               -- one feedback rewrites both languages together
      createdBy TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_kind ON prompt_versions(kind, lang, version DESC);

    -- One row per learning run: the post-mortem over recently settled tickets and, when the agent
    -- found something to change, the prompt feedback it proposed (applied or still waiting).
    CREATE TABLE IF NOT EXISTS learning_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,                         -- ok | skipped | error
      windowStart TEXT NOT NULL,
      windowEnd TEXT NOT NULL,
      tickets INTEGER NOT NULL DEFAULT 0,
      won INTEGER NOT NULL DEFAULT 0,
      lost INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      report TEXT NOT NULL DEFAULT '{}',
      promptFeedback TEXT NOT NULL DEFAULT '',
      applied INTEGER NOT NULL DEFAULT 0,
      appliedBatch TEXT NOT NULL DEFAULT '',
      costUsd REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_created ON learning_runs(createdAt DESC);

    -- A user's own bankroll: generated tickets saved with a stake inherit the ledger's automatic
    -- grading; bets placed elsewhere are logged and graded by the user.
    CREATE TABLE IF NOT EXISTS bankroll_entries (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL,                         -- ticket | manual
      ledgerId TEXT,
      title TEXT NOT NULL DEFAULT '',
      matchup TEXT NOT NULL DEFAULT '',
      combinedDecimal REAL NOT NULL,
      stake REAL NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'pending',      -- manual entries only; ticket entries read the ledger
      createdAt TEXT NOT NULL,
      settledAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bankroll_user ON bankroll_entries(userId, createdAt DESC);

    -- Who brought whom; both sides are credited once when the referred account is created.
    CREATE TABLE IF NOT EXISTS referrals (
      referrerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referredId TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      coins INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_runs (
      id TEXT PRIMARY KEY,
      job TEXT NOT NULL,
      status TEXT NOT NULL,                         -- running | ok | error
      startedAt TEXT NOT NULL,
      finishedAt TEXT,
      gamesProcessed INTEGER NOT NULL DEFAULT 0,
      predictionsWritten INTEGER NOT NULL DEFAULT 0,
      costUsd REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(startedAt DESC);

    -- Tickets a user assembled themselves, and the AI critique they paid coins for.
    CREATE TABLE IF NOT EXISTS user_slips (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      legs TEXT NOT NULL DEFAULT '[]',
      analysis TEXT,
      coinsSpent INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      analysedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_slips_user ON user_slips(userId, createdAt);

    -- Telegram: one row per user. The one-time code is issued in the app and consumed by the bot
    -- (/start <code>); once chatId is set the code is cleared. digest = the morning "tickets of
    -- the day" message.
    CREATE TABLE IF NOT EXISTS telegram_links (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code TEXT UNIQUE,
      codeExpiresAt TEXT,
      chatId TEXT,
      username TEXT NOT NULL DEFAULT '',
      linkedAt TEXT,
      digest INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_chat ON telegram_links(chatId);

    -- What a user wants to hear about: a league (sport key) or a team (ESPN team id within a sport).
    CREATE TABLE IF NOT EXISTS follows (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                           -- team | league
      sportKey TEXT NOT NULL,
      key TEXT NOT NULL,                            -- team id, or the sport key again for a league
      label TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      PRIMARY KEY (userId, kind, sportKey, key)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_sport ON follows(sportKey);

    -- Every alert the product sent or queued, per user: the Telegram history and the in-app list
    -- are the same table. dedupeKey stops a regenerated game from alerting twice.
    CREATE TABLE IF NOT EXISTS alert_log (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,                        -- telegram | inapp
      kind TEXT NOT NULL,                           -- tickets | digest | system
      dedupeKey TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,                         -- sent | failed | unread | read
      error TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      readAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_dedupe ON alert_log(userId, dedupeKey);
    CREATE INDEX IF NOT EXISTS idx_alert_user ON alert_log(userId, createdAt DESC);
  `);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
