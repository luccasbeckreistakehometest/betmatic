import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blendedProbability, fitRate, liveRate, minutesAdjustedHitRate, nbAtLeast, nbExactly, projectLeg, seriesFor, MODEL_WEIGHT } from "@/lib/props/model";
import { projectMinutes, projectRemainingMinutes } from "@/lib/props/minutes";
import { measureProp } from "@/lib/props/history";
import type { PlayerHistory } from "@/lib/types";

/**
 * The per-leg model against the night that taught it. The fixture holds the 2026 WNBA game logs of
 * the players in the 21/09/2026 tickets, cut before that night's games; the numbers pinned here are
 * what the model would have printed before tip-off and at half-time (box score rebuilt from the
 * play-by-play). Finals: Ogunbowale 7 pts / 1 reb / 2 ast in 31 min; Thomas 11 reb in 32; Shepard
 * 19 reb in 36.
 */
const LOGS = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures/wnba-gamelogs-20260921.json"), "utf8")) as Record<string, PlayerHistory>;
const log = (name: string) => Object.values(LOGS).find((h) => h.player === name)!;
const minutesOf = (h: PlayerHistory) => h.games.map((g) => Number(g.stats.MIN)).filter(Number.isFinite);
const REG = 40;
const SPREAD = 5.5; // Dallas -5.5, so the home handicap is +5.5

describe("negative binomial tail", () => {
  it("is the Poisson tail at zero dispersion and fatter above it", () => {
    // Poisson(5): P(X >= 8) = 0.1334
    expect(nbAtLeast(8, 5, 0.005)).toBeCloseTo(0.1334, 2);
    expect(nbAtLeast(8, 5, 0.3)).toBeGreaterThan(0.1334);
    expect(nbAtLeast(0, 5, 0.1)).toBe(1);
    expect(nbAtLeast(3, 0, 0.1)).toBe(0);
    // pmf sums to one over a wide support
    let sum = 0;
    for (let t = 0; t < 200; t += 1) sum += nbExactly(t, 12, 0.15);
    expect(sum).toBeCloseTo(1, 4);
  });
});

describe("rate fit", () => {
  it("weights the rate by minutes and recency and estimates dispersion by moments", () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({ eventId: String(i), value: 20 + (i % 5) * 2 - 4, minutes: 30 }));
    const fit = fitRate(samples, { statLabels: ["PTS"] })!;
    expect(fit.rate).toBeCloseTo(20 / 30, 2);
    expect(fit.games).toBe(30);
    expect(fit.dispersion).toBeGreaterThan(0);
    expect(fit.shape).toBeCloseTo(1 / fit.dispersion, 6);
  });

  it("ignores cameos and needs three real games", () => {
    expect(fitRate([{ value: 4, minutes: 2 }, { value: 3, minutes: 1 }, { value: 20, minutes: 30 }])).toBeNull();
    const fit = fitRate([{ value: 9, minutes: 3 }, { value: 20, minutes: 30 }, { value: 18, minutes: 30 }, { value: 22, minutes: 30 }])!;
    expect(fit.games).toBe(3);
    expect(fit.rate).toBeCloseTo(60 / 90, 2); // recency weights nudge it by under a thousandth
  });
});

describe("projection of a line", () => {
  const fit = { rate: 0.65, dispersion: 0.1 };
  it("gives a ladder around the posted line with monotone probabilities and no push on a half line", () => {
    const leg = projectLeg(fit, { expected: 30, sd: 4 }, 19.5, "over");
    expect(leg.pOver + leg.pUnder).toBeCloseTo(1, 6);
    expect(leg.pPush).toBe(0);
    expect(leg.mean).toBeCloseTo(19.5, 1);
    expect(leg.ladder.map((r) => r.line)).toEqual([17.5, 18.5, 19.5, 20.5, 21.5]);
    for (let i = 1; i < leg.ladder.length; i += 1) expect(leg.ladder[i].pOver).toBeLessThan(leg.ladder[i - 1].pOver);
    expect(leg.note).toMatch(/0\.65\/min × 30 ± 4 min/);
  });

  it("carries a push on a whole line and splits the rest between the sides", () => {
    const leg = projectLeg(fit, { expected: 30, sd: 0.01 }, 20, "over");
    expect(leg.pPush).toBeGreaterThan(0.03);
    expect(leg.pOver + leg.pUnder).toBeCloseTo(1, 6);
  });

  it("adds what is already on the board in play", () => {
    const before = projectLeg(fit, { expected: 17, sd: 3 }, 19.5, "over");
    const live = projectLeg(fit, { expected: 17, sd: 3 }, 19.5, "over", { current: 12 });
    expect(live.pOver).toBeGreaterThan(before.pOver);
    expect(live.mean).toBeCloseTo(12 + 0.65 * 17, 1);
    expect(live.note).toMatch(/^12 \+ 0\.65\/min/);
  });

  it("a wider minutes spread fattens the tails", () => {
    const tight = projectLeg(fit, { expected: 30, sd: 1 }, 27.5, "over");
    const wide = projectLeg(fit, { expected: 30, sd: 8 }, 27.5, "over");
    expect(wide.pOver).toBeGreaterThan(tight.pOver);
  });
});

