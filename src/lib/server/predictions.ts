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

/** The newest stored slate for one game in one language, whatever day it was filed under. */
export function findGamePrediction(gameId: string, lang: string): { generatedAt: string; payload: string } | null {
  return (getDb().prepare("SELECT generatedAt, payload FROM predictions WHERE scope='game' AND gameId=? AND lang=? ORDER BY generatedAt DESC LIMIT 1")
    .get(gameId, lang) as { generatedAt: string; payload: string } | undefined) ?? null;
}

/** Where a game lives — sport, matchup, kickoff, slate day — from whatever language was stored last. */
export function findGameInfo(gameId: string): { sportKey: string; matchup: string; startsAt: string | null; dateKey: string; generatedAt: string } | null {
  return (getDb().prepare("SELECT sportKey, matchup, startsAt, dateKey, generatedAt FROM predictions WHERE scope='game' AND gameId=? ORDER BY generatedAt DESC LIMIT 1")
    .get(gameId) as { sportKey: string; matchup: string; startsAt: string | null; dateKey: string; generatedAt: string } | undefined) ?? null;
}

/** Games with tickets on the given slate days — the sitemap's list of public game pages. */
export function listUpcomingGames(dateKeys: string[]): { gameId: string; sportKey: string; generatedAt: string }[] {
  if (!dateKeys.length) return [];
  return getDb().prepare(
    `SELECT gameId, sportKey, MAX(generatedAt) AS generatedAt FROM predictions
     WHERE scope='game' AND gameId IS NOT NULL AND dateKey IN (${dateKeys.map(() => "?").join(",")})
     GROUP BY gameId ORDER BY generatedAt DESC`,
  ).all(...dateKeys) as { gameId: string; sportKey: string; generatedAt: string }[];
}

/** The most recent day that has game tickets — the landing falls back to it when today has none yet. */
export function latestPredictionDateKey(): string | null {
  const row = getDb().prepare("SELECT dateKey FROM predictions WHERE scope='game' ORDER BY dateKey DESC LIMIT 1").get() as { dateKey: string } | undefined;
  return row?.dateKey ?? null;
}

export interface ServedPrediction {
  gameId: string | null;
  matchup: string;
  startsAt: string | null;
  generatedAt: string;
  slate: BetSlate;
  /** True when the viewer's plan shows tickets on a delay (this one is already past it). */
  delayed: boolean;
}

/** A game the viewer may see, whose newest tickets are still inside the plan's delay. */
export interface DelayedGame {
  gameId: string | null;
  matchup: string;
  availableAt: string;
}

/** Who is reading: a signed-in viewer on a plan with a daily allowance reads the games they chose. */
export interface Viewer {
  unlocked: Set<string>;
  ownGenerated: Set<string>;
}

/**
 * Reads inventory for a viewer, applying the plan's limits and the whitelabel scrub in one place.
 * The FE never filters entitlements itself — anything it receives, the user is allowed to see.
 */
export function servePredictionsDetailed(input: {
  scope: "game" | "slate";
  sportKey: string;
  dateKey: string;
  lang: Lang;
  plan: Plan;
  role: Role;
  viewer?: Viewer;
  /** A signed-out visitor: a plan with a daily allowance shows them nothing — the pick needs an account. */
  anonymous?: boolean;
  now?: number;
}): { predictions: ServedPrediction[]; delayedGames: DelayedGame[] } {
  const { scope, sportKey, dateKey, lang, plan, role, viewer } = input;
  const empty = { predictions: [], delayedGames: [] };

  if (role !== "admin" && plan.sports.length && !plan.sports.includes(sportKey)) return empty;
  if (role !== "admin" && scope === "slate" && !plan.crossGame) return empty;
  if (input.anonymous && plan.gamesPerDay !== null) return empty;

  const rows = getDb()
    .prepare(
      `SELECT * FROM predictions
       WHERE scope = ? AND sportKey = ? AND dateKey = ? AND lang = ?
       ORDER BY COALESCE(startsAt, generatedAt) ASC`,
    )
    .all(scope, sportKey, dateKey, lang) as StoredPrediction[];

  const now = input.now ?? Date.now();
  const delayMs = role === "admin" ? 0 : plan.delayMinutes * 60_000;
  // A daily allowance means the games the viewer chose (a viewer-less read, e.g. the digest, gets the first ones).
  const capped = role === "admin" || plan.gamesPerDay === null
    ? rows
    : viewer
      ? rows.filter((r) => r.gameId !== null && viewer.unlocked.has(r.gameId))
      : rows.slice(0, plan.gamesPerDay);

  const predictions: ServedPrediction[] = [];
  const delayedGames: DelayedGame[] = [];
  for (const row of capped) {
    const generated = Date.parse(row.generatedAt);
    const own = !!(row.gameId && viewer?.ownGenerated.has(row.gameId));
    if (delayMs > 0 && !own && generated + delayMs > now) {
      delayedGames.push({ gameId: row.gameId, matchup: row.matchup, availableAt: new Date(generated + delayMs).toISOString() });
      continue;
    }
    const slate = JSON.parse(row.payload) as BetSlate;
    const allowed: BetSlate = role === "admin"
      ? slate
      : { ...slate, suggestions: slate.suggestions.filter((s) => plan.bands.includes(s.bandKey)) };
    predictions.push({
      gameId: row.gameId,
      matchup: row.matchup,
      startsAt: row.startsAt,
      generatedAt: row.generatedAt,
      slate: scrubSlate(allowed, role, lang),
      delayed: delayMs > 0,
    });
  }
  return { predictions, delayedGames };
}

export function servePredictions(input: Parameters<typeof servePredictionsDetailed>[0]): ServedPrediction[] {
  return servePredictionsDetailed(input).predictions;
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
