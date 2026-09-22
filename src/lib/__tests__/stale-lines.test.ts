import { describe, expect, it, vi } from "vitest";
import { describeDropped, guardProps, judgeProp, needed, type LiveTotals } from "@/lib/props/stale";
import { getLiveBoxScore, totalsFromSnapshot } from "@/lib/props/box-score";
import { parseLiveSnapshot } from "@/lib/live/snapshot";
import { buildPropCandidates } from "@/lib/props/candidates";
import type { PostedProp } from "@/lib/sources/espn-props";
import type { GameDetail, PlayerHistory } from "@/lib/types";

/**
 * The stale line guard, written after a real night: at half time of Atlanta @ New York the prop
 * feed still offered "Bonner over 7.5 points" at 1.86 while she had 10, "Bonner over 3.5 rebounds"
 * while she had 4, and "Stewart over 7.5 rebounds" while she had 8. Six of thirteen priced legs
 * were already decided. ESPN's props are pre-game and never move once the ball is up.
 */
const snapshot = {
  header: { competitions: [{ status: { clock: 0, displayClock: "0:00", period: 2, type: { state: "in" } }, competitors: [
    { homeAway: "home", score: "44", team: { abbreviation: "NY" } }, { homeAway: "away", score: "41", team: { abbreviation: "ATL" } },
  ] }] },
  boxscore: { players: [{ team: { abbreviation: "ATL" }, statistics: [{ labels: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"], athletes: [
    { athlete: { id: "2529120", displayName: "DeWanna Bonner" }, stats: ["18", "10", "4-7", "2-3", "0-0", "4", "2", "1", "0", "0", "1", "3", "1", "+4"] },
    { athlete: { id: "4066533", displayName: "Rhyne Howard" }, stats: ["17", "6", "2-8", "1-4", "1-2", "3", "4", "2", "1", "0", "0", "3", "2", "-1"] },
    // A player listed with no line yet: the box score says nothing, so the guard must say nothing.
    { athlete: { id: "9999", displayName: "Nao Jogou" }, stats: [] },
  ] }] }, { team: { abbreviation: "NY" }, statistics: [{ labels: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"], athletes: [
    { athlete: { id: "2998928", displayName: "Breanna Stewart" }, stats: ["19", "13", "5-10", "1-2", "2-2", "8", "3", "2", "1", "2", "2", "6", "2", "+6"] },
  ] }] }] },
};

describe("stale line rule", () => {
  // A counting stat only goes up, so the whole rule is "how far past the line is the player now".
  const cases: { line: number; side: "over" | "under"; current: number | null; state: string; remaining: number | null; why: string }[] = [
    { line: 7.5, side: "over", current: 10, state: "decided", remaining: null, why: "tonight's Bonner points" },
    { line: 7.5, side: "over", current: 8, state: "decided", remaining: null, why: "exact edge: 8 clears 7.5" },
    { line: 7.5, side: "over", current: 7, state: "alive", remaining: 1, why: "one short" },
    { line: 8.5, side: "over", current: 8, state: "alive", remaining: 1, why: "exact edge: 8 does not clear 8.5" },
    { line: 3.5, side: "over", current: 4, state: "decided", remaining: null, why: "tonight's Bonner rebounds" },
    { line: 0.5, side: "over", current: 1, state: "decided", remaining: null, why: "anytime scorer who has scored" },
    { line: 0.5, side: "over", current: 0, state: "alive", remaining: 1, why: "anytime scorer still to score" },
    { line: 24.5, side: "over", current: 0, state: "alive", remaining: 25, why: "zero is a value, not a missing one" },
    { line: 7.5, side: "under", current: 8, state: "decided", remaining: null, why: "busted the moment it is exceeded" },
    { line: 7.5, side: "under", current: 7, state: "alive", remaining: 0, why: "level with the last winning total" },
    { line: 7.5, side: "under", current: 5, state: "alive", remaining: 2, why: "room for two more" },
    { line: 8, side: "over", current: 8, state: "alive", remaining: 1, why: "whole line: 8 pushes, 9 wins" },
    { line: 8, side: "over", current: 9, state: "decided", remaining: null, why: "whole line cleared" },
    { line: 8, side: "under", current: 8, state: "decided", remaining: null, why: "whole line: the under can only push now" },
    { line: 8, side: "under", current: 7, state: "alive", remaining: 0, why: "still winning by one" },
    { line: 7.5, side: "over", current: null, state: "unknown", remaining: null, why: "no live value for this player" },
  ];

  for (const c of cases) {
    it(`${c.side} ${c.line} with ${c.current ?? "no value"} is ${c.state} (${c.why})`, () => {
      const verdict = judgeProp({ line: c.line, side: c.side }, c.current);
      expect(verdict.state).toBe(c.state);
      expect(verdict.remaining).toBe(c.remaining);
      expect(verdict.current).toBe(c.current);
    });
  }

  it("a line without a number is unknown, never decided", () => {
    expect(judgeProp({ side: "over" }, 30).state).toBe("unknown");
    expect(judgeProp({ line: Number.NaN, side: "over" }, 30).state).toBe("unknown");
    expect(judgeProp({ line: 7.5, side: "over" }, Number.NaN).state).toBe("unknown");
  });

  it("exposes the requirement the prompt quotes", () => {
    expect(needed(7.5, "over", 4)).toBe(4);
    expect(judgeProp({ line: 7.5, side: "over" }, 4).reason?.pt).toBe("4 até agora, faltam 4");
    expect(judgeProp({ line: 7.5, side: "over" }, 10).reason?.en).toBe("already cleared: 10 vs 7.5");
  });
});

