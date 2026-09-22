import { getLiveSnapshot } from "@/lib/server/live-snapshot";
import { emptyTotals, type LiveTotals, type PlayerTotals } from "@/lib/props/stale";
import { normaliseName } from "@/lib/resolve/names";
import { getSport } from "@/lib/sports";
import type { LiveSnapshot } from "@/lib/live/snapshot";

/**
 * What a game in progress has already produced, per player, in the exact markets the product sells.
 * It reads the same ESPN summary the live panel polls (one shared 45-second cache: a game being
 * watched costs no extra request), maps every athlete's box-score line onto the sport's market keys
 * — including the combined ones, points+rebounds and friends — and keys them by athlete id, with
 * the normalised name as the fallback for sources that publish no id.
 *
 * A game that has not started has no box score and yields nothing. Nothing in here is allowed to
 * break generation: a failure is logged and the props go through untouched.
 */
export interface LiveBoxScore {
  state: LiveSnapshot["state"];
  totals: LiveTotals;
  /** Match minute (soccer) or minutes played (basketball), and what is left of regulation. */
  minute: number;
  minutesLeft: number;
  clock: string;
  period: number;
  fetchedAt: string;
}

/** Sums each market's gamelog labels over a live box-score line. Pure. */
export function totalsFromSnapshot(snap: LiveSnapshot, sportKey: string): LiveTotals {
  const markets = getSport(sportKey).markets.filter((m) => m.statLabels.length);
  const totals = emptyTotals();
  for (const player of snap.players) {
    const line: PlayerTotals = {};
    for (const market of markets) {
      // A market is only measurable when every stat it sums is published for this player: a missing
      // label must read as "no value", never as a zero that could settle a line.
      let sum = 0;
      let complete = true;
      for (const label of market.statLabels) {
        const value = player.stats[label];
        if (typeof value !== "number" || !Number.isFinite(value)) { complete = false; break; }
        sum += value;
      }
      if (complete) line[market.key] = sum;
    }
    if (!Object.keys(line).length) continue;
    if (player.id) totals.byId[player.id] = line;
    const name = normaliseName(player.name);
    if (name) totals.byName[name] = line;
  }
  return totals;
}

/**
 * The live box score for one game, or null when there is nothing to read (sport without a box
 * score, game not started, ESPN unreachable). Never throws.
 */
export async function getLiveBoxScore(sportKey: string, gameId: string): Promise<LiveBoxScore | null> {
  try {
    const snap = await getLiveSnapshot(sportKey, gameId);
    if (!snap || snap.state === "pre") return null;
    return {
      state: snap.state,
      totals: totalsFromSnapshot(snap, sportKey),
      minute: snap.minute,
      minutesLeft: Math.max(0, Math.round(snap.regulationMinutes - snap.minute)),
      clock: snap.clock,
      period: snap.period,
      fetchedAt: snap.fetchedAt,
    };
  } catch (error) {
    console.warn("[box-score] live read failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
