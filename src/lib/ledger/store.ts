import fs from "node:fs";
import path from "node:path";
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
 */
export function readLedger(): LedgerEntry[] {
  migrateLegacy();
  try {
    return fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LedgerEntry);
  } catch {
    return [];
  }
}

function writeAll(entries: LedgerEntry[]): void {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
  fs.writeFileSync(FILE, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

/** The ledger id of a ticket: game + band + the exact leg text (the primary generation language). */
export const ledgerIdFor = (gameId: string, s: Pick<BetSuggestion, "bandKey" | "legs">): string =>
  `${gameId}:${s.bandKey}:${s.legs.map((l) => l.selection).join("|")}`;

/** `startsAt` overrides the game's kickoff (a cross-game ticket goes public when its last game starts). */
export function recordPredictions(game: Game, suggestions: BetSuggestion[], opts: { startsAt?: string } = {}): number {
  if (!suggestions.length) return 0;
  const existing = readLedger();
  const seen = new Set(existing.map((e) => e.id));
  const matchup = `${game.away.displayName} @ ${game.home.displayName}`;

  const fresh: LedgerEntry[] = [];
  const ledgerIdOf = new Map(suggestions.map((s) => [s.id, ledgerIdFor(game.id, s)]));
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
      alternativeOf: s.alternativeFor ? ledgerIdOf.get(s.alternativeFor) : undefined,
      outcome: "pending",
      legs: s.legs.map<SettledLeg>((l) => ({
        selection: l.selection,
        market: l.settlement?.type ?? l.market,
        sourceBasis: l.settlement?.sourceBasis ?? "unattributed",
        settlement: l.settlement,
        predictedProbability: l.fairProbability,
        computedProbability: l.computedProbability,
        oddsDecimal: l.oddsDecimal,
        outcome: "pending",
        actual: undefined,
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

export function pendingEntries(): LedgerEntry[] {
  return readLedger().filter((e) => e.outcome === "pending");
}
