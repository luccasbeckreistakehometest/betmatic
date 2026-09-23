import { describe, expect, it } from "vitest";
import fixture from "./fixtures/selecao-3-noites.json";
import { DEFAULT_CALIBRATION, PERIOD_MIN_LEGS, selectDaily, type Candidate, type SelectionContext } from "@/lib/bets/selection";
import { SIZING, shrinkFactor } from "@/lib/bets/sizing";

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
    // In the measurement regime cut 8 does not apply, so the ticket is not discarded — but its
    // size is still the formula's, and at 3.4x with that σ_p the formula says nothing. It lands in
    // `observations`: listed, no stake, and a reason.
    const medicao = selectDaily([c], ctx({ calibration: { ...DEFAULT_CALIBRATION, mode: "medicao" } }));
    expect(medicao.items).toHaveLength(0);
    expect(medicao.observations).toHaveLength(1);
    expect(medicao.observations[0].noStakeReason).toBe("below_floor");
    expect(reasonOf(medicao, c.ledgerId)).toBeUndefined();
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
    // Order is what this pins, so both arms are read together: the long one sizes under the floor
    // even at σ_p = 0.03, which is itself the point being made.
    expect([...sel.items, ...sel.observations].map((i) => i.candidate.ledgerId)).toEqual(["short", "long"]);
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

  /**
   * Four tickets and 4.50 u, where the project's §2i specified six and 6.75 u.
   *
   * The 6/6.75 came from the research script that proposed the policy (`politica/policy.py`),
   * which filtered on {pre-game, main, EV ≥ 100, ≤ 2 linhas, ≤ 5x, edge > 0} and rounded the
   * stake. The policy of §1.2 is stricter than the script that suggested it, and three of the ten
   * cuts the script never had are what move the number: cut 3 (confidence), cut 6/7 (the 4-20 %
   * edge window) and cut 8 (the shrunk edge) drop two of the six, and the floor — flooring to the
   * 0.25 u step rather than rounding, because rounding up is betting above Kelly — takes a third
   * from 0.25 u to nothing.
   *
   * So 4/4.50 u is what the specified policy does; 6/6.75 u was what a looser filter did. The
   * number moved because the specification was measured, not because the specification changed.
   */
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

  it("with the σ_p the ledger measures, the measurement regime recommends NOTHING — and says so", () => {
    const runs = nights.map((d) => realNight(d, DEFAULT_CALIBRATION));
    const items = runs.flatMap((r) => r.items);
    const observations = runs.flatMap((r) => r.observations);

    // This is the fix the owner asked for. These same nights used to print six tickets at 0.25 u,
    // including a 0.25 u on a 1.86 to win 0.215. With σ_p ≈ 0.125 the formula sizes every one of
    // them at a few hundredths of a unit, so the honest answer is no stake at all.
    expect(items).toHaveLength(0);
    expect(runs.reduce((a, r) => a + r.totals.units, 0)).toBe(0);

    // And they are not hidden: they cleared every cut, so they are listed as observations with a
    // reason, not swept into the discard pile with the tickets that never qualified.
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((o) => o.units === 0 && o.noStakeReason === "below_floor")).toBe(true);
    for (const run of runs) if (run.observations.length) expect(run.note).toMatch(/nothing is worth a stake today/);
  });

  it("still sizes with the formula when the estimate is sharp enough to earn it", () => {
    // Same nights, same cuts, σ_p at the floor instead of the ceiling: now the arithmetic clears
    // 0.25 u on its own and the regime holds it AT the floor rather than inventing it there.
    const runs = nights.map((d) => realNight(d, { ...DEFAULT_CALIBRATION, sigmaPPre: SIZING.sigmaPFloor }));
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
 * Every level is computed from the fixture at run time and nothing is written down, because the
 * fixture is a frozen snapshot and the production ledger behind it keeps moving. It has already
 * moved once in a way that mattered: the settle vocabulary could not read `PTS+AST`, `REB+AST` or
 * `PTS+REB`, 57 settled linhas had been filed as unmeasurable, and re-grading them changed nine
 * verdicts — four of which were WINS, so the defect had been making the record look worse than it
 * was. On the corrected ledger the 3-5x band went from -4.9 % to +17.3 % and 5-10x from -63.4 % to
 * -17.1 %.
 *
 * So this block asserts only what survives BOTH readings, and only on slices over the 20-decided
 * gate. Anything the two snapshots disagree about is recorded below as explicitly open, because the
 * gate is a rule for the good news as well as the bad.
 */
type Slice = RealRow[];
const decided = REAL.filter((r) => r.outcome === "won" || r.outcome === "lost");
const roiOf = (rows: Slice) => rows.reduce((a, r) => a + (r.outcome === "won" ? r.decimal : 0), 0) / rows.length - 1;
const greens = (rows: Slice) => rows.filter((r) => r.outcome === "won").length;

/** The product's own sample gate: nothing concludes under 20 decided, in either direction. */
const GATE = 20;

describe("the long tail is where the pre-game loss lives", () => {
  it("has a sample worth reading at all", () => {
    expect(decided.length).toBeGreaterThanOrEqual(GATE);
  });

  it("above 20x there is not one winner, on either reading of the ledger", () => {
    // This snapshot: 0 of 24. The corrected production ledger: 0 of 34, and the correction made it
    // stronger rather than weaker. It is the one price finding with a comfortable sample.
    const dead = decided.filter((r) => r.decimal > 20);
    expect(dead.length).toBeGreaterThanOrEqual(GATE);
    expect(greens(dead)).toBe(0);
    expect(roiOf(dead)).toBe(-1);
  });

  it("the long and moonshot bands are that tail wearing a name, and they die on price", () => {
    const tail = decided.filter((r) => r.bandKey === "long" || r.bandKey === "moonshot");
    expect(tail.length).toBeGreaterThanOrEqual(GATE);
    expect(greens(tail)).toBe(0);
    // Every one of them is priced outside the window, which is why the policy needs no list of
    // banned bands: a "long" that ever prices inside 1.30-5.00 is judged like anything else.
    expect(tail.every((r) => r.decimal > SIZING.maxOdds)).toBe(true);
    for (const c of tail) {
      const sel = selectDaily([c], ctx({ day: c.day, now: Date.parse(c.startsAt) - 3_600_000 }));
      expect(sel.items).toEqual([]);
    }
  });

  it("five linhas or more has never landed one", () => {
    // 0 of 22 here, 0 of 30 on the corrected ledger. Three and four linhas are NOT in this claim:
    // corrected, three reads -45 % and four reads +51 % on six tickets, which is noise.
    const many = decided.filter((r) => r.legs >= 5);
    expect(many.length).toBeGreaterThanOrEqual(GATE);
    expect(greens(many)).toBe(0);
    // The leg cut removes them all, well before the count gets that high.
    expect(SIZING.maxLegs).toBeLessThan(5);
  });

  it("the overconfidence is everywhere, not only in the tail, and it grows with the linhas", () => {
    const gap = (rows: Slice) => greens(rows) / rows.length - rows.reduce((a, r) => a + r.modelProbability, 0) / rows.length;
    // Every bucket promises more than it delivers, single linhas included — 65.0 % against 47.6 %
    // on one linha and 21.7 % against 12.5 % on three, on the corrected ledger.
    expect(gap(decided.filter((r) => r.legs === 1))).toBeLessThan(0);
    expect(gap(decided.filter((r) => r.legs >= 3))).toBeLessThan(0);
    // This is unpriced correlation between the linhas of one ticket. Generation now prices it with
    // an explicit correlation factor; `c^legs` is the shape this layer would use if it had to.
    expect(SIZING.maxLegs).toBeLessThanOrEqual(3);
  });
});

/**
 * Three questions the data is not allowed to answer yet. They are tests rather than a comment so
 * that the day the sample clears the gate, the assertion that says "there is no sample" fails and
 * somebody has to come back and decide.
 */
describe("what the sample does NOT support, and must not be adopted by momentum", () => {
  it("does not tighten the ceiling below 5x", () => {
    const short = decided.filter((r) => r.decimal <= 3);
    const mid = decided.filter((r) => r.decimal > 3 && r.decimal <= SIZING.maxOdds);
    expect(Math.min(short.length, mid.length)).toBeLessThan(GATE);
    // And the direction has already reversed once: 3-5x read -43.5 % on this snapshot and +17.3 %
    // on the corrected ledger. Cutting at 3x would have thrown away the better half.
    expect(SIZING.maxOdds).toBe(5);
  });

  it("does not claim the ceiling at 5x is itself measured — only that nothing contradicts it", () => {
    // What IS measured is 20x+. Between 5x and 20x the sample is thin and the corrected ledger
    // reads 5-10x at -17 %, not the -63 % this snapshot shows. The ceiling stands on the shrinkage
    // instead: k(d) = σ²/(σ² + (d·σ_p)²) already strips a long price of its edge without any
    // ceiling at all, so 5.00 is a conservative backstop, not a conclusion. Revisit it at n ≥ 20.
    const between = decided.filter((r) => r.decimal > SIZING.maxOdds && r.decimal <= 20);
    expect(between.length).toBeLessThan(GATE);
    expect(shrinkFactor(20, 0.12)).toBeLessThan(shrinkFactor(SIZING.maxOdds, 0.12));
  });

  it("does not treat an alternative as a worse ticket, and does not yet let one in either", () => {
    const inWindow = decided.filter((r) => r.decimal >= SIZING.minOdds && r.decimal <= SIZING.maxOdds && r.legs <= SIZING.maxLegs && r.evidenceScore === 100 && r.confidence !== "low");
    const main = inWindow.filter((r) => !r.alternativeOf);
    const alt = inWindow.filter((r) => r.alternativeOf);

    // The window itself cleared the gate on the re-graded ledger (27 decided, up from 19), and the
    // two arms land on top of each other: 40.0 % of 10 against 41.2 % of 17, both promised ~54 %.
    // That is the coordinator's finding reproduced — the second option is not the worse ticket.
    expect(inWindow.length).toBeGreaterThanOrEqual(GATE);

    // But a COMPARISON needs both arms over the gate, not their sum, and neither arm is there yet.
    // Applying the gate to the total would be the trick this suite refuses everywhere else: it is
    // the same rule that keeps 3-5x at +17.3 % from becoming a conclusion, and it binds for the
    // good news as well as the bad. So the cut stays, and it stays for the reason it always had —
    // DUPLICATION. An alternative is a second version of the same bet on the same game, and rule 10
    // already caps a game at one ticket, so admitting them would add candidates without adding
    // exposure. That is an argument for relaxing cut 1 the day this assertion fails, not before.
    expect(Math.min(main.length, alt.length)).toBeLessThan(GATE);
    expect(Math.min(main.length, alt.length)).toBeGreaterThan(0);
  });
});
