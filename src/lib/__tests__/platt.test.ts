import { describe, expect, it } from "vitest";
import { MAX_SLOPE, MIN_SPREAD, applyFit, fitPlatt, shrinkFit, type PlattPoint } from "@/lib/ledger/platt";
import { MAX_SHIFT, PRIOR_STRENGTH, buildCalibrator, correctionOf } from "@/lib/ledger/recalibrate";
import type { CalibrationReport, CalibrationRow } from "@/lib/types";

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** A deterministic stream, so a test that passes passes every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Legs whose truth is `σ(trueSlope · logit(claim))`: the shape the ledger measured on 24/09/2026,
 * where the error GROWS with the claim. With trueSlope = 0.5 a claim of 85% really lands ~66% and a
 * claim of 62% really lands ~55% — one shift cannot fix both.
 */
function skewedSlice(n: number, trueSlope: number, seed = 7): PlattPoint[] {
  const next = rng(seed);
  const points: PlattPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    // Claims spread across the band the product actually serves.
    const predicted = 0.5 + 0.45 * (i / (n - 1));
    const truth = sigmoid(trueSlope * logit(predicted));
    points.push({ predicted, won: next() < truth ? 1 : 0 });
  }
  return points;
}

const brier = (points: PlattPoint[], map: (p: number) => number) =>
  points.reduce((acc, p) => acc + (map(p.predicted) - p.won) ** 2, 0) / points.length;

describe("fitPlatt", () => {
  it("recovers a slope below 1 when the error grows with the claim", () => {
    const fit = fitPlatt(skewedSlice(400, 0.5));
    expect(fit.interceptOnly).toBe(false);
    expect(fit.slope).toBeLessThan(0.8);
    expect(fit.slope).toBeGreaterThan(0.2);
  });

  it("leaves an honest slice alone: slope near 1, intercept near 0", () => {
    const fit = fitPlatt(skewedSlice(600, 1));
    expect(Math.abs(fit.slope - 1)).toBeLessThan(0.25);
    expect(Math.abs(fit.intercept)).toBeLessThan(0.3);
  });

  it("beats the single shift on the shape the ledger actually measured", () => {
    // The old correction: one shift, fitted at the slice's mean claim, exactly as the shipped code
    // computed it — logit(delivered) − logit(claimed) over the whole slice.
    const points = skewedSlice(400, 0.5);
    const claimed = points.reduce((a, p) => a + p.predicted, 0) / points.length;
    const delivered = points.reduce((a, p) => a + p.won, 0) / points.length;
    const shift = logit(delivered) - logit(claimed);

    const fit = fitPlatt(points);
    const withSlope = brier(points, (p) => applyFit(fit, p));
    const withShift = brier(points, (p) => sigmoid(logit(p) + shift));
    const uncorrected = brier(points, (p) => p);

    // Both corrections help; the one with a slope helps more, which is the whole point of the change.
    expect(withShift).toBeLessThan(uncorrected);
    expect(withSlope).toBeLessThan(withShift);
  });

  it("corrects hardest where the model was most confident", () => {
    // The failure the single shift has: it moves every leg by the same amount, so a claim of 90% and
    // a claim of 55% are penalised equally even though only one of them was badly wrong.
    const fit = fitPlatt(skewedSlice(400, 0.5));
    const dropAt = (p: number) => p - applyFit(fit, p);
    expect(dropAt(0.9)).toBeGreaterThan(dropAt(0.6));
  });

  it("keeps the model's ordering: a leg it liked more still comes out higher", () => {
    const fit = fitPlatt(skewedSlice(300, 0.4));
    const ladder = [0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95].map((p) => applyFit(fit, p));
    for (let i = 1; i < ladder.length; i += 1) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
  });

  it("holds the slope at 1 when every leg claimed about the same number", () => {
    // No spread means no information about how the error grows, so the slope is not identifiable and
    // the fit must fall back to the shift the old code computed rather than read noise.
    const next = rng(3);
    const points: PlattPoint[] = Array.from({ length: 200 }, () => ({
      predicted: 0.7,
      won: next() < 0.5 ? 1 : 0,
    }));
    const fit = fitPlatt(points);
    expect(fit.spread).toBeLessThan(MIN_SPREAD);
    expect(fit.interceptOnly).toBe(true);
    expect(fit.slope).toBe(1);
    // It still corrects: 50% delivered against 70% claimed has to come down.
    expect(applyFit(fit, 0.7)).toBeLessThan(0.6);
  });

  it("stays finite when the claims separate the outcomes perfectly", () => {
    // Unregularised logistic regression sends the slope to infinity here. A thin betting slice
    // reaches this easily, so the ridge has to hold.
    const points: PlattPoint[] = Array.from({ length: 60 }, (_, i) => {
      const predicted = 0.5 + 0.45 * (i / 59);
      return { predicted, won: (predicted > 0.72 ? 1 : 0) as 0 | 1 };
    });
    const fit = fitPlatt(points);
    expect(Number.isFinite(fit.slope)).toBe(true);
    expect(fit.slope).toBeLessThanOrEqual(MAX_SLOPE);
  });

  it("returns the identity for an empty slice", () => {
    expect(fitPlatt([])).toMatchObject({ slope: 1, intercept: 0, n: 0 });
  });
});

