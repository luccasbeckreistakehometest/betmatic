import fs from "node:fs";
import path from "node:path";
import { marketKeyOf } from "@/lib/ledger/stat-key";
import { POLICY_VERSION } from "@/lib/bets/sizing";
import type { BetSuggestion, Game, LedgerEntry, SettledLeg } from "@/lib/types";

// Lives under DATA_DIR so it sits on the persistent volume in Docker: this file IS the learning
// history, and it used to be at ./.ledger, which every container rebuild wiped.
const LEDGER_DIR = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "ledger");
const FILE = path.join(LEDGER_DIR, "predictions.jsonl");
const LEGACY_FILE = path.join(process.cwd(), ".ledger", "predictions.jsonl");

function migrateLegacy(): void {
  try {
    if (!fs.existsSync(FILE) && fs.existsSync(LEGACY_FILE)) {
      fs.mkdirSync(LEDGER_DIR, { recursive: true });
      fs.copyFileSync(LEGACY_FILE, FILE);
    }
  } catch { /* a failed migration must not stop reads; the file simply starts empty */ }
}

/**
 * Append-only JSONL. Predictions are a historical record — rewriting them would let a later run
 * quietly launder a bad call, which would make the whole calibration exercise worthless.
 *
 * Live reads live in the same file and are part of the record: the owner's rule, after a night
 * where the half-time reads carried the bankroll, is that every ticket counts and the balance shows
 * them all. Only the readers that would be wrong with reference prices in them — calibration, the
 * closing-line comparison, the in-play tracker — ask for `excludeLive`.
 */
export function readLedger(opts: { excludeLive?: boolean } = {}): LedgerEntry[] {
  migrateLegacy();
  try {
    const all = fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LedgerEntry);
    return opts.excludeLive ? all.filter((e) => e.scope !== "live") : all;
  } catch {
    return [];
  }
}

/** The live reads only: graded like the rest, measured for hit rate, never for money. */
export function readLiveLedger(): LedgerEntry[] {
  return readLedger().filter((e) => e.scope === "live");
}

