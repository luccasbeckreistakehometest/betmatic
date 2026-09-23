import { describe, expect, it } from "vitest";
import fixture from "./fixtures/selecao-3-noites.json";
import { DEFAULT_CALIBRATION, selectDaily, type Candidate, type SelectionContext } from "@/lib/bets/selection";
import { SIZING } from "@/lib/bets/sizing";

/**
 * The day's short list. Everything here is the policy speaking, and the fixture is the production
 * ledger: 123 pre-game tickets from the three real nights of 21–23/09, copied read-only from the
 * server. The screen the owner sees is downstream of this file; if the numbers here move, the
 * screen's numbers moved, and the test says so.
 */

const KICKOFF = "2026-09-25T22:00:00.000Z";
const NOW = Date.parse("2026-09-25T18:00:00.000Z");

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    ledgerId: "g1:safe:leg", suggestionId: "s1", gameId: "g1", sportKey: "wnba", scope: "pre", bandKey: "safe",
    decimal: 1.6, modelProbability: 0.7, legs: 1, players: ["A"], markets: ["pra"],
    evidenceScore: 100, confidence: "high", startsAt: KICKOFF, ...over,
  };
}

function ctx(over: Partial<SelectionContext> = {}): SelectionContext {
  return {
    day: "2026-09-25", sportKey: "wnba", now: NOW,
    calibration: { factorPre: 1, factorLive: 1, sigmaPPre: 0.03, sigmaPLive: 0.03, mode: "carteira" },
    ...over,
  };
}

const reasonOf = (sel: ReturnType<typeof selectDaily>, id: string) => sel.skipped.find((s) => s.ledgerId === id)?.reason;

describe("the cuts, each one with its own reason recorded", () => {
  const cases: [string, Partial<Candidate>, string][] = [
    ["alternative", { alternativeOf: "other" }, "alternative"],
    ["a game already under way", { startsAt: "2026-09-25T10:00:00.000Z" }, "scope"],
    ["evidence under 100", { evidenceScore: 94 }, "evidence"],
    ["low confidence", { confidence: "low" }, "confidence"],
    ["three legs", { legs: 3 }, "legs"],
    ["a price over 5x", { decimal: 6.5, modelProbability: 0.2 }, "odds"],
    ["a price under 1.30", { decimal: 1.2, modelProbability: 0.95 }, "odds"],
    ["an edge under 4 %", { decimal: 1.4, modelProbability: 0.73 }, "edge_low"],
    ["an edge over 20 %", { decimal: 2, modelProbability: 0.65 }, "edge_high"],
    ["an unmapped market", { markets: ["unmapped"] }, "unmapped_market"],
  ];
  for (const [name, over, reason] of cases) {
    it(`skips ${name} and says "${reason}"`, () => {
      const c = candidate(over);
      const sel = selectDaily([c], ctx());
      expect(sel.items).toEqual([]);
      expect(reasonOf(sel, c.ledgerId)).toBe(reason);
    });
  }

  it("drops a shrunk edge under 2 % only while the wallet is open", () => {
    // 3.4x with a 33 % chance: 12 % raw, but the shrinkage at that price leaves under 2 %.
    const c = candidate({ decimal: 3.4, modelProbability: 0.33 });
    expect(reasonOf(selectDaily([c], ctx()), c.ledgerId)).toBe("shrunk_low");
    const medicao = selectDaily([c], ctx({ calibration: { ...DEFAULT_CALIBRATION, mode: "medicao" } }));
    expect(medicao.items).toHaveLength(1);
    expect(medicao.items[0].units).toBe(SIZING.medicaoU);
  });
});

