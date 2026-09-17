import { getDb } from "@/lib/server/db";
import { brasiliaDayStart } from "@/lib/server/ai-budget";

/**
 * Allowances of per-user features, counted per Brasília day. `key` makes a repeat free: opening the
 * same player twice on one day uses one slot.
 */
export type Feature = "player" | "scan" | "tipster" | "scan_try" | "tipster_try";

/**
 * Model calls behind the paid-per-read features. The allowance counts reads the user got; these
 * count every call that reached the model, whatever came back (an empty or failed read still cost
 * tokens), are never released, and have a global ceiling so free reads cannot drain the AI budget.
 */
export function aiTryLimits(env: Record<string, string | undefined> = process.env) {
  const n = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d);
  return {
    scan: { free: n(env.SCAN_TRIES_FREE_PER_DAY, 6), paid: n(env.SCAN_TRIES_PAID_PER_DAY, 40) },
    tipster: { free: n(env.TIPSTER_TRIES_FREE_PER_DAY, 3), paid: n(env.TIPSTER_TRIES_PAID_PER_DAY, 10), global: n(env.TIPSTER_DAILY_CAP, 100) },
  };
}

const dayKey = (now = new Date()) => brasiliaDayStart(now).slice(0, 10);

export function usesSince(userId: string, feature: Feature, since: Date): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM feature_uses WHERE userId=? AND feature=? AND createdAt >= ?").get(userId, feature, since.toISOString()) as { n: number }).n;
}

export function usesToday(userId: string, feature: Feature, now = new Date()): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM feature_uses WHERE userId=? AND feature=? AND dayKey=?").get(userId, feature, dayKey(now)) as { n: number }).n;
}

export function hasUsedToday(userId: string, feature: Feature, key: string, now = new Date()): boolean {
  return !!getDb().prepare("SELECT 1 FROM feature_uses WHERE userId=? AND feature=? AND dayKey=? AND key=?").get(userId, feature, dayKey(now), key);
}

export function globalUsesToday(feature: Feature, now = new Date()): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM feature_uses WHERE feature=? AND dayKey=?").get(feature, dayKey(now)) as { n: number }).n;
}

export function recordUse(userId: string, feature: Feature, key: string, now = new Date()): void {
  getDb().prepare("INSERT OR IGNORE INTO feature_uses (userId, feature, dayKey, key, createdAt) VALUES (?,?,?,?,?)").run(userId, feature, dayKey(now), key, now.toISOString());
}

export function releaseUse(userId: string, feature: Feature, key: string, now = new Date()): void {
  getDb().prepare("DELETE FROM feature_uses WHERE userId=? AND feature=? AND dayKey=? AND key=?").run(userId, feature, dayKey(now), key);
}

/**
 * Takes a slot if the allowance has room, inside one immediate transaction so two parallel requests
 * cannot both take the last one. A key already used today is free.
 */
export function claimUse(input: { userId: string; feature: Feature; key: string; limit: number; since?: Date; now?: Date }): { ok: boolean; used: number; repeat: boolean } {
  const now = input.now ?? new Date();
  const db = getDb();
  return db.transaction(() => {
    if (hasUsedToday(input.userId, input.feature, input.key, now)) return { ok: true, used: usesToday(input.userId, input.feature, now), repeat: true };
    const used = input.since ? usesSince(input.userId, input.feature, input.since) : usesToday(input.userId, input.feature, now);
    if (used >= input.limit) return { ok: false, used, repeat: false };
    recordUse(input.userId, input.feature, input.key, now);
    return { ok: true, used: used + 1, repeat: false };
  }).immediate();
}