function writeAll(entries: LedgerEntry[]): void {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
  fs.writeFileSync(FILE, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

/**
 * The ledger id of a ticket: game + band + the exact leg text (the primary generation language).
 * A live read carries the minute it was taken at, because the same legs at minute 20 and at minute
 * 35 are two different bets on two different remainders of the game.
 */
export const ledgerIdFor = (gameId: string, s: Pick<BetSuggestion, "bandKey" | "legs">, live?: { minute: number }): string =>
  `${gameId}:${live ? `live${live.minute}:` : ""}${s.bandKey}:${s.legs.map((l) => l.selection).join("|")}`;

/**
 * `startsAt` overrides the game's kickoff (a cross-game ticket goes public when its last game starts).
 * `live` records the tickets of an in-play read under the live scope, at the minute they were built,
 * with the clock that was left when they were built: a read at 30 minutes with nothing on the clock
 * and a read at 30 minutes with five minutes left are not the same bet, and the ledger used to be
 * unable to tell them apart.
 */
export function recordPredictions(
  game: Game,
  suggestions: BetSuggestion[],
  opts: {
    startsAt?: string;
    live?: { minute: number; period?: number; clockLeft?: number };
    /** The game's own context at generation time — the same for every leg, copied onto each. */
    environment?: { blowoutProbability?: number | null; paceDelta?: number | null } | null;
    /**
     * What wrote this ticket. All optional, all filed at generation time: which prompt version, which
     * model, what asked for it, and which selection policy was live. Without these a before/after is
     * an argument; with them it is a query, and `ledger/ab.ts` is that query.
     */
    provenance?: { promptVersion?: string | null; modelId?: string | null; generatedBy?: string | null; policyVersion?: string | null };
  } = {},
): number {
  if (!suggestions.length) return 0;
  const existing = readLedger();
  const seen = new Set(existing.map((e) => e.id));
  const matchup = `${game.away.displayName} @ ${game.home.displayName}`;

  const fresh: LedgerEntry[] = [];
  const ledgerIdOf = new Map(suggestions.map((s) => [s.id, ledgerIdFor(game.id, s, opts.live)]));
  for (const s of suggestions) {
    // Same game + same ticket shape must not be logged twice across re-gathers.
    const id = ledgerIdOf.get(s.id)!;
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push({
      id,
      gameId: game.id,
      sportKey: game.sportKey,
      matchup,
      createdAt: new Date().toISOString(),
      startsAt: opts.startsAt ?? game.startsAt,
      bandKey: s.bandKey,
      kind: s.kind,
      title: s.title,
      combinedDecimal: s.combinedDecimal,
      modelledProbability: s.modelledProbability,
      evidenceScore: s.evidenceScore,
      suggestionId: s.id,
      // Recorded so a ticket's price can be rebuilt from its legs — which is what re-pricing a
      // ticket over its surviving legs, after one is voided, needs.
      correlationFactor: s.correlation?.factor,
      alternativeOf: s.alternativeFor ? ledgerIdOf.get(s.alternativeFor) : undefined,
      ...(opts.live
        ? {
            scope: "live" as const,
            minute: opts.live.minute,
            ...(opts.live.period !== undefined ? { period: opts.live.period } : {}),
            ...(opts.live.clockLeft !== undefined && Number.isFinite(opts.live.clockLeft) ? { clockLeft: opts.live.clockLeft } : {}),
          }
        : {}),
      ...(opts.provenance?.promptVersion ? { promptVersion: opts.provenance.promptVersion } : {}),
      ...(opts.provenance?.modelId ? { modelId: opts.provenance.modelId } : {}),
      ...(opts.provenance?.generatedBy ? { generatedBy: opts.provenance.generatedBy } : {}),
      policyVersion: opts.provenance?.policyVersion ?? POLICY_VERSION,
      outcome: "pending",
      legs: s.legs.map<SettledLeg>((l) => ({
        selection: l.selection,
        market: l.settlement?.type ?? l.market,
        sourceBasis: l.settlement?.sourceBasis ?? "unattributed",
        settlement: l.settlement,
        predictedProbability: l.fairProbability,
        computedProbability: l.computedProbability,
        rawProbability: l.rawProbability,
        oddsDecimal: l.oddsDecimal,
        outcome: "pending",
        actual: undefined,
        // Copied from the generation payload so the factor report can cut the ledger by something
        // other than the price. Every one is optional; an older row simply does not carry them.
        ...(l.athleteId ? { athleteId: l.athleteId } : {}),
        ...(marketKeyOf(l, game.sportKey) !== "unmapped" ? { marketKey: marketKeyOf(l, game.sportKey) } : {}),
        ...(l.measured?.rate !== undefined && Number.isFinite(l.measured.rate) ? { measuredRate: Number(l.measured.rate.toFixed(3)) } : {}),
        ...(l.projectedMinutes !== undefined ? { projectedMinutes: l.projectedMinutes } : {}),
        ...(l.modelNote ? { modelNote: l.modelNote.slice(0, 240) } : {}),
        ...(opts.environment?.blowoutProbability !== undefined && opts.environment?.blowoutProbability !== null ? { blowoutProbability: Number(opts.environment.blowoutProbability.toFixed(3)) } : {}),
        ...(opts.environment?.paceDelta !== undefined && opts.environment?.paceDelta !== null ? { paceDelta: Number(opts.environment.paceDelta.toFixed(2)) } : {}),
      })),
    });
  }

  if (!fresh.length) return 0;
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
  fs.appendFileSync(FILE, fresh.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return fresh.length;
}

export function updateEntries(updated: LedgerEntry[]): void {
  if (!updated.length) return;
  const byId = new Map(updated.map((e) => [e.id, e]));
  writeAll(readLedger().map((e) => byId.get(e.id) ?? e));
}

/** Everything still to grade, live reads included: they settle against the same box scores. */
export function pendingEntries(): LedgerEntry[] {
  return readLedger().filter((e) => e.outcome === "pending");
}
