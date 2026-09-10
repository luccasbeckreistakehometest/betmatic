import fs from "node:fs";
import path from "node:path";
import type { BetSuggestion, Game, LedgerEntry, SettledLeg } from "@/lib/types";

const LEDGER_DIR = path.join(process.cwd(), ".ledger");
const FILE = path.join(LEDGER_DIR, "predictions.jsonl");

/**
 * Append-only JSONL. Predictions are a historical record — rewriting them would let a later run
 * quietly launder a bad call, which would make the whole calibration exercise worthless.
 */
export function readLedger(): LedgerEntry[] {
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

export function recordPredictions(game: Game, suggestions: BetSuggestion[]): number {
  if (!suggestions.length) return 0;
  const existing = readLedger();
  const seen = new Set(existing.map((e) => e.id));
  const matchup = `${game.away.displayName} @ ${game.home.displayName}`;

  const fresh: LedgerEntry[] = [];
  for (const s of suggestions) {
    // Same game + same ticket shape must not be logged twice across re-gathers.
    const id = `${game.id}:${s.bandKey}:${s.legs.map((l) => l.selection).join("|")}`;
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push({
      id,
      gameId: game.id,
      sportKey: game.sportKey,
      matchup,
      createdAt: new Date().toISOString(),
      bandKey: s.bandKey,
      kind: s.kind,
      title: s.title,
      combinedDecimal: s.combinedDecimal,
      modelledProbability: s.modelledProbability,
      outcome: "pending",
      legs: s.legs.map<SettledLeg>((l) => ({
        selection: l.selection,
        market: l.settlement?.type ?? l.market,
        sourceBasis: l.settlement?.sourceBasis ?? "unattributed",
        settlement: l.settlement,
        predictedProbability: l.fairProbability,
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