describe("box score totals", () => {
  const snap = parseLiveSnapshot(snapshot, "401857190", "basketball", 10);
  const totals = totalsFromSnapshot(snap, "wnba");

  it("maps single and combined markets, by id and by name", () => {
    expect(totals.byId["2529120"]).toMatchObject({ points: 10, rebounds: 4, assists: 2, threes: 2, pr: 14, pa: 12, ra: 6, pra: 16 });
    expect(totals.byName["dewanna bonner"]).toEqual(totals.byId["2529120"]);
    expect(totals.byId["2998928"]).toMatchObject({ points: 13, rebounds: 8, pra: 24 });
  });

  it("says nothing about a player with no box-score line", () => {
    expect(totals.byId["9999"]).toBeUndefined();
    expect(judgeProp({ athleteId: "9999", line: 7.5, side: "over" }, undefined).state).toBe("unknown");
  });

  it("reads soccer markets from the roster block", () => {
    const soccer = parseLiveSnapshot({
      header: { competitions: [{ status: { displayClock: "62'", period: 2, type: { state: "in" } }, competitors: [
        { homeAway: "home", score: "1", team: { abbreviation: "TUP" } }, { homeAway: "away", score: "0", team: { abbreviation: "IPE" } },
      ] }] },
      rosters: [{ team: { abbreviation: "TUP" }, roster: [{ starter: true, athlete: { id: "88001", displayName: "Rafa Moura" }, stats: [
        { name: "totalShots", value: 3 }, { name: "shotsOnTarget", value: 2 }, { name: "yellowCards", value: 1 }, { name: "totalGoals", value: 1 },
      ] }] }],
    }, "g", "soccer");
    const t = totalsFromSnapshot(soccer, "soccer-bra");
    expect(t.byId["88001"]).toMatchObject({ shots: 3, shots_on_target: 2, yellow_card: 1, goals: 1 });
    // A booked player's "any card over 0.5" is settled; an anytime scorer who has scored likewise.
    expect(judgeProp({ line: 0.5, side: "over" }, t.byId["88001"].yellow_card).state).toBe("decided");
    expect(judgeProp({ line: 0.5, side: "over" }, t.byId["88001"].goals).state).toBe("decided");
  });
});

