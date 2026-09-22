import { readLedger } from "@/lib/ledger/store";
import { clvPromptLine } from "@/lib/server/leg-prices";
import { getSport } from "@/lib/sports";
import type { CalibrationReport, CalibrationRow, LedgerEntry, SettledLeg } from "@/lib/types";

interface Bucket {
  label: string;
  settled: number;
  won: number;
  predictedSum: number;
}

function summarise(buckets: Map<string, Bucket>, minSample: number): CalibrationRow[] {
  return [...buckets.entries()]
    .map(([key, b]) => {
      const hitRate = b.settled > 0 ? b.won / b.settled : NaN;
      const averagePredicted = b.settled > 0 ? b.predictedSum / b.settled : NaN;
      return {
        key,
        label: b.label,
        settled: b.settled,
        won: b.won,
        hitRate,
        averagePredicted,
        // Positive means the model claimed more confidence than the results justified.
        calibrationError: averagePredicted - hitRate,
      };
    })
    .filter((row) => row.settled >= minSample)
    .sort((a, b) => b.settled - a.settled);
}

function addLeg(buckets: Map<string, Bucket>, key: string, label: string, leg: SettledLeg) {
  if (leg.outcome !== "won" && leg.outcome !== "lost") return;
  const bucket = buckets.get(key) ?? { label, settled: 0, won: 0, predictedSum: 0 };
  bucket.settled += 1;
  if (leg.outcome === "won") bucket.won += 1;
  bucket.predictedSum += leg.predictedProbability;
  buckets.set(key, bucket);
}

/**
 * The deterministic model (props/model.ts) against the language model, on the legs where both spoke.
 * Both numbers are recorded at generation time, so this is a fair race: the same legs, the same
 * settlement. Brier is the mean squared error of the probability against the 0/1 outcome — lower
 * is better, 0.25 is a coin flip that says 50%.
 */
export interface ModelRace {
  settled: number;
  won: number;
  averageComputed: number;
  averagePredicted: number;
  brierComputed: number;
  brierPredicted: number;
}

export function modelRace(entries: LedgerEntry[] = readLedger()): ModelRace {
  let settled = 0, won = 0, computedSum = 0, predictedSum = 0, brierC = 0, brierP = 0;
  for (const entry of entries) {
    if (entry.outcome === "pending") continue;
    for (const leg of entry.legs) {
      if ((leg.outcome !== "won" && leg.outcome !== "lost") || leg.computedProbability === undefined || !Number.isFinite(leg.computedProbability)) continue;
      const y = leg.outcome === "won" ? 1 : 0;
      settled += 1;
      won += y;
      computedSum += leg.computedProbability;
      predictedSum += leg.predictedProbability;
      brierC += (leg.computedProbability - y) ** 2;
      brierP += (leg.predictedProbability - y) ** 2;
    }
  }
  return {
    settled, won,
    averageComputed: settled ? computedSum / settled : NaN,
    averagePredicted: settled ? predictedSum / settled : NaN,
    brierComputed: settled ? brierC / settled : NaN,
    brierPredicted: settled ? brierP / settled : NaN,
  };
}

/** The race as one prompt line; silent until there is a sample worth reading. */
export function modelRaceLine(race: ModelRace = modelRace()): string {
  if (race.settled < 10) return "";
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const lead = race.brierComputed < race.brierPredicted - 0.005 ? "the computed number has been the better guide — stay inside its band"
    : race.brierPredicted < race.brierComputed - 0.005 ? "your own estimates have been the better guide, but only where you named a reason the numbers could not see"
    : "the two have been equally good";
  return `COMPUTED MODEL vs YOUR ESTIMATES (${race.settled} settled legs, ${pct(race.won / race.settled)} won): computed averaged ${pct(race.averageComputed)} (Brier ${race.brierComputed.toFixed(3)}), you averaged ${pct(race.averagePredicted)} (Brier ${race.brierPredicted.toFixed(3)}) — ${lead}.`;
}

/**
 * Grades the model against its own past calls. Legs are the unit, not tickets — a parlay losing
 * tells you little, but the individual legs inside it are clean evidence about each source.
 */