describe("concentration", () => {
  it("takes one per game, two per player and three a night", () => {
    const rows = [
      candidate({ ledgerId: "a", gameId: "g1", players: ["Arike"] }),
      candidate({ ledgerId: "b", gameId: "g1", players: ["Paige"] }),
      candidate({ ledgerId: "c", gameId: "g2", players: ["Arike"] }),
      candidate({ ledgerId: "d", gameId: "g3", players: ["Arike"] }),
      candidate({ ledgerId: "e", gameId: "g4", players: ["Kahleah"] }),
      candidate({ ledgerId: "f", gameId: "g5", players: ["Sabrina"] }),
    ];
    const sel = selectDaily(rows, ctx());
    expect(sel.items).toHaveLength(3);
    expect(new Set(sel.items.map((i) => i.candidate.gameId)).size).toBe(3);
    expect(reasonOf(sel, "b")).toBe("game_taken");
    expect(reasonOf(sel, "d")).toBe("player_cap");
    expect(reasonOf(sel, "f")).toBe("quota");
  });
});

describe("the ranking is growth, never EV%", () => {
  it("puts a short price with a small EV above a long one with a big EV", () => {
    const short = candidate({ ledgerId: "short", gameId: "g1", decimal: 1.5, modelProbability: 0.72 });
    const long = candidate({ ledgerId: "long", gameId: "g2", decimal: 4.9, modelProbability: 0.244 });
    // Measured in the regime where both clear the cuts, so the assertion is about order alone.
    const sel = selectDaily([long, short], ctx({ calibration: { factorPre: 1, factorLive: 1, sigmaPPre: 0.03, sigmaPLive: 0.03, mode: "medicao" } }));
    expect(sel.items.map((i) => i.candidate.ledgerId)).toEqual(["short", "long"]);
    // The long one carries the bigger EV and still loses the rank — this is the whole point.
    expect(long.decimal * long.modelProbability - 1).toBeGreaterThan(short.decimal * short.modelProbability - 1);
    // And in the wallet regime it does not even clear the cuts.
    expect(reasonOf(selectDaily([long], ctx()), "long")).toBe("shrunk_low");
  });

  it("is deterministic: shuffling the input never changes the output", () => {
    const rows = [
      candidate({ ledgerId: "a", gameId: "g1", decimal: 1.5, modelProbability: 0.72 }),
      candidate({ ledgerId: "b", gameId: "g2", decimal: 1.7, modelProbability: 0.64 }),
      candidate({ ledgerId: "c", gameId: "g3", decimal: 1.9, modelProbability: 0.58 }),
      candidate({ ledgerId: "d", gameId: "g4", decimal: 2.4, modelProbability: 0.46 }),
    ];
    const first = selectDaily(rows, ctx()).items.map((i) => i.candidate.ledgerId);
    for (const order of [[3, 1, 0, 2], [2, 0, 3, 1], [1, 3, 2, 0]]) {
      expect(selectDaily(order.map((i) => rows[i]), ctx()).items.map((i) => i.candidate.ledgerId)).toEqual(first);
    }
  });
});

describe("nothing to say is an answer", () => {
  it("returns fechado with an empty list and does not throw", () => {
    const sel = selectDaily([candidate({ decimal: 1.4, modelProbability: 0.6 })], ctx());
    expect(sel.items).toEqual([]);
    expect(sel.live).toEqual([]);
    expect(sel.mode).toBe("fechado");
    expect(sel.totals.units).toBe(0);
  });

  it("survives an empty input", () => {
    expect(() => selectDaily([], ctx())).not.toThrow();
    expect(selectDaily([], ctx()).items).toEqual([]);
  });
});

