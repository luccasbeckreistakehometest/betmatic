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
  `);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
