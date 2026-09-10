import { getDb, newId, nowIso } from "@/lib/server/db";
import { savePrediction } from "@/lib/server/predictions";
import { buildBets, buildSlateBets } from "@/lib/bets/builder";
import { getGameDetail, getSlateOrNearest, todayKey } from "@/lib/sources/espn";
import { buildPropCandidates } from "@/lib/props/candidates";
import { refereeForMatch } from "@/lib/signals/referee";
import { computeDvp } from "@/lib/signals/dvp";
import { closeSofascore } from "@/lib/sources/sofascore";
import { getSport } from "@/lib/sports";
import { aiConfigured } from "@/lib/ai/client";
import { lastUsage } from "@/lib/ai/extract";
import { SPORTS } from "@/lib/sports";
import type { Lang } from "@/lib/i18n";

export interface RefreshResult {
  runId: string;
  games: number;
  predictions: number;
  costUsd: number;
  note: string;
}

const LANGS: Lang[] = ["pt", "en"];
const BANDS = ["safe", "value", "mid", "long", "moonshot"];

/**
 * The background job. Users never trigger generation — this fills the inventory they read, so the
 * cost is a function of the slate size, not of how many people are logged in.
 */
export async function runRefresh(options: { sports?: string[]; maxGames?: number } = {}): Promise<RefreshResult> {
  const db = getDb();
  const runId = newId("job");
  const sports = options.sports?.length ? options.sports : SPORTS.map((s) => s.key);
  const maxGames = options.maxGames ?? 8;

  db.prepare("INSERT INTO job_runs (id,job,status,startedAt) VALUES (?,?,?,?)").run(
    runId,
    "refresh",
    "running",
    nowIso(),
  );

  let games = 0;
  let predictions = 0;
  let cost = 0;
  const notes: string[] = [];

  if (!aiConfigured()) {
    const note = "ANTHROPIC_API_KEY missing — nothing generated.";
    db.prepare("UPDATE job_runs SET status=?, finishedAt=?, note=? WHERE id=?").run("error", nowIso(), note, runId);
    return { runId, games: 0, predictions: 0, costUsd: 0, note };
  }

  for (const sportKey of sports) {
    let slate;
    try {
      slate = await getSlateOrNearest(todayKey(), false, sportKey);
    } catch (error) {
      notes.push(`${sportKey}: slate failed (${error instanceof Error ? error.message : "?"})`);
      continue;
    }
    // Only games that have not started are worth a ticket.
    const upcoming = slate.games.filter((g) => g.status === "scheduled").slice(0, maxGames);
    if (!upcoming.length) {
      notes.push(`${sportKey}: no upcoming games`);
      continue;
    }

    const detailed: { game: (typeof upcoming)[number]; detail: NonNullable<Awaited<ReturnType<typeof getGameDetail>>> }[] = [];

    for (const game of upcoming) {
      const detail = await getGameDetail(game.id, false, sportKey).catch(() => null);
      if (!detail) continue;
      games += 1;
      const props = await buildPropCandidates(detail).catch(() => []);
      detailed.push({ game: detail.game, detail });

      // Signals are computed once per game and reused for both languages.
      const sportDef = getSport(sportKey);
      const referee =
        sportDef.group === "soccer"
          ? await refereeForMatch(detail.game.home.displayName, detail.game.away.displayName, slate.dateKey).catch(() => null)
          : null;
      const dvp =
        sportDef.group === "basketball"
          ? {
              home: await computeDvp(sportKey, detail.game.home.id, detail.game.home.abbreviation).catch(() => null),
              away: await computeDvp(sportKey, detail.game.away.id, detail.game.away.abbreviation).catch(() => null),
            }
          : undefined;

      for (const lang of LANGS) {
        try {
          const slateBets = await buildBets({
            game: detail.game,
            detail,
            props,
            picks: [],
            dimers: [],
            x: null,
            bands: BANDS,
            lang,
            referee,
            dvp,
          });
          cost += lastUsage?.costUsd ?? 0;
          savePrediction({
            scope: "game",
            sportKey,
            gameId: detail.game.id,
            dateKey: slate.dateKey,
            lang,
            matchup: `${detail.game.away.displayName} @ ${detail.game.home.displayName}`,
            startsAt: detail.game.startsAt,
            slate: slateBets,
            costUsd: lastUsage?.costUsd ?? 0,
          });
          predictions += 1;
        } catch (error) {
          notes.push(`${sportKey}/${game.id}/${lang}: ${error instanceof Error ? error.message : "?"}`);
        }
      }
    }

    // Cross-game tickets need at least two games to stack.
    if (detailed.length >= 2) {
      for (const lang of LANGS) {
        try {
          const cross = await buildSlateBets({
            games: detailed.map((d) => ({ game: d.game, detail: d.detail })),
            bands: ["long", "moonshot"],
            lang,
          });
          cost += lastUsage?.costUsd ?? 0;
          savePrediction({
            scope: "slate",
            sportKey,
            gameId: null,
            dateKey: slate.dateKey,
            lang,
            matchup: `${detailed.length} games`,
            slate: cross,
            costUsd: lastUsage?.costUsd ?? 0,
          });
          predictions += 1;
        } catch (error) {
          notes.push(`${sportKey}/slate/${lang}: ${error instanceof Error ? error.message : "?"}`);
        }
      }
    }
  }

  // The Sofascore client keeps a browser alive between calls; close it when the run ends.
  await closeSofascore().catch(() => null);

  const note = notes.slice(0, 12).join(" | ");
  db.prepare(
    "UPDATE job_runs SET status=?, finishedAt=?, gamesProcessed=?, predictionsWritten=?, costUsd=?, note=? WHERE id=?",
  ).run("ok", nowIso(), games, predictions, cost, note, runId);

  return { runId, games, predictions, costUsd: cost, note };
}

export function recentRuns(limit = 10) {
  return getDb().prepare("SELECT * FROM job_runs ORDER BY startedAt DESC LIMIT ?").all(limit);
}
