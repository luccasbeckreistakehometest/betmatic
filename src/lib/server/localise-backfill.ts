import { getDb, nowIso } from "@/lib/server/db";
import { savePrediction } from "@/lib/server/predictions";
import { localiseSlate } from "@/lib/bets/localise";
import { lastUsage } from "@/lib/ai/extract";
import { refreshConfig } from "@/lib/server/refresh-policy";
import { SPORTS } from "@/lib/sports";
import { aiConfigured } from "@/lib/ai/client";
import { budgetState } from "@/lib/server/ai-budget";
import { logEvent, reportError } from "@/lib/server/ops-log";
import type { BetSlate } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

export interface LocaliseBackfillResult { status: "ok" | "skipped" | "error"; missing: number; written: number; costUsd: number; note: string }

/**
 * Fills in the derived-language copies a generation left behind. The game read localises inline,
 * but that call can fail on its own (it hit its output cap on every game of 22/09/2026) and the
 * featured job never revisits a game it has already generated, so an English reader would see
 * nothing for the day. Runs every tick, does nothing when nothing is missing, and only looks at
 * games from the last day forward — a slate from last week is not worth a call.
 */
export async function runLocaliseBackfill(opts: {
  now?: Date;
  limit?: number;
  localise?: (slate: BetSlate, from: Lang, to: Lang) => Promise<BetSlate>;
} = {}): Promise<LocaliseBackfillResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 10;
  const localise = opts.localise ?? localiseSlate;
  const db = getDb();
  const [primary, ...derived] = refreshConfig(process.env, SPORTS.map((s) => s.key)).langs as Lang[];
  if (!derived.length) return { status: "skipped", missing: 0, written: 0, costUsd: 0, note: "one language" };
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const rows = db.prepare(
    `SELECT p.id, p.scope, p.sportKey, p.gameId, p.dateKey, p.matchup, p.startsAt, p.payload
     FROM predictions p
     WHERE p.lang = ? AND p.scope IN ('game', 'slate') AND COALESCE(p.startsAt, p.generatedAt) >= ?
     ORDER BY COALESCE(p.startsAt, p.generatedAt) ASC`,
  ).all(primary, since) as { id: string; scope: "game" | "slate"; sportKey: string; gameId: string | null; dateKey: string; matchup: string; startsAt: string | null; payload: string }[];
  const has = db.prepare("SELECT 1 FROM predictions WHERE scope=? AND sportKey=? AND COALESCE(gameId,'')=? AND dateKey=? AND lang=? LIMIT 1");
  const todo: { row: (typeof rows)[number]; lang: Lang }[] = [];
  for (const row of rows) for (const lang of derived) if (!has.get(row.scope, row.sportKey, row.gameId ?? "", row.dateKey, lang)) todo.push({ row, lang });
  if (!todo.length) return { status: "ok", missing: 0, written: 0, costUsd: 0, note: "" };
  if (!aiConfigured()) return { status: "skipped", missing: todo.length, written: 0, costUsd: 0, note: "ai_off" };

  let written = 0, cost = 0;
  const notes: string[] = [];
  for (const { row, lang } of todo.slice(0, limit)) {
    if (budgetState(now).exhausted) { notes.push("ai_budget"); break; }
    try {
      const slate = JSON.parse(row.payload) as BetSlate;
      const localised = await localise(slate, primary, lang);
      const costUsd = lastUsage?.costUsd ?? 0;
      savePrediction({ scope: row.scope, sportKey: row.sportKey, gameId: row.gameId, dateKey: row.dateKey, lang, matchup: row.matchup, startsAt: row.startsAt ?? undefined, slate: localised, costUsd });
      written += 1; cost += costUsd;
    } catch (error) {
      notes.push(`${row.gameId ?? row.scope}/${lang}: ${reportError("job.localise", error, { gameId: row.gameId ?? undefined }, "warn")}`);
    }
  }
  const result: LocaliseBackfillResult = { status: notes.length && !written ? "error" : "ok", missing: todo.length, written, costUsd: cost, note: [`${todo.length} missing`, ...notes].join(" | ").slice(0, 500) };
  logEvent("job.localise", { ...result, at: nowIso() });
  return result;
}