describe("shrinkFit", () => {
  it("moves a thin slice a third of the way and a fat one most of it", () => {
    const raw = { slope: 0.5, intercept: -0.6, n: 20, spread: 1, interceptOnly: false };
    const thin = shrinkFit(raw, PRIOR_STRENGTH, MAX_SHIFT);
    const fat = shrinkFit({ ...raw, n: 400 }, PRIOR_STRENGTH, MAX_SHIFT);
    // 20/(20+40) = 1/3 of the distance from 1 to 0.5
    expect(thin.slope).toBeCloseTo(1 - (1 / 3) * 0.5, 6);
    expect(fat.slope).toBeLessThan(thin.slope);
    expect(fat.slope).toBeGreaterThan(0.5);
  });

  it("never lets the intercept exceed the standing bound", () => {
    const wild = shrinkFit({ slope: 1, intercept: -50, n: 10_000, spread: 1, interceptOnly: true }, PRIOR_STRENGTH, MAX_SHIFT);
    expect(wild.intercept).toBe(-MAX_SHIFT);
  });
});

describe("correctionOf", () => {
  const row = (over: Partial<CalibrationRow> = {}): CalibrationRow => ({
    key: "k", label: "uma fatia", settled: 200, won: 100, hitRate: 0.5, averagePredicted: 0.8,
    calibrationError: 0.3, ...over,
  });

  it("reproduces the old shift for a row that carries no fit", () => {
    // Stored reports and hand-built fixtures predate the slope: they must keep getting exactly the
    // correction they always got, or a replay of the record would silently change.
    const c = correctionOf(row())!;
    const expected = (logit(0.5) - logit(0.8)) * (200 / (200 + PRIOR_STRENGTH));
    expect(c.fit.slope).toBe(1);
    expect(c.shift).toBeCloseTo(expected, 6);
  });

  it("says nothing on a sample below the floor", () => {
    expect(correctionOf(row({ settled: 19 }))).toBeNull();
  });

  it("uses the fitted slope when the row carries one", () => {
    const c = correctionOf(row({ fit: { slope: 0.4, intercept: -0.2, spread: 1.2, interceptOnly: false } }))!;
    expect(c.fit.slope).toBeLessThan(1);
    expect(c.fit.slope).toBeGreaterThan(0.4);
  });
});

describe("buildCalibrator", () => {
  const report = (rows: Partial<CalibrationRow>[]): CalibrationReport => ({
    totalSettled: 500, bySource: [], byMarket: [], bySport: [], bySide: [], generatedAt: "",
    byStat: rows.map((r, i) => ({
      key: r.key ?? `stat${i}`, label: r.label ?? `stat${i}`, settled: 200, won: 100, hitRate: 0.5,
      averagePredicted: 0.8, calibrationError: 0.3, ...r,
    })),
  });

  it("pulls a confident claim down harder than a middling one on a sloped slice", () => {
    const cal = buildCalibrator(report([{ key: "PTS", fit: { slope: 0.45, intercept: 0, spread: 1.3, interceptOnly: false } }]));
    const high = cal.apply(0.9, "measured history", "player prop", "PTS");
    const mid = cal.apply(0.6, "measured history", "player prop", "PTS");
    expect(0.9 - high.probability).toBeGreaterThan(0.6 - mid.probability);
    expect(high.probability).toBeLessThan(0.9);
  });

  it("says in words that the slice got worse as the number rose", () => {
    const cal = buildCalibrator(report([{ key: "PTS", label: "PTS", fit: { slope: 0.4, intercept: 0, spread: 1.3, interceptOnly: false } }]));
    cal.apply(0.85, "measured history", "player prop", "PTS");
    expect(cal.describe()).toContain("errou mais quanto mais alto o número");
  });

  it("widestOnly ignores the per-stat slice and corrects on the wide one", () => {
    // The live measurement said a 75-leg stat slice must not overrule a 456-leg market slice. Here
    // the stat slice would push the number UP and the wide one pulls it DOWN; widestOnly decides.
    const full: CalibrationReport = {
      totalSettled: 500, bySource: [], bySport: [], bySide: [], generatedAt: "",
      byStat: [{ key: "rebounds", label: "rebounds", settled: 75, won: 70, hitRate: 0.93, averagePredicted: 0.83, calibrationError: -0.1, fit: { slope: 1.5, intercept: 0.8, spread: 1.1, interceptOnly: false } }],
      byMarket: [{ key: "player prop", label: "player prop", settled: 456, won: 331, hitRate: 0.73, averagePredicted: 0.86, calibrationError: 0.13, fit: { slope: 0.31, intercept: -0.2, spread: 1.4, interceptOnly: false } }],
    };
    const narrowFirst = buildCalibrator(full).apply(0.9, "measured history", "player prop", "rebounds");
    const widest = buildCalibrator(full, { widestOnly: true }).apply(0.9, "measured history", "player prop", "rebounds");
    expect(narrowFirst.correction?.label).toBe("rebounds");
    expect(widest.correction?.label).toBe("player prop");
    // And the decision matters: one raises the claim, the other cuts it.
    expect(narrowFirst.probability).toBeGreaterThan(0.9);
    expect(widest.probability).toBeLessThan(0.9);
  });

  it("leaves a leg alone when no slice has a sample", () => {
    const cal = buildCalibrator(report([{ settled: 5 }]));
    const out = cal.apply(0.77, "gut", "player prop", "PTS");
    expect(out.probability).toBeCloseTo(0.77, 6);
    expect(out.correction).toBeNull();
    expect(cal.describe()).toBe("");
  });
});
