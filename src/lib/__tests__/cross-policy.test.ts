import { describe, expect, it } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";

process.env.DATA_DIR = path.join(process.cwd(), "data", "unit-cross-policy");
const {
  CROSS_BANDS, CROSS_HARD_MAX_DECIMAL, CROSS_MAX_DECIMAL, CROSS_MAX_LEGS, CROSS_MAX_TICKETS, CROSS_MEASURED_MAX_DECIMAL,
  CROSS_MIN_DECIMAL, CROSS_MIN_GAMES, CROSS_MIN_LEGS, CROSS_MIN_TICKETS_PER_DAY,
  crossDailyEnabled, crossPromptLines, crossShapeReason, dailyCrossVerdict, topCrossTickets,
} = await import("@/lib/bets/cross-policy");
const { getBand } = await import("@/lib/odds");
type Bet = import("@/lib/types").BetSuggestion;

const ticket = (id: string, combinedDecimal: number, legs: number, evidenceScore = 100, modelledProbability = 0.4): Bet => ({
  id, kind: legs > 1 ? "parlay" : "single", bandKey: "value", title: id, background: "",
  legs: Array.from({ length: legs }, (_, i) => ({
    selection: `${id} leg ${i}`, market: "player prop", odds: "1.80", oddsDecimal: 1.8, explanation: "", evidence: "measured",
    fairProbability: 0.6, gameId: `g${i}`, settlement: { type: "player_prop" as const, player: `p${id}${i}`, stat: "points", line: 10.5, side: "over" as const, sourceBasis: "measured history" },
  })),
  combinedDecimal, combinedAmerican: "+200", impliedProbability: 1 / combinedDecimal, modelledProbability, edgePct: 1,
  riskNote: "", confidence: "medium", evidenceScore, evidenceNotes: [],
});

describe("the window the day's cross-game múltiplas are built in", () => {
  it("is the value band's own window, so the ask and the gate cannot drift", () => {
    expect(CROSS_BANDS).toEqual(["value"]);
    expect(getBand("value").min).toBe(CROSS_MIN_DECIMAL);
    expect(getBand("value").max).toBe(CROSS_MAX_DECIMAL);
  });

  it("is the slice of the ledger that paid, and excludes the one that never won", () => {
    // The measurements in bets/cross-policy.ts, recomputed here from the fixture they were taken
    // from, so the numbers written in the comment stay true as the fixture grows. Pre-game only:
    // the live reads are a different population (ledger/recalibrate.ts measures them apart).
    const rows = readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures/ledger-prod-20260923.jsonl"), "utf8")
      .trim().split("\n").map((l) => JSON.parse(l) as { outcome: string; scope?: string; combinedDecimal: number });
    const pre = rows.filter((r) => r.scope !== "live" && (r.outcome === "won" || r.outcome === "lost"));
    const slice = (lo: number, hi: number) => pre.filter((r) => r.combinedDecimal >= lo && r.combinedDecimal < hi);
    const green = (list: typeof pre) => list.filter((r) => r.outcome === "won").length;

    // Above the ceiling: no winner at all, over a real sample. This is what the section asked for
    // before this policy existed (long + moonshot + lottery).
    const long = pre.filter((r) => r.combinedDecimal >= 20);
    expect(long.length).toBeGreaterThanOrEqual(33);
    expect(green(long)).toBe(0);

    // From the ceiling up: 2 green in 52.
    const above = pre.filter((r) => r.combinedDecimal >= CROSS_MAX_DECIMAL);
    expect(green(above) / above.length).toBeLessThan(0.05);

    // Inside the window: the only pre-game slice that returned more than it cost.
    const inside = slice(CROSS_MIN_DECIMAL, CROSS_MAX_DECIMAL);
    const returned = inside.filter((r) => r.outcome === "won").reduce((a, r) => a + r.combinedDecimal, 0);
    expect(inside.length).toBeGreaterThan(10);
    expect(returned / inside.length).toBeGreaterThan(1);

    // Below the floor: it hits more often and still loses money.
    const below = slice(1, CROSS_MIN_DECIMAL);
    const belowReturn = below.filter((r) => r.outcome === "won").reduce((a, r) => a + r.combinedDecimal, 0);
    expect(green(below) / below.length).toBeGreaterThan(green(inside) / inside.length);
    expect(belowReturn / below.length).toBeLessThan(1);
  });
});

describe("the shape gate", () => {
  it("passes a double and a triple inside the window", () => {
    expect(crossShapeReason(ticket("a", 3.24, 2))).toBeNull();
    expect(crossShapeReason(ticket("b", 4.91, 3))).toBeNull();
  });

  it("refuses a single: a múltipla entre jogos is at least two games", () => {
    expect(crossShapeReason(ticket("s", 3, 1))).toMatch(/at least 2/);
    expect(CROSS_MIN_LEGS).toBe(2);
  });

  // A combination of whole tickets carries the legs of both, so the leg cap had to rise with the
  // owner's rule of 25/09/2026. It is still a cap: past it the ticket is a pile, not a story.
  it("refuses a ticket by its length before it argues about its price", () => {
    const reason = crossShapeReason(ticket("long", 45, CROSS_MAX_LEGS + 1));
    expect(reason).toMatch(new RegExp(`${CROSS_MAX_LEGS + 1} legs`));
    expect(reason).not.toMatch(/backstop/);
    expect(CROSS_MAX_LEGS).toBe(12);
  });

  // A 4-leg ticket combined with a 3-leg one is what the rule asks for, and it must pass.
  it("lets a combination of two whole tickets through", () => {
    expect(crossShapeReason(ticket("30x com 25x", 750, 7))).toBeNull();
  });

  it("refuses a price under the floor, and only an arithmetic accident above", () => {
    expect(crossShapeReason(ticket("short", 1.96, 2))).toMatch(/under the 2.00x floor/);
    // The measured ceiling stopped being a refusal on 25/09: past it is a label, not a gate.
    expect(crossShapeReason(ticket("was-refused", CROSS_MEASURED_MAX_DECIMAL, 2))).toBeNull();
    expect(crossShapeReason(ticket("long", 900, 4))).toBeNull();
    expect(crossShapeReason(ticket("absurd", CROSS_HARD_MAX_DECIMAL, 4))).toMatch(/backstop/);
  });

  it("refuses a ticket with no computed price rather than guessing one", () => {
    expect(crossShapeReason(ticket("nan", NaN, 2))).toBe("no computed price");
  });
});

