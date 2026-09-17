import { describe, expect, it } from "vitest";
import { applyFilter, bandComparison, curvePath, decidedInOrder, equityCurve, toRows, unitDelta, type BacktestRow } from "@/lib/ledger/backtest";
import type { LedgerEntry } from "@/lib/types";

const row = (id: string, outcome: BacktestRow["outcome"], odds: number, extra: Partial<BacktestRow> = {}): BacktestRow =>
  ({ id, at: `2026-09-${String(10 + Number(id.replace(/\D/g, "") || 0)).padStart(2, "0")}T10:00:00Z`, outcome, odds, band: "value", sport: "soccer-esp", kind: "single", evidence: 70, ...extra });

describe("backtest rows", () => {
  it("maps ledger entries to a shape with no titles, selections or evidence text", () => {
    const e: LedgerEntry = { id: "g:value:Betano leg", gameId: "g", sportKey: "nba", matchup: "A @ B", createdAt: "2026-09-01T00:00:00Z", settledAt: "2026-09-02T00:00:00Z", bandKey: "value", kind: "parlay", title: "Betano special", combinedDecimal: 3.2, modelledProbability: 0.4, outcome: "won", evidenceScore: 55, legs: [{ selection: "x", market: "total", sourceBasis: "Betano", predictedProbability: 0.5, oddsDecimal: 1.6, outcome: "won" }] };
    const [r] = toRows([e, { ...e, id: "old", settledAt: undefined, outcome: "pending", evidenceScore: undefined }]);
    expect(r).toEqual({ id: "g:value:Betano leg", at: "2026-09-02T00:00:00Z", outcome: "won", odds: 3.2, band: "value", sport: "nba", kind: "parlay", evidence: 55 });
    expect(Object.keys(r)).not.toContain("title");
    const [, old] = toRows([e, { ...e, id: "old", settledAt: undefined, outcome: "pending", evidenceScore: undefined }]);
    expect(old).toMatchObject({ at: "2026-09-01T00:00:00Z", evidence: null });
  });
  it("pays odds minus one on a win, costs one on a loss, nothing otherwise", () => {
    expect(unitDelta({ outcome: "won", odds: 2.5 })).toBe(1.5);
    expect(unitDelta({ outcome: "lost", odds: 2.5 })).toBe(-1);
    expect(unitDelta({ outcome: "push", odds: 2.5 })).toBe(0);
    expect(unitDelta({ outcome: "void", odds: 2.5 })).toBe(0);
  });
});

describe("filters", () => {
  const rows = [row("1", "won", 2), row("2", "lost", 3, { band: "mid", kind: "parlay", sport: "nba", evidence: 30 }), row("3", "won", 1.5, { band: "safe", evidence: null })];
  it("narrows by band, sport, kind and minimum evidence; rows without a score drop out under a threshold", () => {
    expect(applyFilter(rows, { band: "mid" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyFilter(rows, { sport: "soccer-esp" }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(applyFilter(rows, { kind: "parlay" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyFilter(rows, { minEvidence: 50 }).map((r) => r.id)).toEqual(["1"]);
    expect(applyFilter(rows, { minEvidence: 0 }).map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(applyFilter(rows, { band: null, sport: null, kind: null, minEvidence: null })).toHaveLength(3);
  });
  it("orders decided rows by settlement time, then id", () => {
    const same = [row("b", "won", 2, { at: "2026-09-10T00:00:00Z" }), row("a", "lost", 2, { at: "2026-09-10T00:00:00Z" }), row("p", "pending", 2), row("z", "won", 2, { at: "2026-09-09T00:00:00Z" })];
    expect(decidedInOrder(same).map((r) => r.id)).toEqual(["z", "a", "b"]);
  });
});

describe("equity curve", () => {
  it("accumulates flat one-unit results and measures drawdown and losing streaks honestly", () => {
    const rows = [row("1", "won", 3), row("2", "lost", 2), row("3", "lost", 2), row("4", "lost", 2), row("5", "won", 2), row("6", "push", 2), row("7", "pending", 2)];
    const c = equityCurve(rows);
    expect([c.decided, c.won, c.lost]).toEqual([5, 2, 3]);
    expect(c.points.map((p) => p.units)).toEqual([2, 1, 0, -1, 0]);
    expect(c.units).toBe(0);
    expect(c.roi).toBe(0);
    expect(c.peak).toBe(2);
    expect(c.maxDrawdown).toBe(3); // from +2 down to -1
    expect(c.longestLosingStreak).toBe(3);
    expect(c.points[0]).toMatchObject({ id: "1", delta: 2, outcome: "won" });
  });
  it("is empty and finite with no decided tickets", () => {
    expect(equityCurve([row("1", "pending", 2)])).toMatchObject({ decided: 0, units: 0, roi: 0, maxDrawdown: 0, longestLosingStreak: 0, points: [] });
  });
  it("compares 'only band X' strategies in ladder order", () => {
    const rows = [row("1", "won", 2), row("2", "lost", 8, { band: "mid" }), row("3", "won", 1.5, { band: "safe" }), row("4", "won", 30, { band: "long", sport: "nba" })];
    const cmp = bandComparison(rows);
    expect(cmp.map((c) => c.band)).toEqual(["safe", "value", "mid", "long"]);
    expect(cmp.find((c) => c.band === "mid")!.summary.units).toBe(-1);
    expect(cmp.find((c) => c.band === "long")!.summary.units).toBe(29);
    expect(bandComparison(rows, { sport: "nba" }).map((c) => c.band)).toEqual(["long"]);
  });
});

describe("curve path", () => {
  it("starts at the zero baseline and keeps zero inside the y-domain", () => {
    const p = curvePath([{ units: 1 }, { units: -1 }, { units: 0.5 }], 100, 50, 0);
    expect(p.min).toBe(-1); expect(p.max).toBe(1);
    expect(p.d).toBe("M0,25 L33.33,0 L66.67,50 L100,12.5");
    expect(p.zeroY).toBe(25);
    const up = curvePath([{ units: 2 }, { units: 4 }], 100, 100, 0);
    expect(up.min).toBe(0); expect(up.zeroY).toBe(100);
    expect(up.d).toBe("M0,100 L50,50 L100,0");
  });
  it("handles an empty curve without NaN", () => {
    const p = curvePath([], 100, 50);
    // a flat zero line sits on the baseline at the bottom of the box
    expect(p.d).toBe("M4,46");
    expect(p.zeroY).toBe(46);
    expect(Number.isFinite(p.zeroY)).toBe(true);
  });
});
