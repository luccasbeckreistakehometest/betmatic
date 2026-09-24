import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTeamSeasonStats, TEAM_STATS_MIN_GAMES } from "@/lib/sources/espn-team-stats";
import { teamSeasonPrompt } from "@/lib/signals/team-season";
import type { Json } from "@/lib/sources/espn-http";

const fixture = (name: string): Json =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures", name), "utf8")) as Json;

/** Both read 24/09/2026 off the public core API. */
const WNBA = fixture("espn-team-stats-wnba-5-2026.json");
const NBA = fixture("espn-team-stats-nba-13-2026.json");

describe("espn team season statistics", () => {
  it("reads the WNBA season with its league ranks", () => {
    const team = parseTeamSeasonStats(WNBA, "5", "MIN", 2026)!;
    expect(team.games).toBe(43);
    expect(team.pointsFor).toEqual({ value: 96.65, rank: null });
    expect(team.possessions?.value).toBe(96.22);
    expect(team.possessions?.rank).toBe(4);
    // The WNBA is the league that publishes what a side concedes.
    expect(team.pointsAgainst?.value).toBe(90.53);
  });

  it("leaves the conceded side out for the NBA, which does not publish it", () => {
    const team = parseTeamSeasonStats(NBA, "13", "DEN", 2026)!;
    expect(team.games).toBe(82);
    expect(team.pointsFor?.value).toBe(116.34);
    expect(team.pointsAgainst).toBeNull();
    expect(team.possessions?.value).toBe(99.45);
    // Nothing invented in its place: the prompt simply never says "conceded" for this side.
    expect(teamSeasonPrompt({ home: team, away: null })).not.toContain("conceded");
  });

  it("refuses a team with no season behind it", () => {
    const thin = JSON.parse(JSON.stringify(WNBA)) as Json;
    for (const category of thin.splits.categories as Json[]) {
      for (const stat of category.stats as Json[]) if (stat.name === "gamesPlayed") stat.value = TEAM_STATS_MIN_GAMES - 1;
    }
    expect(parseTeamSeasonStats(thin, "5", "MIN", 2026)).toBeNull();
  });

  it("prints both sides with ranks and the shared possession count", () => {
    const home = parseTeamSeasonStats(WNBA, "5", "MIN", 2026);
    const away = parseTeamSeasonStats(WNBA, "9", "SEA", 2026);
    const prompt = teamSeasonPrompt({ home, away });
    expect(prompt).toContain("TEAM SEASON RATES");
    expect(prompt).toContain("96.65 pts");
    expect(prompt).toContain("(#4)");
    expect(prompt).toContain("possessions: that is the volume");
  });

  it("says so rather than printing an empty heading", () => {
    expect(teamSeasonPrompt(null)).toBe("TEAM SEASON RATES: not published for this matchup.");
    expect(teamSeasonPrompt({ home: null, away: null })).toBe("TEAM SEASON RATES: not published for this matchup.");
  });
});
