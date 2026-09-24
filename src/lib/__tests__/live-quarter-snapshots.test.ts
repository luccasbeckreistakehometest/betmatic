import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-live-quarter-snapshots");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

import type { LiveSnapshot } from "@/lib/live/snapshot";

const { boundaryOf, EMPTY_QUARTERS } = await import("@/lib/live/quarters");
const { recordLiveReadSnapshot, storedSnapshots, subtractedQuarters } = await import("@/lib/server/live-quarters");

/**
 * The read is almost never taken on the buzzer: the quarters job fires on the first cron tick after
 * ESPN advances the period, so a "half-time" read usually lands a few seconds into the third. What
 * the table must never do is file that box score as the end of the wrong quarter.
 */
const snap = (over: Partial<LiveSnapshot> & { period: number; clockLeft: number | null }): LiveSnapshot => ({
  gameId: "401857206", sportGroup: "basketball", state: "in", clock: "", elapsed: 0, minute: 0,
  clockUnknown: false, regulationMinutes: 40,
  home: { abbr: "NY", score: 0, stats: {} }, away: { abbr: "ATL", score: 0, stats: {} },
  players: [], quarters: EMPTY_QUARTERS, fetchedAt: "2026-09-22T00:40:00.000Z", ...over,
});

const line = (id: string, stats: Record<string, number>) => ({ id, name: `p${id}`, team: "NY", stats });

describe("which period a stored box score is the end of", () => {
  it("is the period on the clock when the buzzer has gone", () => {
    expect(boundaryOf(snap({ period: 2, clockLeft: 0 }), 10)).toEqual({ through: 2, slack: 0 });
    expect(boundaryOf({ state: "post", period: 4, clockLeft: 0 }, 10)).toEqual({ through: 4, slack: 0 });
  });

  it("is the PREVIOUS period when the next one has already tipped, and says how far in", () => {
    expect(boundaryOf(snap({ period: 3, clockLeft: 10 }), 10)).toEqual({ through: 2, slack: 0 });
    // Twenty seconds into the third: still the end of the second, and the row will say 0.3.
    expect(boundaryOf(snap({ period: 3, clockLeft: 9.7 }), 10)).toEqual({ through: 2, slack: 0.3 });
  });

  it("is nothing at all in the middle of a period, or before one can be named", () => {
    expect(boundaryOf(snap({ period: 3, clockLeft: 5.2 }), 10)).toBeNull();
    expect(boundaryOf(snap({ period: 1, clockLeft: 4 }), 10)).toBeNull();
    // A clock that would not parse is not a clock that has run out.
    expect(boundaryOf(snap({ period: 3, clockLeft: null }), 10)).toBeNull();
    expect(boundaryOf(snap({ period: 0, clockLeft: 0 }), 10)).toBeNull();
  });
});

describe("the stored snapshots", () => {
  const withPlayers = (period: number, clockLeft: number, players: ReturnType<typeof line>[]) =>
    recordLiveReadSnapshot(snap({ period, clockLeft, players }), { sportKey: "wnba", dateKey: "20260921", periodMinutes: 10 });

  it("keeps one row per boundary and makes the quarter computable", () => {
    expect(withPlayers(1, 0, [line("a", { PTS: 12, REB: 3, MIN: 9 })])).toEqual({ through: 1, slack: 0 });
    expect(withPlayers(3, 9.8, [line("a", { PTS: 14, REB: 7, MIN: 18 })])).toEqual({ through: 2, slack: 0.2 });
    expect(storedSnapshots("401857206").map((s) => s.period)).toEqual([1, 2]);
    const [player] = subtractedQuarters("401857206");
    // The whole point: 12 then 14 accumulated means the second quarter was 2, not 14.
    expect(player.periods).toEqual([
      { period: 1, pts: 12, reb: 3, ast: 0, pf: 0, stl: 0, tov: 0, blk: 0, minutes: 9 },
      { period: 2, pts: 2, reb: 4, ast: 0, pf: 0, stl: 0, tov: 0, blk: 0, minutes: 9 },
    ]);
  });

  it("is idempotent, and only ever moves a boundary closer to its buzzer", () => {
    const before = storedSnapshots("401857206");
    expect(withPlayers(1, 0, [line("a", { PTS: 12, REB: 3, MIN: 9 })])).toEqual({ through: 1, slack: 0 });
    expect(storedSnapshots("401857206")).toEqual(before);
    // A later tick, further from the buzzer, must not displace the row taken on it.
    expect(withPlayers(3, 8.5, [line("a", { PTS: 99, REB: 99, MIN: 99 })])).toBeNull();
    expect(storedSnapshots("401857206").find((s) => s.period === 2)!.players[0].stats.PTS).toBe(14);
    // One taken closer does displace it.
    expect(withPlayers(3, 10, [line("a", { PTS: 13, REB: 6, MIN: 18 })])).toEqual({ through: 2, slack: 0 });
    expect(storedSnapshots("401857206").find((s) => s.period === 2)!.players[0].stats.PTS).toBe(13);
  });

  it("stores nothing it cannot name a boundary for, and nothing for a sport this does not cover", () => {
    expect(withPlayers(3, 5, [line("a", { PTS: 20 })])).toBeNull();
    expect(recordLiveReadSnapshot(snap({ period: 2, clockLeft: 0, sportGroup: "soccer", players: [line("a", { PTS: 1 })] }), { sportKey: "bra", dateKey: "20260921", periodMinutes: 45 })).toBeNull();
    // A box score in which nobody has done anything yet is not worth a row.
    expect(recordLiveReadSnapshot(snap({ gameId: "999", period: 1, clockLeft: 0, players: [line("a", { PTS: 0, MIN: 0 })] }), { sportKey: "wnba", dateKey: "20260921", periodMinutes: 10 })).toBeNull();
    expect(storedSnapshots("999")).toEqual([]);
  });
});
