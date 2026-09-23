import { createHash } from "node:crypto";
import { getDb, nowIso } from "@/lib/server/db";
import { brasiliaDay } from "@/lib/ledger/proof";
import { calibrationSnapshot } from "@/lib/ledger/calibration-input";
import { ledgerIdFor } from "@/lib/ledger/store";
import { marketKeyOf } from "@/lib/ledger/stat-key";
import { DEFAULT_CALIBRATION, ladderUnits, selectDaily, type Candidate, type DailySelection, type SelectedItem, type SelectionContext } from "@/lib/bets/selection";
import { SIZING, type StakeMode } from "@/lib/bets/sizing";
import type { BetSlate, BetSuggestion } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

/**
 * "Os bilhetes de hoje": the day's short list, assembled from inventory that already exists.
 *
 * There is no new generator here and nothing is thrown away. The candidates are the very tickets
 * the builder already wrote for every game of the day (`predictions`, the same rows /app reads);
 * this module picks at most three of them, sizes them in units and files the answer — including
 * every discarded candidate with the reason it was discarded, which is what lets the admin answer
 * "why is that one not on the list?" without opening the code.
 */

/** Bumped whenever a constant of the policy moves, so an A/B can tell two eras apart. */
export const POLICY_VERSION = "selecao-1";

const DAY_MS = 86_400_000;

interface PredictionRow { scope: string; gameId: string | null; sportKey: string; dateKey: string; startsAt: string | null; matchup: string; payload: string; generatedAt: string }

/** One served ticket of the day, with the slate row it came from — the join the API reads back. */
export interface InventoryEntry {
  candidate: Candidate;
  suggestion: BetSuggestion;
  dateKey: string;
  generatedAt: string;
  /** The book the leg prices came from, when the legs agree on one. */
  book: string | null;
}

/**
 * Everything generated for one Brasília day and sport. Pre-game rows carry the builder's own
 * tickets; `live` rows carry the latest quarter read of each game. Nothing is filtered here —
 * the cuts belong to `selectDaily`, and the plan's gate belongs to the API.
 */
