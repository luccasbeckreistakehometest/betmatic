import { createHash } from "node:crypto";
import { getDb, nowIso } from "@/lib/server/db";
import { adjustCoins, findById } from "@/lib/server/users";

export const REF_COOKIE = "bm_ref";
/** Coins for both sides when a referred account is created — enough for a couple of on-demand games. */
export const REFERRAL_COINS = Number(process.env.REFERRAL_COINS ?? 5);

/** Stable, short, non-guessable-enough code derived from the user id; no extra column needed. */
export const refCodeFor = (userId: string) => createHash("sha1").update(`ref:${userId}`).digest("base64url").slice(0, 8);

export function userByRefCode(code: string): { id: string } | null {
  const rows = getDb().prepare("SELECT id FROM users").all() as { id: string }[];
  return rows.find((r) => refCodeFor(r.id) === code) ?? null;
}

/** Called once per new account. Idempotent by construction: a user is inserted once. */
export function creditReferral(newUserId: string, code: string | undefined): { referrerId: string } | null {
  if (!code) return null;
  const referrer = userByRefCode(code);
  if (!referrer || referrer.id === newUserId) return null;
  const db = getDb();
  db.prepare("INSERT INTO referrals (referrerId, referredId, coins, createdAt) VALUES (?,?,?,?)").run(referrer.id, newUserId, REFERRAL_COINS, nowIso());
  adjustCoins(referrer.id, REFERRAL_COINS, "referral:invited", { referred: newUserId });
  adjustCoins(newUserId, REFERRAL_COINS, "referral:welcome", { referrer: referrer.id });
  return { referrerId: referrer.id };
}

export function referralStats(userId: string): { code: string; invited: number; coinsEarned: number } {
  const row = getDb().prepare("SELECT COUNT(*) n, COALESCE(SUM(coins),0) c FROM referrals WHERE referrerId=?").get(userId) as { n: number; c: number };
  return { code: refCodeFor(userId), invited: row.n, coinsEarned: row.c };
}

export const referrerExists = (userId: string) => !!findById(userId);
