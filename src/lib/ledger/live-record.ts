import { readLiveLedger } from "@/lib/ledger/store";
import type { LedgerEntry } from "@/lib/types";

/**
 * The live reads' own record. It answers one question — how often does a read taken in play land —
 * and refuses the other one on purpose: the prices on a live ticket are the pre-game board, so a
 * return computed from them would be a number nobody could have collected. `referenceReturn` is
 * printed with that name so the reader knows what it is.
 */
export interface LiveBandRecord {
  bandKey: string;
  tickets: number;
  won: number;
  hitRate: number;
  legs: number;
  legsWon: number;
  legHitRate: number;
  /** Sum of the winners' pre-game reference prices over the decided tickets. Not a return. */
  referenceReturn: number;
}

export interface LiveRecord {
  decided: number;
  pending: number;
  won: number;
  hitRate: number;
  legs: number;
  legsWon: number;
  legHitRate: number;
  referenceReturn: number;
  bands: LiveBandRecord[];
  /** Average modelled chance of the decided tickets beside the share that landed: the calibration line. */
  modelledAverage: number;
}

const decidedOutcome = (o: string) => o === "won" || o === "lost";

export function liveRecordFrom(entries: LedgerEntry[]): LiveRecord {
  const live = entries.filter((e) => e.scope === "live");
  const decided = live.filter((e) => decidedOutcome(e.outcome));
  const legsOf = (rows: LedgerEntry[]) => rows.flatMap((e) => e.legs.filter((l) => l.outcome === "won" || l.outcome === "lost"));
  const stats = (rows: LedgerEntry[]) => {
    const won = rows.filter((e) => e.outcome === "won");
    const legs = legsOf(rows);
    return {
      tickets: rows.length,
      won: won.length,
      hitRate: rows.length ? won.length / rows.length : 0,
      legs: legs.length,
      legsWon: legs.filter((l) => l.outcome === "won").length,
      legHitRate: legs.length ? legs.filter((l) => l.outcome === "won").length / legs.length : 0,
      referenceReturn: won.reduce((sum, e) => sum + e.combinedDecimal, 0),
    };
  };
  const all = stats(decided);
  const bandKeys = [...new Set(decided.map((e) => e.bandKey))];
  return {
    decided: decided.length,
    pending: live.filter((e) => e.outcome === "pending").length,
    won: all.won,
    hitRate: all.hitRate,
    legs: all.legs,
    legsWon: all.legsWon,
    legHitRate: all.legHitRate,
    referenceReturn: all.referenceReturn,
    modelledAverage: decided.length ? decided.reduce((s, e) => s + e.modelledProbability, 0) / decided.length : 0,
    bands: bandKeys.map((bandKey) => ({ bandKey, ...stats(decided.filter((e) => e.bandKey === bandKey)) })),
  };
}

export const liveRecord = (): LiveRecord => liveRecordFrom(readLiveLedger());
