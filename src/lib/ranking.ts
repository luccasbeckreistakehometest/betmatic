/**
 * The opt-in leaderboard as a pure ranking over each member's settled bankroll entries. ROI is
 * profit over money staked; units treat every bet as one unit so a big stake cannot buy a place.
 * Nobody with fewer than MIN_DECIDED decided bets is ranked — ten wins in a row is a good week,
 * not a record.
 */
export const MIN_DECIDED = 10;
export const WEEK_MS = 7 * 86_400_000;

export interface RankEntry { outcome: string; stake: number; pnl: number; at: string }
export interface RankInput { userId: string; handle: string; entries: RankEntry[] }
export interface RankRow { userId: string; handle: string; decided: number; won: number; lost: number; staked: number; profit: number; roi: number; units: number }

export function rankUsers(inputs: RankInput[], opts: { period: "week" | "all"; now?: number; minDecided?: number } = { period: "all" }): RankRow[] {
  const now = opts.now ?? Date.now();
  const since = opts.period === "week" ? new Date(now - WEEK_MS).toISOString() : "";
  const min = opts.minDecided ?? MIN_DECIDED;
  const rows: RankRow[] = [];
  for (const u of inputs) {
    const decided = u.entries.filter((e) => (e.outcome === "won" || e.outcome === "lost") && e.stake > 0 && e.at > since);
    if (decided.length < min) continue;
    const won = decided.filter((e) => e.outcome === "won").length;
    const staked = decided.reduce((a, e) => a + e.stake, 0);
    const profit = decided.reduce((a, e) => a + e.pnl, 0);
    const units = decided.reduce((a, e) => a + e.pnl / e.stake, 0);
    rows.push({ userId: u.userId, handle: u.handle, decided: decided.length, won, lost: decided.length - won, staked: r2(staked), profit: r2(profit), roi: staked ? r4(profit / staked) : 0, units: r2(units) });
  }
  return rows.sort((a, b) => b.roi - a.roi || b.units - a.units || b.decided - a.decided || a.handle.localeCompare(b.handle));
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