describe("guarding a posted feed", () => {
  const snap = parseLiveSnapshot(snapshot, "401857190", "basketball", 10);
  const totals = totalsFromSnapshot(snap, "wnba");
  const prop = (athleteId: string, marketKey: string, line: number, side: "over" | "under" = "over"): PostedProp => ({
    athleteId, marketKey, line, side, decimal: 1.86, openDecimal: null, openLine: null,
    otherDecimal: null, noVigFair: null, kind: "total", book: "DraftKings", updatedAt: null,
  });

  it("drops every leg the box score already settled and keeps the rest with what they need", () => {
    const feed = [
      prop("2529120", "points", 7.5),     // Bonner, 10 already: decided
      prop("2529120", "rebounds", 3.5),   // Bonner, 4 already: decided
      prop("2998928", "rebounds", 7.5),   // Stewart, 8 already: decided
      prop("2529120", "points", 15.5),    // alive, 6 to go
      prop("4066533", "assists", 5.5),    // alive, 2 to go
      prop("9999", "points", 5.5),        // no box-score line: unknown, kept
    ];
    const { kept, dropped } = guardProps(feed, totals);
    expect(dropped.map((d) => `${d.prop.athleteId}:${d.prop.marketKey}`)).toEqual(["2529120:points", "2529120:rebounds", "2998928:rebounds"]);
    expect(kept.map((k) => [k.prop.marketKey, k.verdict.state, k.verdict.remaining])).toEqual([
      ["points", "alive", 6], ["assists", "alive", 2], ["points", "unknown", null],
    ]);
    expect(describeDropped(dropped)[0]).toContain("already cleared: 10 vs 7.5");
  });

  it("keeps everything when there is no box score at all", () => {
    const feed = [prop("2529120", "points", 7.5), prop("2998928", "rebounds", 7.5)];
    expect(guardProps(feed, null).dropped).toHaveLength(0);
    expect(guardProps(feed, { byId: {}, byName: {} } as LiveTotals).dropped).toHaveLength(0);
  });
});

vi.mock("@/lib/server/live-snapshot", () => ({ getLiveSnapshot: vi.fn() }));
vi.mock("@/lib/sources/espn", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn")>()),
  getPlayerHistory: async (_sport: string, athleteId: string): Promise<PlayerHistory> => ({
    athleteId, player: "", team: "",
    // Twelve logged games at starter minutes, so the role gate passes and the line is measurable.
    games: Array.from({ length: 12 }, (_, i) => ({
      eventId: `e${i}`, date: `2026-09-0${(i % 9) + 1}`, opponent: "OPP", homeAway: "vs" as const, result: "W",
      stats: { MIN: 32, PTS: 14 + (i % 5), REB: 5 + (i % 3), AST: 3, "3PT": 2 },
    })),
    availableStats: ["MIN", "PTS", "REB", "AST", "3PT"],
  }),
  getSeasonRole: async () => null,
}));

