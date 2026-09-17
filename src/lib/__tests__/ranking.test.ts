import { describe, expect, it } from "vitest";
import { MIN_DECIDED, rankUsers, type RankEntry } from "@/lib/ranking";

const now = Date.parse("2026-09-17T12:00:00Z");
const day = (d: number) => new Date(now - d * 86_400_000).toISOString();
const bets = (won: number, lost: number, stake = 10, odds = 2, daysAgo = 1): RankEntry[] => [
  ...Array.from({ length: won }, () => ({ outcome: "won", stake, pnl: stake * (odds - 1), at: day(daysAgo) })),
  ...Array.from({ length: lost }, () => ({ outcome: "lost", stake, pnl: -stake, at: day(daysAgo) })),
];

describe("leaderboard ranking", () => {
  it("needs ten decided bets, measures ROI over stake and units per bet, and orders by ROI then units", () => {
    const rows = rankUsers([
      { userId: "a", handle: "ana", entries: bets(7, 3) },                     // +40 on 100 → 40%, +4u
      { userId: "b", handle: "bruno", entries: bets(6, 4, 100) },              // +200 on 1000 → 20%, +2u
      { userId: "c", handle: "carla", entries: bets(9, 0) },                   // only 9 decided
      { userId: "d", handle: "davi", entries: [...bets(7, 3), { outcome: "pending", stake: 10, pnl: 0, at: day(0) }, { outcome: "push", stake: 10, pnl: 0, at: day(0) }] },
    ], { period: "all", now });
    expect(rows.map((r) => r.handle)).toEqual(["ana", "davi", "bruno"]);
    expect(rows[0]).toMatchObject({ decided: 10, won: 7, lost: 3, staked: 100, profit: 40, roi: 0.4, units: 4 });
    expect(rows[2]).toMatchObject({ roi: 0.2, units: 2 });
    expect(MIN_DECIDED).toBe(10);
  });
  it("a big stake cannot buy a place: ties on ROI break on units, then on sample size", () => {
    const rows = rankUsers([
      { userId: "x", handle: "x", entries: [...bets(5, 5, 100, 3), ...bets(0, 0)] },  // +1000-500=+500 on 1000 → 50%, units 10-5=+5
      { userId: "y", handle: "y", entries: bets(10, 10, 10, 3) },                     // +200-100=+100 on 200 → 50%, units +10
    ], { period: "all", now });
    expect(rows.map((r) => r.handle)).toEqual(["y", "x"]);
  });
  it("the weekly board counts only bets settled in the last seven days", () => {
    const inputs = [{ userId: "a", handle: "ana", entries: [...bets(7, 3, 10, 2, 1), ...bets(0, 10, 10, 2, 9)] }];
    expect(rankUsers(inputs, { period: "all", now })[0]).toMatchObject({ decided: 20, roi: -0.3 });
    expect(rankUsers(inputs, { period: "week", now })[0]).toMatchObject({ decided: 10, roi: 0.4 });
    expect(rankUsers([{ userId: "a", handle: "ana", entries: bets(7, 3, 10, 2, 8) }], { period: "week", now })).toEqual([]);
  });
  it("is empty with nobody eligible", () => {
    expect(rankUsers([], { period: "all" })).toEqual([]);
    expect(rankUsers([{ userId: "a", handle: "a", entries: bets(3, 2) }], { period: "all", minDecided: 6 })).toEqual([]);
  });
});
