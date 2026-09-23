import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-daily-list");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

import type { BetSlate, BetSuggestion } from "@/lib/types";

const { savePrediction } = await import("@/lib/server/predictions");
const { buildDailyList, dayInventory, readDailyItems, readDailySelection, runDailyList, runTodayJob, sportsWithInventory } = await import("@/lib/server/daily-list");
const { getDb } = await import("@/lib/server/db");

/**
 * The day's list against a real SQLite file: the SQL, the hash guard and the audit trail of
 * discarded candidates. The policy itself is proved in selection.test.ts — this is the plumbing.
 */

const DAY = "2026-09-22";
const KICKOFF = "2026-09-23T00:30:00.000Z"; // 21:30 in Brasília on the 22nd
const NOW = Date.parse("2026-09-22T20:00:00.000Z");

function suggestion(over: Partial<BetSuggestion> & { id: string }): BetSuggestion {
  return {
    kind: "single", bandKey: "safe", title: `ticket ${over.id}`, background: "", legs: [{
      selection: "Paige Bueckers over 24.5 PRA", market: "player_prop", odds: "1.60", oddsDecimal: 1.6, book: "Betano",
      explanation: "", evidence: "", fairProbability: 0.7,
      settlement: { type: "player_prop", player: "Paige Bueckers", stat: "PRA", line: 24.5, side: "over", sourceBasis: "measured history" },
    }],
    combinedDecimal: 1.6, combinedAmerican: "-167", impliedProbability: 0.625, modelledProbability: 0.7, edgePct: 12,
    riskNote: "", confidence: "high", evidenceScore: 100, evidenceNotes: [], ...over,
  };
}

function seed(gameId: string, suggestions: BetSuggestion[], scope: "game" | "live" = "game") {
  const slate: BetSlate = { suggestions, dataNote: "" };
  savePrediction({ scope, sportKey: "wnba", gameId, dateKey: "20260922", lang: "pt", matchup: `Away ${gameId} @ Home ${gameId}`, startsAt: KICKOFF, slate });
}

beforeAll(() => {
  getDb();
  seed("401857201", [
    suggestion({ id: "a1" }),
    suggestion({ id: "a2", confidence: "low" }),
    suggestion({ id: "a3", alternativeFor: "a1" }),
  ]);
  seed("401857202", [suggestion({ id: "b1", combinedDecimal: 1.8, modelledProbability: 0.62 })]);
  seed("401857203", [suggestion({ id: "c1", combinedDecimal: 45, modelledProbability: 0.05, bandKey: "long" })]);
});

describe("the inventory the policy reads", () => {
  it("sees every generated ticket of the day, alternatives included", () => {
    const inventory = dayInventory(DAY, "wnba");
    expect(inventory).toHaveLength(5);
    expect(inventory.filter((e) => e.candidate.alternativeOf)).toHaveLength(1);
    expect(inventory.every((e) => e.candidate.markets.includes("pra"))).toBe(true);
    expect(inventory[0].book).toBe("Betano");
  });

  it("names the sports that have anything today", () => {
    expect(sportsWithInventory(DAY)).toEqual(["wnba"]);
  });
});

describe("the filed answer", () => {
  it("keeps the short list and every discard with its reason", () => {
    const result = runDailyList({ day: DAY, sportKey: "wnba", now: NOW });
    expect(result.written).toBe(true);
    expect(result.candidates).toBe(5);

    const stored = readDailySelection(DAY, "wnba")!;
    const reasons = new Set(stored.skipped.map((s) => s.reason));
    expect(reasons).toContain("alternative");
    expect(reasons).toContain("confidence");
    expect(reasons).toContain("odds");

    const items = readDailyItems(DAY, "wnba");
    expect(items.length).toBeGreaterThan(0);
    // This fixture has no settled ledger behind it, so σ_p sits at the ceiling and the formula
    // sizes everything under the floor. The wallet is therefore closed and the rows are filed as
    // observations — which is the whole point: the answer is still written down in full, with the
    // discards and their reasons, instead of a stake being invented to make the day look alive.
    expect(stored.mode).toBe("fechado");
    expect(stored.totals.units).toBe(0);
    expect(items.every((i) => i.units === 0)).toBe(true);
    expect(stored.note).toMatch(/nothing is worth a stake today/);
    // One per game, and never the long band — the cuts and the concentration rule still ran.
    expect(new Set(items.map((i) => i.gameId)).size).toBe(items.length);
    expect(items.some((i) => i.bandKey === "long")).toBe(false);
    // The owner's ladder is filed beside the formula's number, for the A/B.
    expect(items.every((i) => i.ladderUnits > 0 && i.stakePolicy === "formula")).toBe(true);
  });

  it("does not rewrite an answer that has not changed", () => {
    expect(runDailyList({ day: DAY, sportKey: "wnba", now: NOW }).written).toBe(false);
    expect(runDailyList({ day: DAY, sportKey: "wnba", now: NOW }).written).toBe(false);
  });

  it("stays inside the measurement regime's ceiling for the day", () => {
    const stored = readDailySelection(DAY, "wnba")!;
    expect(stored.totals.units).toBeLessThanOrEqual(1);
  });

  it("builds the same answer in memory when nothing has been filed", () => {
    const live = buildDailyList(DAY, "wnba", { now: NOW });
    const filed = readDailyItems(DAY, "wnba").filter((i) => i.scope === "pre").map((i) => i.ledgerId);
    expect([...live.selection.items, ...live.selection.observations].map((i) => i.candidate.ledgerId)).toEqual(filed);
  });
});

describe("the job", () => {
  it("walks every sport with inventory and is safe to call on every tick", () => {
    const first = runTodayJob({ now: NOW });
    const second = runTodayJob({ now: NOW });
    expect(first.sports).toBe(1);
    expect(second.written).toBe(0);
    expect(second.items).toBe(first.items);
  });
});

describe("a day with nothing worth naming", () => {
  it("files an empty list instead of inventing one", () => {
    seed("401857299", [suggestion({ id: "z1", combinedDecimal: 1.35, modelledProbability: 0.6, evidenceScore: 88 })], "game");
    const empty = runDailyList({ day: "2026-01-01", sportKey: "wnba", now: Date.parse("2026-01-01T12:00:00Z") });
    expect(empty.selection.items).toEqual([]);
    expect(empty.selection.mode).toBe("fechado");
    expect(readDailyItems("2026-01-01", "wnba")).toEqual([]);
  });
});