export function dayInventory(day: string, sportKey: string, lang: Lang = "pt"): InventoryEntry[] {
  const from = new Date(Date.parse(`${day}T00:00:00-03:00`) - DAY_MS).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00-03:00`) + 2 * DAY_MS).toISOString();
  const rows = getDb().prepare(
    `SELECT scope, gameId, sportKey, dateKey, startsAt, matchup, payload, generatedAt FROM predictions
     WHERE scope IN ('game','live') AND sportKey = ? AND lang = ? AND startsAt IS NOT NULL AND startsAt BETWEEN ? AND ?`,
  ).all(sportKey, lang, from, to) as PredictionRow[];

  const out: InventoryEntry[] = [];
  for (const row of rows) {
    if (!row.gameId || brasiliaDay(row.startsAt ?? undefined) !== day) continue;
    let slate: BetSlate & { minute?: number; period?: number };
    try { slate = JSON.parse(row.payload) as BetSlate & { minute?: number; period?: number }; } catch { continue; }
    if (!Array.isArray(slate.suggestions)) continue;
    const live = row.scope === "live" ? { minute: slate.minute ?? 0, period: slate.period } : undefined;
    const ledgerIdOf = new Map(slate.suggestions.map((s) => [s.id, ledgerIdFor(row.gameId!, s, live)]));
    for (const s of slate.suggestions) {
      const books = [...new Set(s.legs.map((l) => l.book ?? "").filter(Boolean))];
      out.push({
        suggestion: s,
        dateKey: row.dateKey,
        generatedAt: row.generatedAt,
        book: books.length === 1 ? books[0] : null,
        candidate: candidateOf(s, {
          ledgerId: ledgerIdOf.get(s.id)!,
          alternativeOf: s.alternativeFor ? ledgerIdOf.get(s.alternativeFor) : undefined,
          gameId: row.gameId!,
          sportKey,
          matchup: row.matchup,
          startsAt: row.startsAt!,
          scope: live ? "live" : "pre",
          period: live?.period,
        }),
      });
    }
  }
  return out;
}

/** Candidates for one Brasília day and sport — what the policy reads. */
export function candidatesFor(day: string, sportKey: string, lang: Lang = "pt"): Candidate[] {
  return dayInventory(day, sportKey, lang).map((e) => e.candidate);
}

/** A served ticket as the policy sees it: price, chance, legs, who it touches, what market it is. */
export function candidateOf(
  s: BetSuggestion,
  meta: { ledgerId: string; alternativeOf?: string; gameId: string; sportKey: string; matchup: string; startsAt: string; scope: "pre" | "live"; period?: number },
): Candidate {
  const players = [...new Set(s.legs.map((l) => l.settlement?.player ?? "").filter(Boolean))];
  const markets = [...new Set(s.legs.map((l) => marketKeyOf(l, meta.sportKey)))];
  return {
    ledgerId: meta.ledgerId,
    suggestionId: s.id,
    gameId: meta.gameId,
    sportKey: meta.sportKey,
    scope: meta.scope,
    bandKey: s.bandKey,
    decimal: s.combinedDecimal,
    modelProbability: s.modelledProbability,
    legs: s.legs.length,
    players,
    markets,
    evidenceScore: s.evidenceScore ?? 0,
    confidence: s.confidence,
    startsAt: meta.startsAt,
    ...(meta.period !== undefined ? { period: meta.period } : {}),
    ...(meta.alternativeOf ? { alternativeOf: meta.alternativeOf } : {}),
    title: s.title,
    matchup: meta.matchup,
  };
}

/**
 * The calibration the policy sizes with — measured on the ledger, never a constant in a file.
 *
 * The day being selected is excluded from its own calibration, so the policy is never graded on
 * its own answers. With the ledger as it stands the pre-game slice measures σ_p ≈ 0.12 against a
 * gate of 0.08, so the regime is `medicao`: the floor, 1 u a day, 3 u a week, and the reason
 * written on the screen. The first slice whose measurement closes opens for real stakes by itself.
 */
export function selectionCalibration(day?: string): SelectionContext["calibration"] {
  try {
    const snap = calibrationSnapshot({ excludeDay: day });
    return {
      factorPre: snap.pre.settled ? snap.pre.factor : DEFAULT_CALIBRATION.factorPre,
      factorLive: snap.live.settled ? snap.live.factor : DEFAULT_CALIBRATION.factorLive,
      sigmaPPre: snap.pre.settled ? snap.pre.sigmaP : DEFAULT_CALIBRATION.sigmaPPre,
      sigmaPLive: snap.live.settled ? snap.live.sigmaP : DEFAULT_CALIBRATION.sigmaPLive,
      mode: snap.pre.mode,
    };
  } catch {
    // A ledger that cannot be read must not silently open the wallet.
    return { ...DEFAULT_CALIBRATION, mode: "medicao" };
  }
}

export interface DailyListResult {
  day: string;
  sportKey: string;
  selection: DailySelection;
  candidates: number;
  /** False when the stored row already held exactly this answer. */
  written: boolean;
}

/** Builds the day's list without touching the database — what a read path uses when no row exists. */
export function buildDailyList(day: string, sportKey: string, opts: { now?: number; lang?: Lang } = {}): { selection: DailySelection; candidates: Candidate[] } {
  const now = opts.now ?? Date.now();
  const candidates = candidatesFor(day, sportKey, opts.lang ?? "pt");
  const selection = selectDaily(candidates, { day, sportKey, now, calibration: selectionCalibration(day), medicaoWeekUsed: medicaoWeekUsed(day, sportKey) });
  return { selection, candidates };
}

/** Units the measurement regime has already risked in the seven days before `day`. */
export function medicaoWeekUsed(day: string, sportKey: string): number {
  const since = new Date(Date.parse(`${day}T00:00:00-03:00`) - 7 * DAY_MS).toISOString().slice(0, 10);
  const row = getDb().prepare(
    `SELECT COALESCE(SUM(i.units),0) AS u FROM daily_selection_items i
     JOIN daily_selection s ON s.day = i.day AND s.sportKey = i.sportKey
     WHERE i.sportKey = ? AND i.day >= ? AND i.day < ? AND i.scope = 'pre' AND s.mode = 'medicao'`,
  ).get(sportKey, since, day) as { u: number };
  return row?.u ?? 0;
}

const hashOf = (sel: DailySelection) =>
  createHash("sha1").update(JSON.stringify({
    mode: sel.mode,
    items: [...sel.items, ...sel.live].map((i) => [i.candidate.ledgerId, i.units, i.candidate.decimal, i.rank]),
  })).digest("hex").slice(0, 16);

/** Builds the day's list and files it. Idempotent: an unchanged answer is not rewritten. */
export function runDailyList(opts: { day?: string; sportKey: string; now?: number; lang?: Lang } = { sportKey: "wnba" }): DailyListResult {
  const now = opts.now ?? Date.now();
  const day = opts.day ?? brasiliaDay(new Date(now).toISOString());
  const { selection, candidates } = buildDailyList(day, opts.sportKey, { now, lang: opts.lang });
  const hash = hashOf(selection);
  const db = getDb();

  const existing = db.prepare("SELECT hash FROM daily_selection WHERE day=? AND sportKey=?").get(day, opts.sportKey) as { hash: string } | undefined;
  if (existing?.hash === hash) return { day, sportKey: opts.sportKey, selection, candidates: candidates.length, written: false };

  db.transaction(() => {
    db.prepare(
      `INSERT INTO daily_selection (day, sportKey, mode, policyVersion, calibration, totals, skipped, note, hash, candidates, createdAt, updatedAt)
       VALUES (@day,@sportKey,@mode,@policyVersion,@calibration,@totals,@skipped,@note,@hash,@candidates,@now,@now)
       ON CONFLICT(day, sportKey) DO UPDATE SET mode=excluded.mode, policyVersion=excluded.policyVersion, calibration=excluded.calibration,
         totals=excluded.totals, skipped=excluded.skipped, note=excluded.note, hash=excluded.hash, candidates=excluded.candidates, updatedAt=excluded.updatedAt`,
    ).run({
      day, sportKey: opts.sportKey, mode: selection.mode, policyVersion: POLICY_VERSION,
      calibration: JSON.stringify(selectionCalibration(day)),
      totals: JSON.stringify(selection.totals), skipped: JSON.stringify(selection.skipped.slice(0, 400)),
      note: selection.note, hash, candidates: candidates.length, now: nowIso(),
    });
    db.prepare("DELETE FROM daily_selection_items WHERE day=? AND sportKey=?").run(day, opts.sportKey);
    const insert = db.prepare(
      `INSERT INTO daily_selection_items (day, sportKey, ledgerId, rank, scope, gameId, suggestionId, bandKey, title, matchup, startsAt,
         oddsDecimal, modelProbability, calibratedProbability, grossEdge, shrunkEdge, units, minDecimal, capped, stakePolicy, ladderUnits, expiresAt, payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const item of [...selection.items, ...selection.live]) {
      const c = item.candidate;
      insert.run(day, opts.sportKey, c.ledgerId, item.rank, c.scope, c.gameId, c.suggestionId, c.bandKey, c.title ?? "", c.matchup ?? "", c.startsAt,
        c.decimal, c.modelProbability, item.calibratedProbability, item.grossEdge, item.shrunkEdge, item.units, item.minAcceptableDecimal,
        item.capped, "formula", ladderUnits(c.decimal), item.expiresAt ?? null, JSON.stringify({ k: item.k, score: item.score, legs: c.legs, players: c.players, markets: c.markets, evidenceScore: c.evidenceScore, confidence: c.confidence }));
    }
  }).immediate();

  return { day, sportKey: opts.sportKey, selection, candidates: candidates.length, written: true };
}

