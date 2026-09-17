import { DELETED_USER_ID, getDb, nowIso } from "@/lib/server/db";
import { findById, formerUserRef } from "@/lib/server/users";

/**
 * LGPD self-service: everything the product stores about one account, and the erasure that keeps
 * only what accounting needs (payment rows, re-pointed and tagged with a one-way reference).
 */
export function exportAccount(userId: string): Record<string, unknown> | null {
  const db = getDb();
  const user = findById(userId);
  if (!user) return null;
  const { passwordHash: _hash, ...profile } = user;
  void _hash;
  const all = (sql: string) => db.prepare(sql).all(userId);
  const one = (sql: string) => db.prepare(sql).get(userId) ?? null;
  return {
    exportedAt: nowIso(),
    format: "betmatic-account-export/1",
    profile,
    settings: one("SELECT * FROM user_settings WHERE userId = ?"),
    coinLedger: all("SELECT id, delta, reason, balanceAfter, createdAt FROM coin_ledger WHERE userId = ? ORDER BY createdAt"),
    payments: all("SELECT id, kind, reference, period, amount, currency, status, createdAt, settledAt, reversedAt FROM payments WHERE userId = ? ORDER BY createdAt"),
    bankroll: all("SELECT * FROM bankroll_entries WHERE userId = ? ORDER BY createdAt"),
    slips: all("SELECT id, title, legs, analysis, coinsSpent, createdAt FROM user_slips WHERE userId = ? ORDER BY createdAt"),
    follows: all("SELECT kind, sportKey, key, label, createdAt FROM follows WHERE userId = ?"),
    notifications: all("SELECT channel, kind, title, body, url, status, createdAt FROM alert_log WHERE userId = ? ORDER BY createdAt"),
    telegram: one("SELECT chatId, username, linkedAt, digest, createdAt FROM telegram_links WHERE userId = ?"),
    referralsMade: all("SELECT referredId, status, coins, createdAt, creditedAt FROM referrals WHERE referrerId = ?"),
    referredBy: one("SELECT status, createdAt FROM referrals WHERE referredId = ?"),
    gameUnlocks: all("SELECT dayKey, gameId, sportKey, createdAt FROM user_game_unlocks WHERE userId = ? ORDER BY createdAt"),
    generationRequests: all("SELECT sportKey, gameId, dateKey, status, createdAt FROM generation_requests WHERE userId = ? ORDER BY createdAt"),
    onboarding: one("SELECT tourCompleted, tourStep, firstSeenAt, completedAt, events FROM onboarding WHERE id = ?"),
    contactMessages: all("SELECT name, email, topic, message, status, createdAt FROM contact_messages WHERE userId = ? ORDER BY createdAt"),
    bankrollLegs: all("SELECT l.* FROM bankroll_legs l JOIN bankroll_entries e ON e.id = l.entryId WHERE e.userId = ? ORDER BY l.entryId, l.idx"),
    tipsterAudits: all("SELECT id, label, sportKey, report, picks, createdAt FROM tipster_audits WHERE userId = ? ORDER BY createdAt"),
    featureUses: all("SELECT feature, dayKey, createdAt FROM feature_uses WHERE userId = ? ORDER BY createdAt"),
    events: all("SELECT ts, name, path, refHost, utmSource, utmMedium, utmCampaign, utmContent, device FROM events WHERE userId = ? ORDER BY ts"),
  };
}

function ensureDeletedSentinel(): void {
  getDb().prepare(
    `INSERT OR IGNORE INTO users (id,email,name,passwordHash,role,planId,planPeriod,planExpiresAt,coins,lang,createdAt,disabledAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(DELETED_USER_ID, "deleted-accounts@betmatic.invalid", "Conta excluída", "!", "user", "free", "monthly", null, 0, "pt", nowIso(), nowIso());
}

/** Erases the account. Cascades remove every per-user table; payments survive anonymised. */
export function deleteAccount(userId: string): boolean {
  if (userId === DELETED_USER_ID) return false;
  const db = getDb();
  const run = db.transaction(() => {
    const user = findById(userId);
    if (!user) return false;
    ensureDeletedSentinel();
    db.prepare("UPDATE payments SET userId = ?, formerUserRef = ? WHERE userId = ?").run(DELETED_USER_ID, formerUserRef(userId), userId);
    // Tables without a foreign key: keep the cost accounting, drop the link to the person.
    db.prepare("UPDATE generation_requests SET userId = ? WHERE userId = ?").run(DELETED_USER_ID, userId);
    db.prepare("DELETE FROM onboarding WHERE id = ?").run(userId);
    db.prepare("DELETE FROM contact_messages WHERE userId = ?").run(userId);
    db.prepare("DELETE FROM feature_uses WHERE userId = ?").run(userId);
    db.prepare("DELETE FROM events WHERE userId = ?").run(userId);
    db.prepare("UPDATE player_reads SET paidBy = NULL WHERE paidBy = ?").run(userId);
    db.prepare("DELETE FROM leg_prices WHERE ledgerId IN (SELECT 'bl:' || id FROM bankroll_entries WHERE userId = ?)").run(userId);
    // Operator error rows may carry the id in their metadata; the message stays, the link goes.
    db.prepare("UPDATE ops_log SET meta = '{}' WHERE meta LIKE ?").run(`%${userId}%`);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    return true;
  });
  return run.immediate();
}