describe("the pipeline refuses a decided leg", () => {
  const detail = (status: "live" | "scheduled"): GameDetail => ({
    game: {
      id: "401857190", sportKey: "wnba", startsAt: new Date().toISOString(), status, statusDetail: status === "live" ? "Half" : "Scheduled",
      home: { id: "9", abbreviation: "NY", name: "Liberty", displayName: "New York Liberty" },
      away: { id: "20", abbreviation: "ATL", name: "Dream", displayName: "Atlanta Dream" },
    },
    injuries: [], teamStats: { home: [], away: [] }, books: [], ats: [], leaders: [], lastMeetings: [],
    rosters: [
      { teamAbbreviation: "ATL", players: ["DeWanna Bonner"], athletes: [{ name: "DeWanna Bonner", id: "2529120" }] },
      { teamAbbreviation: "NY", players: ["Breanna Stewart"], athletes: [{ name: "Breanna Stewart", id: "2998928" }] },
    ],
  });
  const feed = {
    status: "ok" as const,
    props: [
      { athleteId: "2529120", marketKey: "points", line: 7.5, side: "over" as const, decimal: 1.86, openDecimal: null, openLine: null, otherDecimal: null, noVigFair: null, kind: "total" as const, book: "DraftKings", updatedAt: null },
      { athleteId: "2529120", marketKey: "points", line: 15.5, side: "over" as const, decimal: 2.1, openDecimal: null, openLine: null, otherDecimal: null, noVigFair: null, kind: "total" as const, book: "DraftKings", updatedAt: null },
    ],
  };
  const box = {
    state: "in" as const,
    totals: totalsFromSnapshot(parseLiveSnapshot(snapshot, "401857190", "basketball", 10), "wnba"),
    minute: 20, minutesLeft: 20, clock: "0:00", period: 2, fetchedAt: new Date().toISOString(),
  };

  it("a feed offering over 7.5 points to a player who already has 10 never reaches the model", async () => {
    const set = await buildPropCandidates(detail("live"), { feed, box });
    const lines = set.props.map((p) => `${p.player} ${p.marketKey} ${p.side} ${p.line}`);
    expect(lines).not.toContain("DeWanna Bonner points over 7.5");
    expect(lines).toContain("DeWanna Bonner points over 15.5");
    expect(set.staleDropped[0]).toContain("DeWanna Bonner points over 7.5");
    // The survivor carries what it still needs, for the prompt to say it out loud.
    expect(set.props.find((p) => p.line === 15.5)?.live).toEqual({ current: 10, remaining: 6, minutesLeft: 20 });
    expect(set.posted).toHaveLength(1);
  });

  it("leaves a game that has not started exactly as it was", async () => {
    const set = await buildPropCandidates(detail("scheduled"), { feed });
    expect(set.props.map((p) => p.line).sort((a, b) => a! - b!)).toEqual([7.5, 15.5]);
    expect(set.props.every((p) => !p.live)).toBe(true);
    expect(set.staleDropped).toEqual([]);
  });
});

describe("what the model is told", () => {
  it("calls the prices pre-game references and spells out what each survivor needs", async () => {
    const { describeProps } = await import("@/lib/bets/builder");
    const row = (line: number, side: "over" | "under", live: { current: number; remaining: number; minutesLeft: number } | null) => ({
      player: "DeWanna Bonner", market: "Points", marketKey: "points", line, side, odds: "1.86", book: "DraftKings", priced: true, live,
    });
    const text = describeProps([row(15.5, "over", { current: 10, remaining: 6, minutesLeft: 20 }), row(19.5, "under", { current: 10, remaining: 9, minutesLeft: 20 })]);
    expect(text).toContain("PRE-GAME REFERENCE");
    expect(text).toContain("10 so far, 6 to go, ~20 min of regulation left");
    expect(text).toContain("10 so far, room for 9 more");
    // A game that has not started says none of it.
    expect(describeProps([row(15.5, "over", null)])).not.toContain("PRE-GAME REFERENCE");
  });
});

describe("live box-score reader", () => {
  it("returns nothing before the tip-off, and never throws on a failure", async () => {
    const { getLiveSnapshot } = await import("@/lib/server/live-snapshot");
    const mocked = vi.mocked(getLiveSnapshot);
    mocked.mockResolvedValueOnce(parseLiveSnapshot({ header: { competitions: [{ status: { type: { state: "pre" } }, competitors: [] }] } }, "g", "basketball", 10));
    expect(await getLiveBoxScore("wnba", "g")).toBeNull();
    mocked.mockResolvedValueOnce(null);
    expect(await getLiveBoxScore("wnba", "g")).toBeNull();
    mocked.mockRejectedValueOnce(new Error("ESPN 503"));
    expect(await getLiveBoxScore("wnba", "g")).toBeNull();
  });

  it("reads the clock and the totals once the ball is up", async () => {
    const { getLiveSnapshot } = await import("@/lib/server/live-snapshot");
    vi.mocked(getLiveSnapshot).mockResolvedValueOnce(parseLiveSnapshot(snapshot, "401857190", "basketball", 10));
    const box = await getLiveBoxScore("wnba", "401857190");
    expect(box?.state).toBe("in");
    expect(box?.minutesLeft).toBe(20);
    expect(box?.totals.byId["2998928"].rebounds).toBe(8);
  });
});
