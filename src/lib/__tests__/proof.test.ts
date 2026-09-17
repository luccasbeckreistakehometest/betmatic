import { describe, expect, it } from "vitest";
import { findBySlug, isPublicTicket, proofStats, publicTickets, recentTickets, ticketSlug } from "@/lib/ledger/proof";
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

describe("public tickets", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  it("keeps a ticket private until its game starts, whatever its outcome field says", () => {
    expect(isPublicTicket(e("a", "pending", 2, { startsAt: "2026-09-17T15:00:00Z" }), now)).toBe(false);
    expect(isPublicTicket(e("b", "pending", 2, { startsAt: "2026-09-17T11:59:00Z" }), now)).toBe(true);
    expect(isPublicTicket(e("c", "lost", 2, { startsAt: "2026-09-17T15:00:00Z" }), now)).toBe(false);
  });
  it("treats tickets logged before kickoff times existed as public only once graded", () => {
    expect(isPublicTicket(e("d", "pending", 2), now)).toBe(false);
    expect(isPublicTicket(e("e", "won", 2), now)).toBe(true);
    expect(isPublicTicket(e("f", "pending", 2, { startsAt: "garbage" }), now)).toBe(false);
  });
  it("filters a list without touching the counts' source", () => {
    const list = [e("a", "pending", 2, { startsAt: "2026-09-18T00:00:00Z" }), e("b", "won", 2), e("c", "pending", 2)];
    expect(publicTickets(list, now).map((x) => x.id)).toEqual(["b"]);
    expect(proofStats(list).generated).toBe(3);
  });
});

describe("main tickets only", async () => {
  const { mainTickets, proofStats } = await import("@/lib/ledger/proof");
  it("leaves alternatives out of the counts unless asked", () => {
    const base = { gameId: "g", sportKey: "nba", matchup: "a @ b", createdAt: "2026-09-01", bandKey: "value", kind: "single" as const, title: "t", combinedDecimal: 2, modelledProbability: 0.5, legs: [], outcome: "won" as const };
    const entries: import("@/lib/types").LedgerEntry[] = [{ ...base, id: "m" }, { ...base, id: "a", alternativeOf: "m", outcome: "lost" }];
    expect(proofStats(mainTickets(entries)).generated).toBe(1);
    expect(proofStats(mainTickets(entries, true)).generated).toBe(2);
  });
});
