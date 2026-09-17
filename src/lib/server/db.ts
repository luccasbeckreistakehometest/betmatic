import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { hashPasswordSync } from "@/lib/server/auth";
import { envValue } from "@/lib/env";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
let db: Database.Database | null = null;

/**
 * Single SQLite file. WAL keeps the background refresh job writing while requests read.
 */
export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const opened = new Database(path.join(DATA_DIR, "betmatic.db"));
  // `next build` imports this module from several workers against the same file: wait for the lock
  // instead of failing, and make every schema step idempotent.
  opened.pragma("busy_timeout = 10000");
  opened.pragma("journal_mode = WAL");
  opened.pragma("foreign_keys = ON");
  opened.transaction(() => migrate(opened)).immediate();
  opened.transaction(() => ensureAdmin(opened)).immediate();
  db = opened;
  return db;
}

/**
 * ALTER TABLE for databases created before a column existed. Safe to race: two workers can both see
 * the column missing, and the loser's "duplicate column" error is the expected outcome.
 */
export function addColumn(database: Pick<Database.Database, "prepare" | "exec">, table: string, column: string, definition: string): void {
  const columns = (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (columns.length === 0 || columns.includes(column)) return;
  try {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (!(error instanceof Error && /duplicate column name/i.test(error.message))) throw error;
  }
}

export function addColumnIfMissing(table: string, column: string, definition: string): void {
  addColumn(getDb(), table, column, definition);
}

/**
 * The admin account comes from env so nothing is committed. Outside production a known default
 * is created so the panel opens on a fresh checkout.
 */
function ensureAdmin(d: Database.Database): void {
  const prod = process.env.NODE_ENV === "production";
  // A value that is really a comment (see lib/env.ts) counts as unset: it must never become a login.
  const email = (process.env.ADMIN_EMAIL === undefined ? (prod ? "" : "admin@betmatic.app") : envValue("ADMIN_EMAIL")).toLowerCase();
  const password = process.env.ADMIN_PASSWORD === undefined ? (prod ? "" : "betmatic2026") : envValue("ADMIN_PASSWORD");
  if (!email.includes("@") || !password) return;
  if (d.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return;
  // A paid plan needs an expiry to count as active; the admin's never runs out. The only synchronous
  // scrypt in the app: it runs once per fresh data directory, never on a request.
  d.prepare("INSERT OR IGNORE INTO users (id,email,name,passwordHash,role,planId,planPeriod,planExpiresAt,coins,lang,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(`usr_${randomBytes(10).toString("hex")}`, email, "Admin", hashPasswordSync(password), "admin", "max", "annual", "2099-01-01T00:00:00.000Z", 0, "pt", new Date().toISOString());
}

/** Payment rows outlive a deleted account (accounting); they are re-pointed at this inert row. */
export const DELETED_USER_ID = "usr_deleted";

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

    -- Responsible play + leaderboard consent, one row per user (defaults apply until the first write).
    -- A pause ends on its date and nothing in the code lifts it early.
    CREATE TABLE IF NOT EXISTS user_settings (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      dailyStakeCap REAL,
      weeklyStakeCap REAL,
      sessionReminderMinutes INTEGER,
      lossStreakNotice INTEGER NOT NULL DEFAULT 3,
      pausedUntil TEXT,
      pausedAt TEXT,
      leaderboardOptIn INTEGER NOT NULL DEFAULT 0,
      handle TEXT UNIQUE,
      updatedAt TEXT NOT NULL
    );

    -- "Por que perdi?": the model's post-mortem of one lost ticket, generated once per language.
    CREATE TABLE IF NOT EXISTS ticket_reviews (
      ledgerId TEXT NOT NULL,
      lang TEXT NOT NULL,
      payload TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      costUsd REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (ledgerId, lang)
    );

    -- Mercado Pago notifications already acted on. The key is "<paymentId>:credit" or
    -- "<paymentId>:reversal"; inserting it inside the crediting transaction is the idempotency guard.
    CREATE TABLE IF NOT EXISTS processed_payments (
      key TEXT PRIMARY KEY,
      paymentId TEXT NOT NULL,
      paymentRowId TEXT,
      action TEXT NOT NULL,                         -- credit | reversal | ignored
      status TEXT NOT NULL,
      amount REAL,
      processedAt TEXT NOT NULL
    );

    -- Every model call and what it cost: the daily spend ceiling reads this, not an estimate.
    CREATE TABLE IF NOT EXISTS ai_usage (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      model TEXT NOT NULL,
      inputTokens INTEGER NOT NULL DEFAULT 0,
      outputTokens INTEGER NOT NULL DEFAULT 0,
      costUsd REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(createdAt);

    -- Operator-facing errors (AI failures, payment lookups, job failures). Users see a neutral message;
    -- the detail lands here and in the server log.
    CREATE TABLE IF NOT EXISTS ops_log (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,                          -- error | warn | info
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ops_log_created ON ops_log(createdAt DESC);

    -- The in-app contact form. Status is the admin's inbox state.
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      userId TEXT,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT 'other',
      message TEXT NOT NULL,
      lang TEXT NOT NULL DEFAULT 'pt',
      status TEXT NOT NULL DEFAULT 'open',          -- open | answered | closed
      adminNote TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(status, createdAt DESC);

    -- Plans with a daily game allowance (free): the games a user opened today, in the order opened.
    CREATE TABLE IF NOT EXISTS user_game_unlocks (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dayKey TEXT NOT NULL,
      gameId TEXT NOT NULL,
      sportKey TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (userId, dayKey, gameId)
    );
  `);

  // Columns added after the first release. Each is idempotent and safe under parallel workers.
  addColumn(d, "users", "sessionVersion", "INTEGER NOT NULL DEFAULT 0");
  addColumn(d, "users", "disabledAt", "TEXT");
  addColumn(d, "users", "termsAcceptedAt", "TEXT");
  addColumn(d, "users", "termsVersion", "TEXT");
  addColumn(d, "users", "mustChangePassword", "INTEGER NOT NULL DEFAULT 0");
  addColumn(d, "payments", "preferenceId", "TEXT");
  addColumn(d, "payments", "providerPaymentId", "TEXT");
  addColumn(d, "payments", "statusDetail", "TEXT");
  addColumn(d, "payments", "reversedAt", "TEXT");
  addColumn(d, "payments", "formerUserRef", "TEXT");
  // The account's plan right before and right after a plan purchase: a refund rebuilds from these.
  addColumn(d, "payments", "planBefore", "TEXT");
  addColumn(d, "payments", "planAfter", "TEXT");
  // Referrals credit on the referred user's first paid purchase; rows from before this were credited at signup.
  addColumn(d, "referrals", "status", "TEXT NOT NULL DEFAULT 'credited'");
  addColumn(d, "referrals", "creditedAt", "TEXT");
  addColumn(d, "referrals", "paymentRowId", "TEXT");
  addColumn(d, "generation_requests", "scope", "TEXT NOT NULL DEFAULT 'game'");
  migrateRound3(d);
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment ON payments(providerPaymentId) WHERE providerPaymentId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_payments_preference ON payments(preferenceId);
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrerId, status, creditedAt);
  `);
}

/** Round 3 tables. Every statement is idempotent; the caller runs inside an immediate transaction. */
function migrateRound3(d: Database.Database): void {
  d.exec(`
    -- Destaques do dia: the few games the system generates by itself so the record is never empty.
    CREATE TABLE IF NOT EXISTS featured_games (
      dayKey TEXT NOT NULL,
      sportKey TEXT NOT NULL,
      gameId TEXT NOT NULL,
      rank INTEGER NOT NULL DEFAULT 0,
      matchup TEXT NOT NULL DEFAULT '',
      startsAt TEXT,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (dayKey, gameId)
    );
    CREATE INDEX IF NOT EXISTS idx_genreq_scope ON generation_requests(scope, createdAt);

    -- The legs of a bankroll entry built here (custom parlay) or read from a slip print. Legs matched
    -- to an ESPN game carry a settlement descriptor and are graded automatically.
    CREATE TABLE IF NOT EXISTS bankroll_legs (
      entryId TEXT NOT NULL REFERENCES bankroll_entries(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      selection TEXT NOT NULL,
      market TEXT NOT NULL DEFAULT '',
      odds REAL,
      gameId TEXT,
      sportKey TEXT,
      startsAt TEXT,
      settlement TEXT,
      outcome TEXT NOT NULL DEFAULT 'pending',
      actual TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (entryId, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_bankroll_legs_pending ON bankroll_legs(outcome, gameId);

    -- Daily/weekly/monthly allowances of per-user features (player deep dive, slip scans, tipster audits).
    CREATE TABLE IF NOT EXISTS feature_uses (
      userId TEXT NOT NULL,
      feature TEXT NOT NULL,
      dayKey TEXT NOT NULL,
      key TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (userId, feature, dayKey, key)
    );
    CREATE INDEX IF NOT EXISTS idx_feature_uses ON feature_uses(feature, createdAt);

    -- "Leitura do analista" on the player deep dive: one per athlete, day and language. The first
    -- reader pays for it; everyone after reads the same text for free.
    CREATE TABLE IF NOT EXISTS player_reads (
      sportKey TEXT NOT NULL,
      athleteId TEXT NOT NULL,
      dayKey TEXT NOT NULL,
      lang TEXT NOT NULL,
      payload TEXT NOT NULL,
      paidBy TEXT,
      costUsd REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (sportKey, athleteId, dayKey, lang)
    );

    -- Vigia de escalação: a pending ticket's leg that lost its footing before kickoff (benched, ruled
    -- out, doubtful, a key absence). One row per leg and kind; the lineup job never writes it twice.
    CREATE TABLE IF NOT EXISTS leg_alerts (
      ledgerId TEXT NOT NULL,
      legIndex INTEGER NOT NULL,
      gameId TEXT NOT NULL,
      sportKey TEXT NOT NULL,
      suggestionId TEXT,
      kind TEXT NOT NULL,
      player TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      detectedAt TEXT NOT NULL,
      PRIMARY KEY (ledgerId, legIndex, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_leg_alerts_game ON leg_alerts(gameId, detectedAt);

    -- CLV: the price each leg was taken at, and the market's close at kickoff. ledgerId is a ledger
    -- ticket id, or bl:<entryId> for a bankroll leg built here or read from a print.
    CREATE TABLE IF NOT EXISTS leg_prices (
      ledgerId TEXT NOT NULL,
      legIndex INTEGER NOT NULL,
      gameId TEXT NOT NULL,
      sportKey TEXT NOT NULL,
      startsAt TEXT,
      kind TEXT NOT NULL,                           -- ml | total | spread | prop
      marketKey TEXT NOT NULL DEFAULT '',
      athleteId TEXT,
      side TEXT,
      line REAL,
      takenDecimal REAL NOT NULL,
      openDecimal REAL,
      closeDecimal REAL,
      closeFair REAL,
      closeLine REAL,
      clvPct REAL,
      basis TEXT,                                   -- novig | raw
      direction TEXT,                               -- favor | against (line_moved only)
      status TEXT NOT NULL DEFAULT 'pending',       -- pending | closed | line_moved | no_close
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (ledgerId, legIndex)
    );
    CREATE INDEX IF NOT EXISTS idx_leg_prices_pending ON leg_prices(status, startsAt);
  `);
  addColumn(d, "user_slips", "kind", "TEXT NOT NULL DEFAULT 'analysis'");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
