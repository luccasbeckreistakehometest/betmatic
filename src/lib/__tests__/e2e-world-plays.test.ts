import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeEspnFixtures } from "../../../tests/e2e/espn-fixtures";
import { narrationTotals, parseQuarterProfiles, quartersPrompt } from "@/lib/live/quarters";

/**
 * The closed world the Playwright specs run against has to hang together the way ESPN does, or an
 * e2e pass proves nothing about the real thing. This holds the fake play-by-play to the fake box
 * score printed beside it: if someone adds a rebound to one and not the other, it fails here rather
 * than in a browser.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-e2e-world-"));
writeEspnFixtures(dir);
const file = fs.readdirSync(dir).find((n) => n.includes("summary_event_990000102"))!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const summary = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as any;
const profiles = parseQuarterProfiles(summary, 10);

describe("the live game in the closed world", () => {
  it("narrates a game the walk can read", () => {
    expect(profiles.plays).toBe(36);
    expect(profiles.periods).toEqual([1, 2, 3]);
  });

  it("narrates exactly the box score printed beside it", () => {
    for (const group of summary.boxscore.players) {
      const stat = group.statistics[0];
      for (const a of stat.athletes) {
        const row = Object.fromEntries((stat.labels as string[]).map((l, i) => [l, a.stats[i]]));
        const got = narrationTotals(profiles.players.find((p) => p.name === a.athlete.displayName)!);
        expect({ who: a.athlete.displayName, pts: got.pts, reb: got.reb, pf: got.pf, stl: got.stl, tov: got.tov, blk: got.blk })
          .toEqual({ who: a.athlete.displayName, pts: Number(row.PTS), reb: Number(row.REB), pf: Number(row.PF), stl: Number(row.STL), tov: Number(row.TO), blk: Number(row.BLK) });
      }
    }
  });

  it("refuses the minutes, because one player a side cannot field five", () => {
    // The honest-refusal path, exercised end to end: the block still carries the counting stats.
    expect(profiles.minutesThrough).toBe(0);
    expect(profiles.notes[0]).toContain("not 5");
    const block = quartersPrompt(profiles, { lastComplete: 2 });
    expect(block).toContain("MINUTES ARE NOT MEASURED AT ALL FOR THIS GAME");
    expect(block).toContain("Q1 8pt 2rb 0as 1pf min not measured");
    expect(block).not.toMatch(/0min/);
  });
});
