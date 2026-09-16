import { getDb, newId, nowIso } from "@/lib/server/db";
import { scrubSlate } from "@/lib/server/whitelabel";
import type { BetSlate } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import type { Plan, Role } from "@/lib/plans";

export interface StoredPrediction {
  id: string;
  scope: "game" | "slate";
  sportKey: string;
  gameId: string | null;
  dateKey: string;
  lang: string;
  matchup: string;
  startsAt: string | null;
  payload: string;
  generatedAt: string;
  costUsd: number;
}

export function savePrediction(input: {
  scope: "game" | "slate";
  sportKey: string;
  gameId?: string | null;
  dateKey: string;
  lang: Lang;
  matchup?: string;
  startsAt?: string | null;
  slate: BetSlate;
  costUsd?: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO predictions (id,scope,sportKey,gameId,dateKey,lang,matchup,startsAt,payload,generatedAt,costUsd)
       VALUES (@id,@scope,@sportKey,@gameId,@dateKey,@lang,@matchup,@startsAt,@payload,@generatedAt,@costUsd)
       ON CONFLICT(scope,sportKey,COALESCE(gameId,''),dateKey,lang) DO UPDATE SET
         payload=excluded.payload, generatedAt=excluded.generatedAt, costUsd=excluded.costUsd,
         matchup=excluded.matchup, startsAt=excluded.startsAt`,
    )
    .run({
      id: newId("pred"),
      scope: input.scope,
      sportKey: input.sportKey,
      gameId: input.gameId ?? null,
      dateKey: input.dateKey,
      lang: input.lang,
      matchup: input.matchup ?? "",
      startsAt: input.startsAt ?? null,
      payload: JSON.stringify(input.slate),
      generatedAt: nowIso(),
      costUsd: input.costUsd ?? 0,
    });
}

/** Only what the refresh policy needs to decide whether to spend tokens on this game again. */
export function findPrediction(input: { scope: "game" | "slate"; sportKey: string; gameId: string | null; dateKey: string; lang: string }): { generatedAt: string; payload: string } | null {
  return (getDb().prepare(
    "SELECT generatedAt, payload FROM predictions WHERE scope=? AND sportKey=? AND COALESCE(gameId,'')=? AND dateKey=? AND lang=?",
  ).get(input.scope, input.sportKey, input.gameId ?? "", input.dateKey, input.lang) as { generatedAt: string; payload: string } | undefined) ?? null;
}

export interface ServedPrediction {
  gameId: string | null;
  matchup: string;
  startsAt: string | null;
  generatedAt: string;
  slate: BetSlate;
  /** True when the plan's delay is still hiding a fresher generation. */
  delayed: boolean;
}

/**
 * Reads inventory for a viewer, applying the plan's limits and the whitelabel scrub in one place.
 * The FE never filters entitlements itself — anything it receives, the user is allowed to see.
 */
export function servePredictions(input: {
  scope: "game" | "slate";
  sportKey: string;
  dateKey: string;
  lang: Lang;
  plan: Plan;
  role: Role;
  limit?: number;
}): ServedPrediction[] {
  const { scope, sportKey, dateKey, lang, plan, role } = input;

  if (plan.sports.length && !plan.sports.includes(sportKey)) return [];
  if (scope === "slate" && !plan.crossGame) return [];

  const rows = getDb()
    .prepare(
      `SELECT * FROM predictions
       WHERE scope = ? AND sportKey = ? AND dateKey = ? AND lang = ?
       ORDER BY COALESCE(startsAt, generatedAt) ASC`,
    )
    .all(scope, sportKey, dateKey, lang) as StoredPrediction[];

  const cutoff = Date.now() - plan.delayMinutes * 60_000;
  const capped = plan.gamesPerDay === null ? rows : rows.slice(0, plan.gamesPerDay);

  return capped
    .map((row) => {
      const fresh = Date.parse(row.generatedAt) > cutoff;
      // A delayed plan still sees the ticket, just not the newest regeneration of it.
      if (fresh && plan.delayMinutes > 0) return null;
      const slate = JSON.parse(row.payload) as BetSlate;
      const allowed: BetSlate = {
        ...slate,
        suggestions: slate.suggestions.filter((s) => plan.bands.includes(s.bandKey)),
      };
      return {
        gameId: row.gameId,
        matchup: row.matchup,
        startsAt: row.startsAt,
        generatedAt: row.generatedAt,
        slate: scrubSlate(allowed, role, lang),
        delayed: plan.delayMinutes > 0,
      };
    })
    .filter((p): p is ServedPrediction => p !== null);
}

export function predictionStats() {
  const db = getDb();
  return {
    total: (db.prepare("SELECT COUNT(*) AS n FROM predictions").get() as { n: number }).n,
    costUsd:
      (db.prepare("SELECT COALESCE(SUM(costUsd),0) AS c FROM predictions").get() as { c: number }).c,
    latest:
      (db.prepare("SELECT MAX(generatedAt) AS t FROM predictions").get() as { t: string | null }).t,
  };
}
