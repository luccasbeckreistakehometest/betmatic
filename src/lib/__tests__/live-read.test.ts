import { describe, expect, it } from "vitest";
import { parseLiveSnapshot } from "@/lib/live/snapshot";

process.env.DATA_DIR = "/tmp/bm-live-read-test";
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
const { LIVE_BANDS, LIVE_MAX_PER_BAND, CONTESTED_MARGIN, liveContext } = await import("@/lib/server/live-read");

/** Half-time of a one-possession game: the shape the hand-built reads were taken at. */
const summary = (homeScore: number, awayScore: number) => ({
  header: { competitions: [{ status: { clock: 0, displayClock: "0:00", period: 2, type: { state: "in" } }, competitors: [
    { homeAway: "home", score: String(homeScore), team: { abbreviation: "PHX" } },
    { homeAway: "away", score: String(awayScore), team: { abbreviation: "DAL" } },
  ] }] },
  boxscore: { players: [{ team: { abbreviation: "PHX" }, statistics: [{ labels: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"], athletes: [
    { athlete: { id: "1", displayName: "Alyssa Thomas" }, stats: ["19", "8", "3-6", "0-0", "2-2", "6", "7", "2", "1", "0", "2", "4", "1", "+2"] },
  ] }] }] },
});

describe("the live read reaches the long band", () => {
  // The bug this pins: the live read used to ask for `safe` and `value` only, one ticket each, so
  // the 10x-plus tickets that the hand-built half-time reads returned +425% on were unreachable.
  it("asks for the mid and long bands, more than one ticket each", () => {
    expect(LIVE_BANDS).toContain("mid");
    expect(LIVE_BANDS).toContain("long");
    expect(LIVE_MAX_PER_BAND).toBeGreaterThan(1);
  });

  it("leaves moonshot to the pre-game slate", () => {
    expect(LIVE_BANDS).not.toContain("moonshot");
  });
});

describe("the margin the pre-game read could only guess", () => {
  const ctx = (home: number, away: number) =>
    liveContext(parseLiveSnapshot(summary(home, away), "g", "basketball", 10), { leaders: "Alyssa Thomas (PHX): PTS 8, REB 6", trackerText: "" });

  it("tells the model to move unders off the starters while the game is close", () => {
    const close = ctx(44, 43);
    expect(close).toContain("margin 1");
    expect(close).toMatch(/inside 1 point with/);
    expect(close).toMatch(/fighting the scoreboard/);
    expect(close).toMatch(/bench minutes/);
  });

  it("flips to the opposite reading once the game is out of reach", () => {
    const blowout = ctx(60, 38);
    expect(blowout).toMatch(/22 points apart/);
    expect(blowout).toMatch(/the closers sit/);
    expect(blowout).not.toMatch(/fighting the scoreboard/);
  });

  it("treats exactly the threshold as contested", () => {
    expect(ctx(50, 50 - CONTESTED_MARGIN)).toMatch(/fighting the scoreboard/);
    expect(ctx(50, 50 - CONTESTED_MARGIN - 1)).toMatch(/the closers sit/);
  });

  it("carries the score, the minutes left and the ticket brief", () => {
    const c = ctx(44, 43);
    expect(c).toContain("DAL 43 @ PHX 44");
    expect(c).toMatch(/BUILD REAL TICKETS, NOT A BULLETIN/);
    expect(c).toMatch(/at least one at 10x or longer/);
    expect(c).toMatch(/remaining requirement sits below the rate the player has already produced/);
    expect(c).toContain("LIVE PLAYER LINES:");
  });

  it("drops the tracker block when no ticket is being followed", () => {
    expect(ctx(44, 43)).not.toContain("PRE-MATCH TICKETS");
  });
});
