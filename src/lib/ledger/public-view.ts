import { scrubText } from "@/lib/server/whitelabel";
import type { LedgerEntry, SettledLeg } from "@/lib/types";

export type PublicLeg = Omit<SettledLeg, "sourceBasis" | "settlement">;
export type PublicEntry = Omit<LedgerEntry, "legs"> & { legs: PublicLeg[] };

/**
 * A ledger entry as anyone but the operator may see it: no source basis, no settlement descriptor,
 * and every free-text field scrubbed of source and sportsbook names.
 */
export function publicEntry(entry: LedgerEntry, lang: "pt" | "en"): PublicEntry {
  return {
    ...entry,
    matchup: scrubText(entry.matchup, lang),
    title: scrubText(entry.title, lang),
    legs: entry.legs.map((leg) => ({
      selection: scrubText(leg.selection, lang),
      market: leg.market,
      predictedProbability: leg.predictedProbability,
      oddsDecimal: leg.oddsDecimal,
      outcome: leg.outcome,
      actual: leg.actual ? scrubText(leg.actual, lang) : undefined,
    })),
  };
}
