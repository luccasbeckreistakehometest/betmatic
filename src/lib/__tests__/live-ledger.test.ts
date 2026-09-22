import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BetSuggestion, Game, LedgerEntry } from "@/lib/types";

const DIR = path.join(process.cwd(), "data", "unit-live-ledger");
process.env.DATA_DIR = DIR;
fs.rmSync(DIR, { recursive: true, force: true });

const { readLedger, readLiveLedger, recordPredictions, updateEntries, pendingEntries, ledgerIdFor } = await import("@/lib/ledger/store");
const { liveRecordFrom, liveRecord } = await import("@/lib/ledger/live-record");

const game = {
  id: "g1", sportKey: "wnba", startsAt: "2026-09-22T00:00:00.000Z",
  home: { id: "h", displayName: "Phoenix Mercury", abbreviation: "PHX" }, away: { id: "a", displayName: "Dallas Wings", abbreviation: "DAL" },
} as unknown as Game;

const leg = (selection: string, odds = 1.8) => ({
  selection, market: "player prop", odds: String(odds), oddsDecimal: odds, explanation: "", evidence: "", fairProbability: 0.6,
  settlement: { type: "player_prop" as const, player: "Jessica Shepard", stat: "rebounds", line: 13.5, side: "over" as const, sourceBasis: "measured history" },
});
const ticket = (id: string, bandKey: string, selections: string[], combinedDecimal = 3.2): BetSuggestion => ({
  id, kind: selections.length > 1 ? "parlay" : "single", bandKey, title: id, background: "", legs: selections.map((s) => leg(s)),
  combinedDecimal, combinedAmerican: "+220", impliedProbability: 1 / combinedDecimal, modelledProbability: 0.4, edgePct: 0.1,
  riskNote: "", confidence: "low", evidenceScore: 70, evidenceNotes: [],
});

// An empty file is written first: with no file, the store would copy the legacy ./.ledger of the
// checkout into the test directory and the assertions would count someone else's tickets.
beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
  fs.writeFileSync(path.join(DIR, "ledger", "predictions.jsonl"), "");
});

describe("the live scope of the ledger", () => {
  it("keeps a live read out of the default read and out of the pre-game ids", () => {
    const shape = ticket("t1", "mid", ["Shepard o13.5 REB", "Bueckers o24.5 PRA"]);
    expect(recordPredictions(game, [shape])).toBe(1);
    expect(recordPredictions(game, [shape], { live: { minute: 20 } })).toBe(1);
    expect(readLedger()).toHaveLength(1);
    expect(readLedger({ includeLive: true })).toHaveLength(2);
    const live = readLiveLedger();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ scope: "live", minute: 20, outcome: "pending" });
    expect(live[0].id).toBe(ledgerIdFor("g1", shape, { minute: 20 }));
    expect(live[0].id).not.toBe(ledgerIdFor("g1", shape));
    expect(readLedger()[0].scope).toBeUndefined();
  });

  it("treats the same legs at another minute as another bet, and the same minute as the same one", () => {
    const shape = ticket("t1", "mid", ["Shepard o13.5 REB"]);
    recordPredictions(game, [shape], { live: { minute: 20 } });
    expect(recordPredictions(game, [shape], { live: { minute: 20 } })).toBe(0);
    expect(recordPredictions(game, [shape], { live: { minute: 35 } })).toBe(1);
    expect(readLiveLedger().map((e) => e.minute)).toEqual([20, 35]);
  });

  it("settles live reads with everything else and never loses them on a rewrite", () => {
    recordPredictions(game, [ticket("pre", "safe", ["Shepard o13.5 REB"])]);
    recordPredictions(game, [ticket("live", "long", ["Shepard o13.5 REB", "Bueckers o24.5 PRA"], 14.65)], { live: { minute: 20 } });
    expect(pendingEntries()).toHaveLength(2);
    // The settle pass rewrites the pre-game entry only; the live one must survive the rewrite.
    const pre = readLedger()[0];
    updateEntries([{ ...pre, outcome: "won", settledAt: "2026-09-22T03:00:00.000Z" }]);
    expect(readLedger()[0].outcome).toBe("won");
    expect(readLiveLedger()).toHaveLength(1);
    expect(pendingEntries().map((e) => e.scope)).toEqual(["live"]);
  });
});

describe("the live record", () => {
  const entry = (id: string, bandKey: string, outcome: LedgerEntry["outcome"], combinedDecimal: number, legs: LedgerEntry["outcome"][], scope?: "live"): LedgerEntry => ({
    id, gameId: "g1", sportKey: "wnba", matchup: "DAL @ PHX", createdAt: "", bandKey, kind: "parlay", title: id, combinedDecimal, modelledProbability: 0.25,
    outcome, ...(scope ? { scope, minute: 20 } : {}),
    legs: legs.map((o) => ({ selection: "x", market: "player_prop", sourceBasis: "", predictedProbability: 0.6, oddsDecimal: 1.8, outcome: o })),
  });

  it("counts hit rates and a reference return, ignoring pre-game entries and pending reads", () => {
    const r = liveRecordFrom([
      entry("a", "mid", "won", 14.65, ["won", "won", "won"], "live"),
      entry("b", "mid", "lost", 13.06, ["won", "lost", "won", "won"], "live"),
      entry("c", "long", "lost", 19.11, ["won", "won", "lost", "won"], "live"),
      entry("d", "long", "pending", 20, ["pending"], "live"),
      entry("pre", "safe", "won", 1.38, ["won"]),
    ]);
    expect(r).toMatchObject({ decided: 3, pending: 1, won: 1, legs: 11, legsWon: 9, referenceReturn: 14.65 });
    expect(r.hitRate).toBeCloseTo(1 / 3, 6);
    expect(r.legHitRate).toBeCloseTo(9 / 11, 6);
    expect(r.modelledAverage).toBeCloseTo(0.25, 6);
    expect(r.bands.map((b) => [b.bandKey, b.tickets, b.won])).toEqual([["mid", 2, 1], ["long", 1, 0]]);
  });

  it("reads the live entries from the ledger file", () => {
    recordPredictions(game, [ticket("live", "long", ["Shepard o13.5 REB"], 14.65)], { live: { minute: 20 } });
    expect(liveRecord()).toMatchObject({ decided: 0, pending: 1 });
  });
});
