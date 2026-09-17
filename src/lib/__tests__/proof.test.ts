import { describe, expect, it } from "vitest";
import { findBySlug, proofStats, recentTickets, ticketSlug } from "@/lib/ledger/proof";
import type { LedgerEntry } from "@/lib/types";

const e = (id: string, outcome: LedgerEntry["outcome"], odds: number, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id, gameId: "g", sportKey: "soccer-bra", matchup: "A @ B", createdAt: "2026-09-10T10:00:00Z", settledAt: outcome === "pending" ? undefined : "2026-09-11T10:00:00Z",
  bandKey: "value", kind: "single", title: id, combinedDecimal: odds, modelledProbability: 0.5, outcome,
  legs: [{ selection: "x", market: "total", sourceBasis: "book", predictedProbability: 0.5, oddsDecimal: odds, outcome: outcome === "pending" ? "pending" : outcome }], ...extra,
});

describe("proofStats", () => {
  it("counts a flat one-unit stake honestly: wins pay odds minus one, losses cost one, pushes nothing", () => {
    const s = proofStats([e("a", "won", 2.5), e("b", "lost", 1.8), e("c", "push", 1.9), e("d", "pending", 3), e("e", "void", 2)]);
    expect([s.generated, s.settled, s.won, s.lost, s.push, s.void, s.pending]).toEqual([5, 4, 1, 1, 1, 1, 1]);
    expect(s.hitRate).toBe(0.5);
    expect(s.unitsStaked).toBe(2);
    expect(s.roi).toBeCloseTo((1.5 - 1) / 2, 10);
  });
  it("slices parlays separately from singles by market", () => {
    const s = proofStats([e("a", "won", 2, { kind: "parlay" }), e("b", "lost", 2)]);
    expect(s.byMarket.map((r) => r.key).sort()).toEqual(["parlay", "total"]);
  });
  it("gives every ticket a short stable public slug", () => {
    const list = [e("g1:value:x|y", "won", 2), e("g1:mid:z", "lost", 3)];
    const slug = ticketSlug(list[0].id);
    expect(slug).toMatch(/^[0-9a-f]{10}$/);
    expect(findBySlug(list, slug)?.id).toBe(list[0].id);
    expect(findBySlug(list, "nope")).toBeNull();
  });
  it("lists settled tickets first, newest settlement first", () => {
    const r = recentTickets([e("p", "pending", 2), e("old", "won", 2, { settledAt: "2026-09-01T00:00:00Z" }), e("new", "lost", 2, { settledAt: "2026-09-12T00:00:00Z" })]);
    expect(r.map((x) => x.id)).toEqual(["new", "old", "p"]);
  });
});
