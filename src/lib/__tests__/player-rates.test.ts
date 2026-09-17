import { describe, expect, it } from "vitest";
import { measureProp } from "@/lib/props/history";
import { rateTable, splitWithWithout } from "@/lib/props/rates";
import type { PlayerGame, PlayerHistory } from "@/lib/types";

const g = (eventId: string, pts: number, min = 30, homeAway: "vs" | "@" = "vs"): PlayerGame => ({ eventId, date: `2026-09-${eventId.padStart(2, "0")}`, opponent: "X", homeAway, result: "", stats: { PTS: pts, MIN: min, "3PT": `${Math.floor(pts / 8)}-5` } });
const games = [g("20", 22), g("19", 18, 30, "@"), g("18", 20), g("17", 25, 30, "@"), g("16", 12), g("15", 20), g("14", 30, 30, "@"), g("13", 9), g("12", 21), g("11", 19, 30, "@"), g("10", 23)];
const history: PlayerHistory = { athleteId: "1", player: "", team: "", games, availableStats: ["PTS", "MIN", "3PT"] };

describe("rates at any line", () => {
  it("match measureProp for every window and treat the line itself as a push", () => {
    for (const line of [15.5, 20, 20.5, 8.5]) {
      for (const side of ["over", "under"] as const) {
        const m = measureProp(history, "points", line, side, "wnba")!;
        const t = rateTable(games, ["PTS"], line, side);
        expect([t.last5.hits, t.last5.of]).toEqual([m.last5.hits, m.last5.of]);
        expect([t.last10.hits, t.last10.of]).toEqual([m.last10.hits, m.last10.of]);
        expect([t.season.hits, t.season.of]).toEqual([m.season.hits, m.season.of]);
      }
    }
  });

  it("splits home and away and reads made-attempt pairs as the made count", () => {
    const t = rateTable(games, ["PTS"], 19.5);
    expect(t.home.of + t.away.of).toBe(t.season.of);
    expect(rateTable(games, ["3PT"], 1.5).season.hits).toBe(games.filter((x) => Math.floor((x.stats.PTS as number) / 8) > 1.5).length);
  });
});

describe("with / without a teammate", () => {
  it("counts a teammate with 0 minutes as absent in basketball and needs 3 games a side", () => {
    const mate = [g("20", 10), g("19", 8), g("18", 0, 0), g("17", 7), g("15", 5)];
    const s = splitWithWithout(games, mate, ["PTS"], 19.5, "over", true);
    expect(s.withGames).toBe(4);
    expect(s.withoutGames).toBe(7);
    expect(s.enough).toBe(true);
    expect(s.with.hits).toBe(3);
  });

  it("flags a small sample, and in football any appearance counts", () => {
    const s = splitWithWithout(games, [g("20", 0, 0), g("19", 0, 0)], ["PTS"], 19.5, "over", false);
    expect(s.withGames).toBe(2);
    expect(s.enough).toBe(false);
  });
});
