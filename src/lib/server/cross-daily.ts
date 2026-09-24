import { findPrediction } from "@/lib/server/predictions";
import { generateSlate, SYSTEM_SLATE_USER } from "@/lib/server/slate-build";
import { crossDailyEnabled, dailyCrossVerdict, type DailyCrossVerdict } from "@/lib/bets/cross-policy";
import { slateCaps } from "@/lib/server/on-demand-policy";
import { refreshConfig } from "@/lib/server/refresh-policy";
import { aiConfigured } from "@/lib/ai/client";
import { AiBudgetExceededError, budgetState } from "@/lib/server/ai-budget";
import { getSlateOrNearest, todayKey } from "@/lib/sources/espn";
import { SOLD_SPORTS } from "@/lib/sports";
import { logEvent, reportError } from "@/lib/server/ops-log";
import type { Lang } from "@/lib/i18n";

/**
 * "As múltiplas do dia entre jogos", built by the scheduler for every sport with a grid.
 *
 * The section used to exist only if a reader pressed a button, and what the button asked for was
 * the long bands — so on 23/09/2026, a two-game night, it returned nothing at all and said so. Both
 * halves of that are fixed: the shape is now the short window of bets/cross-policy.ts, and the build
 * happens on its own, every day, for every sport with CROSS_MIN_GAMES upcoming games or more. The
 * reader's own button still works on top of this (server/on-demand.ts); it is no longer the only way
 * the section fills.
 *
 * What bounds the bill, in the order it bites:
 *   · `onceADay` at the cron route — the whole job runs once per Brasília day, from job_runs, never
 *     from a tick counter held in the scheduler's shell (see server/job-guard.ts for that story).
 *   · one stored slate per sport per day — a rerun of the day finds it and files nothing.
 *   · AI_DAILY_BUDGET_USD — read before every sport, so a long grid stops when the day's money does.
 *   · CROSS_DAILY=0 — off, without a deploy.
 *
 * A sport whose grid cannot hold a combination across games is not a failure and never reaches the
 * model: it is reported as `too_few_games`, which is what the screen tells the reader too.
 */

export interface CrossDailySport {
  sportKey: string;
  verdict: DailyCrossVerdict;
  dateKey: string | null;
  games: number;
  tickets: number;
  costUsd: number;
}

export interface CrossDailyResult {
  status: "ok" | "skipped" | "error";
  generated: number;
  tickets: number;
  costUsd: number;
  sports: CrossDailySport[];
  note: string;
}

export async function runCrossDaily(opts: {
  now?: Date;
  env?: Record<string, string | undefined>;
  sports?: string[];
  /** The day guard normally lives at the cron route (`onceADay`); a direct caller can say so here. */
  ranToday?: boolean;
} = {}): Promise<CrossDailyResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const enabled = crossDailyEnabled(env);
  const cfg = refreshConfig(env, SOLD_SPORTS.map((s) => s.key));
  const langs = cfg.langs as Lang[];
  const primary = langs[0];
  const caps = slateCaps(env);
  const wanted = opts.sports?.length ? opts.sports : cfg.sports;
  const sports = SOLD_SPORTS.filter((s) => wanted.includes(s.key));

  const rows: CrossDailySport[] = [];
  const notes: string[] = [];
  let generated = 0, tickets = 0, costUsd = 0, failures = 0;

  for (const sport of sports) {
    const slate = enabled ? await getSlateOrNearest(todayKey(), false, sport.key).catch(() => null) : null;
    // Only games still to start: a múltipla whose first leg already tipped off is not placeable.
    const upcoming = (slate?.games ?? [])
      .filter((g) => g.status === "scheduled" && Date.parse(g.startsAt) > now.getTime())
      .slice(0, caps.maxGames);
    const dateKey = slate?.dateKey ?? null;
    const verdict = dailyCrossVerdict({
      enabled,
      exists: !!dateKey && !!findPrediction({ scope: "slate", sportKey: sport.key, gameId: null, dateKey, lang: primary }),
      ranToday: opts.ranToday ?? false,
      upcomingGames: upcoming.length,
      aiConfigured: aiConfigured(),
      budgetExhausted: budgetState(now).exhausted,
    });
    const row: CrossDailySport = { sportKey: sport.key, verdict, dateKey, games: upcoming.length, tickets: 0, costUsd: 0 };
    if (verdict !== "generate" || !dateKey) {
      rows.push(row);
      if (verdict === "switched_off") break;
      if (verdict === "ai_budget") { notes.push("ai_budget"); break; }
      continue;
    }
    try {
      const out = await generateSlate({
        sportKey: sport.key, dateKey, games: upcoming, langs,
        userId: SYSTEM_SLATE_USER, key: `slate:${sport.key}`, crossShape: true,
      });
      row.tickets = out.tickets;
      row.costUsd = out.costUsd;
      if (out.status === "too_few_games") row.verdict = "too_few_games";
      else { generated += 1; tickets += out.tickets; }
      costUsd += out.costUsd;
      // Zero tickets is an answer, not a fault: the grid had no combination inside the window and
      // the stored note says so on the page. It is logged so the operator can see how often it happens.
      notes.push(`${sport.key}: ${out.tickets} ${out.note}`);
    } catch (error) {
      failures += 1;
      notes.push(`${sport.key}: ${reportError("job.cross", error, { sportKey: sport.key }, "warn")}`);
      if (error instanceof AiBudgetExceededError) { notes.push("ai_budget"); rows.push(row); break; }
    }
    rows.push(row);
  }

  const status: CrossDailyResult["status"] = !enabled ? "skipped" : failures > 0 && generated === 0 ? "error" : "ok";
  const result: CrossDailyResult = {
    status, generated, tickets, costUsd: Number(costUsd.toFixed(4)), sports: rows,
    note: (enabled ? notes : ["CROSS_DAILY=0"]).join(" | ").slice(0, 500),
  };
  logEvent("job.cross", { ...result, sports: rows.length });
  return result;
}
