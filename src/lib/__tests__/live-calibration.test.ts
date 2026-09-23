import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  bootstrapGap, brierSkill, calibrationBuckets, calibrationSlice, expectedWinsInterval,
  liveCalibration, liveCalibrationMinLegs, poissonBinomial, ticketProbabilityExVoid, uniqueLegs, wilson,
} from "@/lib/ledger/live-calibration";
import { proofStats } from "@/lib/ledger/proof";
import { parseLiveSnapshot } from "@/lib/live/snapshot";
import { blendedLadder } from "@/lib/props/candidates";
import { projectLeg } from "@/lib/props/model";
import type { LedgerEntry, SettledLeg } from "@/lib/types";

/**
 * The honest reading of a live read, and the two bugs that had to be fixed before it could be
 * published: a clock that fell back to zero and stamped 59 legs as certainties, and a "return"
 * computed off a pre-game price nobody was still offering.
 *
 * The last test freezes the numbers of 22/09/2026 from the production ledger itself: expected 156.8
 * wins on the legs, 131 happened. If this file ever goes green with a different number, either the
 * fixture or the measure moved.
 */

const REAL: LedgerEntry[] = fs
  .readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures/ledger-live-20260922.jsonl"), "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as LedgerEntry);

const leg = (outcome: SettledLeg["outcome"], p?: number, selection = "s"): SettledLeg => ({
  selection, market: "player_prop", sourceBasis: "measured history", predictedProbability: p ?? 0.6,
  ...(p === undefined ? {} : { computedProbability: p }), oddsDecimal: 1.8, outcome,
});
const entry = (id: string, outcome: LedgerEntry["outcome"], legs: SettledLeg[], over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id, gameId: "g1", sportKey: "wnba", matchup: "A @ B", createdAt: "2026-09-22T03:00:00.000Z",
  startsAt: "2026-09-22T03:00:00.000Z", settledAt: "2026-09-22T05:00:00.000Z",
  bandKey: "mid", kind: legs.length > 1 ? "parlay" : "single", title: id, combinedDecimal: 3,
  modelledProbability: 0.5, scope: "live", minute: 20, period: 2, outcome, legs, ...over,
});

describe("the expected-wins band", () => {
  // 1. Exact, deterministic, no seed: a simulated band would move between runs.
  it("is the exact Poisson-binomial, not a simulation", () => {
    expect(poissonBinomial([0.5, 0.5])).toEqual([0.25, 0.5, 0.25]);
    const two = expectedWinsInterval([0.5, 0.5]);
    expect(two.expected).toBeCloseTo(1, 12);
    const hundred = expectedWinsInterval(new Array(100).fill(0.9));
    expect(hundred.expected).toBeCloseTo(90, 9);
    expect([hundred.lo, hundred.hi]).toEqual([84, 95]);
    // Same input, same answer, every time.
    expect(expectedWinsInterval(new Array(100).fill(0.9))).toEqual(hundred);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 0 });
    expect(wilson(24, 48).lo).toBeCloseTo(0.3639, 4);
    expect(wilson(24, 48).hi).toBeCloseTo(0.6361, 4);
  });
});

describe("what the measure says about a model", () => {
  // 2. A model that is right about everything sits on zero and scores skill above zero.
  it("reads zero on a perfectly calibrated sample, and the skill is positive", () => {
    const rows: { p: number; won: boolean }[] = [];
    for (const p of [0.2, 0.4, 0.6, 0.8]) {
      for (let i = 0; i < 250; i += 1) rows.push({ p, won: i < 250 * p });
    }
    const s = calibrationSlice("k", "l", rows);
    expect(s.n).toBe(1000);
    expect(s.gapPoints).toBeCloseTo(0, 9);
    expect(s.verdict).toBe("dentro");
    expect(s.skill).toBeGreaterThan(0);
    expect(Math.abs(s.z)).toBeLessThan(1e-9);
  });

  // 3. A model that promises 95 and delivers 80 is caught, and by how much.
  it("catches an overconfident model and says by how many points", () => {
    const rows = new Array(100).fill(0).map((_, i) => ({ p: 0.95, won: i < 80 }));
    const s = calibrationSlice("k", "l", rows);
    expect(s.verdict).toBe("abaixo");
    expect(s.z).toBeLessThan(-2);
    expect(s.gapPoints).toBeCloseTo(-15, 9);
    expect(s.expectedWins).toBeCloseTo(95, 9);
  });

  // 4. The test that stops the ruler becoming a compliment: stamping the base rate scores zero.
  it("gives a model that stamps the base rate on everything a skill of exactly zero", () => {
    const rows = new Array(200).fill(0).map((_, i) => ({ p: 0.6, won: i < 120 }));
    const { brier, baseline, skill } = brierSkill(rows);
    expect(brier).toBeCloseTo(baseline, 12);
    expect(skill).toBeCloseTo(0, 12);
    // And a buckets table alone would have called it well calibrated.
    expect(calibrationBuckets(rows)).toHaveLength(1);
    expect(calibrationBuckets(rows)[0].gap).toBeCloseTo(0, 12);
  });
});