export interface StoredSelectionRow {
  day: string; sportKey: string; mode: StakeMode; note: string; candidates: number; updatedAt: string;
  totals: DailySelection["totals"]; skipped: DailySelection["skipped"];
}

export function readDailySelection(day: string, sportKey: string): StoredSelectionRow | null {
  const row = getDb().prepare("SELECT * FROM daily_selection WHERE day=? AND sportKey=?").get(day, sportKey) as
    { day: string; sportKey: string; mode: StakeMode; note: string; candidates: number; updatedAt: string; totals: string; skipped: string } | undefined;
  if (!row) return null;
  const parse = <T>(text: string, fallback: T): T => { try { return JSON.parse(text) as T; } catch { return fallback; } };
  return {
    day: row.day, sportKey: row.sportKey, mode: row.mode, note: row.note, candidates: row.candidates, updatedAt: row.updatedAt,
    totals: parse(row.totals, { units: 0, pctOfBankroll: 0, games: 0 }),
    skipped: parse(row.skipped, [] as DailySelection["skipped"]),
  };
}

export interface StoredItemRow {
  ledgerId: string; rank: number; scope: "pre" | "live"; gameId: string; suggestionId: string; bandKey: string; title: string; matchup: string;
  startsAt: string | null; oddsDecimal: number; modelProbability: number; calibratedProbability: number; grossEdge: number; shrunkEdge: number;
  units: number; minDecimal: number | null; capped: SelectedItem["capped"]; stakePolicy: string; ladderUnits: number; expiresAt: string | null; payload: string;
}

export function readDailyItems(day: string, sportKey: string): StoredItemRow[] {
  return getDb().prepare("SELECT * FROM daily_selection_items WHERE day=? AND sportKey=? ORDER BY scope DESC, rank ASC").all(day, sportKey) as StoredItemRow[];
}

/** Every sport that has inventory for the day — what the `today` job walks. */
export function sportsWithInventory(day: string, lang: Lang = "pt"): string[] {
  const from = new Date(Date.parse(`${day}T00:00:00-03:00`) - DAY_MS).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00-03:00`) + 2 * DAY_MS).toISOString();
  return (getDb().prepare(
    "SELECT DISTINCT sportKey FROM predictions WHERE scope IN ('game','live') AND lang = ? AND startsAt BETWEEN ? AND ?",
  ).all(lang, from, to) as { sportKey: string }[]).map((r) => r.sportKey);
}

/** The job: one pass over every sport with inventory today. Zero tokens, safe on every tick. */
export function runTodayJob(opts: { now?: number; lang?: Lang } = {}): { day: string; sports: number; written: number; items: number } {
  const now = opts.now ?? Date.now();
  const day = brasiliaDay(new Date(now).toISOString());
  const sports = sportsWithInventory(day, opts.lang ?? "pt");
  let written = 0, items = 0;
  for (const sportKey of sports) {
    const result = runDailyList({ day, sportKey, now, lang: opts.lang });
    if (result.written) written += 1;
    items += result.selection.items.length + result.selection.live.length;
  }
  return { day, sports: sports.length, written, items };
}

export { SIZING };
