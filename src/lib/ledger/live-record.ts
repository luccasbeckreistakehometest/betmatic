import { readLiveLedger } from "@/lib/ledger/store";
import { liveCalibration, type LiveCalibration } from "@/lib/ledger/live-calibration";
import type { LedgerEntry } from "@/lib/types";

/**
 * The live reads' own record. It answers one question — how often does a read taken in play land,
 * against the chance the read itself gave — and refuses the other one on purpose: the prices on a
 * live ticket are the pre-game board, so a return computed from them is a number nobody could have
 * collected. There used to be a `referenceReturn` here, printed with a name that said so; a
 * comment in the code does not survive a screenshot, and on 22/09/2026 that field read +369% on a
 * day whose reads landed 12.5 fewer times than they promised. The field is gone. What replaces it
 * is `calibration`: expected wins against observed wins, with the band.
 */
export interface LiveBandRecord {
  bandKey: string;
  tickets: number;
  won: number;
  hitRate: number;
  legs: number;
  legsWon: number;
  legHitRate: number;
}

export interface LiveRecord {
  decided: number;
  pending: number;
  won: number;
  hitRate: number;
  legs: number;
  legsWon: number;
  legHitRate: number;
  bands: LiveBandRecord[];
  /** The same count per quarter the read was taken in: the end of Q1, half-time and the end of Q3 are different bets. */
  periods: { period: number; tickets: number; won: number; hitRate: number; legs: number; legsWon: number; legHitRate: number }[];
  /** Average modelled chance of the decided tickets beside the share that landed: the calibration line. */
  modelledAverage: number;
  /** Promised against delivered, on the leg and on the ticket. The only published reading. */
  calibration: LiveCalibration;
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
    modelledAverage: decided.length ? decided.reduce((s, e) => s + e.modelledProbability, 0) / decided.length : 0,
    bands: bandKeys.map((bandKey) => ({ bandKey, ...stats(decided.filter((e) => e.bandKey === bandKey)) })),
    periods: [...new Set(decided.map((e) => e.period ?? 0))].sort((a, b) => a - b).map((period) => ({ period, ...stats(decided.filter((e) => (e.period ?? 0) === period)) })),
    calibration: liveCalibration(entries),
  };
}

export const liveRecord = (): LiveRecord => liveRecordFrom(readLiveLedger());