describe("what goes into the count and what stays out", () => {
  // 5. A leg with no computed chance leaves the arithmetic and is published in `coverage`.
  it("drops a leg with no computed chance and reports it in the coverage", () => {
    const rows = [
      entry("a", "won", [leg("won", 0.8, "x"), leg("won", undefined, "y")]),
      entry("b", "lost", [leg("lost", 0.7, "z")], { minute: 30 }),
    ];
    const c = liveCalibration(rows, { minLegs: 1 });
    expect(c.legs.n).toBe(2);
    expect(c.coverage).toMatchObject({ legsDecided: 3, withComputed: 2, voided: 0, games: 1 });
    expect(c.coverage.legsDecided - c.coverage.withComputed).toBe(1);
    expect(c.legs.expectedWins).toBeCloseTo(1.5, 9);
    // Never substituted by predictedProbability: that is the language model's number.
    expect(c.legs.predictedAverage).toBeCloseTo(0.75, 9);
  });

  // 6. A voided leg never had a chance of anything: the ticket is re-priced on the survivors.
  it("re-prices a ticket over its surviving legs, and drops one that lost them all", () => {
    const three = entry("t3", "lost", [leg("won", 0.8, "a"), leg("lost", 0.5, "b"), leg("void", 0.4, "c")], { modelledProbability: 0.8 * 0.5 * 0.4 });
    expect(ticketProbabilityExVoid(three)).toBeCloseTo(0.4, 9);
    const allVoid = entry("t0", "void", [leg("void", 0.5, "a"), leg("void", 0.5, "b")]);
    expect(ticketProbabilityExVoid(allVoid)).toBeNull();
    const single = entry("t1", "won", [leg("won", 0.6, "a")], { modelledProbability: 0.6 });
    expect(ticketProbabilityExVoid(single)).toBeCloseTo(0.6, 9);
    // Only the survivors reach the sample; the void ticket is not in it.
    const c = liveCalibration([three, allVoid, single], { minLegs: 1 });
    expect(c.tickets.n).toBe(2);
    expect(c.tickets.expectedWins).toBeCloseTo(1, 9);
    expect(c.coverage.voided).toBe(3);
  });

  // 7. Tickets of one game are not independent, and the published band has to know it.
  it("widens the band when the rows cluster inside a few games", () => {
    // Twelve rows, all at the same chance, six wins — but the wins go with the game.
    const rows: { gameId: string; p: number; won: boolean }[] = [];
    for (let g = 0; g < 4; g += 1) {
      for (let i = 0; i < 3; i += 1) rows.push({ gameId: `g${g}`, p: 0.5, won: g < 2 });
    }
    const clustered = bootstrapGap(rows);
    const independent = bootstrapGap(rows.map((r, i) => ({ ...r, gameId: `own${i}` })));
    const pb = expectedWinsInterval(rows.map((r) => r.p));
    const pbWidth = ((pb.hi - pb.lo) / rows.length) * 100;
    expect(clustered.hi - clustered.lo).toBeGreaterThan(pbWidth);
    expect(clustered.hi - clustered.lo).toBeGreaterThan(independent.hi - independent.lo);
    // Deterministic: same rows, same seed, same band.
    expect(bootstrapGap(rows)).toEqual(clustered);
  });
});

describe("the money", () => {
  // 8. A live read has no collectable price, so it has no units, no return and no ROI.
  it("keeps the live reads out of every unit, return and ROI", () => {
    const pre = entry("pre", "won", [leg("won", 0.5)], { scope: undefined, minute: undefined, period: undefined, combinedDecimal: 2 });
    const live = entry("live", "won", [leg("won", 0.9)], { combinedDecimal: 30 });
    const s = proofStats([pre, live]);
    expect(s.unitsStaked).toBe(1);
    expect(s.unitsReturned).toBeCloseTo(2, 9);
    expect(s.roi).toBeCloseTo(1, 9);
    expect(s.byScope.find((r) => r.key === "live")).toEqual({ key: "live", settled: 1, won: 1 });
    expect(s.byScope.find((r) => r.key === "pregame")).toMatchObject({ settled: 1, won: 1, roi: 1 });
    expect(s.byBand.reduce((a, b) => a + b.settled, 0)).toBe(1);
    expect(s.byDay[0].unitsReturned).toBeCloseTo(2, 9);
    expect(s.byDay[0].live).toMatchObject({ settled: 1, won: 1 });
    expect(s.liveCalibration.tickets.n).toBe(1);
  });
});