describe("the day's short list", () => {
  it("keeps the best-evidenced tickets and leaves the rest", () => {
    const ids = "abcdefghijklmnopqrst".split("");
    const bets = ids.map((id, i) => ticket(id, 3, 2, 50 + i));
    const kept = topCrossTickets(bets);
    expect(kept).toHaveLength(CROSS_MAX_TICKETS);
    // The best-evidenced survive, and there are more of them now: the day's floor is ten.
    expect(CROSS_MAX_TICKETS).toBeGreaterThanOrEqual(CROSS_MIN_TICKETS_PER_DAY);
    // Kept by evidence, returned in the CALLER order — linkAlternatives has already sorted it.
    expect(kept.map((b) => b.id)).toEqual(ids.slice(-CROSS_MAX_TICKETS));
  });

  it("breaks a tie on evidence and chance with the id, so two runs pick the same pair", () => {
    const bets = ["d", "c", "b", "a"].map((id) => ticket(id, 3, 2, 50, 0.4));
    // Which two are kept is decided by the id; the order they come back in is the caller's own,
    // which linkAlternatives has already sorted by price.
    expect(topCrossTickets(bets, 2).map((b) => b.id).sort()).toEqual(["a", "b"]);
    expect(topCrossTickets([...bets].reverse(), 2).map((b) => b.id).sort()).toEqual(["a", "b"]);
  });

  it("never leaves an alternative without its main", () => {
    const main = ticket("m", 3, 2, 30);
    const alt: Bet = { ...ticket("alt", 3.1, 2, 100), alternativeFor: "m" };
    const kept = topCrossTickets([main, alt, ticket("x", 3, 2, 99), ticket("y", 3, 2, 98), ticket("z", 3, 2, 97)], 3);
    expect(kept.map((b) => b.id)).toEqual(["x", "y", "z"]);
  });

  it("leaves a short list alone", () => {
    const bets = [ticket("a", 3, 2), ticket("b", 3, 2)];
    expect(topCrossTickets(bets)).toBe(bets);
  });
});

describe("whether the scheduler builds today's múltiplas", () => {
  const base = { upcomingGames: 4, exists: false, aiConfigured: true, budgetExhausted: false, ranToday: false, enabled: true };

  it("builds on a grid of two games or more", () => {
    expect(dailyCrossVerdict(base)).toBe("generate");
    expect(dailyCrossVerdict({ ...base, upcomingGames: CROSS_MIN_GAMES })).toBe("generate");
  });

  it("says so, and spends nothing, when the grid cannot hold a combination across games", () => {
    expect(dailyCrossVerdict({ ...base, upcomingGames: 1 })).toBe("too_few_games");
    expect(dailyCrossVerdict({ ...base, upcomingGames: 0 })).toBe("too_few_games");
  });

  it("never pays twice for the same day", () => {
    expect(dailyCrossVerdict({ ...base, exists: true })).toBe("exists");
    expect(dailyCrossVerdict({ ...base, ranToday: true })).toBe("already_ran");
  });

  it("puts the switch and the calendar ahead of the model, and the budget last", () => {
    expect(dailyCrossVerdict({ ...base, enabled: false, upcomingGames: 9 })).toBe("switched_off");
    expect(dailyCrossVerdict({ ...base, aiConfigured: false })).toBe("ai_off");
    expect(dailyCrossVerdict({ ...base, budgetExhausted: true })).toBe("ai_budget");
    // A one-game night is refused before the budget is even read: nothing to buy.
    expect(dailyCrossVerdict({ ...base, upcomingGames: 1, budgetExhausted: true })).toBe("too_few_games");
  });

  it("reads the env switch, defaulting to on", () => {
    expect(crossDailyEnabled({})).toBe(true);
    expect(crossDailyEnabled({ CROSS_DAILY: "1" })).toBe(true);
    expect(crossDailyEnabled({ CROSS_DAILY: " 0 " })).toBe(false);
  });
});

describe("what the prompt is told", () => {
  it("states the same window the code enforces", () => {
    const text = crossPromptLines().join("\n");
    expect(text).toContain("2.00x");
    expect(text).toContain("5.00x");
    expect(text).toContain(`Never more than ${CROSS_MAX_LEGS}`);
    expect(text).toContain(CROSS_BANDS[0]);
    // The record is stated, not implied: the model is shown why the window is short.
    expect(text).toMatch(/0 green in 34/);
  });
});
