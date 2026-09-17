import { getDb, nowIso } from "@/lib/server/db";
import { brasiliaDayStart } from "@/lib/server/ai-budget";
import type { Plan } from "@/lib/plans";

/**
 * Plans with a daily game allowance (free: 1) let the user CHOOSE the game: the first N games they
 * open on a Brasília calendar day are theirs for that day. Written only on POST (opening a game
 * asks for its tickets), never on a page read.
 */
export const dayKeyFor = (now = new Date()) => brasiliaDayStart(now).slice(0, 10);

export function unlockedGames(userId: string, now = new Date()): { gameId: string; sportKey: string }[] {
  return getDb().prepare("SELECT gameId, sportKey FROM user_game_unlocks WHERE userId = ? AND dayKey = ? ORDER BY createdAt ASC")
    .all(userId, dayKeyFor(now)) as { gameId: string; sportKey: string }[];
}

export type UnlockResult =
  | { ok: true; alreadyUnlocked: boolean }
  | { ok: false; reason: "limit"; unlocked: { gameId: string; sportKey: string }[] };

export function unlockGame(input: { userId: string; plan: Plan; gameId: string; sportKey: string; now?: Date }): UnlockResult {
  const { userId, plan, gameId, sportKey } = input;
  const now = input.now ?? new Date();
  if (plan.gamesPerDay === null) return { ok: true, alreadyUnlocked: false };
  const db = getDb();
  const run = db.transaction((): UnlockResult => {
    const current = unlockedGames(userId, now);
    if (current.some((g) => g.gameId === gameId)) return { ok: true, alreadyUnlocked: true };
    if (current.length >= (plan.gamesPerDay ?? 0)) return { ok: false, reason: "limit", unlocked: current };
    db.prepare("INSERT OR IGNORE INTO user_game_unlocks (userId, dayKey, gameId, sportKey, createdAt) VALUES (?,?,?,?,?)")
      .run(userId, dayKeyFor(now), gameId, sportKey, nowIso());
    return { ok: true, alreadyUnlocked: false };
  });
  return run.immediate();
}

/** Games whose current tickets this user generated: their own fresh work is never delayed. */
export function ownGeneratedGames(userId: string, since: string): Set<string> {
  const rows = getDb().prepare("SELECT DISTINCT gameId FROM generation_requests WHERE userId = ? AND status = 'ok' AND createdAt >= ?")
    .all(userId, since) as { gameId: string }[];
  return new Set(rows.map((r) => r.gameId));
}