export function calibrate(minSample = 5): CalibrationReport {
  const entries = readLedger().filter((e) => e.outcome !== "pending");
  const bySource = new Map<string, Bucket>();
  const byMarket = new Map<string, Bucket>();
  const bySport = new Map<string, Bucket>();

  for (const entry of entries) {
    for (const leg of entry.legs) {
      addLeg(bySource, leg.sourceBasis, leg.sourceBasis, leg);
      addLeg(byMarket, leg.market, leg.market, leg);
      addLeg(bySport, entry.sportKey, getSport(entry.sportKey).label.en, leg);
    }
  }

  const settledLegs = entries.reduce(
    (acc, e) => acc + e.legs.filter((l) => l.outcome === "won" || l.outcome === "lost").length,
    0,
  );

  return {
    totalSettled: settledLegs,
    bySource: summarise(bySource, minSample),
    byMarket: summarise(byMarket, minSample),
    bySport: summarise(bySport, minSample),
    generatedAt: new Date().toISOString(),
  };
}

/** Cross-tab of source × market: this is the "where does each source specialise" answer. */
export function specialisation(minSample = 4): CalibrationRow[] {
  const buckets = new Map<string, Bucket>();
  for (const entry of readLedger().filter((e) => e.outcome !== "pending")) {
    for (const leg of entry.legs) {
      addLeg(buckets, `${leg.sourceBasis} · ${leg.market}`, `${leg.sourceBasis} on ${leg.market}`, leg);
    }
  }
  return summarise(buckets, minSample).sort((a, b) => b.hitRate - a.hitRate);
}

/**
 * The track record as prompt text. Only slices with a real sample are included — feeding back a
 * 2-game "trend" would teach the model to trust noise.
 */
/** One line of closing line value per market; the prompt never fails because of it. */
function safeClvLine(): string {
  try { return clvPromptLine(); } catch { return ""; }
}

export function calibrationPrompt(): string {
  const report = calibrate();
  if (report.totalSettled < 10) {
    return `TRACK RECORD: only ${report.totalSettled} legs settled so far — not enough to calibrate against. Do not claim any source has a proven edge.`;
  }

  const fmt = (rows: CalibrationRow[]) =>
    rows
      .slice(0, 8)
      .map(
        (r) =>
          `- ${r.label}: ${r.won}/${r.settled} (${(r.hitRate * 100).toFixed(0)}%), predicted avg ${(r.averagePredicted * 100).toFixed(0)}% → ${
            r.calibrationError > 0.05
              ? `OVERCONFIDENT by ${(r.calibrationError * 100).toFixed(0)}pts`
              : r.calibrationError < -0.05
                ? `underconfident by ${(-r.calibrationError * 100).toFixed(0)}pts`
                : "well calibrated"
          }`,
      )
      .join("\n");

  const spec = specialisation();
  return [
    `TRACK RECORD — ${report.totalSettled} settled legs from past predictions. Use this to weight your confidence.`,
    "",
    `By evidence source:\n${fmt(report.bySource) || "- no slice has a large enough sample yet"}`,
    "",
    `By market type:\n${fmt(report.byMarket) || "- no slice has a large enough sample yet"}`,
    spec.length
      ? `\nStrongest source/market combinations measured so far:\n${spec
          .slice(0, 6)
          .map((r) => `- ${r.label}: ${r.won}/${r.settled} (${(r.hitRate * 100).toFixed(0)}%)`)
          .join("\n")}`
      : "",
    "",
    safeClvLine(),
    modelRaceLine(),
    "Apply this honestly: where a source is measured OVERCONFIDENT, lower your fairProbability for legs leaning on it. Where a slice has no sample, say so instead of assuming it is good.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function ledgerSummary(): { total: number; pending: number; settled: number; won: number } {
  const entries: LedgerEntry[] = readLedger();
  return {
    total: entries.length,
    pending: entries.filter((e) => e.outcome === "pending").length,
    settled: entries.filter((e) => e.outcome !== "pending").length,
    won: entries.filter((e) => e.outcome === "won").length,
  };
}
