import { describe, expect, it } from "vitest";
import { attributionRows, killerLegs, soleKiller } from "@/lib/ledger/attribution";
import type { LedgerEntry, LegOutcome, SettledLeg } from "@/lib/types";

const leg = (outcome: LegOutcome, over: Partial<SettledLeg> = {}): SettledLeg => ({
  selection: "x", market: "player_prop", sourceBasis: "measured history", predictedProbability: 0.7, oddsDecimal: 1.6, outcome, ...over,
});

const entry = (outcome: LegOutcome, legs: SettledLeg[], over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `t:${outcome}:${legs.length}:${over.id ?? ""}`, gameId: "401", sportKey: "wnba", matchup: "A @ B", createdAt: "2026-09-22T00:00:00.000Z",
  bandKey: "safe", kind: legs.length > 1 ? "parlay" : "single", title: "t", combinedDecimal: 2, modelledProbability: 0.5, legs, outcome, ...over,
});

describe("who killed the ticket", () => {
  it("names the single losing leg", () => {
    const e = entry("lost", [leg("won"), leg("lost"), leg("won")]);
    expect(killerLegs(e)).toEqual([1]);
    expect(soleKiller(e)).toBe(1);
  });

  it("refuses to blame anyone when two legs died", () => {
    const e = entry("lost", [leg("lost"), leg("lost"), leg("won")]);
    expect(killerLegs(e)).toEqual([0, 1]);
    expect(soleKiller(e)).toBeNull();
  });

  it("finds no killer on a ticket that won", () => {
    expect(killerLegs(entry("won", [leg("won"), leg("won")]))).toEqual([]);
    expect(soleKiller(entry("won", [leg("won")]))).toBeNull();
  });
});

describe("the rows", () => {
  const day = () => "2026-09-22";

  it("writes one row per decided leg and marks the sole killer", () => {
    const rows = attributionRows([entry("lost", [leg("won"), leg("lost", { marketKey: "pra" })])], day);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sole)).toEqual([false, true]);
    expect(rows[1].marketKey).toBe("pra");
  });

  it("never counts a push, a void or a pending leg", () => {
    const rows = attributionRows([entry("lost", [leg("lost"), leg("push"), leg("void"), leg("pending")])], day);
    expect(rows).toHaveLength(1);
  });

  it("produces nothing at all for a pending ticket", () => {
    expect(attributionRows([entry("pending", [leg("pending")])], day)).toEqual([]);
  });

  it("gives a winner's legs rows with no blame on them", () => {
    const rows = attributionRows([entry("won", [leg("won"), leg("won")])], day);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.sole === false && r.outcome === "won")).toBe(true);
  });

  it("keeps the scope and the alternative flag, so the slices never mix", () => {
    const rows = attributionRows([
      entry("lost", [leg("lost")], { id: "live", scope: "live" }),
      entry("lost", [leg("lost")], { id: "alt", alternativeOf: "main" }),
    ], day);
    expect(rows.map((r) => `${r.scope}:${r.alternative}`)).toEqual(["live:false", "pre:true"]);
  });
});
