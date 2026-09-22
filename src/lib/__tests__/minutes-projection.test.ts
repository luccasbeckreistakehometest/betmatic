import { describe, expect, it } from "vitest";
import { listingAvailability, minutesPrompt, projectMinutes, projectRemainingMinutes, QUESTIONABLE_HAIRCUT, REMAINING_SD_SCALE } from "@/lib/props/minutes";

const steady = (n: number, m: number) => Array.from({ length: n }, () => m);

describe("minutes projection before tip-off", () => {
  it("needs three real games and ignores cameos in the mean", () => {
    expect(projectMinutes({ player: "x", minutes: [30, 2], regulationMinutes: 40 })).toBeNull();
    const p = projectMinutes({ player: "x", minutes: [31, 2, 30, 1, 32, 29], regulationMinutes: 40 })!;
    expect(p.baseline.games).toBe(4);
    expect(p.expected).toBeGreaterThan(29);
    expect(p.expected).toBeLessThan(32);
    // Cameos widen the spread rather than pulling the mean down.
    const clean = projectMinutes({ player: "x", minutes: [31, 30, 32, 29], regulationMinutes: 40 })!;
    expect(p.sd).toBeGreaterThan(clean.sd);
  });

  it("nudges toward the last five when the role just changed, and says so", () => {
    const promoted = projectMinutes({ player: "x", minutes: [...steady(5, 30), ...steady(20, 18)], regulationMinutes: 40 })!;
    expect(promoted.adjustments.find((a) => a.kind === "trend")!.minutes).toBeGreaterThan(0);
    expect(promoted.expected).toBeGreaterThan(24);
    const demoted = projectMinutes({ player: "x", minutes: [...steady(5, 18), ...steady(20, 30)], regulationMinutes: 40 })!;
    expect(demoted.adjustments.find((a) => a.kind === "trend")!.minutes).toBeLessThan(0);
  });

  it("a big spread takes minutes off a starter and adds spread; a bench player is untouched", () => {
    const flat = projectMinutes({ player: "s", minutes: steady(20, 32), regulationMinutes: 40, expectedMargin: 0 })!;
    const blowout = projectMinutes({ player: "s", minutes: steady(20, 32), regulationMinutes: 40, expectedMargin: 14 })!;
    expect(blowout.blowoutProbability).toBeGreaterThan(flat.blowoutProbability);
    expect(blowout.expected).toBeLessThan(flat.expected);
    expect(blowout.sd).toBeGreaterThan(flat.sd);
    expect(blowout.adjustments.some((a) => a.kind === "blowout")).toBe(true);
    const bench = projectMinutes({ player: "b", minutes: steady(20, 14), regulationMinutes: 40, expectedMargin: 14 })!;
    expect(bench.adjustments.some((a) => a.kind === "blowout")).toBe(false);
  });

  it("frees minutes for a measured absence, a modest labelled nudge for an unmeasured one, and none for a season-long one", () => {
    const base = { player: "x", minutes: steady(20, 26), regulationMinutes: 40 };
    const measured = projectMinutes({ ...base, absentTeammates: [{ name: "Star", status: "Out", minutesPerGame: 30, without: { games: 6, meanMinutes: 32, withGames: 14, withMinutes: 25 } }] })!;
    expect(measured.expected).toBeCloseTo(26 + 3.5, 1);
    expect(measured.adjustments[0].note).toMatch(/Star out: 32 min in the 6 games without her vs 25 in 14 with/);
    const unmeasured = projectMinutes({ ...base, absentTeammates: [{ name: "Star", status: "Out", minutesPerGame: null, without: null }] })!;
    expect(unmeasured.expected).toBeCloseTo(26.8, 1);
    expect(unmeasured.adjustments[0].note).toMatch(/share unmeasured/);
    const deepBench = projectMinutes({ ...base, absentTeammates: [{ name: "Twelfth", status: "Out", minutesPerGame: 6, without: null }] })!;
    expect(deepBench.adjustments).toEqual([]);
    // A teammate already missing from the last five games is in the recent minutes already: no second count.
    const stale = projectMinutes({ ...base, absentTeammates: [{ name: "Star", status: "Out", minutesPerGame: 30, without: { games: 6, meanMinutes: 32, withGames: 14, withMinutes: 25, recentMissed: 5 } }] })!;
    expect(stale.expected).toBeCloseTo(26, 1);
    expect(stale.adjustments[0].note).toMatch(/already in the last five/);
    const notOut = projectMinutes({ ...base, absentTeammates: [{ name: "Star", status: "Day-To-Day", minutesPerGame: 30, without: null }] })!;
    expect(notOut.adjustments).toEqual([]);
  });

  it("flags the player's own listing without inventing a number", () => {
    const out = projectMinutes({ player: "x", minutes: steady(10, 30), regulationMinutes: 40, listing: { status: "Out", updatedAt: "2026-09-21T00:13Z" } })!;
    expect(out.availability).toBe("listed_out");
    expect(out.expected).toBeCloseTo(30, 0);
    expect(out.adjustments.find((a) => a.kind === "listing")!.note).toMatch(/confirm before any leg/);
    const gtd = projectMinutes({ player: "x", minutes: steady(10, 30), regulationMinutes: 40, listing: { status: "Questionable" } })!;
    expect(gtd.availability).toBe("questionable");
    expect(gtd.sd).toBeGreaterThan(out.sd);
    // A questionable listing costs a modest, stated haircut as well as the wider spread.
    expect(gtd.expected).toBeCloseTo(30 - QUESTIONABLE_HAIRCUT, 1);
    expect(gtd.adjustments.find((a) => a.kind === "listing")!.note).toMatch(/1\.5 min off for a possible cap/);
    expect(listingAvailability("Day-To-Day")).toBe("questionable");
    expect(listingAvailability("Injured Reserve")).toBe("listed_out");
    expect(listingAvailability(undefined)).toBe("ok");
  });
});

