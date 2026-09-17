import { describe, expect, it } from "vitest";
import { featuredConfig, pickFeatured, type FeaturedCandidate } from "@/lib/server/featured-policy";

const NOW = Date.parse("2026-09-17T12:00:00Z");
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();
const g = (gameId: string, sportKey: string, hours: number, hasLines = true, teamIds = ["h" + gameId, "a" + gameId]): FeaturedCandidate => ({ gameId, sportKey, startsAt: at(hours), teamIds, hasLines });
const none = { teams: new Map<string, number>(), leagues: new Map<string, number>() };
const known = ["soccer-bra", "wnba", "nba", "soccer-eng", "soccer-ucl", "soccer-lib", "tennis-atp"];

describe("featured config", () => {
  it("defaults to 3 a day, caps at 8 and ignores unknown sports", () => {
    expect(featuredConfig({}, known)).toEqual({ perDay: 3, sports: ["soccer-bra", "wnba", "soccer-eng", "soccer-ucl", "soccer-lib"] });
    expect(featuredConfig({ FEATURED_PER_DAY: "50" }, known).perDay).toBe(8);
    expect(featuredConfig({ FEATURED_PER_DAY: "0" }, known).perDay).toBe(0);
    expect(featuredConfig({ FEATURED_SPORTS: "nba, bogus" }, known).sports).toEqual(["nba"]);
  });
});

describe("pickFeatured", () => {
  const cfg = featuredConfig({}, known);

  it("keeps only games 2 to 30 hours out, in configured sports", () => {
    const out = pickFeatured([g("soon", "soccer-bra", 1), g("ok", "soccer-bra", 5), g("far", "soccer-bra", 31), g("nba", "nba", 5)], none, cfg, NOW);
    expect(out.map((x) => x.gameId)).toEqual(["ok"]);
  });

  it("ranks by follows, then league priority, then lines, then kickoff, and caps the count", () => {
    const games = [g("wnba1", "wnba", 4), g("bra-late", "soccer-bra", 20), g("bra-early", "soccer-bra", 3, false), g("bra-lines", "soccer-bra", 10), g("eng-followed", "soccer-eng", 6, true, ["t9", "t10"])];
    const follows = { teams: new Map([["soccer-eng:t9", 2]]), leagues: new Map<string, number>() };
    expect(pickFeatured(games, follows, cfg, NOW).map((x) => x.gameId)).toEqual(["eng-followed", "bra-lines", "bra-late"]);
    expect(pickFeatured(games, follows, { ...cfg, perDay: 5 }, NOW).map((x) => x.gameId)).toEqual(["eng-followed", "bra-lines", "bra-late", "bra-early", "wnba1"]);
  });

  it("counts a league follow for every game in it and never repeats a game", () => {
    const follows = { teams: new Map<string, number>(), leagues: new Map([["wnba", 1]]) };
    expect(pickFeatured([g("x", "soccer-bra", 5), g("w", "wnba", 5), g("w", "wnba", 5)], follows, cfg, NOW).map((x) => x.gameId)).toEqual(["w", "x"]);
  });
});
