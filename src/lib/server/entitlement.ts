import { getDb } from "@/lib/server/db";
import { servePredictionsDetailed, type ServedPrediction, type Viewer } from "@/lib/server/predictions";
import { ownGeneratedGames, unlockedGames } from "@/lib/server/unlocks";
import { getPlan, type Plan, type Role } from "@/lib/plans";
import type { Lang } from "@/lib/i18n";

/**
 * One entitlement pass for every place that talks about a game's tickets outside /api/predictions:
 * pushes to followers, lineup alerts, the live panel and the per-game alert list. Whatever the
 * recipient's plan hides on the page (bands, sports, the free delay, the daily game allowance) is
 * hidden here too, so a push never becomes a side door to paid picks.
 */
export interface EntitledUser { id: string; role: Role; plan: Plan; planActive: boolean }

const OWN_WINDOW_MS = 2 * 86_400_000;

export function viewerFor(user: EntitledUser, now = Date.now()): Viewer {
  const plan = user.planActive ? user.plan : getPlan("free");
  return {
    unlocked: new Set(plan.gamesPerDay !== null ? unlockedGames(user.id, new Date(now)).map((g) => g.gameId) : []),
    ownGenerated: ownGeneratedGames(user.id, new Date(now - OWN_WINDOW_MS).toISOString()),
  };
}

/** The dateKey a game's newest tickets were saved under (callers that only know the game id). */
export function latestDateKeyForGame(sportKey: string, gameId: string): string | null {
  const row = getDb().prepare("SELECT dateKey FROM predictions WHERE scope='game' AND sportKey=? AND gameId=? ORDER BY generatedAt DESC LIMIT 1")
    .get(sportKey, gameId) as { dateKey: string } | undefined;
  return row?.dateKey ?? null;
}

/** This game's tickets as the user may read them right now, or null when the plan shows none. */
export function servedGameFor(
  user: EntitledUser,
  q: { sportKey: string; gameId: string; lang: Lang; dateKey?: string | null; now?: number },
): ServedPrediction | null {
  const plan = user.planActive ? user.plan : getPlan("free");
  const dateKey = q.dateKey ?? latestDateKeyForGame(q.sportKey, q.gameId);
  if (!dateKey) return null;
  const now = q.now ?? Date.now();
  const served = servePredictionsDetailed({
    scope: "game", sportKey: q.sportKey, dateKey, lang: q.lang, plan, role: user.role, viewer: viewerFor(user, now), now,
  }).predictions.find((p) => p.gameId === q.gameId);
  return served && served.slate.suggestions.length ? served : null;
}

/** Suggestion ids of this game the user may read right now (empty when none). */
export function visibleSuggestionIds(user: EntitledUser, q: { sportKey: string; gameId: string; lang: Lang; dateKey?: string | null; now?: number }): Set<string> {
  return new Set(servedGameFor(user, q)?.slate.suggestions.map((s) => s.id) ?? []);
}
