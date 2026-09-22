import { getDb, newId, nowIso } from "@/lib/server/db";
import { aiConfigured } from "@/lib/ai/client";
import { AiBudgetExceededError, budgetState } from "@/lib/server/ai-budget";
import { featuredConfig, pickFeatured, type FeaturedCandidate } from "@/lib/server/featured-policy";
import { findPrediction } from "@/lib/server/predictions";
import { refreshConfig } from "@/lib/server/refresh-policy";
import { generateGame } from "@/lib/server/generate-game";
import { espnDateKey, getGameDetail, getSlate, shiftKey, todayKey } from "@/lib/sources/espn";
import { SPORTS } from "@/lib/sports";
import { logEvent, reportError } from "@/lib/server/ops-log";
import type { Lang } from "@/lib/i18n";

export const SYSTEM_USER = "system";
import { dayKeyNow, featuredGeneratedToday, featuredToday } from "@/lib/server/featured-store";
export { featuredCostToday, featuredToday, recentFeaturedIds } from "@/lib/server/featured-store";




function followCounts() {
  const rows = getDb().prepare("SELECT kind, sportKey, key, COUNT(*) n FROM follows GROUP BY kind, sportKey, key").all() as { kind: string; sportKey: string; key: string; n: number }[];
  const teams = new Map<string, number>();
  const leagues = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === "league") leagues.set(r.sportKey, r.n);
    else teams.set(`${r.sportKey}:${r.key}`, r.n);
  }
  return { teams, leagues };
}


export interface FeaturedResult { runId: string; status: "ok" | "error" | "skipped"; picked: number; generated: number; predictions: number; costUsd: number; note: string }

/**
 * The featured job. Picks up to FEATURED_PER_DAY games, registers the ones that already have tickets
 * and generates the rest — outside every user's allowance, inside the AI budget. A rerun on the same
 * day writes nothing new. With AI off it records an error, never an "ok".
 */
/**
 * One run at a time. The cron's first tick after a deploy and a manual trigger used to land within a
 * minute of each other and both generate the same game on Opus — two bills, one slate. A run that
 * finds another in flight steps aside and says so.
 */
let inflight: Promise<FeaturedResult> | null = null;

export function runFeatured(opts: { now?: Date } = {}): Promise<FeaturedResult> {
  if (inflight) return inflight.then((r) => ({ ...r, status: "skipped", generated: 0, predictions: 0, costUsd: 0, note: "already running" }));
  inflight = runFeaturedOnce(opts).finally(() => { inflight = null; });
  return inflight;
}

