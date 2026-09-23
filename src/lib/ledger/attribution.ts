import type { LedgerEntry, SettledLeg } from "@/lib/types";

/**
 * Which leg actually killed the ticket.
 *
 * Without it `summariseWindow` counts the six losing legs of an eight-leg parlay as six independent
 * mistakes, when the ticket died on one of them. On the production ledger **94 of the 131 lost
 * tickets died on exactly one leg** — so "the sole killer" is not a rare case, it is the normal one,
 * and it is the only honest unit of blame.
 *
 * Pure functions over the entry; the job below turns them into rows.
 */

const decided = (l: SettledLeg) => l.outcome === "won" || l.outcome === "lost";

/** Every leg that lost on a lost ticket. A push or a void never killed anything. */
export function killerLegs(entry: Pick<LedgerEntry, "outcome" | "legs">): number[] {
  if (entry.outcome !== "lost") return [];
  return entry.legs.map((l, i) => (l.outcome === "lost" ? i : -1)).filter((i) => i >= 0);
}

/** The index of the one leg that killed the ticket, or null when more than one did. */
export function soleKiller(entry: Pick<LedgerEntry, "outcome" | "legs">): number | null {
  const killers = killerLegs(entry);
  return killers.length === 1 ? killers[0] : null;
}

export interface AttributionRow {
  ledgerId: string;
  legIndex: number;
  gameId: string;
  sportKey: string;
  scope: "pre" | "live";
  alternative: boolean;
  bandKey: string;
  /** The canonical market key when the leg carries one; `unmapped` otherwise. */
  marketKey: string;
  side: string;
  athleteId: string;
  outcome: "won" | "lost";
  /** True when this leg is the only reason the ticket lost. */
  sole: boolean;
  predicted: number;
  oddsDecimal: number;
  day: string;
}

/**
 * One row per decided leg of a decided ticket. A pending ticket produces nothing, a push or void leg
 * produces nothing, and a leg of a won ticket produces a row with `sole: false` — a winner has no
 * killer, and pretending otherwise would bias every slice towards losses.
 */
export function attributionRows(entries: LedgerEntry[], dayOf: (entry: LedgerEntry) => string): AttributionRow[] {
  const out: AttributionRow[] = [];
  for (const entry of entries) {
    if (entry.outcome !== "won" && entry.outcome !== "lost") continue;
    const sole = soleKiller(entry);
    entry.legs.forEach((leg, legIndex) => {
      if (!decided(leg)) return;
      out.push({
        ledgerId: entry.id, legIndex, gameId: entry.gameId, sportKey: entry.sportKey,
        scope: entry.scope === "live" ? "live" : "pre",
        alternative: !!entry.alternativeOf,
        bandKey: entry.bandKey,
        marketKey: leg.marketKey ?? "unmapped",
        side: leg.settlement?.side ?? "",
        athleteId: leg.athleteId ?? "",
        outcome: leg.outcome === "won" ? "won" : "lost",
        sole: sole === legIndex,
        predicted: leg.predictedProbability,
        oddsDecimal: leg.oddsDecimal,
        day: dayOf(entry),
      });
    });
  }
  return out;
}
