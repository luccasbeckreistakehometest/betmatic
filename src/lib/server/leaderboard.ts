import { getDb } from "@/lib/server/db";
import { listBankroll } from "@/lib/server/bankroll";
import { MIN_DECIDED, rankUsers, type RankRow } from "@/lib/ranking";

/**
 * Only members who opted in are read at all; the rows that leave carry the handle, never the
 * user id, name or e-mail. `you` marks the viewer's own row so the page can highlight it.
 */
export type LeaderboardRow = Omit<RankRow, "userId"> & { you: boolean; position: number };

export function leaderboard(period: "week" | "all", viewerId: string | null, now = Date.now()): { rows: LeaderboardRow[]; period: "week" | "all"; minDecided: number; members: number } {
  const optedIn = getDb().prepare("SELECT userId, handle FROM user_settings WHERE leaderboardOptIn=1 AND handle IS NOT NULL").all() as { userId: string; handle: string }[];
  const inputs = optedIn.map((u) => ({
    userId: u.userId, handle: u.handle,
    entries: listBankroll(u.userId).entries.map((e) => ({ outcome: e.outcome, stake: e.stake, pnl: e.pnl, at: e.settledAt ?? e.createdAt })),
  }));
  const rows = rankUsers(inputs, { period, now }).map(({ userId, ...r }, i) => ({ ...r, you: userId === viewerId, position: i + 1 }));
  return { rows, period, minDecided: MIN_DECIDED, members: optedIn.length };
}