describe("live rate posterior", () => {
  it("moves a volatile player toward tonight and a consistent one barely", () => {
    const volatile = liveRate({ rate: 0.6, shape: 4 }, { value: 0, minutes: 18 });
    const steady = liveRate({ rate: 0.6, shape: 40 }, { value: 0, minutes: 18 });
    expect(volatile.rate).toBeLessThan(steady.rate);
    expect(steady.rate).toBeGreaterThan(0.45);
    expect(volatile.dispersion).toBeCloseTo(1 / 4, 6); // no counts seen: shape unchanged
    const hot = liveRate({ rate: 0.6, shape: 10 }, { value: 20, minutes: 18 });
    expect(hot.rate).toBeGreaterThan(0.6);
    expect(hot.dispersion).toBeCloseTo(1 / 30, 6);
    expect(liveRate({ rate: 0.6, shape: 10 }, { value: 0, minutes: 0 }).rate).toBe(0.6);
  });
});

describe("blend with the season hit rate", () => {
  it("leans on the distribution but lets the sample fatten the tails", () => {
    expect(blendedProbability(0.5, 0, 0)).toBe(0.5);
    expect(blendedProbability(0.9, 20, 40)).toBeCloseTo(MODEL_WEIGHT * 0.9 + (1 - MODEL_WEIGHT) * (21 / 42), 6);
    expect(blendedProbability(0.999, 40, 40)).toBeLessThan(0.995);
    expect(blendedProbability(0.001, 0, 40)).toBeGreaterThan(0.005);
  });
});

describe("21/09/2026, Dallas @ Phoenix, before tip-off", () => {
  const project = (name: string, market: string, line: number, side: "over" | "under") => {
    const h = log(name);
    const series = seriesFor(h, market, "wnba");
    const fit = fitRate(series, { statLabels: market === "pa" ? ["PTS", "AST"] : ["REB"] })!;
    const minutes = projectMinutes({ player: name, minutes: minutesOf(h), regulationMinutes: REG, expectedMargin: SPREAD })!;
    const leg = projectLeg(fit, minutes, line, side);
    const measured = measureProp(h, market, line, side, "wnba")!;
    return { fit, minutes, leg, measured, computed: blendedProbability(leg.computed, measured.season.hits, measured.season.of), series };
  };

  it("Ogunbowale over 19.5 points+assists: the 57% hit rate was a memory, the rate over the minutes says about 45%", () => {
    const r = project("Arike Ogunbowale", "pa", 19.5, "over");
    expect(r.measured.impliedFair).toBeCloseTo(24 / 42, 3);
    expect(r.minutes.expected).toBeGreaterThan(26);
    expect(r.minutes.expected).toBeLessThan(32);
    expect(r.leg.mean).toBeLessThan(19.5);
    expect(r.computed).toBeGreaterThan(0.38);
    expect(r.computed).toBeLessThan(0.50);
    expect(minutesAdjustedHitRate(r.series, r.fit, r.minutes.expected, 19.5, "over")).toBeLessThan(r.measured.impliedFair);
  });

  it("Thomas under 8.5 rebounds: the model would still have liked it, at about 70% (she played 32 minutes and took 11)", () => {
    const r = project("Alyssa Thomas", "rebounds", 8.5, "under");
    expect(r.measured.impliedFair).toBeCloseTo(28 / 42, 3);
    expect(r.computed).toBeGreaterThan(0.62);
    expect(r.computed).toBeLessThan(0.78);
    // What it would have taken: her actual 32 minutes at her season rate put the mean near the line.
    const withRealMinutes = projectLeg(r.fit, { expected: 32, sd: 2 }, 8.5, "under");
    expect(withRealMinutes.pUnder).toBeLessThan(r.leg.pUnder);
  });

  it("Shepard over 13.5 rebounds: a 31% hit rate that the distribution prices near 23%, with the rung beside it lower still", () => {
    const r = project("Jessica Shepard", "rebounds", 13.5, "over");
    expect(r.measured.impliedFair).toBeCloseTo(13 / 42, 3);
    expect(r.computed).toBeGreaterThan(0.17);
    expect(r.computed).toBeLessThan(0.30);
    const next = r.leg.ladder.find((x) => x.line === 14.5)!;
    expect(next.pOver).toBeLessThan(r.leg.pOver);
  });
});

