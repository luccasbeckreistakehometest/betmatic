import { createHash } from "node:crypto";
import { brasiliaDayStart } from "@/lib/server/ai-budget";
import { getDb, nowIso } from "@/lib/server/db";
import { adjustCoins, findById } from "@/lib/server/users";

export const REF_COOKIE = "bm_ref";
/** Coins for both sides once the referred account makes its first paid purchase. */
export const REFERRAL_COINS = Number(process.env.REFERRAL_COINS ?? 5);
/** How many referrals one referrer can be paid for per day; the rest are recorded as capped. */
export const referralDailyCap = () => Math.max(0, Number(process.env.REFERRAL_DAILY_CAP ?? 3) || 0);

/** Stable, short, non-guessable-enough code derived from the user id; no extra column needed. */
export const refCodeFor = (userId: string) => createHash("sha1").update(`ref:${userId}`).digest("base64url").slice(0, 8);

export function userByRefCode(code: string): { id: string } | null {
  if (!/^[A-Za-z0-9_-]{8}$/.test(code)) return null;
  const rows = getDb().prepare("SELECT id FROM users WHERE disabledAt IS NULL").all() as { id: string }[];
  return rows.find((r) => refCodeFor(r.id) === code) ?? null;
}

/**
 * Called once per new account: remembers who referred it. Nothing is credited yet — a signup costs
 * nothing to fake, a paid purchase does.
 */
export function recordReferral(newUserId: string, code: string | undefined): { referrerId: string } | null {
  if (!code) return null;
  const referrer = userByRefCode(code);
  if (!referrer || referrer.id === newUserId) return null;
  const res = getDb().prepare("INSERT OR IGNORE INTO referrals (referrerId, referredId, coins, createdAt, status) VALUES (?,?,0,?,'pending')")
    .run(referrer.id, newUserId, nowIso());
  return res.changes ? { referrerId: referrer.id } : null;
}

/**
 * Runs inside the payment-crediting transaction. The referred user always gets the welcome coins on
 * their first purchase; the referrer is paid only while under the daily cap.
 */
export function creditReferralOnPurchase(referredId: string, paymentRowId: string, now = new Date()): "credited" | "capped" | null {
  const db = getDb();
  const row = db.prepare("SELECT referrerId FROM referrals WHERE referredId = ? AND status = 'pending'").get(referredId) as { referrerId: string } | undefined;
  if (!row) return null;
  const referrerAlive = !!findById(row.referrerId);
  const paidToday = (db.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrerId = ? AND status = 'credited' AND creditedAt >= ?")
    .get(row.referrerId, brasiliaDayStart(now)) as { n: number }).n;
  const underCap = referrerAlive && paidToday < referralDailyCap();
  adjustCoins(referredId, REFERRAL_COINS, "referral:welcome", { referrer: row.referrerId, payment: paymentRowId });
  if (underCap) adjustCoins(row.referrerId, REFERRAL_COINS, "referral:invited", { referred: referredId, payment: paymentRowId });
  const status = underCap ? "credited" : "capped";
  db.prepare("UPDATE referrals SET status = ?, coins = ?, creditedAt = ? WHERE referredId = ?")
    .run(status, underCap ? REFERRAL_COINS : 0, now.toISOString(), referredId);
  return status;
}

export function referralStats(userId: string): { code: string; invited: number; converted: number; coinsEarned: number } {
  const row = getDb().prepare(
    "SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='credited' THEN 1 ELSE 0 END),0) conv, COALESCE(SUM(CASE WHEN status='credited' THEN coins ELSE 0 END),0) c FROM referrals WHERE referrerId=?",
  ).get(userId) as { n: number; conv: number; c: number };
  return { code: refCodeFor(userId), invited: row.n, converted: row.conv, coinsEarned: row.c };
}

export const referrerExists = (userId: string) => !!findById(userId);
