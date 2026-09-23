import { describe, expect, it } from "vitest";
import fixture from "./fixtures/selecao-3-noites.json";
import { DEFAULT_CALIBRATION, PERIOD_MIN_LEGS, selectDaily, type Candidate, type SelectionContext } from "@/lib/bets/selection";
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

  /**
   * The quarters as the ledger of 22/09 measured them at fair price, on the 168 unique decided
   * legs of `ledger-live-20260922.jsonl`: Q1 has 17 legs and therefore no verdict, Q2 is 19.5
   * points overconfident, Q3 is 4.0 under, Q4 is 21.6 under. The factor is the gap turned into a
   * multiplier; what the tests below pin is the ORDER these produce, never the levels.
   */
  const PERIODS_2209 = {
    1: { settled: 17, factor: 0.78, sigmaP: 0.15, gapPoints: -0.202 },
    2: { settled: 48, factor: 0.79, sigmaP: 0.14, gapPoints: -0.195 },
    3: { settled: 52, factor: 0.96, sigmaP: 0.08, gapPoints: -0.04 },
    4: { settled: 51, factor: 0.78, sigmaP: 0.15, gapPoints: -0.216 },
  };
  const liveCtx = () => ctx({ calibration: { ...DEFAULT_CALIBRATION, livePeriods: PERIODS_2209 } });

  it("sends at most two a night, and the quarter that keeps its promise goes first", () => {
    const rows = [
      live({ ledgerId: "L1", gameId: "g1", period: 1, decimal: 2.4, modelProbability: 0.62 }),
      live({ ledgerId: "L2", gameId: "g2", period: 3, decimal: 3.6, modelProbability: 0.35 }),
      live({ ledgerId: "L3", gameId: "g3", period: 4, decimal: 2.2, modelProbability: 0.66 }),
    ];
    const sel = selectDaily(rows, liveCtx());
    expect(sel.live).toHaveLength(2);
    // Q3 wins on its own measurement, not because the code names it.
    expect(sel.live[0].candidate.ledgerId).toBe("L2");
    expect(sel.live[0].periodCalibration).toMatchObject({ period: 3, settled: 52 });
  });

  it("elects whichever quarter the ledger says keeps its promise — nothing here is hard-coded to 3", () => {
    const flipped = { ...PERIODS_2209, 2: { settled: 48, factor: 0.97, sigmaP: 0.08, gapPoints: -0.02 }, 3: { settled: 52, factor: 0.78, sigmaP: 0.15, gapPoints: -0.22 } };
    const rows = [
      live({ ledgerId: "L2", gameId: "g2", period: 3, decimal: 3.6, modelProbability: 0.35 }),
      live({ ledgerId: "L4", gameId: "g4", period: 2, decimal: 2.4, modelProbability: 0.62 }),
    ];
    const sel = selectDaily(rows, ctx({ calibration: { ...DEFAULT_CALIBRATION, livePeriods: flipped } }));
    expect(sel.live[0].candidate.ledgerId).toBe("L4");
  });

  it("a quarter under the 20-leg gate corrects nothing and says so", () => {
    const rows = [live({ ledgerId: "L1", gameId: "g1", period: 1, decimal: 2.4, modelProbability: 0.62 })];
    const sel = selectDaily(rows, liveCtx());
    expect(sel.live).toHaveLength(1);
    // Q1 has 17 decided legs on the real ledger: under the gate, so no verdict and no correction.
    expect(sel.live[0].periodCalibration).toBeNull();
    expect(PERIODS_2209[1].settled).toBeLessThan(PERIOD_MIN_LEGS);
  });

  it("corrects a read by its own quarter, so the same ticket is worth less in Q4 than in Q3", () => {
    const q3 = live({ ledgerId: "Q3", gameId: "g1", period: 3, decimal: 2.2, modelProbability: 0.66 });
    const q4 = live({ ledgerId: "Q4", gameId: "g2", period: 4, decimal: 2.2, modelProbability: 0.66 });
    const sel = selectDaily([q3, q4], liveCtx());
    const of = (id: string) => sel.live.find((l) => l.candidate.ledgerId === id)!;
    expect(of("Q3").calibratedProbability).toBeGreaterThan(of("Q4").calibratedProbability);
    // And neither one is ever worth a stake, whatever its quarter measures.
    expect(sel.live.every((l) => l.units === 0)).toBe(true);
  });
});

/* ── The regression: the three real nights ─────────────────────────────────────────────────── */

/** The fixture carries each ticket's settled outcome beside the candidate the policy reads. */
type RealRow = Candidate & { day: string; outcome: "won" | "lost" | "push" | "void" | "pending" };
const REAL = fixture as RealRow[];
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

/* ── Where the pre-game money actually went ────────────────────────────────────────────────── */

