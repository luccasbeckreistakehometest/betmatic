import { getDb, newId, nowIso } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { brasiliaDay } from "@/lib/ledger/proof";
import { attributionRows } from "@/lib/ledger/attribution";
import { factorCalibration, type FactorStat } from "@/lib/ledger/factor-report";
import type { FactorInput } from "@/lib/ledger/factors";
import type { LedgerEntry } from "@/lib/types";

/**
 * `job=attribute`: rebuilds the blame index and the factor report from the ledger. Zero tokens, and
 * idempotent by construction — the ledger is the source of truth and both tables are derived, so
 * running it ten times in a row leaves exactly the state one run leaves.
 */

export const FACTOR_CODE_VERSION = "factors-1";

const dayOf = (entry: LedgerEntry) => brasiliaDay(entry.settledAt ?? entry.startsAt ?? entry.createdAt);

/** Every decided leg with everything that can slice it, including the CLV of that exact leg. */
export function factorInputs(entries: LedgerEntry[] = readLedger()): FactorInput[] {
  const rows = attributionRows(entries, dayOf);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const clv = new Map<string, number>();
  for (const row of getDb().prepare("SELECT ledgerId, legIndex, clvPct FROM leg_prices WHERE status='closed' AND clvPct IS NOT NULL").all() as { ledgerId: string; legIndex: number; clvPct: number }[]) {
    clv.set(`${row.ledgerId}|${row.legIndex}`, row.clvPct);
  }
  return rows.map((row) => {
    const entry = byId.get(row.ledgerId)!;
    const leg = entry.legs[row.legIndex];
    return {
      ...row,
      period: entry.period,
      ticketLegs: entry.legs.length,
      computed: leg?.computedProbability,
      projectedMinutes: leg?.projectedMinutes,
      blowoutProbability: leg?.blowoutProbability,
      clvPct: clv.get(`${row.ledgerId}|${row.legIndex}`) ?? null,
    } satisfies FactorInput;
  });
}

export interface AttributeResult { runId: string; legs: number; sole: number; factors: number; flagged: number }

export function runAttributeJob(entries: LedgerEntry[] = readLedger()): AttributeResult {
  const db = getDb();
  const rows = attributionRows(entries, dayOf);
  const stats = factorCalibration(factorInputs(entries));
  const runId = newId("fct");
  const at = nowIso();

  db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO leg_attribution (ledgerId, legIndex, gameId, sportKey, scope, alternative, marketKey, side, athleteId, outcome, sole, predicted, oddsDecimal, day)
       VALUES (@ledgerId,@legIndex,@gameId,@sportKey,@scope,@alternative,@marketKey,@side,@athleteId,@outcome,@sole,@predicted,@oddsDecimal,@day)
       ON CONFLICT(ledgerId, legIndex) DO UPDATE SET outcome=excluded.outcome, sole=excluded.sole, marketKey=excluded.marketKey,
         side=excluded.side, athleteId=excluded.athleteId, predicted=excluded.predicted, oddsDecimal=excluded.oddsDecimal, day=excluded.day`,
    );
    for (const row of rows) insert.run({ ...row, alternative: row.alternative ? 1 : 0, sole: row.sole ? 1 : 0 });

    const stat = db.prepare(
      `INSERT INTO factor_stats (runId, id, scope, dim, value, legs, won, games, days, hitRate, predicted, gap, ciLow, ciHigh, pValue, qValue, flagged, computedAt, codeVersion)
       VALUES (@runId,@id,@scope,@dim,@value,@legs,@won,@games,@days,@hitRate,@predicted,@gap,@ciLow,@ciHigh,@pValue,@qValue,@flagged,@computedAt,@codeVersion)`,
    );
    for (const s of stats) stat.run({ ...s, runId, flagged: s.flagged ? 1 : 0, computedAt: at, codeVersion: FACTOR_CODE_VERSION });
    // Only the last few rounds are kept: the table is an index, and the ledger can always rebuild it.
    db.prepare("DELETE FROM factor_stats WHERE runId NOT IN (SELECT runId FROM factor_stats GROUP BY runId ORDER BY MAX(computedAt) DESC LIMIT 5)").run();
  }).immediate();

  return { runId, legs: rows.length, sole: rows.filter((r) => r.sole).length, factors: stats.length, flagged: stats.filter((s) => s.flagged).length };
}

/** The newest round of factors, for the admin panel and for the prompt. */
export function latestFactorStats(limit = 200): FactorStat[] {
  const run = getDb().prepare("SELECT runId FROM factor_stats ORDER BY computedAt DESC LIMIT 1").get() as { runId: string } | undefined;
  if (!run) return [];
  const rows = getDb().prepare("SELECT * FROM factor_stats WHERE runId=? ORDER BY ABS(gap) DESC LIMIT ?").all(run.runId, limit) as (Omit<FactorStat, "flagged"> & { flagged: number })[];
  return rows.map((r): FactorStat => ({ ...r, flagged: !!r.flagged }));
}

/** How many decided legs carry no canonical market name — the bucket the admin has to see. */
export function unmappedLegs(): { legs: number; examples: string[] } {
  const rows = getDb().prepare("SELECT ledgerId, COUNT(*) AS n FROM leg_attribution WHERE marketKey='unmapped' GROUP BY ledgerId ORDER BY n DESC LIMIT 5").all() as { ledgerId: string; n: number }[];
  const total = (getDb().prepare("SELECT COUNT(*) AS n FROM leg_attribution WHERE marketKey='unmapped'").get() as { n: number }).n;
  return { legs: total, examples: rows.map((r) => r.ledgerId) };
}