async function runFeaturedOnce(opts: { now?: Date } = {}): Promise<FeaturedResult> {
  const now = opts.now ?? new Date();
  const db = getDb();
  const runId = newId("job");
  const cfg = featuredConfig(process.env, SPORTS.map((s) => s.key));
  const langs = refreshConfig(process.env, SPORTS.map((s) => s.key)).langs as Lang[];
  db.prepare("INSERT INTO job_runs (id,job,status,startedAt) VALUES (?,?,?,?)").run(runId, "featured", "running", nowIso());
  const finish = (r: Omit<FeaturedResult, "runId">): FeaturedResult => {
    db.prepare("UPDATE job_runs SET status=?, finishedAt=?, gamesProcessed=?, predictionsWritten=?, costUsd=?, note=? WHERE id=?")
      .run(r.status, nowIso(), r.generated, r.predictions, r.costUsd, r.note.slice(0, 500), runId);
    logEvent("job.featured", { runId, ...r });
    return { runId, ...r };
  };
  if (cfg.perDay === 0) return finish({ status: "skipped", picked: 0, generated: 0, predictions: 0, costUsd: 0, note: "FEATURED_PER_DAY=0" });
  // A request still "running" after half an hour belongs to a process that died mid-stream; left
  // alone it would block that game's generation for good.
  db.prepare("DELETE FROM generation_requests WHERE status='running' AND createdAt < ?").run(new Date(now.getTime() - 30 * 60_000).toISOString());

  const candidates: FeaturedCandidate[] = [];
  const today = todayKey();
  for (const sportKey of cfg.sports) {
    for (const day of [today, shiftKey(today, 1)]) {
      const games = await getSlate(day, false, sportKey).catch(() => []);
      for (const g of games) {
        if (g.status !== "scheduled") continue;
        candidates.push({ gameId: g.id, sportKey, startsAt: g.startsAt, teamIds: [g.home.id, g.away.id], hasLines: !!g.odds });
      }
    }
  }
  const picks = pickFeatured(candidates, followCounts(), cfg, now.getTime());
  const dayKey = dayKeyNow(now);
  const already = new Set(featuredToday(now).map((r) => r.gameId));
  let generated = 0, cost = 0, failures = 0;
  const notes: string[] = [];
  const register = (pick: FeaturedCandidate, rank: number, matchup: string) =>
    db.prepare("INSERT OR IGNORE INTO featured_games (dayKey,sportKey,gameId,rank,matchup,startsAt,createdAt) VALUES (?,?,?,?,?,?,?)")
      .run(dayKey, pick.sportKey, pick.gameId, rank, matchup, pick.startsAt, nowIso());

  for (const [rank, pick] of picks.entries()) {
    if (already.has(pick.gameId)) continue;
    const dateKey = espnDateKey(new Date(pick.startsAt));
    const existing = findPrediction({ scope: "game", sportKey: pick.sportKey, gameId: pick.gameId, dateKey, lang: langs[0] });
    const detail = await getGameDetail(pick.gameId, false, pick.sportKey).catch(() => null);
    const matchup = detail ? `${detail.game.away.displayName} @ ${detail.game.home.displayName}` : "";
    if (existing) { register(pick, rank, matchup); continue; }
    if (!aiConfigured()) { failures += 1; if (!notes.includes("ai_off")) notes.push("ai_off"); continue; }
    if (budgetState(now).exhausted) { notes.push("ai_budget"); break; }
    if (featuredGeneratedToday(now) >= cfg.perDay) { notes.push("daily featured cap"); break; }
    if (!detail) { failures += 1; notes.push(`${pick.gameId}: no detail`); continue; }
    // Someone may be generating this game right now (on demand, or the tick before this one).
    if (db.prepare("SELECT 1 FROM generation_requests WHERE gameId=? AND status='running' LIMIT 1").get(pick.gameId)) { notes.push(`${pick.gameId}: in flight`); continue; }

    const reqId = newId("gr");
    db.prepare("INSERT INTO generation_requests (id,userId,sportKey,gameId,dateKey,status,createdAt,scope) VALUES (?,?,?,?,?,?,?,?)")
      .run(reqId, SYSTEM_USER, pick.sportKey, pick.gameId, dateKey, "running", nowIso(), "featured");
    try {
      const out = await generateGame({ sportKey: pick.sportKey, dateKey, detail, langs });
      db.prepare("UPDATE generation_requests SET status='ok', costUsd=?, finishedAt=?, note=? WHERE id=?").run(out.costUsd, nowIso(), [...out.notes, ...out.info].join(" | ").slice(0, 500), reqId);
      register(pick, rank, matchup);
      generated += 1;
      cost += out.costUsd;
    } catch (error) {
      db.prepare("DELETE FROM generation_requests WHERE id=?").run(reqId);
      failures += 1;
      notes.push(`${pick.gameId}: ${reportError("job.featured", error, { gameId: pick.gameId }, "warn")}`);
      if (error instanceof AiBudgetExceededError) break;
    }
  }

  if (notes.includes("ai_off")) reportError("job.featured", new Error("ANTHROPIC_API_KEY missing — featured games not generated."));
  const status = failures > 0 && generated === 0 ? "error" : "ok";
  return finish({ status, picked: picks.length, generated, predictions: generated * langs.length, costUsd: cost, note: [`${picks.length} picked`, ...notes].join(" | ") });
}

