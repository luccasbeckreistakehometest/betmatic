import { describe, expect, it } from "vitest";
import { buildCalibrator, correctionOf, MIN_SAMPLE, PRIOR_STRENGTH } from "@/lib/ledger/recalibrate";
import type { CalibrationReport, CalibrationRow } from "@/lib/types";

/**
 * The track record has sat in the prompt for weeks, ending with "where a source is measured
 * OVERCONFIDENT, lower your fairProbability". Measured on 23/09/2026 it plainly does not work:
 * player props delivered 45% against 58% claimed, and the live reads promised 93,4% on legs that
 * landed 78,0%. The correction has to be arithmetic, not an instruction.
 */

const row = (over: Partial<CalibrationRow> = {}): CalibrationRow => ({
  key: "player_prop",
  label: "player_prop",
  settled: 100,
  won: 45,
  hitRate: 0.45,
  averagePredicted: 0.58,
  calibrationError: 0.13,
  ...over,
});

const report = (rows: CalibrationRow[]): CalibrationReport => ({
  totalSettled: rows.reduce((a, r) => a + r.settled, 0),
  bySource: [],
  bySide: [],
  byStat: [],
  byMarket: rows,
  bySport: [],
  generatedAt: "2026-09-23T12:00:00.000Z",
});

describe("what a measured slice earns", () => {
  it("pulls an overconfident slice down, and the shift is negative", () => {
    const c = correctionOf(row());
    expect(c).not.toBeNull();
    expect(c!.shift).toBeLessThan(0);
    expect(c!.delivered).toBeCloseTo(0.45, 3);
  });

  it("pushes an underconfident slice up", () => {
    const c = correctionOf(row({ hitRate: 0.7, won: 70, averagePredicted: 0.55, calibrationError: -0.15 }));
    expect(c!.shift).toBeGreaterThan(0);
  });

  it("says nothing at all below the sample gate", () => {
    expect(correctionOf(row({ settled: MIN_SAMPLE - 1 }))).toBeNull();
    expect(correctionOf(undefined)).toBeNull();
  });

  it("moves further the more legs stand behind it", () => {
    const thin = correctionOf(row({ settled: MIN_SAMPLE }))!;
    const thick = correctionOf(row({ settled: 500 }))!;
    expect(Math.abs(thick.shift)).toBeGreaterThan(Math.abs(thin.shift));
    // A slice of exactly PRIOR_STRENGTH legs earns half of what it measured.
    const half = correctionOf(row({ settled: PRIOR_STRENGTH }))!;
    const full = correctionOf(row({ settled: 10_000 }))!;
    expect(Math.abs(half.shift)).toBeCloseTo(Math.abs(full.shift) / 2, 1);
  });
});

describe("the corrected chance a ticket is served with", () => {
  it("lowers a claim on a slice measured overconfident, without inverting it", () => {
    const cal = buildCalibrator(report([row()]));
    const high = cal.apply(0.93, "measured history", "player_prop");
    const low = cal.apply(0.6, "measured history", "player_prop");

    expect(high.probability).toBeLessThan(0.93);
    expect(low.probability).toBeLessThan(0.6);
    // Ordering survives: the leg the model liked more still comes out higher.
    expect(high.probability).toBeGreaterThan(low.probability);
    expect(high.probability).toBeGreaterThan(0);
    expect(high.probability).toBeLessThan(1);
  });

  it("leaves a leg alone when its slice has no sample to speak from", () => {
    const cal = buildCalibrator(report([row({ settled: 3 })]));
    expect(cal.apply(0.93, "measured history", "player_prop").probability).toBe(0.93);
    expect(cal.apply(0.93, "measured history", "moneyline").correction).toBeNull();
  });

  it("prefers how a source behaves on this market over how it behaves overall", () => {
    const wide: CalibrationReport = {
      ...report([row({ key: "player_prop", hitRate: 0.44, won: 44, averagePredicted: 0.46 })]),
      bySource: [row({ key: "measured history", label: "measured history", hitRate: 0.2, won: 20, averagePredicted: 0.8 })],
    };
    const cal = buildCalibrator(wide);
    const got = cal.apply(0.7, "measured history", "player_prop");
    // The narrow slice is nearly calibrated, so the correction is small — the brutal wide slice
    // would have halved it.
    expect(got.correction!.label).toBe("player_prop");
    expect(got.probability).toBeGreaterThan(0.6);
  });

  it("describes in plain Portuguese what it did, for the record", () => {
    const cal = buildCalibrator(report([row()]));
    cal.apply(0.9, "measured history", "player_prop");
    expect(cal.describe()).toContain("prometeu 58% e entregou 45% em 100 linhas");
  });

  it("never pushes a probability out of bounds, however bad the slice", () => {
    const cal = buildCalibrator(report([row({ hitRate: 0.01, won: 1, averagePredicted: 0.99, settled: 1000 })]));
    const got = cal.apply(0.99, "measured history", "player_prop");
    expect(got.probability).toBeGreaterThan(0);
    expect(got.probability).toBeLessThan(1);
  });
});

