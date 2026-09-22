import { describe, expect, it } from "vitest";
import { measuredLift, ruleFor, ticketCorrelation, type CorrLeg } from "@/lib/signals/correlation";

const prop = (o: Partial<CorrLeg> & { player: string; probability: number }): CorrLeg => ({ type: "player_prop", athleteId: o.player, team: "DAL", labels: ["PTS"], line: 19.5, side: "over", ...o });

describe("pairwise rules", () => {
  it("prices the same player's overlapping stats as one night and opposing sides against each other", () => {
    expect(ruleFor(prop({ player: "a", probability: 0.6 }), prop({ player: "a", probability: 0.7, labels: ["PTS", "REB", "AST"], line: 24.5 }), {})!.lift).toBe(1.25);
    expect(ruleFor(prop({ player: "a", probability: 0.6 }), prop({ player: "a", probability: 0.7, labels: ["PTS", "REB", "AST"], line: 30.5, side: "under" }), {})!.lift).toBe(0.75);
    expect(ruleFor(prop({ player: "a", probability: 0.6 }), prop({ player: "a", probability: 0.7, labels: ["REB"], line: 6.5 }), {})!.lift).toBe(1.05);
  });

  it("knows teammates share boards, opponents share pace, and a big favourite's cover sits its star", () => {
    expect(ruleFor(prop({ player: "a", probability: 0.6, labels: ["REB"] }), prop({ player: "b", probability: 0.6, labels: ["REB"] }), {})!.lift).toBe(0.93);
    expect(ruleFor(prop({ player: "a", probability: 0.6 }), prop({ player: "b", probability: 0.6, team: "PHX" }), {})!.lift).toBe(1.05);
    expect(ruleFor(prop({ player: "a", probability: 0.6 }), prop({ player: "b", probability: 0.6, team: "PHX", side: "under" }), {})!.lift).toBe(0.97);
    const spread: CorrLeg = { type: "spread", team: "DAL", probability: 0.5 };
    expect(ruleFor(prop({ player: "a", probability: 0.6 }), spread, { homeAbbr: "PHX", awayAbbr: "DAL", spread: 9.5 })!.lift).toBe(0.9);
    expect(ruleFor(prop({ player: "a", probability: 0.6, side: "under" }), spread, { homeAbbr: "PHX", awayAbbr: "DAL", spread: 9.5 })!.lift).toBe(1.08);
    expect(ruleFor(prop({ player: "a", probability: 0.6 }), spread, { homeAbbr: "PHX", awayAbbr: "DAL", spread: 3 })!.lift).toBe(1.05);
    const total: CorrLeg = { type: "total", side: "over", line: 170.5, probability: 0.5 };
    expect(ruleFor(prop({ player: "a", probability: 0.6 }), total, {})!.lift).toBe(1.1);
    expect(ruleFor({ type: "moneyline", team: "DAL", probability: 0.6 }, total, {})).toBeNull();
  });
});

describe("measured co-occurrence", () => {
  const series = (values: number[]) => values.map((v, i) => ({ eventId: `e${i}`, value: v, minutes: 30 }));
  it("measures the lift from the shared games and shrinks it toward the rule", () => {
    // Twenty games where a and b clear their lines together fourteen times out of the twenty they each clear it.
    const a = prop({ player: "a", probability: 0.6, series: series(Array.from({ length: 20 }, (_, i) => (i < 14 ? 25 : 10))) });
    const b = prop({ player: "b", probability: 0.6, series: series(Array.from({ length: 20 }, (_, i) => (i < 14 ? 25 : 10))) });
    const m = measuredLift(a, b, 1)!;
    expect(m.games).toBe(20);
    expect(m.lift).toBeGreaterThan(1.2);
    expect(m.lift).toBeLessThan(1 / 0.7);
    const opposite = prop({ player: "b", probability: 0.6, series: series(Array.from({ length: 20 }, (_, i) => (i < 14 ? 10 : 25))) });
    expect(measuredLift(a, opposite, 1)!.lift).toBeLessThan(0.7);
  });

  it("needs twelve shared games and skips pushes", () => {
    const a = prop({ player: "a", probability: 0.6, series: series([25, 25, 25, 25, 25, 10, 10, 10]) });
    expect(measuredLift(a, prop({ player: "b", probability: 0.6, series: series([25, 25, 25, 25, 25, 10, 10, 10]) }), 1)).toBeNull();
    expect(measuredLift(prop({ player: "a", probability: 0.6 }), prop({ player: "b", probability: 0.6 }), 1)).toBeNull();
  });
});

describe("a ticket's factor", () => {
  it("two rungs of the same stat on one player are one bet: the product collapses to the harder line", () => {
    const r = ticketCorrelation([prop({ player: "a", probability: 0.7, line: 19.5 }), prop({ player: "a", probability: 0.4, line: 24.5 })]);
    expect(r.pairs[0].basis).toBe("redundant");
    expect(r.probability).toBeCloseTo(0.4, 6);
    expect(r.note).toMatch(/one bet/);
    const between = ticketCorrelation([prop({ player: "a", probability: 0.7, line: 19.5 }), prop({ player: "a", probability: 0.6, line: 24.5, side: "under" })]);
    expect(between.pairs[0].basis).toBe("nested");
    expect(between.probability).toBeCloseTo(0.3, 6);
  });

  it("multiplies the pairwise lifts, caps the total, and never beats the weakest leg", () => {
    const legs = [prop({ player: "a", probability: 0.9 }), prop({ player: "a", probability: 0.9, labels: ["PTS", "REB"], line: 25.5 }), prop({ player: "a", probability: 0.9, labels: ["PTS", "AST"], line: 23.5 })];
    const r = ticketCorrelation(legs);
    expect(r.independent).toBeCloseTo(0.729, 6);
    expect(r.probability).toBeLessThanOrEqual(0.9);
    expect(r.probability).toBeGreaterThan(r.independent);
    expect(r.factor).toBeGreaterThan(1);
    expect(r.pairs.every((p) => p.basis === "rule" && p.lift === 1.25)).toBe(true);
  });

  it("leaves independent legs alone and says so", () => {
    const r = ticketCorrelation([prop({ player: "a", probability: 0.6 }), prop({ player: "b", probability: 0.6, side: "under" })]);
    // Teammates on opposite sides: rule lift 1, no pair recorded.
    expect(r.pairs).toEqual([]);
    expect(r.factor).toBe(1);
    expect(r.note).toBe("legs priced as independent");
  });

  it("names the pairs that moved the number and counts the quiet ones", () => {
    const legs = [prop({ player: "a", probability: 0.6 }), prop({ player: "b", probability: 0.6, team: "PHX" }), prop({ player: "c", probability: 0.6, team: "PHX", side: "under" }), prop({ player: "a", probability: 0.6, labels: ["PTS", "REB"], line: 25.5 })];
    const r = ticketCorrelation(legs);
    expect(r.note).toMatch(/^correlation ×/);
    expect(r.note).toMatch(/rule ×1\.25 \(same player, overlapping stats/);
    expect(r.note).toMatch(/pairs? within 5% of independent/);
  });
});