describe("live reads enter the list and never the wallet", () => {
  const live = (over: Partial<Candidate> = {}) => candidate({ scope: "live", decimal: 3.2, modelProbability: 0.36, startsAt: "2026-09-25T10:00:00.000Z", ...over });

  it("never carries units without a confirmed price", () => {
    const sel = selectDaily([live({ ledgerId: "L1" })], ctx());
    expect(sel.live).toHaveLength(1);
    expect(sel.live[0].units).toBe(0);
    expect(sel.totals.units).toBe(0);
  });

  it("publishes a minimum price and a 90-second validity", () => {
    const sel = selectDaily([live({ ledgerId: "L1" })], ctx());
    expect(sel.live[0].minAcceptableDecimal).toBeGreaterThan(1);
    expect(Date.parse(sel.live[0].expiresAt!) - NOW).toBe(SIZING.liveValidityMs);
  });

  it("asks 8 % of an in-play read, not 4 %", () => {
    const thin = live({ ledgerId: "L2", decimal: 1.8, modelProbability: 0.59 });
    expect(reasonOf(selectDaily([thin], ctx()), "L2")).toBe("edge_low");
  });

  it("sends at most two a night and puts the third quarter first", () => {
    const rows = [
      live({ ledgerId: "L1", gameId: "g1", period: 1, decimal: 2.4, modelProbability: 0.62 }),
      live({ ledgerId: "L2", gameId: "g2", period: 3, decimal: 3.6, modelProbability: 0.35 }),
      live({ ledgerId: "L3", gameId: "g3", period: 4, decimal: 2.2, modelProbability: 0.66 }),
    ];
    const sel = selectDaily(rows, ctx());
    expect(sel.live).toHaveLength(2);
    expect(sel.live[0].candidate.ledgerId).toBe("L2");
  });
});

/* ── The regression: the three real nights ─────────────────────────────────────────────────── */

const REAL = fixture as (Candidate & { day: string })[];
const nights = [...new Set(REAL.map((c) => c.day))].sort();

function realNight(day: string, calibration: SelectionContext["calibration"]) {
  const rows = REAL.filter((c) => c.day === day);
  // Selection happens before kickoff; the fixture's own kickoffs are the clock.
  const now = Math.min(...rows.map((c) => Date.parse(c.startsAt))) - 3_600_000;
  return selectDaily(rows, { day, sportKey: "wnba", now, calibration });
}

describe("the three real nights of the production ledger", () => {
  it("has 123 pre-game tickets across three nights", () => {
    expect(REAL).toHaveLength(123);
    expect(nights).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
  });

  it("regime A (c = 1, σ_p = 0.03): four tickets, 4.50 u over three nights", () => {
    const runs = nights.map((d) => realNight(d, { factorPre: 1, factorLive: 1, sigmaPPre: 0.03, sigmaPLive: 0.03, mode: "carteira" }));
    expect(runs.flatMap((r) => r.items)).toHaveLength(4);
    expect(runs.reduce((a, r) => a + r.totals.units, 0)).toBeCloseTo(4.5, 10);
    // Never more than three a night, never two on the same game.
    for (const run of runs) {
      expect(run.items.length).toBeLessThanOrEqual(SIZING.maxPerDay);
      expect(new Set(run.items.map((i) => i.candidate.gameId)).size).toBe(run.items.length);
    }
  });

  it("the measured calibration closes the wallet entirely", () => {
    const runs = nights.map((d) => realNight(d, { ...DEFAULT_CALIBRATION, mode: "carteira" }));
    expect(runs.flatMap((r) => r.items)).toHaveLength(0);
    expect(runs.every((r) => r.mode === "fechado")).toBe(true);
  });

  it("the measurement regime risks the floor and nothing more", () => {
    const runs = nights.map((d) => realNight(d, DEFAULT_CALIBRATION));
    const items = runs.flatMap((r) => r.items);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.units === SIZING.medicaoU)).toBe(true);
    for (const run of runs) expect(run.totals.units).toBeLessThanOrEqual(SIZING.medicaoDayCapU);
    // Against the 737 u the app asks for on one of these nights today.
    expect(runs.reduce((a, r) => a + r.totals.units, 0)).toBeLessThanOrEqual(3);
  });

  it("never lets an alternative into the wallet", () => {
    const runs = nights.map((d) => realNight(d, { factorPre: 1, factorLive: 1, sigmaPPre: 0.03, sigmaPLive: 0.03, mode: "carteira" }));
    expect(runs.flatMap((r) => r.items).some((i) => i.candidate.alternativeOf)).toBe(false);
  });
});
