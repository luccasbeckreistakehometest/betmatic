import { getDb } from "@/lib/server/db";
import { brasiliaDayStart } from "@/lib/server/ai-budget";

/** Reads of the featured table, kept free of the generation imports (the digest and landing use them). */
export const dayKeyNow = (now = new Date()) => brasiliaDayStart(now).slice(0, 10);

export interface FeaturedRow { dayKey: string; sportKey: string; gameId: string; rank: number; matchup: string; startsAt: string | null; createdAt: string }

export function featuredToday(now = new Date()): FeaturedRow[] {
  return getDb().prepare("SELECT * FROM featured_games WHERE dayKey=? ORDER BY rank").all(dayKeyNow(now)) as FeaturedRow[];
}

/** Game ids featured today or yesterday (a late-night visitor still sees yesterday's picks). */
export function recentFeaturedIds(now = new Date()): Set<string> {
  const since = new Date(now.getTime() - 36 * 3_600_000).toISOString();
  return new Set((getDb().prepare("SELECT gameId FROM featured_games WHERE createdAt >= ?").all(since) as { gameId: string }[]).map((r) => r.gameId));
}

export const featuredGeneratedToday = (now = new Date()) =>
  (getDb().prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='featured' AND status='ok' AND createdAt > ?").get(brasiliaDayStart(now)) as { n: number }).n;

export function featuredCostToday(now = new Date()): number {
  return (getDb().prepare("SELECT COALESCE(SUM(costUsd),0) c FROM generation_requests WHERE scope='featured' AND createdAt > ?").get(brasiliaDayStart(now)) as { c: number }).c;
}