describe("the clock", () => {
  // 10. The bug that made the whole thing necessary: an unreadable clock read as zero.
  it("reads M:SS and refuses to call a missing clock zero", () => {
    const summary = (status: Record<string, unknown>) => ({
      header: { competitions: [{ status: { period: 4, type: { state: "in" }, ...status }, competitors: [
        { homeAway: "home", score: "80", team: { abbreviation: "NY" } },
        { homeAway: "away", score: "77", team: { abbreviation: "ATL" } },
      ] }] },
    });
    const mmss = parseLiveSnapshot(summary({ clock: "5:23" }), "g", "basketball", 10);
    expect(mmss.clockLeft).toBe(5.4);
    expect(mmss.minute).toBe(34.6);
    expect(mmss.clockUnknown).toBe(false);
    // The display clock is read when `clock` is not a number.
    expect(parseLiveSnapshot(summary({ clock: null, displayClock: "5:23" }), "g", "basketball", 10).clockLeft).toBe(5.4);
    // Seconds, the usual shape.
    expect(parseLiveSnapshot(summary({ clock: 323 }), "g", "basketball", 10).clockLeft).toBe(5.4);
    // Neither: unknown, and NOT minute 40 with nothing left.
    const blind = parseLiveSnapshot(summary({}), "g", "basketball", 10);
    expect(blind.clockUnknown).toBe(true);
    expect(blind.clockLeft).toBeNull();
    expect(blind.minute).not.toBe(40);
    // A finished game has no clock to read and does not need one.
    const done = parseLiveSnapshot(summary({ type: { state: "post" } }), "g", "basketball", 10);
    expect(done.clockUnknown).toBe(false);
    expect(done.minute).toBe(40);
  });

  // 11. And the consequence of that bug: a chance of exactly 1.000 in the ledger.
  it("never lets the in-play path publish a chance above 0,995", () => {
    // A remainder with no minutes left: the under is home and the raw distribution says so.
    const raw = projectLeg({ rate: 0.6, dispersion: 0.1 }, { expected: 0, sd: 0, max: 0 }, 23.5, "under", { current: 10, maxMinutes: 0 });
    expect(raw.computed).toBe(1);
    const clamped = blendedLadder(raw.ladder, () => null, false);
    for (const rung of clamped) {
      expect(rung.pOver).toBeLessThanOrEqual(0.995);
      expect(rung.pUnder).toBeLessThanOrEqual(0.995);
      expect(rung.pOver).toBeGreaterThanOrEqual(0.005);
      expect(rung.pOver + rung.pUnder).toBeCloseTo(1, 9);
    }
    expect(Math.max(...clamped.map((r) => r.pUnder))).toBeCloseTo(0.995, 9);
  });
});

describe("the real ledger of 22/09/2026", () => {
  // 12. The numbers of the document, frozen against the production rows.
  it("says the live reads landed far below the chance they gave themselves", () => {
    const c = liveCalibration(REAL, { minLegs: 1 });
    expect(c.legs.n).toBe(168);
    expect(c.legs.won).toBe(131);
    expect(c.legs.expectedWins).toBeCloseTo(156.8, 1);
    expect(c.legs.verdict).toBe("abaixo");
    expect(c.legs.z).toBeLessThan(-8);
    expect(c.legs.gapPoints).toBeCloseTo(-15.4, 1);
    // The skill score: the computed chances are worth LESS than stamping the sample's average.
    expect(c.legs.skill).toBeLessThan(0);

    // The tickets, main only, are the headline of the page and of the mail.
    expect(c.tickets.n).toBe(48);
    expect(c.tickets.won).toBe(24);
    expect(c.tickets.expectedWins).toBeCloseTo(36.5, 1);
    expect([c.tickets.lo, c.tickets.hi]).toEqual([31, 41]);
    expect(c.tickets.gapPoints).toBeCloseTo(-26.1, 1);
    expect(c.tickets.verdict).toBe("abaixo");
    // The fair-price return is a diagnostic and it agrees; it is never printed as money.
    expect(c.tickets.fairUnits).toBeCloseTo(-0.237, 2);

    // Four games, not forty-eight tickets: the real sample of that night.
    expect(c.coverage.games).toBe(4);
    expect(c.coverage.withComputed).toBe(168);

    // Every quarter with enough legs, and the third — the one the old "+938% ROI" came from — is
    // the only one the model nearly got right.
    const q = Object.fromEntries(c.byPeriod.map((s) => [s.key, s]));
    expect(q.q1).toBeUndefined();
    expect(q.q3.gapPoints).toBeCloseTo(-4, 1);
    expect(q.q2.gapPoints).toBeCloseTo(-19.5, 1);
    expect(q.q4.gapPoints).toBeCloseTo(-21.6, 1);

    // The overstatement lives above 80%, which is where the live reads live.
    const high = c.buckets.filter((b) => b.from >= 0.8);
    expect(high.every((b) => b.gap < 0)).toBe(true);
  });

  it("holds its tongue below the sample gate", () => {
    expect(liveCalibrationMinLegs({})).toBe(100);
    expect(liveCalibrationMinLegs({ LIVE_CALIBRATION_MIN_LEGS: "1" })).toBe(1);
    expect(liveCalibration(REAL, { minLegs: 1 }).publishable).toBe(true);
    expect(liveCalibration(REAL, { minLegs: 500 }).publishable).toBe(false);
    // One read, taken twice on the same line, is one call — not two.
    const dup = uniqueLegs([entry("a", "won", [leg("won", 0.9, "x")]), entry("b", "won", [leg("won", 0.9, "x")])]);
    expect(dup.rows).toHaveLength(1);
  });
});
