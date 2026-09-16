import { getDb, newId, nowIso } from "@/lib/server/db";
import { findPrediction, savePrediction } from "@/lib/server/predictions";
import { buildBets, buildSlateBets } from "@/lib/bets/builder";
import { localiseSlate } from "@/lib/bets/localise";
import { refreshConfig, shouldGenerate } from "@/lib/server/refresh-policy";
import { getGameDetail, getSlateOrNearest, todayKey } from "@/lib/sources/espn";
import { buildPropCandidates } from "@/lib/props/candidates";
import { refereeForMatch } from "@/lib/signals/referee";
import { computeDvp } from "@/lib/signals/dvp";
import { closeSofascore } from "@/lib/sources/sofascore";
import { getSport, SPORTS } from "@/lib/sports";
import { aiConfigured } from "@/lib/ai/client";
import { lastUsage } from "@/lib/ai/extract";
import type { BetSlate } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

export interface RefreshResult {
  runId: string;
  games: number;
  predictions: number;
  skipped: number;
  costUsd: number;
  note: string;
}

const BANDS = ["safe", "value", "mid", "long", "moonshot"];

/**
 * The background job. Users never trigger generation — this fills the inventory they read.
 *
 * Cost discipline, learned the expensive way: a game is generated once per day in the primary
 * language, the second language is derived from it by the cheaper model, and a run that finds
 * nothing new spends nothing on the model. Sports, game cap, languages and the optional pre-match
 * refresh all come from env (see refresh-policy.ts), so the ceiling is a deploy setting.
 */
export async function runRefresh(options: { sports?: string[]; maxGames?: number } = {}): Promise<RefreshResult> {
  const db = getDb();
  const runId = newId("job");
  const cfg = refreshConfig(process.env, SPORTS.map((s) => s.key));
  const sports = options.sports?.length ? options.sports : cfg.sports;
  const maxGames = options.maxGames ?? cfg.maxGames;
  const [primary, ...derived] = cfg.langs as Lang[];

  db.prepare("INSERT INTO job_runs (id,job,status,startedAt) VALUES (?,?,?,?)").run(runId, "refresh", "running", nowIso());

  let games = 0, predictions = 0, skipped = 0, cost = 0;
  const notes: string[] = [];
  const spend = () => { cost += lastUsage?.costUsd ?? 0; return lastUsage?.costUsd ?? 0; };

  if (!aiConfigured()) {
    const note = "ANTHROPIC_API_KEY missing — nothing generated.";
    db.prepare("UPDATE job_runs SET status=?, finishedAt=?, note=? WHERE id=?").run("error", nowIso(), note, runId);
    return { runId, games: 0, predictions: 0, skipped: 0, costUsd: 0, note };
  }

  for (const sportKey of sports) {
    let slate;
    try {
      slate = await getSlateOrNearest(todayKey(), false, sportKey);
    } catch (error) {
      notes.push(`${sportKey}: slate failed (${error instanceof Error ? error.message : "?"})`);
      continue;
    }
    const upcoming = slate.games.filter((g) => g.status === "scheduled").slice(0, maxGames);
    if (!upcoming.length) { notes.push(`${sportKey}: no upcoming games`); continue; }

    const detailed: { game: (typeof upcoming)[number]; detail: NonNullable<Awaited<ReturnType<typeof getGameDetail>>> }[] = [];
    let generatedThisRun = 0;

    for (const game of upcoming) {
      const existing = findPrediction({ scope: "game", sportKey, gameId: game.id, dateKey: slate.dateKey, lang: primary });
      const decision = shouldGenerate({ existingGeneratedAt: existing?.generatedAt ?? null, startsAt: game.startsAt, now: Date.now(), prematchHours: cfg.prematchHours });
      if (!decision.generate) { skipped += 1; continue; }

      const detail = await getGameDetail(game.id, false, sportKey).catch(() => null);
      if (!detail) continue;
      games += 1;
      const props = await buildPropCandidates(detail).catch(() => []);
      detailed.push({ game: detail.game, detail });

      const sportDef = getSport(sportKey);
      const referee = sportDef.group === "soccer"
        ? await refereeForMatch(detail.game.home.displayName, detail.game.away.displayName, slate.dateKey).catch(() => null)
        : null;
      const dvp = sportDef.group === "basketball"
        ? { home: await computeDvp(sportKey, detail.game.home.id, detail.game.home.abbreviation).catch(() => null),
            away: await computeDvp(sportKey, detail.game.away.id, detail.game.away.abbreviation).catch(() => null) }
        : undefined;

      const matchup = `${detail.game.away.displayName} @ ${detail.game.home.displayName}`;
      const save = (lang: Lang, s: BetSlate, costUsd: number) =>
        savePrediction({ scope: "game", sportKey, gameId: detail.game.id, dateKey: slate.dateKey, lang, matchup, startsAt: detail.game.startsAt, slate: s, costUsd });

      let primarySlate: BetSlate;
      try {
        primarySlate = await buildBets({ game: detail.game, detail, props, picks: [], dimers: [], x: null, bands: BANDS, lang: primary, referee, dvp });
        save(primary, primarySlate, spend());
        predictions += 1; generatedThisRun += 1;
        notes.push(`${sportKey}/${game.id}: ${decision.reason}`);
      } catch (error) {
        notes.push(`${sportKey}/${game.id}/${primary}: ${error instanceof Error ? error.message : "?"}`);
        continue;
      }
      for (const lang of derived) {
        try {
          save(lang, await localiseSlate(primarySlate, primary, lang), spend());
          predictions += 1;
        } catch (error) {
          notes.push(`${sportKey}/${game.id}/${lang}: ${error instanceof Error ? error.message : "?"}`);
        }
      }
    }

    // Cross-game tickets: once per day per sport, and again only when a game in it was regenerated.
    const slateExisting = findPrediction({ scope: "slate", sportKey, gameId: null, dateKey: slate.dateKey, lang: primary });
    if (detailed.length >= 2 && (!slateExisting || generatedThisRun > 0)) {
      try {
        const cross = await buildSlateBets({ games: detailed.map((d) => ({ game: d.game, detail: d.detail })), bands: ["long", "moonshot"], lang: primary });
        const saveSlate = (lang: Lang, s: BetSlate, costUsd: number) =>
          savePrediction({ scope: "slate", sportKey, gameId: null, dateKey: slate.dateKey, lang, matchup: `${detailed.length} games`, slate: s, costUsd });
        saveSlate(primary, cross, spend()); predictions += 1;
        for (const lang of derived) {
          try { saveSlate(lang, await localiseSlate(cross, primary, lang), spend()); predictions += 1; }
          catch (error) { notes.push(`${sportKey}/slate/${lang}: ${error instanceof Error ? error.message : "?"}`); }
        }
      } catch (error) {
        notes.push(`${sportKey}/slate: ${error instanceof Error ? error.message : "?"}`);
      }
    }
  }

  await closeSofascore().catch(() => null);

  const note = [`skipped ${skipped} fresh`, ...notes].slice(0, 14).join(" | ");
  db.prepare("UPDATE job_runs SET status=?, finishedAt=?, gamesProcessed=?, predictionsWritten=?, costUsd=?, note=? WHERE id=?")
    .run("ok", nowIso(), games, predictions, cost, note, runId);
  return { runId, games, predictions, skipped, costUsd: cost, note };
}

export function recentRuns(limit = 10) {
  return getDb().prepare("SELECT * FROM job_runs ORDER BY startedAt DESC LIMIT ?").all(limit);
}