/**
 * The cuts of §1.2 are not taste. This block measures the same fixture the policy runs on and
 * states what the loss is made of, so a future edit that loosens a cut has to argue with a number.
 *
 * Everything here is computed from the fixture at run time — no level is written down — because
 * the fixture is a snapshot that keeps settling. A newer snapshot measured on the server reads
 * -54.8 % overall against this one's -67.7 %, and the two disagree on the level of every small
 * slice while agreeing on every slice big enough to have a verdict. That is exactly why the
 * assertions below are about SIGN and COUNT on samples over the gate, never about a percentage.
 */
const decided = REAL.filter((r) => r.outcome === "won" || r.outcome === "lost");
const roiOf = (rows: RealRow[]) => rows.reduce((a, r) => a + (r.outcome === "won" ? r.decimal : 0), 0) / rows.length - 1;
const greens = (rows: RealRow[]) => rows.filter((r) => r.outcome === "won").length;

/** The product's own sample gate: nothing concludes under 20 decided. */
const GATE = 20;

describe("the long tail is where the pre-game loss lives", () => {
  it("has a sample worth reading at all", () => {
    expect(decided.length).toBeGreaterThanOrEqual(GATE);
  });

  it("above 5x there is not one winner, and the odds cut removes every one of them", () => {
    const longshots = decided.filter((r) => r.decimal > SIZING.maxOdds);
    expect(longshots.length).toBeGreaterThanOrEqual(GATE);
    expect(greens(longshots)).toBe(0);
    expect(roiOf(longshots)).toBe(-1);
    // Not one of them ever reaches the list, and the cut that removes them is about the PRICE:
    // for every longshot that is otherwise clean, the single recorded reason is "odds".
    for (const c of longshots) {
      const sel = selectDaily([c], ctx({ day: c.day, now: Date.parse(c.startsAt) - 3_600_000 }));
      expect(sel.items).toEqual([]);
      const clean = c.evidenceScore === 100 && c.confidence !== "low" && c.legs <= SIZING.maxLegs && !c.alternativeOf;
      if (clean) expect(reasonOf(sel, c.ledgerId)).toBe("odds");
    }
  });

  it("the long and moonshot bands are that same tail wearing a name", () => {
    const tail = decided.filter((r) => r.bandKey === "long" || r.bandKey === "moonshot");
    expect(tail.length).toBeGreaterThanOrEqual(GATE);
    expect(greens(tail)).toBe(0);
    // They are cut by their PRICE, never by their label: the policy has no list of banned bands,
    // so a "long" that ever prices inside 1.30-5.00 is judged like anything else.
    expect(tail.every((r) => r.decimal > SIZING.maxOdds)).toBe(true);
  });

  it("three linhas or more is a different game, and the leg cut removes it", () => {
    const many = decided.filter((r) => r.legs > SIZING.maxLegs);
    expect(many.length).toBeGreaterThanOrEqual(GATE);
    expect(greens(many)).toBeLessThanOrEqual(1);
    expect(roiOf(many)).toBeLessThan(-0.8);
    // Against what survives the cut, on the same nights.
    const few = decided.filter((r) => r.legs <= SIZING.maxLegs);
    expect(greens(few) / few.length).toBeGreaterThan(greens(many) / many.length);
  });

  it("the overconfidence is not in the tail only — it is everywhere, and it grows with the linhas", () => {
    const gap = (rows: RealRow[]) => greens(rows) / rows.length - rows.reduce((a, r) => a + r.modelProbability, 0) / rows.length;
    // Every bucket promises more than it delivers, single linhas included.
    expect(gap(decided.filter((r) => r.legs === 1))).toBeLessThan(0);
    expect(gap(decided.filter((r) => r.legs >= 3))).toBeLessThan(0);
    // This is unpriced correlation between the linhas of one ticket, which is precisely what
    // `p_cal = p_model * c^legs` exists to undo — the compounding, not a flat haircut.
    expect(SIZING.maxLegs).toBeLessThanOrEqual(3);
  });

  it("does NOT tighten the ceiling below 5x: neither half of that window has a verdict", () => {
    const short = decided.filter((r) => r.decimal <= 3);
    const mid = decided.filter((r) => r.decimal > 3 && r.decimal <= SIZING.maxOdds);
    // Both sit under the gate on this snapshot, and a newer one reverses which of the two looks
    // better. Cutting at 3x on that would drop the half that measured better on the other snapshot.
    expect(Math.min(short.length, mid.length)).toBeLessThan(GATE);
    expect(SIZING.maxOdds).toBe(5);
  });

  it("does NOT treat an alternative as a worse ticket: inside the wallet window there is no sample", () => {
    const inWindow = decided.filter((r) => r.decimal >= SIZING.minOdds && r.decimal <= SIZING.maxOdds && r.legs <= SIZING.maxLegs && r.evidenceScore === 100 && r.confidence !== "low");
    const main = inWindow.filter((r) => !r.alternativeOf);
    const alt = inWindow.filter((r) => r.alternativeOf);
    // 19 decided between them: the cut stands on duplication (one bet per game), never on a claim
    // that the second option is worse — measured over ALL tickets the two are indistinguishable.
    expect(inWindow.length).toBeLessThan(GATE);
    expect(Math.min(main.length, alt.length)).toBeGreaterThan(0);
  });
});