describe("remaining minutes in play", () => {
  const pre = projectMinutes({ player: "x", minutes: steady(20, 32), regulationMinutes: 40 });

  it("blends tonight's share of the clock with the pre-game share, weighting tonight more as the game goes", () => {
    const early = projectRemainingMinutes({ player: "x", preGame: pre, minutesPlayed: 5, minutesElapsed: 10, minutesLeft: 30, regulationMinutes: 40, fouls: 0, currentMargin: 0 });
    const late = projectRemainingMinutes({ player: "x", preGame: pre, minutesPlayed: 15, minutesElapsed: 30, minutesLeft: 10, regulationMinutes: 40, fouls: 0, currentMargin: 0 });
    // Same 50% share tonight; the pre-game 80% share matters more early than late.
    expect(early.expected / 30).toBeGreaterThan(late.expected / 10);
    expect(early.adjustments[0].note).toMatch(/on court 50% of the clock tonight vs 80% pre-game/);
  });

  it("uses tonight alone without a pre-game projection and never exceeds the minutes left", () => {
    const r = projectRemainingMinutes({ player: "x", preGame: null, minutesPlayed: 20, minutesElapsed: 20, minutesLeft: 20, regulationMinutes: 40, fouls: 0, currentMargin: 0 });
    expect(r.expected).toBeLessThanOrEqual(20);
    expect(r.expected).toBeGreaterThan(18);
    const end = projectRemainingMinutes({ player: "x", preGame: pre, minutesPlayed: 35, minutesElapsed: 40, minutesLeft: 0, regulationMinutes: 40, fouls: 0, currentMargin: 0 });
    expect(end.expected).toBe(0);
    expect(end.sd).toBe(0);
  });

  it("narrows its spread with the clock instead of holding a fixed floor", () => {
    const at = (left: number) => projectRemainingMinutes({ player: "x", preGame: pre, minutesPlayed: 40 - left - 2, minutesElapsed: 40 - left, minutesLeft: left, regulationMinutes: 40, fouls: 0, currentMargin: 2, expectedMargin: 0 });
    expect(at(20).sd).toBeGreaterThanOrEqual(1.5);
    expect(at(2).sd).toBeLessThanOrEqual(0.5);
    expect(at(0.5).sd).toBeLessThanOrEqual(0.15);
    for (const left of [20, 10, 5, 2, 1]) expect(at(left).expected).toBeLessThanOrEqual(left);
    // The width multiplier is the production constant unless a research run sweeps it.
    const args = { player: "x", preGame: pre, minutesPlayed: 18, minutesElapsed: 20, minutesLeft: 20, regulationMinutes: 40, fouls: 0, currentMargin: 2, expectedMargin: 0 };
    const wide = projectRemainingMinutes({ ...args, sdScale: REMAINING_SD_SCALE * 2 });
    expect(wide.sd).toBeCloseTo(projectRemainingMinutes(args).sd * 2, 1);
    // The clock travels with the estimate, so a direct caller of projectLeg is capped too.
    expect(at(2).max).toBe(2);
  });

  it("prints the block with every input the model is asked to read", () => {
    const text = minutesPrompt([projectMinutes({ player: "Ana", minutes: [...steady(5, 30), ...steady(20, 18)], regulationMinutes: 40, expectedMargin: 12, listing: { status: "Questionable" } })!]);
    expect(text).toMatch(/MINUTES PROJECTION/);
    expect(text).toMatch(/Ana: \d+(\.\d)? ± \d+(\.\d)? min ⚠ questionable/);
    expect(text).toMatch(/trend: \+/);
    expect(text).toMatch(/blowout risk \d+%/);
    expect(minutesPrompt([])).toMatch(/not computed/);
  });
});