describe("21/09/2026, Dallas @ Phoenix, at half-time (47-43 Dallas)", () => {
  // Half-time lines rebuilt from ESPN's play-by-play: Shepard 7 reb in 16.2 min, Ogunbowale 0 reb in 13.7 min, Thomas 5 reb in 16.2 min.
  const half = (name: string, market: string, labels: string[], line: number, side: "over" | "under", tonight: { value: number; minutes: number; fouls: number }) => {
    const h = log(name);
    const fit = fitRate(seriesFor(h, market, "wnba"), { statLabels: labels })!;
    const pre = projectMinutes({ player: name, minutes: minutesOf(h), regulationMinutes: REG, expectedMargin: SPREAD });
    const remaining = projectRemainingMinutes({ player: name, preGame: pre, minutesPlayed: tonight.minutes, minutesElapsed: 20, minutesLeft: 20, regulationMinutes: REG, fouls: tonight.fouls, currentMargin: -4, expectedMargin: SPREAD });
    const posterior = liveRate(fit, tonight);
    return { remaining, posterior, leg: projectLeg({ rate: posterior.rate, dispersion: posterior.dispersion }, remaining, line, side, { current: tonight.value }) };
  };

  it("Shepard over 13.5 rebounds: seven on the board, the rate already produced covers the seven still needed — about a third, up from a quarter pre-game", () => {
    const r = half("Jessica Shepard", "rebounds", ["REB"], 13.5, "over", { value: 7, minutes: 16.2, fouls: 0 });
    expect(r.remaining.expected).toBeGreaterThan(14);
    expect(r.remaining.expected).toBeLessThan(18);
    expect(r.leg.pOver).toBeGreaterThan(0.28);
    expect(r.leg.pOver).toBeLessThan(0.42);
    expect(r.leg.ladder.find((x) => x.line === 14.5)!.pOver).toBeLessThan(r.leg.pOver);
  });

  it("Ogunbowale over 3.5 rebounds after none in the first half is a reversion bet the model prices under 10%", () => {
    const r = half("Arike Ogunbowale", "rebounds", ["REB"], 3.5, "over", { value: 0, minutes: 13.7, fouls: 3 });
    expect(r.posterior.rate).toBeLessThan(0.12);
    expect(r.leg.pOver).toBeLessThan(0.1);
  });

  it("Thomas under 8.5 rebounds with five at half-time needs her to slow down: below even", () => {
    const r = half("Alyssa Thomas", "rebounds", ["REB"], 8.5, "under", { value: 5, minutes: 16.2, fouls: 1 });
    expect(r.leg.pUnder).toBeLessThan(0.5);
    expect(r.leg.pUnder).toBeGreaterThan(0.3);
  });

  it("foul trouble and a decided game both cut the remaining minutes", () => {
    const h = log("Alyssa Thomas");
    const pre = projectMinutes({ player: "Alyssa Thomas", minutes: minutesOf(h), regulationMinutes: REG, expectedMargin: SPREAD });
    const base = projectRemainingMinutes({ player: "x", preGame: pre, minutesPlayed: 16, minutesElapsed: 20, minutesLeft: 20, regulationMinutes: REG, fouls: 1, currentMargin: 2 });
    const fouls = projectRemainingMinutes({ player: "x", preGame: pre, minutesPlayed: 16, minutesElapsed: 20, minutesLeft: 20, regulationMinutes: REG, fouls: 5, currentMargin: 2 });
    const blowout = projectRemainingMinutes({ player: "x", preGame: pre, minutesPlayed: 16, minutesElapsed: 20, minutesLeft: 20, regulationMinutes: REG, fouls: 1, currentMargin: 24 });
    expect(fouls.expected).toBeLessThan(base.expected - 4);
    expect(fouls.adjustments.some((a) => a.kind === "fouls")).toBe(true);
    expect(blowout.expected).toBeLessThan(base.expected - 1.5);
    expect(blowout.adjustments.some((a) => a.kind === "margin")).toBe(true);
    // Late in a decided game the spread of the estimate has narrowed with the clock.
    const late = projectRemainingMinutes({ player: "x", preGame: pre, minutesPlayed: 30, minutesElapsed: 35, minutesLeft: 5, regulationMinutes: REG, fouls: 1, currentMargin: 24 });
    expect(late.sd).toBeLessThan(base.sd);
  });
});
