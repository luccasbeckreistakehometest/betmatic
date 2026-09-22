import { describe, expect, it } from "vitest";
import { parseLiveSnapshot } from "@/lib/live/snapshot";

process.env.DATA_DIR = "/tmp/bm-live-read-test";
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
const { LIVE_BANDS, LIVE_MAX_PER_BAND, CONTESTED_MARGIN, liveContext, projectionLines } = await import("@/lib/server/live-read");

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


describe("the remaining-game projections the live read prints", () => {
  const row = (player: string, side: "over" | "under", line: number, computed: number, live: { needed: number; needPerMinute: number; ratePerMinuteTonight: number; ratePerMinuteBlended: number }) => ({
    player, market: "Rebounds", marketKey: "rebounds", line, side, odds: "5.36", priced: true,
    model: { computed, distribution: computed, pOver: computed, pUnder: 1 - computed, mean: 12, sd: 3, rate: 0.34, recentRate: 0.3, dispersion: 0.05, minutes: { expected: 16, sd: 4, availability: "ok" as const }, ladder: [], note: "",
      live: { needed: live.needed, remainingMinutes: 16, needPerMinute: live.needPerMinute, ratePerMinuteTonight: live.ratePerMinuteTonight, ratePerMinutePreGame: 0.34, ratePerMinuteBlended: live.ratePerMinuteBlended, minutesPlayed: 16, fouls: 0 } },
  });

  it("tags the line tonight's rate already covers, the reversion, and the under that needs a slowdown", () => {
    const text = projectionLines([
      row("Jessica Shepard", "over", 13.5, 0.34, { needed: 7, needPerMinute: 0.438, ratePerMinuteTonight: 0.438, ratePerMinuteBlended: 0.344 }),
      row("Arike Ogunbowale", "over", 3.5, 0.07, { needed: 4, needPerMinute: 0.27, ratePerMinuteTonight: 0, ratePerMinuteBlended: 0.101 }),
      row("Alyssa Thomas", "under", 8.5, 0.46, { needed: 3, needPerMinute: 0.189, ratePerMinuteTonight: 0.313, ratePerMinuteBlended: 0.249 }),
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/Alyssa Thomas Rebounds under 8\.5 .*COMPUTED 46% — NEEDS A SLOWDOWN — do not buy/);
    expect(lines[1]).toMatch(/Jessica Shepard Rebounds over 13\.5 .*needs 7 more in ~16 min = 0\.44\/min vs 0\.44\/min tonight \(16 min\), 0\.34\/min pre-game → COMPUTED 34% — TONIGHT'S RATE ALREADY COVERS IT/);
    expect(lines[2]).toMatch(/Arike Ogunbowale .*COMPUTED 7% — NEEDS A REVERSION — do not buy/);
    expect(projectionLines([])).toBe("");
    expect(projectionLines([row("x", "over", 1.5, 0.5, { needed: 1, needPerMinute: 0.1, ratePerMinuteTonight: 0.2, ratePerMinuteBlended: 0.2 })], "pt")).toMatch(/RITMO DE HOJE JÁ COBRE/);
  });

  it("puts the projections block into the live context with its instruction", () => {
    const snap = parseLiveSnapshot(summary(47, 43), "g", "basketball", 10);
    const text = liveContext(snap, { leaders: "", trackerText: "", projections: "- line one" });
    expect(text).toMatch(/REMAINING-GAME PROJECTIONS — computed per line/);
    expect(text).toContain("- line one");
    expect(text).toMatch(/NEEDS A REVERSION or NEEDS A SLOWDOWN does not go in a ticket/);
    expect(liveContext(snap, { leaders: "", trackerText: "" })).not.toMatch(/REMAINING-GAME PROJECTIONS/);
  });
});
