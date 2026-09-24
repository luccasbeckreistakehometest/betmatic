import { getDb, nowIso } from "@/lib/server/db";
import { boundaryOf, quartersBySubtraction, type SnapshotLine, type StoredSnapshot, type SubtractedProfile } from "@/lib/live/quarters";
import { reportError } from "@/lib/server/ops-log";
import type { LiveSnapshot } from "@/lib/live/snapshot";

/**
 * The snapshot of every live read, kept so a quarter can be had by subtraction.
 *
 * Nothing here fetches and nothing here is on the critical path of a read: a failure is logged and
 * the read goes on without it, because the narration is the primary route and this is the check.
 */

/** The box score is worth keeping only for the players who have actually been on the floor. */
const worthKeeping = (p: SnapshotLine): boolean => Object.values(p.stats).some((v) => v > 0);

/**
 * Store this read's box score against the period it is the end of.
 *
 * Idempotent, and monotone towards the buzzer: a boundary already stored is overwritten only by a
 * snapshot taken CLOSER to it, so re-running the quarters job can add rows and improve rows but can
 * never move a boundary further from where it belongs. Returns the boundary written, or null.
 */
export function recordLiveReadSnapshot(
  snap: LiveSnapshot,
  meta: { sportKey: string; dateKey: string; periodMinutes: number },
): { through: number; slack: number } | null {
  if (snap.sportGroup !== "basketball") return null;
  const at = boundaryOf(snap, meta.periodMinutes);
  if (!at) return null;
  const players = snap.players.filter(worthKeeping).map((p) => ({ id: p.id, name: p.name, team: p.team, stats: p.stats }));
  if (!players.length) return null;
  try {
    const changes = getDb().prepare(`
      INSERT INTO live_read_snapshots (gameId, throughPeriod, sportKey, dateKey, slackMinutes, minute, homeScore, awayScore, players, takenAt)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(gameId, throughPeriod) DO UPDATE SET
        slackMinutes = excluded.slackMinutes, minute = excluded.minute, homeScore = excluded.homeScore,
        awayScore = excluded.awayScore, players = excluded.players, takenAt = excluded.takenAt
      WHERE excluded.slackMinutes <= live_read_snapshots.slackMinutes
    `).run(snap.gameId, at.through, meta.sportKey, meta.dateKey, at.slack, snap.minute, snap.home.score, snap.away.score, JSON.stringify(players), nowIso()).changes;
    return changes ? at : null;
  } catch (error) {
    reportError("live.quarter_snapshot", error, { gameId: snap.gameId, through: at.through }, "warn");
    return null;
  }
}

interface Row { throughPeriod: number; slackMinutes: number; players: string }

/** Every boundary snapshot stored for this game, oldest first. */
export function storedSnapshots(gameId: string): (StoredSnapshot & { slack: number })[] {
  try {
    const rows = getDb().prepare("SELECT throughPeriod, slackMinutes, players FROM live_read_snapshots WHERE gameId = ? ORDER BY throughPeriod").all(gameId) as Row[];
    return rows.map((r) => ({ period: r.throughPeriod, slack: r.slackMinutes, players: JSON.parse(r.players) as SnapshotLine[] }));
  } catch (error) {
    reportError("live.quarter_snapshots_read", error, { gameId }, "warn");
    return [];
  }
}

/** The per-quarter split this game's stored reads support on their own, with no narration involved. */
export function subtractedQuarters(gameId: string): SubtractedProfile[] {
  const stored = storedSnapshots(gameId);
  return stored.length ? quartersBySubtraction(stored) : [];
}
